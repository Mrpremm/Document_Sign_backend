const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

class Logger {
  constructor() {
    this.logFile = path.join(logsDir, `app-${new Date().toISOString().split('T')[0]}.log`);
  }

  // Format log message
  formatMessage(level, message, meta = {}) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
      pid: process.pid,
    });
  }

  // Write to log file
  async writeToFile(message) {
    return new Promise((resolve, reject) => {
      fs.appendFile(this.logFile, message + '\n', (err) => {
        if (err) {
          console.error('Error writing to log file:', err);
        }
        resolve();
      });
    });
  }

  // Info level log
  async info(message, meta = {}) {
    const logMessage = this.formatMessage('INFO', message, meta);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`📘 INFO: ${message}`, meta);
    }
    
    await this.writeToFile(logMessage);
  }

  // Error level log
  async error(message, error = null, meta = {}) {
    const errorMeta = error ? {
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
      ...meta,
    } : meta;

    const logMessage = this.formatMessage('ERROR', message, errorMeta);
    
    console.error(`❌ ERROR: ${message}`, errorMeta);
    await this.writeToFile(logMessage);
  }

  // Warning level log
  async warn(message, meta = {}) {
    const logMessage = this.formatMessage('WARN', message, meta);
    
    console.warn(`⚠️ WARN: ${message}`, meta);
    await this.writeToFile(logMessage);
  }

  // Debug level log (only in development)
  async debug(message, meta = {}) {
    if (process.env.NODE_ENV === 'development') {
      const logMessage = this.formatMessage('DEBUG', message, meta);
      console.log(`🔧 DEBUG: ${message}`, meta);
      await this.writeToFile(logMessage);
    }
  }

  // Audit log (special for audit trail)
  async audit(userId, action, details = {}) {
    const auditMessage = this.formatMessage('AUDIT', action, {
      userId,
      ...details,
      timestamp: new Date().toISOString(),
    });

    // Write to separate audit log file
    const auditFile = path.join(logsDir, `audit-${new Date().toISOString().split('T')[0]}.log`);
    
    return new Promise((resolve) => {
      fs.appendFile(auditFile, auditMessage + '\n', (err) => {
        if (err) {
          console.error('Error writing to audit file:', err);
        }
        resolve();
      });
    });
  }
}

module.exports = new Logger();