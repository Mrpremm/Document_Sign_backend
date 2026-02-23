const nodemailer = require('nodemailer');
const transporter = require('../config/email');

class EmailService {
  constructor() {
    this.from = process.env.EMAIL_FROM || 'noreply@signaturesaas.com';
  }

  // Send signing request email
  async sendSigningRequest({ to, signerName, documentName, signingUrl, senderName }) {
    const subject = `Document Ready for Signature: ${documentName}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Document Signature Request</h1>
          </div>
          <div class="content">
            <p>Hello ${signerName},</p>
            <p><strong>${senderName}</strong> has sent you a document to sign: <strong>"${documentName}"</strong></p>
            <p>Please review the document and add your signature by clicking the button below:</p>
            <div style="text-align: center;">
              <a href="${signingUrl}" class="button">Sign Document</a>
            </div>
            <p><small>This link will expire in 7 days for security purposes.</small></p>
            <p>If you're having trouble clicking the button, copy and paste this URL into your browser:</p>
            <p style="word-break: break-all;"><small>${signingUrl}</small></p>
          </div>
          <div class="footer">
            <p>This is an automated message from SignatureSaaS. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      console.log(`✅ Signing request email sent to ${to}`);
    } catch (error) {
      console.error('❌ Error sending email:', error);
      throw error;
    }
  }

  // Send document signed notification
  async sendDocumentSignedNotification({ to, documentName, signedBy }) {
    const subject = `Document Signed: ${documentName}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #48bb78 0%, #38a169 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Document Signed Successfully</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Good news! Your document <strong>"${documentName}"</strong> has been signed by:</p>
            <p><strong>${signedBy}</strong></p>
            <p>You can now download the fully signed document from your dashboard.</p>
            <p>Thank you for using SignatureSaaS!</p>
          </div>
          <div class="footer">
            <p>This is an automated message from SignatureSaaS. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      console.log(`✅ Signed notification email sent to ${to}`);
    } catch (error) {
      console.error('❌ Error sending email:', error);
      throw error;
    }
  }

  // Send rejection notification
  async sendRejectionNotification({ to, documentName, reason, rejectedBy }) {
    const subject = `Document Rejected: ${documentName}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f56565 0%, #c53030 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Document Rejected</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>Your document <strong>"${documentName}"</strong> has been rejected by <strong>${rejectedBy}</strong>.</p>
            ${reason ? `<p><strong>Reason provided:</strong> ${reason}</p>` : ''}
            <p>Please review the document and make necessary changes before sending again.</p>
          </div>
          <div class="footer">
            <p>This is an automated message from SignatureSaaS. Please do not reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });
      console.log(`✅ Rejection notification email sent to ${to}`);
    } catch (error) {
      console.error('❌ Error sending email:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();