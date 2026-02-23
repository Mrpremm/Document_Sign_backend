const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const AppError = require('../utils/AppError');

class PDFService {
  // Get PDF metadata
  async getPDFMetadata(filePath) {
    try {
      const pdfBytes = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      
      return {
        pageCount: pdfDoc.getPageCount(),
        title: pdfDoc.getTitle() || '',
        author: pdfDoc.getAuthor() || '',
        subject: pdfDoc.getSubject() || '',
      };
    } catch (error) {
      console.error('Error reading PDF metadata:', error);
      throw new AppError('Error reading PDF file', 500);
    }
  }

  // Generate signed PDF with signature images
  async generateSignedPDF(originalPath, signatures) {
    try {
      // Load the original PDF
      const pdfBytes = fs.readFileSync(originalPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      
      // Embed standard font for text
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Process each signature
      for (const signature of signatures) {
        const { position, signatureData, signerName, signedAt } = signature;
        
        // Get the page
        const page = pdfDoc.getPage(position.pageNumber - 1);
        
        try {
          // Try to embed signature as image (assuming base64 PNG)
          const signatureImageBytes = Buffer.from(signatureData, 'base64');
          let signatureImage;
          
          try {
            signatureImage = await pdfDoc.embedPng(signatureImageBytes);
          } catch {
            try {
              signatureImage = await pdfDoc.embedJpg(signatureImageBytes);
            } catch {
              // If image embedding fails, draw a rectangle with text
              this.drawTextSignature(page, signerName, position, helveticaFont);
              continue;
            }
          }

          // Draw the signature image
          page.drawImage(signatureImage, {
            x: position.x,
            y: position.y,
            width: position.width || 150,
            height: position.height || 50,
          });

          // Add signer name below signature
          page.drawText(signerName, {
            x: position.x,
            y: position.y - 15,
            size: 8,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });

          // Add date
          const dateStr = new Date(signedAt).toLocaleDateString();
          page.drawText(dateStr, {
            x: position.x,
            y: position.y - 25,
            size: 8,
            font: helveticaFont,
            color: rgb(0.5, 0.5, 0.5),
          });

        } catch (error) {
          console.error('Error adding signature to PDF:', error);
          // Continue with other signatures
        }
      }

      // Add signature page at the end (optional)
      // await this.addSignaturePage(pdfDoc, signatures);

      // Save the modified PDF
      const modifiedPdfBytes = await pdfDoc.save();
      
      // Save to temporary file
      const tempPath = path.join('uploads', 'signed', `temp-${Date.now()}.pdf`);
      fs.writeFileSync(tempPath, modifiedPdfBytes);
      
      return tempPath;
    } catch (error) {
      console.error('Error generating signed PDF:', error);
      throw new AppError('Error generating signed PDF', 500);
    }
  }

  // Draw text signature when image embedding fails
  drawTextSignature(page, text, position, font) {
    page.drawText(`Signed by: ${text}`, {
      x: position.x,
      y: position.y,
      size: 12,
      font: font,
      color: rgb(0, 0, 0.8),
    });

    // Draw a line under the text
    page.drawLine({
      start: { x: position.x, y: position.y - 2 },
      end: { x: position.x + 200, y: position.y - 2 },
      thickness: 1,
      color: rgb(0, 0, 0.8),
    });
  }

  // Add signature summary page
  async addSignaturePage(pdfDoc, signatures) {
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Title
    page.drawText('Digital Signature Certificate', {
      x: 50,
      y: height - 50,
      size: 18,
      font: boldFont,
      color: rgb(0, 0, 0.5),
    });

    // Document information
    page.drawText(`This document has been digitally signed by:`, {
      x: 50,
      y: height - 80,
      size: 12,
      font: font,
    });

    let yPosition = height - 110;
    
    // List all signatures
    for (const signature of signatures) {
      const signerInfo = `${signature.signerName} (${signature.signerEmail}) - ${new Date(signature.signedAt).toLocaleString()}`;
      
      page.drawText(`• ${signerInfo}`, {
        x: 50,
        y: yPosition,
        size: 10,
        font: font,
        color: rgb(0.2, 0.2, 0.2),
      });

      yPosition -= 20;

      // Add IP and user agent
      if (signature.ipAddress) {
        page.drawText(`  IP: ${signature.ipAddress}`, {
          x: 70,
          y: yPosition,
          size: 8,
          font: font,
          color: rgb(0.5, 0.5, 0.5),
        });
        yPosition -= 15;
      }
    }

    // Add verification note
    page.drawText('This signature certificate verifies the authenticity of the signatures.', {
      x: 50,
      y: 100,
      size: 9,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });

    page.drawText(`Generated on: ${new Date().toLocaleString()}`, {
      x: 50,
      y: 80,
      size: 8,
      font: font,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  // Validate PDF
  async validatePDF(filePath) {
    try {
      const pdfBytes = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      
      return {
        isValid: true,
        pageCount: pdfDoc.getPageCount(),
        isEncrypted: pdfDoc.isEncrypted,
      };
    } catch (error) {
      return {
        isValid: false,
        error: error.message,
      };
    }
  }

  // Extract text from PDF (for search/indexing)
  async extractText(filePath) {
    // Note: For production, use a proper PDF text extraction library
    // This is a placeholder
    return '';
  }
}

module.exports = new PDFService();