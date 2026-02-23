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
    // Store token mapping (in production, use Redis with expiry)
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

  // Send emails to all signers
  for (const signer of document.signers) {
    const token = await tokenService.getToken(document._id, signer.email);
    const signingUrl = `${process.env.BASE_URL}/api/sign/${token}`;

    await emailService.sendSigningRequest({
      to: signer.email,
      signerName: signer.name,
      documentName: document.title,
      signingUrl,
      senderName: req.user.name,
    });
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

// Reject document
exports.rejectDocument = catchAsync(async (req, res, next) => {
  const { reason } = req.body;
  const document = req.document; // From checkDocumentOwnership middleware

  if (document.status !== 'sent') {
    return next(new AppError('Document must be in sent status to reject.', 400));
  }

  document.status = 'rejected';
  document.rejectionReason = reason;
  await document.save();

  // Notify owner
  await emailService.sendRejectionNotification({
    to: document.owner.email,
    documentName: document.title,
    reason,
    rejectedBy: req.user.email,
  });

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

// Download document
exports.downloadDocument = catchAsync(async (req, res, next) => {
  const document = await Document.findById(req.params.id);

  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  // Check ownership
  if (document.owner.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new AppError('You do not have permission to download this document.', 403));
  }

  // Determine which file to send
  const filePath = document.status === 'signed' && document.signedFile
    ? document.signedFile.path
    : document.originalFile.path;

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return next(new AppError('Document file not found.', 404));
  }

  // Log download
  await AuditLog.log({
    userId: req.user.id,
    documentId: document._id,
    action: 'document_downloaded',
    metadata: { fileType: document.status === 'signed' ? 'signed' : 'original' },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  // Send file
  res.download(filePath, `${document.title}.pdf`);
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
      fs.unlinkSync(document.originalFile.path);
    }
    if (document.signedFile && document.signedFile.path) {
      fs.unlinkSync(document.signedFile.path);
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