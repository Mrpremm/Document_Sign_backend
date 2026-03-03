const express = require('express');
const fs = require('fs');
const signatureController = require('../controllers/signatureController');
const { protect } = require('../middleware/authMiddleware');
const { uploadSignature } = require('../middleware/uploadMiddleware');
const Document = require('../models/Document');
const tokenService = require('../services/tokenService');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');

const router = express.Router();

// ---------------------------------------------------------------------------
// Public routes — token is the authentication mechanism
// ---------------------------------------------------------------------------

// GET /api/sign/:token — get document info by signing token
router.get('/:token', signatureController.getSignatureInfo);

// POST /api/sign/:token — submit signature via token
router.post('/:token', uploadSignature, signatureController.signWithToken);

// POST /api/sign/:token/reject — signer rejects document via token
router.post('/:token/reject', signatureController.rejectWithToken);

// GET /api/sign/:token/file — serve the original PDF for the signing page
router.get('/:token/file', catchAsync(async (req, res, next) => {
  const tokenData = await tokenService.verifyToken(req.params.token);
  if (!tokenData) {
    return next(new AppError('Invalid or expired signing token.', 401));
  }

  const document = await Document.findById(tokenData.documentId);
  if (!document) {
    return next(new AppError('Document not found.', 404));
  }

  const filePath = document.originalFile?.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return next(new AppError('File not found on server.', 404));
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${document.title}.pdf"`);
  fs.createReadStream(filePath).pipe(res);
}));

// ---------------------------------------------------------------------------
// Protected routes — authenticated users only
// ---------------------------------------------------------------------------
router.use(protect);

// Authenticated signature management
router.post('/', uploadSignature, signatureController.addSignature);
router.get('/document/:documentId', signatureController.getDocumentSignatures);
router.get('/verify/:signatureId', signatureController.verifySignature);

module.exports = router;