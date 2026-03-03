const fs = require('fs');
const path = require('path');
const Document = require('../models/Document');
const Signature = require('../models/Signature');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { formatSuccess } = require('../utils/responseFormatter');
const pdfService = require('../services/pdfService');
const emailService = require('../services/emailService');
const tokenService = require('../services/tokenService');

// ---------------------------------------------------------------------------
// Helper: generate and save signed PDF after all signers have signed
// ---------------------------------------------------------------------------
const finalizeSignedPDF = async (document) => {
  // Populate all signature records (they're stored as ObjectId refs)
  const signatures = await Signature.find({ documentId: document._id });

  if (!signatures.length) return;

  // Ensure output directory exists
  const signedDir = path.join(process.cwd(), 'uploads', 'signed');
  if (!fs.existsSync(signedDir)) {
    fs.mkdirSync(signedDir, { recursive: true });
  }

  // Generate signed PDF
  const signedPdfPath = await pdfService.generateSignedPDF(
    document.originalFile.path,
    signatures
  );

  const signedFilename = `signed-${Date.now()}.pdf`;
  const signedFilepath = path.join(signedDir, signedFilename);

  // Move temp file to final location
  fs.copyFileSync(signedPdfPath, signedFilepath);
  // Clean up temp file if different
  if (signedPdfPath !== signedFilepath && fs.existsSync(signedPdfPath)) {
    fs.unlinkSync(signedPdfPath);
  }

  document.signedFile = {
    filename: signedFilename,
    path: signedFilepath,
    size: fs.statSync(signedFilepath).size,
    signedAt: new Date(),
  };
  document.status = 'signed';
  await document.save();
};

// ---------------------------------------------------------------------------
// POST /api/sign (authenticated — owner adds a signature position)
// ---------------------------------------------------------------------------
exports.addSignature = catchAsync(async (req, res, next) => {
  const { documentId, signerEmail, signerName, position, signatureType } = req.body;
  const document = await Document.findById(documentId).populate('owner', 'name email');

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  if (document.status !== 'sent') {
    return next(new AppError('Document is not ready for signing.', 400));
  }

  const signer = document.signers.find(s => s.email === signerEmail);
  if (!signer) {
    return next(new AppError('You are not authorized to sign this document.', 403));
  }

  if (signer.signed) {
    return next(new AppError('You have already signed this document.', 400));
  }

  if (!position || !position.pageNumber || position.x === undefined || position.y === undefined) {
    return next(new AppError('Signature position is required.', 400));
  }

  // Resolve signature data — file upload takes priority, then body base64
  let signatureData;
  if (req.file) {
    signatureData = fs.readFileSync(req.file.path, { encoding: 'base64' });
    fs.unlinkSync(req.file.path);
  } else if (req.body.signatureData) {
    // Accept raw base64 or data:image/... data URL
    signatureData = req.body.signatureData.replace(/^data:image\/\w+;base64,/, '');
  } else {
    return next(new AppError('Signature data is required.', 400));
  }

  // Create signature record
  const signature = await Signature.create({
    documentId: document._id,
    signerEmail,
    signerName,
    signatureData,
    signatureType: signatureType || 'draw',
    position,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  document.signatures.push(signature._id);
  signer.signed = true;
  signer.signedAt = new Date();
  await document.save();

  const allSigned = document.signers.every(s => s.signed);

  if (allSigned) {
    try {
      await finalizeSignedPDF(document);
      // Notify document owner
      await emailService.sendDocumentSignedNotification({
        to: document.owner.email,
        documentName: document.title,
        signedBy: document.signers.map(s => s.name || s.email).join(', '),
      });
    } catch (err) {
      console.error('Error finalizing signed PDF:', err.message);
    }
  }

  await AuditLog.log({
    userId: req.user ? req.user.id : null,
    documentId: document._id,
    action: 'signature_added',
    metadata: { signerEmail, signerName, allSigned },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(201).json(
    formatSuccess({ signature, document }, 'Signature added successfully')
  );
});

// ---------------------------------------------------------------------------
// GET /api/sign/:token — public route — return document & signer info
// ---------------------------------------------------------------------------
exports.getSignatureInfo = catchAsync(async (req, res, next) => {
  const { token } = req.params;

  const tokenData = await tokenService.verifyToken(token);
  if (!tokenData) {
    return next(new AppError('Invalid or expired token.', 400));
  }

  const { documentId, email } = tokenData;
  const document = await Document.findById(documentId)
    .populate('owner', 'name email');

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  const signer = document.signers.find(s => s.email === email);

  res.status(200).json(
    formatSuccess({
      document: {
        _id: document._id,
        title: document.title,
        description: document.description,
        status: document.status,
        owner: document.owner,
        signatureFields: document.signatureFields,
      },
      signer: {
        name: signer?.name || '',
        email: signer?.email || email,
        signed: signer?.signed || false,
      },
    }, 'Signature information retrieved successfully')
  );
});

// ---------------------------------------------------------------------------
// POST /api/sign/:token — public route — external signer submits signature
// ---------------------------------------------------------------------------
exports.signWithToken = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const { signatureData, position, signatureType, name } = req.body;

  const tokenData = await tokenService.verifyToken(token);
  if (!tokenData) {
    return next(new AppError('Invalid or expired token.', 400));
  }

  const { documentId, email } = tokenData;
  const document = await Document.findById(documentId).populate('owner', 'name email');

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  if (document.status !== 'sent') {
    return next(new AppError('Document is not ready for signing.', 400));
  }

  const signer = document.signers.find(s => s.email === email);
  if (!signer) {
    return next(new AppError('You are not authorized to sign this document.', 403));
  }

  if (signer.signed) {
    return next(new AppError('You have already signed this document.', 400));
  }

  // Resolve signature image data
  let signatureImageData;
  if (req.file) {
    signatureImageData = fs.readFileSync(req.file.path, { encoding: 'base64' });
    fs.unlinkSync(req.file.path);
  } else if (signatureData) {
    // Strip data URL prefix if present
    signatureImageData = signatureData.replace(/^data:image\/\w+;base64,/, '');
  } else {
    return next(new AppError('Signature data is required.', 400));
  }

  // Default position if not provided (page 1, top-left area)
  const sigPosition = position || { pageNumber: 1, x: 50, y: 100, width: 150, height: 50 };

  // Create signature record
  const signature = await Signature.create({
    documentId: document._id,
    signerEmail: email,
    signerName: name || signer.name || email,
    signatureData: signatureImageData,
    signatureType: signatureType || 'draw',
    position: sigPosition,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  document.signatures.push(signature._id);
  signer.signed = true;
  signer.signedAt = new Date();

  // Invalidate token — one-time use
  await tokenService.invalidateToken(token);

  await document.save();

  const allSigned = document.signers.every(s => s.signed);

  if (allSigned) {
    try {
      await finalizeSignedPDF(document);
      await emailService.sendDocumentSignedNotification({
        to: document.owner.email,
        documentName: document.title,
        signedBy: document.signers.map(s => s.name || s.email).join(', '),
      });
    } catch (err) {
      console.error('Error finalizing signed PDF:', err.message);
    }
  }

  await AuditLog.log({
    userId: null,
    documentId: document._id,
    action: 'signature_added',
    metadata: {
      signerEmail: email,
      signerName: name || signer.name,
      allSigned,
      viaToken: true,
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(201).json(
    formatSuccess({
      signature,
      document,
      message: 'Document signed successfully',
    })
  );
});

// ---------------------------------------------------------------------------
// POST /api/sign/:token/reject — public route — external signer rejects
// ---------------------------------------------------------------------------
exports.rejectWithToken = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const { reason } = req.body;

  const tokenData = await tokenService.verifyToken(token);
  if (!tokenData) {
    return next(new AppError('Invalid or expired token.', 400));
  }

  const { documentId, email } = tokenData;
  const document = await Document.findById(documentId).populate('owner', 'name email');

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  if (document.status !== 'sent') {
    return next(new AppError('Document is not ready for rejection.', 400));
  }

  const signer = document.signers.find(s => s.email === email);
  if (!signer) {
    return next(new AppError('You are not authorized to reject this document.', 403));
  }

  if (signer.signed) {
    return next(new AppError('You have already signed this document.', 400));
  }

  document.status = 'rejected';
  document.rejectionReason = reason || 'Rejected by signer';
  await document.save();

  // Invalidate token
  await tokenService.invalidateToken(token);

  // Notify document owner
  try {
    await emailService.sendRejectionNotification({
      to: document.owner.email,
      documentName: document.title,
      reason: reason || 'No reason provided',
      rejectedBy: email,
    });
  } catch (err) {
    console.error('Failed to send rejection email:', err.message);
  }

  await AuditLog.log({
    userId: null,
    documentId: document._id,
    action: 'document_rejected',
    metadata: { reason, rejectedBy: email, viaToken: true },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess({ document }, 'Document rejected successfully')
  );
});

// ---------------------------------------------------------------------------
// GET /api/sign/document/:documentId — authenticated — list all signatures
// ---------------------------------------------------------------------------
exports.getDocumentSignatures = catchAsync(async (req, res, next) => {
  const { documentId } = req.params;

  const signatures = await Signature.find({ documentId })
    .sort('-signedAt');

  res.status(200).json(
    formatSuccess({ signatures }, 'Signatures retrieved successfully')
  );
});

// ---------------------------------------------------------------------------
// GET /api/sign/verify/:signatureId — verify a signature record
// ---------------------------------------------------------------------------
exports.verifySignature = catchAsync(async (req, res, next) => {
  const { signatureId } = req.params;

  const signature = await Signature.findById(signatureId)
    .populate('documentId');

  if (!signature) {
    return next(new AppError('Signature not found.', 404));
  }

  let isDocumentIntact = true;
  if (signature.documentId.signedFile && signature.documentId.signedFile.path) {
    const crypto = require('crypto');
    const filePath = signature.documentId.signedFile.path;
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      const currentHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex');
      isDocumentIntact = currentHash === signature.documentId.metadata?.fileHash;
    }
  }

  res.status(200).json(
    formatSuccess({
      signature,
      verification: {
        isValid: signature.isVerified && isDocumentIntact,
        signedAt: signature.signedAt,
        signerEmail: signature.signerEmail,
        signerName: signature.signerName,
        ipAddress: signature.ipAddress,
        userAgent: signature.userAgent,
        documentIntact: isDocumentIntact,
      },
    }, 'Signature verified successfully')
  );
});