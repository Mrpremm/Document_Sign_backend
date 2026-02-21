const nodemailer = require('nodemailer');

const createTransporter = () => {
  // Create transporter based on environment
  if (process.env.NODE_ENV === 'production') {
    // Production email configuration
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      secure: process.env.EMAIL_PORT === '465', // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  } else {
    // Development - use ethereal for testing
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: {
        user: 'ethereal.user@ethereal.email', // Generate from ethereal.email
        pass: 'ethereal.password',
      },
    });
  }
};

const transporter = createTransporter();

// Verify transporter connection
transporter.verify((error, success) => {
  if (error) {
    console.error(' Email configuration error:', error);
  } else {
    console.log(' Email server is ready to send messages');
  }
});

module.exports = transporter;