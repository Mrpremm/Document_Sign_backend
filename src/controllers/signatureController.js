const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Document = require('../models/Document');
const Signature = require('../models/Signature');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { formatSuccess } = require('../utils/responseFormatter');
const pdfService = require('../services/pdfService');
const emailService = require('../services/emailService');
const tokenService = require('../services/tokenService');

// Add signature to document
exports.addSignature = catchAsync(async (req, res, next) => {
  const { documentId, signerEmail, signerName, position, signatureType } = req.body;
  const document = await Document.findById(documentId);

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  // Check if document is in correct status
  if (document.status !== 'sent') {
    return next(new AppError('Document is not ready for signing.', 400));
  }

  // Check if signer is authorized
  const signer = document.signers.find(s => s.email === signerEmail);
  if (!signer) {
    return next(new AppError('You are not authorized to sign this document.', 403));
  }

  // Check if already signed
  if (signer.signed) {
    return next(new AppError('You have already signed this document.', 400));
  }

  // Validate position
  if (!position || !position.pageNumber || position.x === undefined || position.y === undefined) {
    return next(new AppError('Signature position is required.', 400));
  }

  // Handle signature file if uploaded
  let signatureData;
  if (req.file) {
    // Convert image to base64
    signatureData = fs.readFileSync(req.file.path, { encoding: 'base64' });
    // Clean up temp file
    fs.unlinkSync(req.file.path);
  } else if (req.body.signatureData) {
    signatureData = req.body.signatureData;
  } else {
    return next(new AppError('Signature data is required.', 400));
  }

  // Create signature record
  const signature = await Signature.create({
    documentId: document._id,
    signerEmail,
    signerName,
    signatureData,
    signatureType,
    position,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Add signature to document
  document.signatures.push(signature._id);
  
  // Mark signer as signed
  signer.signed = true;
  signer.signedAt = new Date();
  
  await document.save();

  // Check if all signers have signed
  const allSigned = document.signers.every(s => s.signed);
  
  if (allSigned) {
    // Generate final signed PDF
    const signedPdfPath = await pdfService.generateSignedPDF(
      document.originalFile.path,
      document.signatures
    );

    // Save signed file info
    const signedFilename = `signed-${Date.now()}.pdf`;
    const signedFilepath = path.join('uploads/signed', signedFilename);
    
    fs.copyFileSync(signedPdfPath, signedFilepath);

    document.signedFile = {
      filename: signedFilename,
      path: signedFilepath,
      size: fs.statSync(signedFilepath).size,
      signedAt: new Date(),
    };
    document.status = 'signed';
    await document.save();

    // Notify document owner
    await emailService.sendDocumentSignedNotification({
      to: document.owner.email,
      documentName: document.title,
      signedBy: document.signers.map(s => s.name).join(', '),
    });
  }

  // Log signature
  await AuditLog.log({
    userId: req.user ? req.user.id : null,
    documentId: document._id,
    action: 'signature_added',
    metadata: {
      signerEmail,
      signerName,
      allSigned,
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(201).json(
    formatSuccess({ 
      signature,
      document,
    }, 'Signature added successfully')
  );
});

// Sign document with token (public route)
exports.signWithToken = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const { signatureData, position, signatureType, name } = req.body;

  // Validate token
  const tokenData = await tokenService.verifyToken(token);
  if (!tokenData) {
    return next(new AppError('Invalid or expired token.', 400));
  }

  const { documentId, email } = tokenData;
  const document = await Document.findById(documentId);

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  // Check if document is in correct status
  if (document.status !== 'sent') {
    return next(new AppError('Document is not ready for signing.', 400));
  }

  // Check if signer is authorized
  const signer = document.signers.find(s => s.email === email);
  if (!signer) {
    return next(new AppError('You are not authorized to sign this document.', 403));
  }

  // Check if already signed
  if (signer.signed) {
    return next(new AppError('You have already signed this document.', 400));
  }

  // Handle signature file
  let signatureImageData;
  if (req.file) {
    signatureImageData = fs.readFileSync(req.file.path, { encoding: 'base64' });
    fs.unlinkSync(req.file.path);
  } else if (signatureData) {
    signatureImageData = signatureData;
  } else {
    return next(new AppError('Signature data is required.', 400));
  }

  // Create signature record
  const signature = await Signature.create({
    documentId: document._id,
    signerEmail: email,
    signerName: name || signer.name,
    signatureData: signatureImageData,
    signatureType: signatureType || 'draw',
    position,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Update document
  document.signatures.push(signature._id);
  signer.signed = true;
  signer.signedAt = new Date();
  
  // Invalidate token
  await tokenService.invalidateToken(token);
  
  await document.save();

  // Check if all signers have signed
  const allSigned = document.signers.every(s => s.signed);
  
  if (allSigned) {
    // Generate final signed PDF
    const signedPdfPath = await pdfService.generateSignedPDF(
      document.originalFile.path,
      document.signatures
    );

    const signedFilename = `signed-${Date.now()}.pdf`;
    const signedFilepath = path.join('uploads/signed', signedFilename);
    
    fs.copyFileSync(signedPdfPath, signedFilepath);

    document.signedFile = {
      filename: signedFilename,
      path: signedFilepath,
      size: fs.statSync(signedFilepath).size,
      signedAt: new Date(),
    };
    document.status = 'signed';
    await document.save();

    // Notify document owner
    await emailService.sendDocumentSignedNotification({
      to: document.owner.email,
      documentName: document.title,
      signedBy: document.signers.map(s => s.name).join(', '),
    });
  }

  // Log signature
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

// Get signature information
exports.getSignatureInfo = catchAsync(async (req, res, next) => {
  const { token } = req.params;

  // Validate token
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

  // Find signer info
  const signer = document.signers.find(s => s.email === email);

  res.status(200).json(
    formatSuccess({
      document: {
        title: document.title,
        description: document.description,
        owner: document.owner,
      },
      signer: {
        name: signer.name,
        email: signer.email,
        signed: signer.signed,
      },
      status: document.status,
    }, 'Signature information retrieved successfully')
  );
});

// Get signatures for a document
exports.getDocumentSignatures = catchAsync(async (req, res, next) => {
  const { documentId } = req.params;
  
  const signatures = await Signature.find({ documentId })
    .sort('-signedAt');

  res.status(200).json(
    formatSuccess({ signatures }, 'Signatures retrieved successfully')
  );
});

// Verify signature
exports.verifySignature = catchAsync(async (req, res, next) => {
  const { signatureId } = req.params;
  
  const signature = await Signature.findById(signatureId)
    .populate('documentId');

  if (!signature) {
    return next(new AppError('Signature not found.', 404));
  }

  // Verify document integrity
  let isDocumentIntact = true;
  if (signature.documentId.signedFile && signature.documentId.signedFile.path) {
    const fileBuffer = fs.readFileSync(signature.documentId.signedFile.path);
    const currentHash = crypto
      .createHash('sha256')
      .update(fileBuffer)
      .digest('hex');
    
    isDocumentIntact = currentHash === signature.documentId.metadata.fileHash;
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