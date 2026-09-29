import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import sharp from 'sharp';

// Reference Color Palette (#173F55 Navy, #E31837 Red, #F3F4F6 Light Gray)
const COLORS = {
  navyHeader: [23, 63, 85],       // #173F55 Navy Blue
  redLine: [227, 24, 55],         // #E31837 Red Accent
  labelBg: [243, 244, 246],       // #F3F4F6 Cell Label Background
  borderColor: [209, 213, 219],   // #D1D5DB Cell Border
  darkText: [31, 41, 55],         // #1F2937 Dark Text
  lightText: [107, 114, 128],     // #6B7280 Gray Text
  white: [255, 255, 255],
  goldStar: [245, 158, 11],       // #F59E0B Yellow Star
  grayStar: [209, 213, 219],       // #D1D5DB Gray Star
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 12;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 186mm

/**
 * Generates an A4 PDF matching the reference design.
 * @param {Object} feedback - The feedback data
 * @param {string|null} logoBase64 - Base64 encoded logo image
 * @returns {Promise<Buffer>} PDF buffer
 */
export async function generateFeedbackPDF(feedback, logoBase64 = null) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  let y = 10;

  // ============================================================
  // HEADER
  // ============================================================

  // Left: Official Logo
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', MARGIN_X, y, 42, 14);
    } catch {
      // Fallback text if logo fails
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...COLORS.navyHeader);
      doc.text('EAGLE EYE', MARGIN_X, y + 8);
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...COLORS.navyHeader);
    doc.text('EAGLE EYE', MARGIN_X, y + 8);
  }

  // Right: Company Name & Address
  const rightX = PAGE_WIDTH - MARGIN_X;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.navyHeader);
  doc.text('EAGLE EYE SAFDRIVE PVT LTD', rightX, y + 4, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.darkText);
  doc.text('S.F. No. 491/1B, MasaGoundan Chettipalayam,', rightX, y + 8, { align: 'right' });
  doc.text('Senthampalayam, Annur, Tamil Nadu 641107.', rightX, y + 11.5, { align: 'right' });

  y += 16;

  // Red Divider Line
  doc.setDrawColor(...COLORS.redLine);
  doc.setLineWidth(0.8);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 6;

  // ============================================================
  // DOCUMENT TITLE & META
  // ============================================================
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.darkText);
  doc.text('CUSTOMER FEEDBACK FORM', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 5.5;

  // Formatted Timestamps
  const submittedDate = feedback.submitted_at ? new Date(feedback.submitted_at) : new Date();
  const dateStr = formatDate(submittedDate);
  const timeStr = formatTime(submittedDate);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.darkText);
  doc.text(`Feedback ID: ${feedback.feedback_id || 'EE-FB-20260926-00123'}`, MARGIN_X, y);

  doc.setFont('helvetica', 'normal');
  doc.text(`Date: ${dateStr}`, rightX, y - 1.5, { align: 'right' });
  doc.text(`Time: ${timeStr}`, rightX, y + 2, { align: 'right' });
  y += 5;

  // ============================================================
  // SECTION 1 — CUSTOMER & VEHICLE DETAILS (4-Column Grid)
  // ============================================================
  y = drawSectionHeader(doc, '1. CUSTOMER & VEHICLE DETAILS', y);

  const detailsRows = [
    [
      { label: 'Customer Name', value: feedback.customer_name || '-' },
      { label: 'Vehicle Type', value: feedback.vehicle_type || '-' },
    ],
    [
      { label: 'Phone Number', value: feedback.phone_number || '-' },
      { label: 'Product / Service Name', value: feedback.product_service || '-' },
    ],
    [
      { label: 'Company / Fleet Name', value: feedback.company_name || '-' },
      { label: 'Service Date', value: feedback.service_date ? formatDate(new Date(feedback.service_date)) : '-' },
    ],
    [
      { label: 'Email', value: feedback.email || '-' },
      { label: 'Service Representative / Technician', value: feedback.technician || '-' },
    ],
    [
      { label: 'Vehicle Number', value: feedback.vehicle_number || '-' },
      { label: 'IMEI Number', value: feedback.imei_number || '-' },
    ],
  ];

  y = drawFourColumnTable(doc, detailsRows, y);
  y += 3;

  // ============================================================
  // SECTION 2 — SERVICE RATING (OUT OF 5)
  // ============================================================
  y = drawSectionHeader(doc, '2. SERVICE RATING (OUT OF 5)', y);

  const ratingRows = [
    ['Product Quality', feedback.rating_product_quality || 0],
    ['Installation / Service', feedback.rating_installation || 0],
    ['Product Performance', feedback.rating_performance || 0],
    ['Technician Professionalism', feedback.rating_professionalism || 0],
    ['Customer Support', feedback.rating_support || 0],
  ];

  y = drawRatingTable(doc, ratingRows, y);
  y += 3;

  // ============================================================
  // SECTION 3 — ISSUE RESOLUTION
  // ============================================================
  y = drawSectionHeader(doc, '3. ISSUE RESOLUTION', y);

  const rowHeight = 8;
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, rowHeight);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.darkText);
  doc.text('Was the issue resolved to your satisfaction?', MARGIN_X + 3, y + 5.2);

  const selectedOption = feedback.issue_resolved || 'Yes';
  const options = ['Yes', 'Partially', 'No'];
  let optX = MARGIN_X + 95;

  options.forEach((opt) => {
    const isSelected = selectedOption === opt;
    // Draw Checkbox box
    doc.setDrawColor(...COLORS.navyHeader);
    if (isSelected) {
      doc.setFillColor(...COLORS.navyHeader);
      doc.rect(optX, y + 2, 4, 4, 'FD');
      // White checkmark
      doc.setDrawColor(...COLORS.white);
      doc.setLineWidth(0.5);
      doc.line(optX + 1, y + 4, optX + 2, y + 5);
      doc.line(optX + 2, y + 5, optX + 3.2, y + 2.8);
    } else {
      doc.setFillColor(...COLORS.white);
      doc.rect(optX, y + 2, 4, 4, 'FD');
    }

    doc.setFont('helvetica', isSelected ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.darkText);
    doc.text(opt, optX + 6, y + 5.2);
    optX += 28;
  });

  y += rowHeight + 3;

  // ============================================================
  // SECTION 4 — WHAT COULD WE IMPROVE TO SERVE YOU BETTER?
  // ============================================================
  y = drawSectionHeader(doc, '4. WHAT COULD WE IMPROVE TO SERVE YOU BETTER?', y);
  y = drawTextBox(doc, feedback.improvement_suggestions || 'None', y, 14);
  y += 3;

  // ============================================================
  // SECTION 5 — ADDITIONAL COMMENTS OR SUGGESTIONS
  // ============================================================
  y = drawSectionHeader(doc, '5. ADDITIONAL COMMENTS OR SUGGESTIONS', y);
  y = drawTextBox(doc, feedback.additional_comments || 'None', y, 14);
  y += 3;

  // ============================================================
  // SECTION 6 — CUSTOMER SIGNATURE
  // ============================================================
  y = drawSectionHeader(doc, '6. CUSTOMER SIGNATURE', y);

  const sigBoxHeight = 30;           // Taller box to better fit landscape signatures
  const sigLeftWidth = 115;
  const sigRightWidth = CONTENT_WIDTH - sigLeftWidth;
  const sigPadding = 3;              // Inner padding around the signature image

  // Left box - Signature image container
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN_X, y, sigLeftWidth, sigBoxHeight);

  if (feedback.signatureDataUrl) {
    try {
      // Available area inside the signature box (after padding)
      const availW = sigLeftWidth - sigPadding * 2;
      const availH = sigBoxHeight - sigPadding * 2;

      // Rotate the landscape signature 90° clockwise so it appears horizontal
      // in the portrait PDF. Customers always sign in landscape on mobile.
      const rotatedDataUrl = await rotateSignature90(feedback.signatureDataUrl);

      // Extract rotated image dimensions for proportional scaling
      const sigDims = getImageDimensionsFromDataUrl(rotatedDataUrl);

      let imgW, imgH;

      if (sigDims) {
        const { width: rotW, height: rotH } = sigDims;
        const aspectRatio = rotW / rotH;

        // "contain" scaling — fit within availW × availH preserving aspect ratio
        if (aspectRatio >= availW / availH) {
          imgW = availW;
          imgH = availW / aspectRatio;
        } else {
          imgH = availH;
          imgW = availH * aspectRatio;
        }
      } else {
        imgW = availW;
        imgH = availH;
      }

      // Center the rotated image within the available area
      const imgX = MARGIN_X + sigPadding + (availW - imgW) / 2;
      const imgY = y + sigPadding + (availH - imgH) / 2;

      doc.addImage(rotatedDataUrl, 'PNG', imgX, imgY, imgW, imgH);
    } catch (sigErr) {
      console.warn('Signature rotation/insertion failed:', sigErr.message);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.lightText);
      doc.text('[Digital Signature Captured]', MARGIN_X + 30, y + sigBoxHeight / 2 + 2);
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.lightText);
    doc.text('[Digital Signature Captured]', MARGIN_X + 30, y + sigBoxHeight / 2 + 2);
  }

  // Right box - Date & Time container
  doc.rect(MARGIN_X + sigLeftWidth, y, sigRightWidth, sigBoxHeight);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.darkText);
  doc.text('Signature Date', MARGIN_X + sigLeftWidth + 5, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.darkText);
  doc.text(`${dateStr} ${timeStr}`, MARGIN_X + sigLeftWidth + 5, y + 16);

  y += sigBoxHeight + 6;

  // ============================================================
  // FOOTER & QR CODE
  // ============================================================

  // Centered Thank You Text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.navyHeader);
  doc.text('Thank you for your valuable feedback!', PAGE_WIDTH / 2, y, { align: 'center' });
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.darkText);
  doc.text('Eagle Eye – Safer Vehicles, Safer Roads.', PAGE_WIDTH / 2, y, { align: 'center' });

  // Return generated buffer
  return Buffer.from(doc.output('arraybuffer'));
}

// ============================================================
// HELPER DRAWING FUNCTIONS
// ============================================================

function drawSectionHeader(doc, title, y) {
  doc.setFillColor(...COLORS.navyHeader);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.white);
  doc.text(title, MARGIN_X + 3, y + 3.8);

  return y + 5.5;
}

function drawFourColumnTable(doc, rows, y) {
  const col1Width = 42; // Label 1
  const col2Width = 51; // Value 1
  const col3Width = 48; // Label 2
  const col4Width = 45; // Value 2
  const rowHeight = 6.2;

  doc.setLineWidth(0.2);
  doc.setDrawColor(...COLORS.borderColor);

  rows.forEach((row) => {
    let x = MARGIN_X;

    // Cell 1: Label
    doc.setFillColor(...COLORS.labelBg);
    doc.rect(x, y, col1Width, rowHeight, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.darkText);
    doc.text(row[0].label, x + 2, y + 4.2);
    x += col1Width;

    // Cell 2: Value
    doc.setFillColor(...COLORS.white);
    doc.rect(x, y, col2Width, rowHeight, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.darkText);
    doc.text(doc.splitTextToSize(String(row[0].value), col2Width - 3)[0] || '-', x + 2, y + 4.2);
    x += col2Width;

    // Cell 3: Label
    doc.setFillColor(...COLORS.labelBg);
    doc.rect(x, y, col3Width, rowHeight, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.darkText);
    doc.text(row[1].label, x + 2, y + 4.2);
    x += col3Width;

    // Cell 4: Value
    doc.setFillColor(...COLORS.white);
    doc.rect(x, y, col4Width, rowHeight, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.darkText);
    doc.text(doc.splitTextToSize(String(row[1].value), col4Width - 3)[0] || '-', x + 2, y + 4.2);

    y += rowHeight;
  });

  return y;
}

function drawRatingTable(doc, rows, y) {
  const col1Width = 95;
  const col2Width = 91; // Spans rating stars & score
  const rowHeight = 6.2;

  doc.setLineWidth(0.2);
  doc.setDrawColor(...COLORS.borderColor);

  // Table Header
  doc.setFillColor(...COLORS.labelBg);
  doc.rect(MARGIN_X, y, col1Width, rowHeight, 'FD');
  doc.rect(MARGIN_X + col1Width, y, col2Width, rowHeight, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.darkText);
  doc.text('Criteria', MARGIN_X + 3, y + 4.2);
  doc.text('Rating', MARGIN_X + col1Width + 38, y + 4.2);

  y += rowHeight;

  // Rating Rows
  rows.forEach(([criteria, score]) => {
    // Left Cell: Criteria
    doc.setFillColor(...COLORS.white);
    doc.rect(MARGIN_X, y, col1Width, rowHeight, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.darkText);
    doc.text(criteria, MARGIN_X + 3, y + 4.2);

    // Right Cell: Stars & Score
    doc.setFillColor(...COLORS.white);
    doc.rect(MARGIN_X + col1Width, y, col2Width, rowHeight, 'FD');

    // Draw Crisp Vector Stars
    const starStartX = MARGIN_X + col1Width + 24;
    for (let i = 1; i <= 5; i++) {
      const starCx = starStartX + (i - 1) * 6.5;
      const starCy = y + 3.1;
      drawVectorStar(doc, starCx, starCy, 2.2, i <= score);
    }

    // Numerical Score
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.darkText);
    doc.text(`${score} / 5`, MARGIN_X + col1Width + 66, y + 4.2);

    y += rowHeight;
  });

  return y;
}

function drawVectorStar(doc, cx, cy, radius = 2.2, isFilled = true) {
  const innerRadius = radius * 0.42;
  const points = [];
  const spikes = 5;
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;

  for (let i = 0; i < spikes; i++) {
    points.push({
      x: cx + Math.cos(rot) * radius,
      y: cy + Math.sin(rot) * radius,
    });
    rot += step;

    points.push({
      x: cx + Math.cos(rot) * innerRadius,
      y: cy + Math.sin(rot) * innerRadius,
    });
    rot += step;
  }

  if (isFilled) {
    doc.setFillColor(...COLORS.goldStar);
    doc.setDrawColor(...COLORS.goldStar);
    doc.setLineWidth(0.1);
  } else {
    doc.setFillColor(...COLORS.white);
    doc.setDrawColor(...COLORS.grayStar);
    doc.setLineWidth(0.3);
  }

  const startX = points[0].x;
  const startY = points[0].y;
  const deltaLines = points.slice(1).map((p, i) => [
    p.x - points[i].x,
    p.y - points[i].y,
  ]);

  doc.lines(deltaLines, startX, startY, [1, 1], isFilled ? 'FD' : 'D', true);
}

function drawTextBox(doc, text, y, minHeight = 14) {
  doc.setLineWidth(0.2);
  doc.setDrawColor(...COLORS.borderColor);

  const lines = doc.splitTextToSize(text, CONTENT_WIDTH - 6);
  const textHeight = lines.length * 4.5;
  const boxHeight = Math.max(minHeight, textHeight + 6);

  doc.setFillColor(...COLORS.white);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, boxHeight, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.darkText);

  let textY = y + 4.5;
  lines.forEach((line) => {
    doc.text(line, MARGIN_X + 3, textY);
    textY += 4.5;
  });

  return y + boxHeight;
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

function formatTime(date) {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
}

/**
 * Rotates a base64-encoded PNG signature image 90° clockwise using sharp.
 * Customers sign in landscape on mobile; rotating converts the signature
 * to the correct orientation for the portrait PDF.
 * Returns a new base64 data URL of the rotated PNG.
 */
async function rotateSignature90(dataUrl) {
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const inputBuffer = Buffer.from(base64Data, 'base64');

  const rotatedBuffer = await sharp(inputBuffer)
    .rotate(90)           // 90° clockwise
    .flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } }) // white bg for transparency
    .png()
    .toBuffer();

  return `data:image/png;base64,${rotatedBuffer.toString('base64')}`;
}

/**
 * Extracts pixel width and height from a base64-encoded PNG data URL
 * by reading the IHDR chunk (bytes 16–23 of the PNG file).
 * Returns { width, height } or null if parsing fails.
 */
function getImageDimensionsFromDataUrl(dataUrl) {
  try {
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(base64Data, 'base64');

    // PNG IHDR: width at bytes 16-19, height at bytes 20-23 (big-endian uint32)
    if (buf.length >= 24) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0 && width < 20000 && height < 20000) {
        return { width, height };
      }
    }
    return null;
  } catch {
    return null;
  }
}
