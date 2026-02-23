const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AppError = require('../utils/AppError');

// Ensure upload directories exist
const uploadDirs = ['uploads/original', 'uploads/signed'];
uploadDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'document') {
      cb(null, 'uploads/original/');
    } else if (file.fieldname === 'signature') {
      cb(null, 'uploads/signed/');
    } else {
      cb(new AppError('Invalid field name', 400), null);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  },
});

// File filter function
const fileFilter = (req, file, cb) => {
  // Accept PDFs only for documents
  if (file.fieldname === 'document') {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new AppError('Only PDF files are allowed for documents!', 400), false);
    }
  }
  // Accept images for signatures
  else if (file.fieldname === 'signature') {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Only image files are allowed for signatures!', 400), false);
    }
  } else {
    cb(new AppError('Invalid file field', 400), false);
  }
};

// Create multer upload instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: process.env.MAX_FILE_SIZE || 10 * 1024 * 1024, // 10MB default
  },
});

// Custom error handler for multer
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('File too large. Maximum size is 10MB.', 400));
    }
    return next(new AppError(err.message, 400));
  }
  next(err);
};

// Middleware for single document upload
exports.uploadDocument = (req, res, next) => {
  upload.single('document')(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    
    if (!req.file) {
      return next(new AppError('Please upload a document.', 400));
    }
    
    next();
  });
};

// Middleware for signature upload
exports.uploadSignature = (req, res, next) => {
  upload.single('signature')(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    
    if (!req.file) {
      return next(new AppError('Please upload a signature image.', 400));
    }
    
    next();
  });
};

// Middleware for multiple files
exports.uploadMultiple = (req, res, next) => {
  upload.fields([
    { name: 'document', maxCount: 1 },
    { name: 'signature', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    next();
  });
};