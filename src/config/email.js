const nodemailer = require('nodemailer');

const createTransporter = () => {
  if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: parseInt(process.env.EMAIL_PORT) === 465, // true only for port 465 (SSL)
      requireTLS: parseInt(process.env.EMAIL_PORT) !== 465, // STARTTLS for port 587
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false, // Needed for some Gmail / self-signed cert setups
      },
    });
  }

  // Fallback: log emails to console in development (no real sending)
  console.warn('⚠️  No email config found in .env — emails will be logged to console only.');
  return nodemailer.createTransport({
    jsonTransport: true,
  });
};

const transporter = createTransporter();

// Verify the SMTP connection on startup
if (process.env.EMAIL_HOST) {
  transporter.verify((error) => {
    if (error) {
      console.error('❌ Email configuration error:', error.message);
      console.error('   → Check EMAIL_HOST, EMAIL_USER, EMAIL_PASS in your .env');
      console.error('   → For Gmail: use an App Password from https://myaccount.google.com/apppasswords');
    } else {
      console.log('✅ Email server is ready to send messages');
    }
  });
}

module.exports = transporter;
