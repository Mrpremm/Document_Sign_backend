const express = require('express');
const signatureController = require('../controllers/signatureController');
const { protect } = require('../middleware/authMiddleware');
const { uploadSignature } = require('../middleware/uploadMiddleware');

const router = express.Router();

// Public routes (for token-based signing)
router.get('/:token', signatureController.getSignatureInfo);
router.post('/:token', uploadSignature, signatureController.signWithToken);

// Protected routes
router.use(protect);

// Signature management
router.post('/', uploadSignature, signatureController.addSignature);
router.get('/document/:documentId', signatureController.getDocumentSignatures);
router.get('/verify/:signatureId', signatureController.verifySignature);

module.exports = router;