const mongoose = require('mongoose');

const signatureSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
    },
    signerEmail: {
      type: String,
      required: [true, 'Signer email is required'],
      lowercase: true,
    },
    signerName: {
      type: String,
      required: [true, 'Signer name is required'],
    },
    signatureData: {
      type: String, // Base64 encoded signature image or reference
      required: true,
    },
    signatureType: {
      type: String,
      enum: ['draw', 'type', 'upload'],
      default: 'draw',
    },
    position: {
      pageNumber: {
        type: Number,
        required: true,
        min: 1,
      },
      x: {
        type: Number,
        required: true,
      },
      y: {
        type: Number,
        required: true,
      },
      width: Number,
      height: Number,
    },
    ipAddress: String,
    userAgent: String,
    signedAt: {
      type: Date,
      default: Date.now,
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
    certificateData: {
      type: mongoose.Schema.Types.Mixed, // Store certificate information
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
signatureSchema.index({ documentId: 1, signerEmail: 1 });
signatureSchema.index({ signedAt: -1 });

// Ensure one signature per signer per document
signatureSchema.index({ documentId: 1, signerEmail: 1 }, { unique: true });

const Signature = mongoose.model('Signature', signatureSchema);

module.exports = Signature;