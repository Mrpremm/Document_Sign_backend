const crypto = require('crypto');
const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Persistent Token model (stored in MongoDB instead of in-memory Map)
// ---------------------------------------------------------------------------
const signTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  documentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Document',
    required: true,
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
  },
  used: {
    type: Boolean,
    default: false,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // MongoDB TTL — auto-deletes after expiresAt
  },
});

const SignToken = mongoose.models.SignToken || mongoose.model('SignToken', signTokenSchema);

// ---------------------------------------------------------------------------
class TokenService {
  // Generate a cryptographically secure random token
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Store token with associated data in MongoDB
  async storeToken(token, data, expiryInSeconds = 7 * 24 * 60 * 60) {
    const expiresAt = new Date(Date.now() + expiryInSeconds * 1000);

    await SignToken.findOneAndUpdate(
      { token },
      {
        token,
        documentId: data.documentId,
        email: data.email,
        used: false,
        expiresAt,
      },
      { upsert: true, new: true }
    );

    return token;
  }

  // Verify token and return its data (null if invalid/expired/used)
  async verifyToken(token) {
    const tokenDoc = await SignToken.findOne({
      token,
      used: false,
      expiresAt: { $gt: new Date() },
    });

    if (!tokenDoc) return null;

    return {
      documentId: tokenDoc.documentId,
      email: tokenDoc.email,
    };
  }

  // Mark token as used (one-time use)
  async invalidateToken(token) {
    await SignToken.findOneAndUpdate({ token }, { used: true });
  }

  // Get the raw token string for a given documentId + email pair
  async getToken(documentId, email) {
    const tokenDoc = await SignToken.findOne({
      documentId,
      email: email.toLowerCase(),
      used: false,
      expiresAt: { $gt: new Date() },
    });

    return tokenDoc ? tokenDoc.token : null;
  }

  // Generate a full signing URL
  generateSigningUrl(token, baseUrl) {
    return `${baseUrl}/sign/${token}`;
  }

  // Validate token format (64 hex chars)
  isValidTokenFormat(token) {
    return /^[a-f0-9]{64}$/i.test(token);
  }
}

module.exports = new TokenService();