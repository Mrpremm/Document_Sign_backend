const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Document title is required'],
      trim: true,
      maxlength: [200, 'Title cannot be more than 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot be more than 500 characters'],
    },
    originalFile: {
      filename: String,
      path: String,
      size: Number,
      mimetype: String,
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
    },
    signedFile: {
      filename: String,
      path: String,
      size: Number,
      signedAt: Date,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'signed', 'rejected'],
      default: 'draft',
    },
    signers: [
      {
        name: String,
        email: String,
        signed: {
          type: Boolean,
          default: false,
        },
        signedAt: Date,
        signatureToken: String,
        tokenExpires: Date,
      },
    ],
    signatures: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Signature',
      },
    ],
    metadata: {
      pageCount: Number,
      fileHash: String, // For integrity verification
      lastModified: Date,
    },
    sentAt: Date,
    signedAt: Date,
    rejectedAt: Date,
    rejectionReason: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for better query performance
documentSchema.index({ owner: 1, status: 1 });
documentSchema.index({ 'signers.email': 1 });
documentSchema.index({ 'signers.signatureToken': 1 });

// Virtual for audit logs
documentSchema.virtual('auditLogs', {
  ref: 'AuditLog',
  foreignField: 'documentId',
  localField: '_id',
});

// Method to generate signing token
documentSchema.methods.generateSigningToken = function (signerEmail) {
  const crypto = require('crypto');
  const token = crypto.randomBytes(32).toString('hex');
  
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const signer = this.signers.find(s => s.email === signerEmail);
  if (signer) {
    signer.signatureToken = hashedToken;
    signer.tokenExpires = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  }

  return token;
};

// Method to verify signing token
documentSchema.methods.verifySigningToken = function (token, email) {
  const crypto = require('crypto');
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const signer = this.signers.find(
    s => s.email === email && 
         s.signatureToken === hashedToken && 
         s.tokenExpires > Date.now()
  );

  return !!signer;
};

// Pre-save middleware to update timestamps based on status
documentSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    if (this.status === 'sent' && !this.sentAt) {
      this.sentAt = Date.now();
    } else if (this.status === 'signed' && !this.signedAt) {
      this.signedAt = Date.now();
    } else if (this.status === 'rejected' && !this.rejectedAt) {
      this.rejectedAt = Date.now();
    }
  }
  next();
});

const Document = mongoose.model('Document', documentSchema);

module.exports = Document;