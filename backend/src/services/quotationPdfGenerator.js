import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

// Reference Colors from exact PDF screenshot
const COLORS = {
  headerBlue: [169, 216, 245],       // #A9D8F5 Light Blue Header Bar
  lightBlueBg: [224, 242, 254],      // #E0F2FE Light Blue Table Header
  navyHeader: [23, 63, 85],          // #173F55 Dark Navy Text
  borderColor: [0, 0, 0],            // Thin Black Border
  gridBorder: [0, 0, 0],             // Black Grid Lines
  darkText: [0, 0, 0],               // Black Text
  blueLink: [37, 99, 235],           // Blue Hyperlink
  white: [255, 255, 255],
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 10;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 190mm

/**
 * Draws a clean vector Rupee symbol (₹) inline with text
 */
function drawRupeeSymbolInline(doc, x, y, size = 2.4) {
  doc.setLineWidth(0.3);
  doc.setDrawColor(0, 0, 0);

  const topY = y - size * 0.7;
  const midY = y - size * 0.35;
  const botY = y + size * 0.3;
  const w = size * 0.6;

  doc.line(x, topY, x + w, topY);
  doc.line(x, midY, x + w * 0.9, midY);
  doc.line(x + 0.2, topY, x + 0.2, midY + 0.4);
  doc.line(x + 0.2, midY + 0.4, x + w * 0.7, midY + 0.4);
  doc.line(x + w * 0.7, midY + 0.4, x + 0.2, y);
  doc.line(x + 0.3, y - 0.2, x + w, botY);
}

/**
 * Sanitizes PDF text strings to remove fullwidth Asian punctuation (，：（）)
 * and non-WinAnsi characters that corrupt jsPDF font encoding.
 */
export function sanitizePdfText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/（/g, ' (')
    .replace(/）/g, ')')
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/“/g, '"')
    .replace(/”/g, '"')
    .replace(/‘/g, "'")
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Converts a number to Indian Currency Words (e.g. 22000 -> Twenty Two Thousand Only)
 */
export function numberToWordsIndian(num) {
  if (num === null || num === undefined || isNaN(num)) return 'Zero Only';
  
  const single = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teen = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const roundNum = Math.floor(Math.abs(num));
  const paise = Math.round((Math.abs(num) - roundNum) * 100);

  if (roundNum === 0 && paise === 0) return 'Zero Only';

  function convertChunk(n) {
    let str = '';
    if (n >= 100) {
      str += single[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 10 && n <= 19) {
      str += teen[n - 10] + ' ';
    } else if (n >= 20 || n === 10) {
      str += tens[Math.floor(n / 10)] + ' ';
      if (n % 10 > 0) str += single[n % 10] + ' ';
    } else if (n > 0) {
      str += single[n] + ' ';
    }
    return str;
  }

  let words = '';
  let temp = roundNum;

  const crore = Math.floor(temp / 10000000);
  temp %= 10000000;
  const lakh = Math.floor(temp / 100000);
  temp %= 100000;
  const thousand = Math.floor(temp / 1000);
  temp %= 1000;
  const hundred = temp;

  if (crore > 0) words += convertChunk(crore) + 'Crore ';
  if (lakh > 0) words += convertChunk(lakh) + 'Lakh ';
  if (thousand > 0) words += convertChunk(thousand) + 'Thousand ';
  if (hundred > 0) words += convertChunk(hundred);

  words = words.trim();
  if (!words) words = 'Zero';

  let result = words;
  if (paise > 0) {
    result += ' Rupees and ' + convertChunk(paise).trim() + ' Paise';
  }
  result += ' Only';
  return sanitizePdfText(result);
}

function formatCurrency(amount) {
  const num = parseFloat(amount) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDateShort(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return sanitizePdfText(String(dateInput));
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

/**
 * Generates exact 2-Page Quotation PDF matching reference image
 */
export async function generateQuotationPDF(quotation, items = [], logoBase64 = null) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Fallback to local logo asset if logoBase64 is not passed
  let effectiveLogo = logoBase64;
  if (!effectiveLogo) {
    try {
      const localLogoPath = path.resolve(process.cwd(), 'assets/logo.png');
      if (fs.existsSync(localLogoPath)) {
        const logoBuf = fs.readFileSync(localLogoPath);
        effectiveLogo = `data:image/png;base64,${logoBuf.toString('base64')}`;
      }
    } catch (e) {
      // Ignore
    }
  }

  const pageMarginTop = 10;
  const pageMarginBottom = 10;
  let y = pageMarginTop;

  // Outer Box Frame Page 1
  const outerFrameHeight = PAGE_HEIGHT - pageMarginTop - pageMarginBottom - 8;
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, outerFrameHeight);

  // ============================================================
  // PAGE 1 HEADER
  // ============================================================
  // Logo on Left
  if (effectiveLogo) {
    try {
      doc.addImage(effectiveLogo, 'PNG', MARGIN_X + 2, y + 2, 28, 14);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.text('Eagle Eye', MARGIN_X + 2, y + 8);
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('Eagle Eye', MARGIN_X + 2, y + 8);
  }

  // Company Name & Address Centered
  const centerX = PAGE_WIDTH / 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('Eagle Eye Safdrive Pvt Ltd', centerX, y + 5.2, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('No.491/1B, Near Srinivasa Avenue, Senthampalayam, Annur,', centerX, y + 9.5, { align: 'center' });
  doc.text('Coimbatore - 641 107', centerX, y + 13.2, { align: 'center' });
  
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);

  // Single continuous contact line: GST No, Tel, Email
  const part1 = 'GST No: 33AAICE7626B1ZX    Tel: +91 63692 58461    Email: ';
  const part2 = 'info@safdrive.live';
  
  // Calculate exact string widths for clean centering
  const w1 = doc.getTextWidth(part1);
  const w2 = doc.getTextWidth(part2);
  const startX = centerX - (w1 + w2) / 2;

  doc.text(part1, startX, y + 17.2);
  doc.setTextColor(...COLORS.blueLink);
  doc.text(part2, startX + w1, y + 17.2);

  y += 20.5;

  // Horizontal Line below Header
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);

  // ============================================================
  // QUOTATION BANNER (Light Blue Bar)
  // ============================================================
  doc.setFillColor(...COLORS.headerBlue);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('QUOTATION', centerX, y + 4.3, { align: 'center' });
  doc.line(MARGIN_X, y + 6, MARGIN_X + CONTENT_WIDTH, y + 6);

  y += 6;

  // ============================================================
  // CUSTOMER & QUOTATION NO SECTION (Split 2 Columns)
  // ============================================================
  const custBoxH = 28;
  const halfW = CONTENT_WIDTH / 2;

  // Header Cells
  doc.setFillColor(...COLORS.headerBlue);
  doc.rect(MARGIN_X, y, halfW, 5.5, 'F');
  doc.rect(MARGIN_X + halfW, y, halfW, 5.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  doc.text('CUSTOMER DETAILS', MARGIN_X + halfW / 2, y + 3.8, { align: 'center' });

  const qDateStr = formatDateShort(quotation.quotation_date);
  doc.text(`Quotation No : ${sanitizePdfText(quotation.quotation_number || 'CQS/00231')} Dt ${qDateStr}`, MARGIN_X + halfW + 4, y + 3.8);

  doc.line(MARGIN_X, y + 5.5, MARGIN_X + CONTENT_WIDTH, y + 5.5);
  doc.line(MARGIN_X + halfW, y, MARGIN_X + halfW, y + custBoxH);

  let leftY = y + 8.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const sanitizedCustName = sanitizePdfText(quotation.customer_name || '');
  const sanitizedContact = sanitizePdfText(quotation.contact_person || '');
  const sanitizedAddress = sanitizePdfText(quotation.address || '');
  const sanitizedPhone = sanitizePdfText(quotation.phone_number || '');

  // TO Left Side
  doc.text('TO', MARGIN_X + 2, leftY);
  leftY += 3.8;
  doc.setFont('helvetica', 'bold');
  doc.text(sanitizedCustName, MARGIN_X + 2, leftY);
  leftY += 3.8;
  doc.setFont('helvetica', 'normal');
  if (sanitizedContact) {
    doc.text(sanitizedContact, MARGIN_X + 2, leftY);
    leftY += 3.8;
  }
  if (sanitizedAddress) {
    const addLines = doc.splitTextToSize(sanitizedAddress, halfW - 4);
    doc.text(addLines, MARGIN_X + 2, leftY);
    leftY += (addLines.length * 3.5);
  }
  if (sanitizedPhone) {
    doc.text(sanitizedPhone, MARGIN_X + 2, leftY);
  }

  // TO Right Side
  let rightY = y + 8.5;
  doc.text('TO', MARGIN_X + halfW + 2, rightY);
  rightY += 3.8;
  doc.setFont('helvetica', 'bold');
  doc.text(sanitizedCustName, MARGIN_X + halfW + 2, rightY);
  rightY += 3.8;
  doc.setFont('helvetica', 'normal');
  if (sanitizedContact) {
    doc.text(sanitizedContact, MARGIN_X + halfW + 2, rightY);
    rightY += 3.8;
  }
  if (sanitizedAddress) {
    const addLinesR = doc.splitTextToSize(sanitizedAddress, halfW - 4);
    doc.text(addLinesR, MARGIN_X + halfW + 2, rightY);
    rightY += (addLinesR.length * 3.5);
  }
  if (sanitizedPhone) {
    doc.text(sanitizedPhone, MARGIN_X + halfW + 2, rightY);
  }

  y += custBoxH;
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);

  // ============================================================
  // PRODUCT TABLE (Proportional Widths Total 190mm)
  // ============================================================
  const cols = [
    { name: 'S.No', width: 10, align: 'center' },
    { name: 'Item Description', width: 56, align: 'left' },
    { name: 'HSN/SAC', width: 18, align: 'center' },
    { name: 'QTY', width: 12, align: 'center' },
    { name: 'UOM', width: 14, align: 'center' },
    { name: 'Rate (', width: 24, align: 'right', isRate: true },
    { name: 'Disc %', width: 14, align: 'center' },
    { name: 'Discount', width: 16, align: 'right' },
    { name: 'Amount (', width: 26, align: 'right', isAmount: true },
  ];

  doc.setFillColor(...COLORS.headerBlue);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);

  let cX = MARGIN_X;
  cols.forEach(col => {
    let textX = cX + 2;
    if (col.align === 'center') textX = cX + col.width / 2;
    if (col.align === 'right') textX = cX + col.width - 2;

    if (col.isRate) {
      // Single line 'Rate (₹)' right aligned inside 24mm header cell
      const cellRight = cX + col.width - 2;
      doc.text('Rate (', cellRight - 12.8, y + 5.2);
      drawRupeeSymbolInline(doc, cellRight - 3.6, y + 5.2, 2.2);
      doc.text(')', cellRight - 1.2, y + 5.2);
    } else if (col.isAmount) {
      // Single line 'Amount (₹)' right aligned inside 26mm header cell
      const cellRight = cX + col.width - 2;
      doc.text('Amount (', cellRight - 16.2, y + 5.2);
      drawRupeeSymbolInline(doc, cellRight - 3.6, y + 5.2, 2.2);
      doc.text(')', cellRight - 1.2, y + 5.2);
    } else {
      doc.text(col.name, textX, y + 5.2, { align: col.align });
    }
    cX += col.width;
  });

  y += 8;
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);

  const prodTableStartY = y - 8;

  // Render Item Rows
  let totalQty = 0;
  let totalUom = 'SET';

  items.forEach((item, index) => {
    const cleanDesc = sanitizePdfText(item.item_description || '');
    const descLines = doc.splitTextToSize(cleanDesc, cols[1].width - 3);
    const rowH = Math.max(8, descLines.length * 3.8 + 3);

    let posX = MARGIN_X;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);

    // S.No
    doc.text(String(index + 1), posX + cols[0].width / 2, y + 4.5, { align: 'center' });
    posX += cols[0].width;

    // Description
    doc.text(descLines, posX + 2, y + 4.5);
    posX += cols[1].width;

    // HSN/SAC (Always defaults to fixed 852589)
    const hsnValue = sanitizePdfText(item.hsn_sac || '852589');
    doc.text(hsnValue, posX + cols[2].width / 2, y + 4.5, { align: 'center' });
    posX += cols[2].width;

    // QTY
    const itemQty = parseFloat(item.qty) || 1;
    totalQty += itemQty;
    doc.text(String(itemQty), posX + cols[3].width / 2, y + 4.5, { align: 'center' });
    posX += cols[3].width;

    // UOM
    totalUom = sanitizePdfText(item.uom || 'SET');
    doc.text(totalUom, posX + cols[4].width / 2, y + 4.5, { align: 'center' });
    posX += cols[4].width;

    // Rate
    doc.text(formatCurrency(item.rate), posX + cols[5].width - 2, y + 4.5, { align: 'right' });
    posX += cols[5].width;

    // Disc %
    doc.text(parseFloat(item.discount_pct || 0) > 0 ? `${item.discount_pct}%` : '', posX + cols[6].width / 2, y + 4.5, { align: 'center' });
    posX += cols[6].width;

    // Discount Amount
    doc.text(parseFloat(item.discount_amount || 0) > 0 ? formatCurrency(item.discount_amount) : '', posX + cols[7].width - 2, y + 4.5, { align: 'right' });
    posX += cols[7].width;

    // Amount
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(item.amount), posX + cols[8].width - 2, y + 4.5, { align: 'right' });

    y += rowH;
    doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);
  });

  // Total Row at bottom of product table
  doc.setFillColor(...COLORS.headerBlue);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);

  let totalX = MARGIN_X + cols[0].width;
  doc.text('Total', totalX + cols[1].width / 2, y + 4.2, { align: 'center' });
  doc.text(totalUom, MARGIN_X + cols[0].width + cols[1].width + cols[2].width + cols[3].width + cols[4].width / 2, y + 4.2, { align: 'center' });
  doc.text(formatCurrency(quotation.subtotal), MARGIN_X + CONTENT_WIDTH - 2, y + 4.2, { align: 'right' });

  y += 6;
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);

  // Vertical Borders for Product Table
  let gridX = MARGIN_X;
  cols.forEach(col => {
    doc.line(gridX, prodTableStartY, gridX, y);
    gridX += col.width;
  });
  doc.line(gridX, prodTableStartY, gridX, y);

  // ============================================================
  // TERMS & CONDITIONS (LEFT) AND TAX / NET AMOUNT (RIGHT)
  // ============================================================
  const splitBoxH = 45;
  const leftW = 135;
  const rightW = CONTENT_WIDTH - leftW; // 55mm

  // Split Divider Line
  doc.line(MARGIN_X + leftW, y, MARGIN_X + leftW, y + splitBoxH);

  // Terms Left Side
  let termY = y + 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 0, 0);
  doc.text('Terms & Conditions', MARGIN_X + 3, termY);
  termY += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);

  const exactDefaultTerms = [
    '1. 100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
    '2. Payments are non-refundable once the order has been confirmed and processing has begun.',
    '3. SIM card procurement, activation, and recharge/data charges shall be under the customer\'s scope.',
    '4. Delivery timelines are estimates only and subject to stock availability.',
    '5. Products/services provided are subject to a 3-year replacement warranty against manufacturing defects.',
    '6. This warranty does not cover normal wear and tear, misuse, or damage caused by improper handling.',
  ];

  const rawTerms = (quotation.terms_conditions && quotation.terms_conditions.length > 0)
    ? quotation.terms_conditions
    : exactDefaultTerms;

  const termsToRender = rawTerms.map((t, idx) => {
    const clean = sanitizePdfText(t);
    return /^\d+\./.test(clean) ? clean : `${idx + 1}. ${clean}`;
  });

  termsToRender.forEach(term => {
    if (termY < y + splitBoxH - 2) {
      const termLines = doc.splitTextToSize(term, leftW - 6);
      doc.text(termLines, MARGIN_X + 3, termY);
      termY += (termLines.length * 2.8 + 0.8);
    }
  });

  // Right Side Tax Breakdown
  let rightTaxY = y + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);

  if (quotation.gst_applicable && quotation.gst_type === 'CGST_SGST') {
    doc.text('CGST', MARGIN_X + leftW + 4, rightTaxY);
    doc.text(formatCurrency(quotation.cgst_amount), MARGIN_X + CONTENT_WIDTH - 2, rightTaxY, { align: 'right' });
    rightTaxY += 7;

    doc.text('SGST', MARGIN_X + leftW + 4, rightTaxY);
    doc.text(formatCurrency(quotation.sgst_amount), MARGIN_X + CONTENT_WIDTH - 2, rightTaxY, { align: 'right' });
  } else if (quotation.gst_applicable && quotation.gst_type === 'IGST') {
    doc.text('IGST', MARGIN_X + leftW + 4, rightTaxY);
    doc.text(formatCurrency(quotation.igst_amount), MARGIN_X + CONTENT_WIDTH - 2, rightTaxY, { align: 'right' });
  }

  // Net Amount Row Box on Right
  const netBoxY = y + splitBoxH - 10;
  doc.line(MARGIN_X + leftW, netBoxY, MARGIN_X + CONTENT_WIDTH, netBoxY);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Net Amount', MARGIN_X + leftW + 4, netBoxY + 6.5);
  doc.text(formatCurrency(quotation.net_amount), MARGIN_X + CONTENT_WIDTH - 2, netBoxY + 6.5, { align: 'right' });

  y += splitBoxH;
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);

  // ============================================================
  // NET AMOUNT IN WORDS
  // ============================================================
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Net Amount in words', MARGIN_X + 2, y + 4.2);
  doc.setFont('helvetica', 'normal');
  doc.text(numberToWordsIndian(quotation.net_amount), MARGIN_X + 2, y + 8.2);

  y += 10;
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);

  // ============================================================
  // BANK DETAILS & QR CODE
  // ============================================================
  const bankBoxH = 28;
  const bankW = 140;
  const qrW = CONTENT_WIDTH - bankW; // 50mm

  doc.line(MARGIN_X + bankW, y, MARGIN_X + bankW, y + bankBoxH);

  let bY = y + 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);

  doc.text('Bank Name: Indian Overseas Bank', MARGIN_X + 2, bY);
  doc.text('Branch Name : ANNUR', MARGIN_X + 75, bY);
  bY += 4.5;

  doc.text('Account No : 000702000641107', MARGIN_X + 2, bY);
  doc.text('IFSC Code: IOBA0000007', MARGIN_X + 75, bY);
  bY += 4.5;

  doc.text('Account Name : EAGLE EYE SAFDRIVE PVT LTD', MARGIN_X + 2, bY);
  bY += 4.5;
  doc.text('Scan QR', MARGIN_X + 2, bY);
  bY += 4.5;
  doc.text('UPI ID : EAGLEEYESAFDRIVE@iob', MARGIN_X + 2, bY);

  // QR Code Image
  try {
    const upiUri = 'upi://pay?pa=EAGLEEYESAFDRIVE@iob&pn=EAGLE%20EYE%20SAFDRIVE%20PVT%20LTD&cu=INR';
    const qrDataUrl = await QRCode.toDataURL(upiUri, { margin: 1, width: 100 });
    doc.addImage(qrDataUrl, 'PNG', MARGIN_X + bankW + (qrW - 22) / 2, y + 3, 22, 22);
  } catch (err) {
    console.error('Failed to generate QR:', err);
  }

  y += bankBoxH;
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_WIDTH, y);

  // ============================================================
  // SIGNATORY & FOOTER
  // ============================================================
  let sigY = y + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('For Eagle Eye Safdrive Pvt Ltd', MARGIN_X + CONTENT_WIDTH - 2, sigY, { align: 'right' });
  
  sigY += 12;
  doc.text('Authorised Signatory', MARGIN_X + CONTENT_WIDTH - 2, sigY, { align: 'right' });

  // Computer Generated Disclaimer Outside Box
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('This is a Computer Generated Document', centerX, PAGE_HEIGHT - 6, { align: 'center' });

  // ============================================================
  // PAGE 2 – PRODUCT TECHNICAL SPECIFICATION (EXACT 19 SPECIFICATIONS)
  // ============================================================
  // Always include Page 2 to guarantee exactly 2 pages
  doc.addPage();
  let p2Y = 12;

  // Header Logo & Company Info
  if (effectiveLogo) {
    try {
      doc.addImage(effectiveLogo, 'PNG', MARGIN_X + 2, p2Y, 28, 14);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Eagle Eye', MARGIN_X + 2, p2Y + 8);
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text('EAGLE EYE SAFDRIVE PVT LTD', centerX, p2Y + 8, { align: 'center' });

  p2Y += 18;

  // Subtitle Banner
  doc.setFontSize(10);
  doc.text('Product Specification Technical Specification', centerX, p2Y, { align: 'center' });
  doc.line(centerX - 42, p2Y + 1, centerX + 42, p2Y + 1);

  p2Y += 6;

  // 4 Column Technical Matrix (Total 190mm: 12 + 50 + 98 + 30)
  const specCols = [
    { name: 'No.', width: 12, align: 'center' },
    { name: 'Specification', width: 50, align: 'center' },
    { name: 'Technical Parameter', width: 98, align: 'center' },
    { name: 'Remark', width: 30, align: 'center' },
  ];

  // Table Header
  doc.rect(MARGIN_X, p2Y, CONTENT_WIDTH, 7);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);

  let sX = MARGIN_X;
  specCols.forEach(col => {
    doc.text(col.name, sX + col.width / 2, p2Y + 4.8, { align: 'center' });
    sX += col.width;
  });

  p2Y += 7;
  const specTableStartY = p2Y - 7;

  // 19 Technical Parameters from Reference PDF (All text sanitized)
  const full19Specs = [
    { no: '1', spec: 'Display size', param: '10-inchs IPS full viewing angle HD screen 16 : 10', remark: '' },
    { no: '2', spec: 'Resolution', param: '1280*800, 4 Camera', remark: '' },
    { no: '3', spec: 'System', param: 'Linux', remark: '' },
    { no: '4', spec: 'Processor', param: 'MTK6762 CCRTEX-A53 Octa-core Processor 2GHz', remark: '' },
    { no: '5', spec: 'Storage Memory', param: '128GB', remark: '' },
    { no: '6', spec: 'Operating Memory', param: '2GB/4GB', remark: '' },
    { no: '7', spec: 'GPU Processor', param: 'IMG GE8320, 650MHZ', remark: '' },
    { no: '8', spec: 'Calibration Method', param: 'One-key Calibration, Remote Calibration', remark: '' },
    { no: '9', spec: 'Display Mode', param: '4K', remark: '' },
    { no: '10', spec: 'Tracking Method', param: 'GPS+ GLONASS+ AGPS', remark: '' },
    { no: '11', spec: 'Network', param: '4G full Netcom supports external SIM card', remark: '' },
    { no: '12', spec: 'WiFi', param: 'supports 802.11 b/g/n protocol', remark: '' },
    { no: '13', spec: 'USB insert', param: 'support 1 USB insert', remark: '' },
    { no: '14', spec: 'T F card', param: 'Supports expansion up to 512GB', remark: '' },
    { no: '15', spec: 'Car Setting', param: 'Settings include system, screen, time, sound, language, network, ETC', remark: '' },
    { no: '16', spec: 'Operating Voltage', param: 'DC 9-36V, nominal DC 24V', remark: '' },
    { no: '17', spec: 'Working Current', param: 'About 0.8A (with 4cameras)', remark: '' },
    { no: '18', spec: 'Working Temperature', param: '-20-70 degrees', remark: '' },
    { no: '19', spec: 'Storage temperature', param: '-40-85 degrees', remark: '' },
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  full19Specs.forEach((row) => {
    const cleanSpec = sanitizePdfText(row.spec);
    const cleanParam = sanitizePdfText(row.param);
    const cleanRemark = sanitizePdfText(row.remark);

    const specLines = doc.splitTextToSize(cleanSpec, specCols[1].width - 4);
    const paramLines = doc.splitTextToSize(cleanParam, specCols[2].width - 4);
    const remarkLines = doc.splitTextToSize(cleanRemark, specCols[3].width - 4);

    const maxLines = Math.max(specLines.length, paramLines.length, remarkLines.length, 1);
    const rowH = Math.max(7, maxLines * 4 + 2);

    doc.rect(MARGIN_X, p2Y, CONTENT_WIDTH, rowH);

    let px = MARGIN_X;

    // No.
    doc.text(row.no, px + specCols[0].width / 2, p2Y + 4.8, { align: 'center' });
    px += specCols[0].width;

    // Spec
    doc.text(specLines, px + specCols[1].width / 2, p2Y + 4.8, { align: 'center' });
    px += specCols[1].width;

    // Parameter
    doc.text(paramLines, px + specCols[2].width / 2, p2Y + 4.8, { align: 'center' });
    px += specCols[2].width;

    // Remark
    doc.text(remarkLines, px + specCols[3].width / 2, p2Y + 4.8, { align: 'center' });

    p2Y += rowH;
  });

  // Vertical Borders for Page 2
  let sGridX = MARGIN_X;
  specCols.forEach(col => {
    doc.line(sGridX, specTableStartY, sGridX, p2Y);
    sGridX += col.width;
  });
  doc.line(sGridX, specTableStartY, sGridX, p2Y);

  // Return PDF Node Buffer
  const pdfOutput = doc.output('arraybuffer');
  return Buffer.from(pdfOutput);
}
