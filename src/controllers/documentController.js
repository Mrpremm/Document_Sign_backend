const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Document = require('../models/Document');
const AuditLog = require('../models/AuditLog');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
const { formatSuccess, formatPaginated } = require('../utils/responseFormatter');
const emailService = require('../services/emailService');
const pdfService = require('../services/pdfService');
const tokenService = require('../services/tokenService');

// Upload new document
exports.uploadDocument = catchAsync(async (req, res, next) => {
  const { title, description, signers } = req.body;

  if (!req.file) {
    return next(new AppError('Please upload a document file.', 400));
  }

  // Parse signers if provided as JSON string
  let signersArray = [];
  if (signers) {
    try {
      signersArray = typeof signers === 'string' ? JSON.parse(signers) : signers;
    } catch (error) {
      return next(new AppError('Invalid signers format.', 400));
    }
  }

  // Get PDF metadata
  const pdfMetadata = await pdfService.getPDFMetadata(req.file.path);

  // Calculate file hash for integrity
  const fileHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(req.file.path))
    .digest('hex');

  // Create document record
  const document = await Document.create({
    title,
    description,
    owner: req.user.id,
    originalFile: {
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimetype: req.file.mimetype,
    },
    signers: signersArray,
    metadata: {
      pageCount: pdfMetadata.pageCount,
      fileHash,
      lastModified: new Date(),
    },
    status: 'draft',
  });

  // Generate signing tokens for signers
  for (const signer of document.signers) {
    const token = document.generateSigningToken(signer.email);
    // Store token in MongoDB via tokenService
    await tokenService.storeToken(token, {
      documentId: document._id,
      email: signer.email,
    });
  }
  await document.save();

  // Log document creation
  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_created',
    metadata: {
      title: document.title,
      fileSize: req.file.size,
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(201).json(
    formatSuccess({ document }, 'Document uploaded successfully')
  );
});

// Get all documents for current user
exports.getMyDocuments = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const status = req.query.status;

  // Build query
  const query = { owner: req.user.id };
  if (status) {
    query.status = status;
  }

  // Execute query with pagination
  const documents = await Document.find(query)
    .populate('signatures')
    .sort('-createdAt')
    .skip(skip)
    .limit(limit);

  const total = await Document.countDocuments(query);

  res.status(200).json(
    formatPaginated(
      documents,
      page,
      limit,
      total,
      'Documents retrieved successfully'
    )
  );
});

// Get single document
exports.getDocument = catchAsync(async (req, res, next) => {
  const document = await Document.findById(req.params.id)
    .populate('signatures')
    .populate('owner', 'name email');

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  // Check ownership
  if (document.owner._id.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new AppError('You do not have permission to view this document.', 403));
  }

  // Log document view
  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_viewed',
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess({ document }, 'Document retrieved successfully')
  );
});

// Update document
exports.updateDocument = catchAsync(async (req, res, next) => {
  const { title, description, signers } = req.body;
  const document = req.document; // From checkDocumentOwnership middleware

  // Only allow updates if document is in draft status
  if (document.status !== 'draft') {
    return next(new AppError('Cannot update document after it has been sent.', 400));
  }

  // Update fields
  if (title) document.title = title;
  if (description) document.description = description;
  if (signers) {
    try {
      document.signers = typeof signers === 'string' ? JSON.parse(signers) : signers;
    } catch (error) {
      return next(new AppError('Invalid signers format.', 400));
    }
  }

  await document.save();

  // Log document update
  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_updated',
    metadata: { updatedFields: Object.keys(req.body) },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess({ document }, 'Document updated successfully')
  );
});

// Save signature field positions set in the document viewer UI
exports.saveSignatureFields = catchAsync(async (req, res, next) => {
  const { fields } = req.body;
  const document = await Document.findOne({ _id: req.params.id, owner: req.user.id });

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  if (document.status !== 'draft') {
    return next(new AppError('Cannot update signature fields after document has been sent.', 400));
  }

  // Persist the field data (positions + signature image data + dates)
  document.signatureFields = Array.isArray(fields) ? fields : [];

  // ── Burn fields into a copy of the PDF ──────────────────────────────────
  // Regenerate the signed PDF whenever ANY field (signature or date) is present
  const hasAnyField = document.signatureFields.some(
    (f) =>
      (f.type === 'signature' && f.signatureDataUrl) ||
      (f.type === 'date' && f.dateValue)
  );

  if (hasAnyField && document.originalFile?.path) {
    try {
      const signed = await pdfService.generateSignedPDFFromFields(
        document.originalFile.path,
        document.signatureFields
      );

      // Remove the previous signed file if it exists
      if (document.signedFile?.path && fs.existsSync(document.signedFile.path)) {
        try { fs.unlinkSync(document.signedFile.path); } catch {}
      }

      document.signedFile = {
        filename: signed.filename,
        path: signed.path,
        size: signed.size,
        signedAt: new Date(),
      };
    } catch (err) {
      // Log but don't fail — field data is still saved to the DB
      console.error('Failed to generate signed PDF:', err.message);
    }
  }

  await document.save();

  res.status(200).json(
    formatSuccess({ signatureFields: document.signatureFields }, 'Signature fields saved successfully')
  );
});

// Send document for signing
exports.sendDocument = catchAsync(async (req, res, next) => {
  const document = req.document; // From checkDocumentOwnership middleware

  if (document.status !== 'draft') {
    return next(new AppError('Document has already been sent or signed.', 400));
  }

  if (!document.signers || document.signers.length === 0) {
    return next(new AppError('Please add at least one signer before sending.', 400));
  }

  // Update status
  document.status = 'sent';
  await document.save();

  // ── Send signing emails ──────────────────────────────────────────────────
  // Always generate a fresh token for each signer so that signers added
  // after the initial upload (via updateDocument) also get an email.
  for (const signer of document.signers) {
    try {
      // Generate a new token and persist it (overwrites any existing one)
      const rawToken = tokenService.generateToken();
      await tokenService.storeToken(rawToken, {
        documentId: document._id,
        email: signer.email,
      });

      const signingUrl = `${process.env.BASE_URL}/sign/${rawToken}`;

      await emailService.sendSigningRequest({
        to: signer.email,
        signerName: signer.name || signer.email,
        documentName: document.title,
        signingUrl,
        senderName: req.user.name,
      });

      console.log(`✅ Signing email sent to ${signer.email}`);
    } catch (emailError) {
      // Log but don't fail the whole request — other signers can still be emailed
      console.error(`❌ Failed to send signing email to ${signer.email}:`, emailError.message);
    }
  }


  // Log document sent
  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_sent',
    metadata: {
      signersCount: document.signers.length,
      signers: document.signers.map(s => s.email),
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess({ document }, 'Document sent for signing successfully')
  );
});

// Reject document (by owner)
exports.rejectDocument = catchAsync(async (req, res, next) => {
  const { reason } = req.body;
  const document = req.document; // From checkDocumentOwnership middleware

  if (document.status !== 'sent') {
    return next(new AppError('Document must be in sent status to reject.', 400));
  }

  document.status = 'rejected';
  document.rejectionReason = reason;
  await document.save();

  // Notify signers (best effort)
  for (const signer of document.signers) {
    try {
      await emailService.sendRejectionNotification({
        to: signer.email,
        documentName: document.title,
        reason,
        rejectedBy: document.owner.email || req.user.email,
      });
    } catch (err) {
      console.error('Failed to send rejection email:', err.message);
    }
  }

  // Log rejection
  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_rejected',
    metadata: { reason },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess({ document }, 'Document rejected successfully')
  );
});

// Delete document
exports.deleteDocument = catchAsync(async (req, res, next) => {
  const document = req.document; // From checkDocumentOwnership middleware

  // Only allow deletion of draft documents
  if (document.status !== 'draft') {
    return next(new AppError('Cannot delete document after it has been sent.', 400));
  }

  // Delete physical files
  try {
    if (document.originalFile && document.originalFile.path) {
      if (fs.existsSync(document.originalFile.path)) {
        fs.unlinkSync(document.originalFile.path);
      }
    }
    if (document.signedFile && document.signedFile.path) {
      if (fs.existsSync(document.signedFile.path)) {
        fs.unlinkSync(document.signedFile.path);
      }
    }
  } catch (error) {
    console.error('Error deleting files:', error);
    // Continue with deletion even if files are missing
  }

  // Delete document from database
  await Document.findByIdAndDelete(document._id);

  // Log deletion
  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_deleted',
    metadata: { title: document.title },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.status(200).json(
    formatSuccess(null, 'Document deleted successfully')
  );
});

// Stream / download document PDF (authenticated) — serves signed PDF if available, else original
exports.downloadDocument = catchAsync(async (req, res, next) => {
  const document = await Document.findOne({ _id: req.params.id, owner: req.user.id });

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  // Serve signed file if available, otherwise original
  const filePath = document.signedFile?.path || document.originalFile?.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return next(new AppError('File not found on server.', 404));
  }

  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_downloaded',
    metadata: { fileType: document.signedFile?.path ? 'signed' : 'original' },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${document.title}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
});

// Get audit logs for a specific document
exports.getAuditLogs = catchAsync(async (req, res, next) => {
  // Verify requester owns the document
  const document = await Document.findOne({ _id: req.params.id, owner: req.user.id });

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  const AuditLog = require('../models/AuditLog');
  const logs = await AuditLog.find({ documentId: req.params.id })
    .populate('userId', 'name email')
    .sort('-timestamp');

  res.status(200).json(
    formatSuccess({ logs }, 'Audit logs retrieved successfully')
  );
});
