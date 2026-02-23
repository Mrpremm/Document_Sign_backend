const crypto = require('crypto');
// In production, use Redis for token storage
// const redis = require('../config/redis');

class TokenService {
  constructor() {
    // Simple in-memory store (replace with Redis in production)
    this.tokenStore = new Map();
    
    // Clean up expired tokens every hour
    setInterval(() => this.cleanupExpiredTokens(), 60 * 60 * 1000);
  }

  // Generate a secure token
  generateToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Store token with data
  async storeToken(token, data, expiryInSeconds = 7 * 24 * 60 * 60) { // 7 days default
    const expiresAt = Date.now() + (expiryInSeconds * 1000);
    
    this.tokenStore.set(token, {
      ...data,
      expiresAt,
      used: false,
    });

    // In production with Redis:
    // await redis.setex(`token:${token}`, expiryInSeconds, JSON.stringify(data));
    
    return token;
  }

  // Verify and get token data
  async verifyToken(token) {
    const tokenData = this.tokenStore.get(token);

    if (!tokenData) {
      return null;
    }

    // Check if expired
    if (tokenData.expiresAt < Date.now()) {
      this.tokenStore.delete(token);
      return null;
    }

    // Check if already used (for one-time tokens)
    if (tokenData.used) {
      return null;
    }

    return {
      documentId: tokenData.documentId,
      email: tokenData.email,
    };
  }

  // Mark token as used
  async invalidateToken(token) {
    const tokenData = this.tokenStore.get(token);
    if (tokenData) {
      tokenData.used = true;
      this.tokenStore.set(token, tokenData);
    }

    // In production with Redis:
    // await redis.del(`token:${token}`);
  }

  // Get token for a specific document and email
  async getToken(documentId, email) {
    // Find token in store (inefficient for large stores - use Redis in production)
    for (const [token, data] of this.tokenStore.entries()) {
      if (data.documentId === documentId && data.email === email && !data.used) {
        return token;
      }
    }
    return null;
  }

  // Clean up expired tokens
  cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, data] of this.tokenStore.entries()) {
      if (data.expiresAt < now) {
        this.tokenStore.delete(token);
      }
    }
    console.log(`🧹 Cleaned up expired tokens. Current store size: ${this.tokenStore.size}`);
  }

  // Generate signing URL
  generateSigningUrl(token, baseUrl) {
    return `${baseUrl}/api/sign/${token}`;
  }

  // Validate token format
  isValidTokenFormat(token) {
    return /^[a-f0-9]{64}$/i.test(token);
  }
}

module.exports = new TokenService();