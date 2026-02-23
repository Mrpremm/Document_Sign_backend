const express = require('express');
const documentController = require('../controllers/documentController');
const { protect, checkDocumentOwnership } = require('../middleware/authMiddleware');
const { uploadDocument } = require('../middleware/uploadMiddleware');

const router = express.Router();

// All document routes require authentication
router.use(protect);

// Document CRUD operations
router.route('/')
  .get(documentController.getMyDocuments)
  .post(uploadDocument, documentController.uploadDocument);

router.route('/:id')
  .get(documentController.getDocument)
  .patch(checkDocumentOwnership, documentController.updateDocument)
  .delete(checkDocumentOwnership, documentController.deleteDocument);

// Document actions
router.post('/:id/send', checkDocumentOwnership, documentController.sendDocument);
router.post('/:id/reject', checkDocumentOwnership, documentController.rejectDocument);
router.get('/:id/download', documentController.downloadDocument);

module.exports = router;