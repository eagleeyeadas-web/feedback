import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

// Reference Colors
const COLORS = {
  navyHeader: [23, 63, 85],         // #173F55 Navy Blue
  headerBlue: [30, 58, 138],        // #1E3A8A Dark Blue
  lightBlueBg: [224, 242, 254],     // #E0F2FE Light Blue Table Header
  bannerBlue: [23, 63, 85],         // Banner Background
  borderColor: [0, 0, 0],           // Thin Black Border
  gridBorder: [180, 180, 180],      // Inner Grid Lines
  darkText: [31, 41, 55],           // #1F2937
  blackText: [0, 0, 0],
  white: [255, 255, 255],
  grayBg: [248, 250, 252],
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 12;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 186mm

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

  let result = words + ' Rupees';
  if (paise > 0) {
    result += ' and ' + convertChunk(paise).trim() + ' Paise';
  }
  result += ' Only';
  return result;
}

/**
 * Formats a number to Indian currency format with 2 decimals
 */
function formatCurrency(amount) {
  const num = parseFloat(amount) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats date to DD-MM-YYYY
 */
function formatDateStr(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Generates Quotation PDF matching reference layout exactly
 */
export async function generateQuotationPDF(quotation, items = [], logoBase64 = null) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  let y = 10;

  // ============================================================
  // HEADER & COMPANY INFO
  // ============================================================
  // Logo on the left
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', MARGIN_X, y, 42, 14);
    } catch (e) {
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

  // Company Name & Info (Centered / Right aligned)
  const centerX = PAGE_WIDTH / 2 + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.navyHeader);
  doc.text('EAGLE EYE SAFDRIVE PVT LTD', centerX, y + 3, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.darkText);
  doc.text('No.491/1B, Near Srinivasa Avenue, Senthampalayam, Annur, Coimbatore - 641 107', centerX, y + 7.5, { align: 'center' });
  doc.text('GST No: 33AAICE7626B1ZX  |  Tel: +91 63692 58461  |  Email: info@safdrive.live', centerX, y + 11, { align: 'center' });

  y += 16;

  // ============================================================
  // QUOTATION BANNER (Dark Blue Solid Rectangle)
  // ============================================================
  doc.setFillColor(...COLORS.bannerBlue);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.white);
  doc.text('QUOTATION', PAGE_WIDTH / 2, y + 5, { align: 'center' });

  y += 7;

  // ============================================================
  // CUSTOMER & QUOTATION DETAILS BOX (Two Columns)
  // ============================================================
  const custBoxHeight = 32;
  const colWidth = CONTENT_WIDTH / 2; // 93mm each

  // Outer Border Box
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, custBoxHeight);
  // Center vertical divider
  doc.line(MARGIN_X + colWidth, y, MARGIN_X + colWidth, y + custBoxHeight);

  // Left Column: CUSTOMER DETAILS
  let leftY = y + 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.navyHeader);
  doc.text('CUSTOMER DETAILS', MARGIN_X + 4, leftY);
  leftY += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.blackText);
  doc.text('TO:', MARGIN_X + 4, leftY);
  leftY += 3.8;

  doc.text(quotation.customer_name || '', MARGIN_X + 4, leftY);
  leftY += 3.8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  if (quotation.contact_person) {
    doc.text(`Attn: ${quotation.contact_person}`, MARGIN_X + 4, leftY);
    leftY += 3.5;
  }
  if (quotation.address) {
    const addressLines = doc.splitTextToSize(quotation.address, colWidth - 8);
    doc.text(addressLines, MARGIN_X + 4, leftY);
    leftY += (addressLines.length * 3.3);
  }
  if (quotation.phone_number) {
    doc.text(`Ph: ${quotation.phone_number}`, MARGIN_X + 4, leftY);
    leftY += 3.3;
  }
  if (quotation.gst_number) {
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${quotation.gst_number}`, MARGIN_X + 4, leftY);
  }

  // Right Column: QUOTATION NO & DATE
  let rightY = y + 4;
  const rightColX = MARGIN_X + colWidth + 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.navyHeader);
  doc.text('QUOTATION DETAILS', rightColX, rightY);
  rightY += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.blackText);

  doc.setFont('helvetica', 'bold');
  doc.text('Quotation No:', rightColX, rightY);
  doc.setFont('helvetica', 'normal');
  doc.text(quotation.quotation_number || '', rightColX + 26, rightY);
  rightY += 4.5;

  doc.setFont('helvetica', 'bold');
  doc.text('Date:', rightColX, rightY);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDateStr(quotation.quotation_date), rightColX + 26, rightY);
  rightY += 4.5;

  doc.setFont('helvetica', 'bold');
  doc.text('Valid Until:', rightColX, rightY);
  doc.setFont('helvetica', 'normal');
  const validUntil = new Date(quotation.quotation_date || Date.now());
  validUntil.setDate(validUntil.getDate() + 30); // 30 days default
  doc.text(formatDateStr(validUntil), rightColX + 26, rightY);

  y += custBoxHeight + 2;

  // ============================================================
  // PRODUCT TABLE
  // ============================================================
  // Column Specs: total width 186mm
  const cols = [
    { name: 'S.No', width: 10, align: 'center' },
    { name: 'Item Description', width: 56, align: 'left' },
    { name: 'HSN/SAC', width: 18, align: 'center' },
    { name: 'QTY', width: 12, align: 'center' },
    { name: 'UOM', width: 14, align: 'center' },
    { name: 'Rate (₹)', width: 22, align: 'right' },
    { name: 'Disc %', width: 14, align: 'center' },
    { name: 'Discount', width: 18, align: 'right' },
    { name: 'Amount (₹)', width: 22, align: 'right' },
  ];

  // Header Row Height
  const headerHeight = 7;
  doc.setFillColor(...COLORS.bannerBlue);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, headerHeight, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.white);

  let curX = MARGIN_X;
  cols.forEach(col => {
    let textX = curX + col.width / 2;
    if (col.align === 'left') textX = curX + 2;
    if (col.align === 'right') textX = curX + col.width - 2;
    doc.text(col.name, textX, y + 4.8, { align: col.align });
    curX += col.width;
  });

  // Table Border Top/Header
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, headerHeight);

  y += headerHeight;

  const tableStartY = y;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.blackText);

  // Render Rows dynamically
  items.forEach((item, index) => {
    // Calculate wrapped height for description
    const descLines = doc.splitTextToSize(item.item_description || '', cols[1].width - 4);
    const rowHeight = Math.max(7, descLines.length * 3.8 + 3);

    // Row background (white)
    doc.setFillColor(255, 255, 255);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, rowHeight, 'F');

    let x = MARGIN_X;

    // S.No
    doc.text(String(index + 1), x + cols[0].width / 2, y + 4.5, { align: 'center' });
    x += cols[0].width;

    // Description
    doc.text(descLines, x + 2, y + 4.5);
    x += cols[1].width;

    // HSN/SAC
    doc.text(item.hsn_sac || '-', x + cols[2].width / 2, y + 4.5, { align: 'center' });
    x += cols[2].width;

    // QTY
    doc.text(String(item.qty || 1), x + cols[3].width / 2, y + 4.5, { align: 'center' });
    x += cols[3].width;

    // UOM
    doc.text(item.uom || 'Nos', x + cols[4].width / 2, y + 4.5, { align: 'center' });
    x += cols[4].width;

    // Rate
    doc.text(formatCurrency(item.rate), x + cols[5].width - 2, y + 4.5, { align: 'right' });
    x += cols[5].width;

    // Disc %
    doc.text(parseFloat(item.discount_pct || 0) > 0 ? `${item.discount_pct}%` : '-', x + cols[6].width / 2, y + 4.5, { align: 'center' });
    x += cols[6].width;

    // Discount Amount
    doc.text(parseFloat(item.discount_amount || 0) > 0 ? formatCurrency(item.discount_amount) : '-', x + cols[7].width - 2, y + 4.5, { align: 'right' });
    x += cols[7].width;

    // Amount
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(item.amount), x + cols[8].width - 2, y + 4.5, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    // Draw row bottom border
    doc.setDrawColor(...COLORS.gridBorder);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, y + rowHeight, MARGIN_X + CONTENT_WIDTH, y + rowHeight);

    y += rowHeight;
  });

  // Vertical column borders for product table
  let gridX = MARGIN_X;
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  cols.forEach(col => {
    doc.line(gridX, tableStartY - headerHeight, gridX, y);
    gridX += col.width;
  });
  doc.line(gridX, tableStartY - headerHeight, gridX, y);

  y += 2;

  // ============================================================
  // TERMS & CONDITIONS (LEFT) AND TAX SUMMARY (RIGHT) SPLIT
  // ============================================================
  const splitY = y;
  const leftWidth = 110;
  const rightWidth = CONTENT_WIDTH - leftWidth; // 76mm

  // Compute Right Side Tax Summary Box Height
  let taxRowsCount = 1; // Subtotal
  if (quotation.gst_type === 'CGST_SGST') taxRowsCount += 2; // CGST + SGST
  if (quotation.gst_type === 'IGST') taxRowsCount += 1; // IGST
  taxRowsCount += 1; // Net Amount

  const taxBoxHeight = Math.max(38, taxRowsCount * 7.5);

  // Outer border for Terms & Conditions (Left)
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, splitY, leftWidth - 2, taxBoxHeight);

  // Terms & Conditions Title
  doc.setFillColor(...COLORS.bannerBlue);
  doc.rect(MARGIN_X, splitY, leftWidth - 2, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.white);
  doc.text('TERMS & CONDITIONS', MARGIN_X + 3, splitY + 4.2);

  // Render Terms
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.darkText);

  const defaultTerms = quotation.terms_conditions || [];
  let termY = splitY + 9;

  defaultTerms.forEach((term, idx) => {
    if (termY < splitY + taxBoxHeight - 3) {
      const termLines = doc.splitTextToSize(`${idx + 1}. ${term}`, leftWidth - 8);
      doc.text(termLines, MARGIN_X + 3, termY);
      termY += (termLines.length * 2.8);
    }
  });

  // Right Side: TAX SUMMARY TABLE
  const rightX = MARGIN_X + leftWidth;
  doc.rect(rightX, splitY, rightWidth, taxBoxHeight);

  let curTaxY = splitY;
  const labelX = rightX + 3;
  const valX = rightX + rightWidth - 3;

  function renderTaxRow(label, valStr, isBold = false, isFill = false) {
    if (isFill) {
      doc.setFillColor(...COLORS.lightBlueBg);
      doc.rect(rightX, curTaxY, rightWidth, 7.5, 'F');
    }
    doc.setDrawColor(...COLORS.gridBorder);
    doc.line(rightX, curTaxY + 7.5, rightX + rightWidth, curTaxY + 7.5);

    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(isBold ? 8 : 7.5);
    doc.setTextColor(...COLORS.blackText);

    doc.text(label, labelX, curTaxY + 5);
    doc.text(valStr, valX, curTaxY + 5, { align: 'right' });
    curTaxY += 7.5;
  }

  // 1. Subtotal
  renderTaxRow('Sub Total', `₹ ${formatCurrency(quotation.subtotal)}`);

  // 2. CGST & SGST or IGST
  if (quotation.gst_applicable && quotation.gst_type === 'CGST_SGST') {
    renderTaxRow(`CGST @ ${quotation.cgst_pct}%`, `₹ ${formatCurrency(quotation.cgst_amount)}`);
    renderTaxRow(`SGST @ ${quotation.sgst_pct}%`, `₹ ${formatCurrency(quotation.sgst_amount)}`);
  } else if (quotation.gst_applicable && quotation.gst_type === 'IGST') {
    renderTaxRow(`IGST @ ${quotation.igst_pct}%`, `₹ ${formatCurrency(quotation.igst_amount)}`);
  }

  // 3. Net Amount
  renderTaxRow('NET AMOUNT', `₹ ${formatCurrency(quotation.net_amount)}`, true, true);

  y = splitY + taxBoxHeight + 2;

  // ============================================================
  // AMOUNT IN WORDS BANNER
  // ============================================================
  const wordsStr = numberToWordsIndian(quotation.net_amount);

  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 7);
  doc.setFillColor(...COLORS.grayBg);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 7, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.navyHeader);
  doc.text('Amount in Words:', MARGIN_X + 3, y + 4.8);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.blackText);
  doc.text(wordsStr, MARGIN_X + 30, y + 4.8);

  y += 9;

  // ============================================================
  // BANK DETAILS & QR CODE (LEFT & RIGHT BOX)
  // ============================================================
  const bankBoxHeight = 28;
  const bankLeftWidth = 130;
  const qrRightWidth = CONTENT_WIDTH - bankLeftWidth; // 56mm

  // Bank Left Box
  doc.rect(MARGIN_X, y, bankLeftWidth - 2, bankBoxHeight);
  doc.setFillColor(...COLORS.bannerBlue);
  doc.rect(MARGIN_X, y, bankLeftWidth - 2, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.white);
  doc.text('BANK & PAYMENT DETAILS', MARGIN_X + 3, y + 3.8);

  let bankY = y + 9.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.blackText);

  const bankLines = [
    ['Bank Name:', 'Indian Overseas Bank'],
    ['Branch:', 'ANNUR'],
    ['Account No:', '000702000641107'],
    ['IFSC Code:', 'IOBA0000007'],
    ['Account Name:', 'EAGLE EYE SAFDRIVE PVT LTD'],
    ['UPI ID:', 'EAGLEEYESAFDRIVE@iob'],
  ];

  bankLines.forEach(([label, val]) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, MARGIN_X + 3, bankY);
    doc.setFont('helvetica', 'normal');
    doc.text(val, MARGIN_X + 26, bankY);
    bankY += 3.2;
  });

  // QR Code Right Box
  const qrX = MARGIN_X + bankLeftWidth;
  doc.rect(qrX, y, qrRightWidth, bankBoxHeight);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.navyHeader);
  doc.text('SCAN TO PAY (UPI)', qrX + qrRightWidth / 2, y + 4.5, { align: 'center' });

  // Generate UPI QR Code Data URL
  try {
    const upiUri = 'upi://pay?pa=EAGLEEYESAFDRIVE@iob&pn=EAGLE%20EYE%20SAFDRIVE%20PVT%20LTD&cu=INR';
    const qrDataUrl = await QRCode.toDataURL(upiUri, { margin: 1, width: 100 });
    doc.addImage(qrDataUrl, 'PNG', qrX + (qrRightWidth - 19) / 2, y + 6.5, 19, 19);
  } catch (err) {
    console.error('Failed to render UPI QR code:', err);
  }

  y += bankBoxHeight + 4;

  // ============================================================
  // FOOTER / AUTHORISED SIGNATORY
  // ============================================================
  // Right side: Signatory block
  const sigX = MARGIN_X + CONTENT_WIDTH - 60;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.blackText);
  doc.text('For Eagle Eye Safdrive Pvt Ltd', sigX, y, { align: 'left' });

  // Signature space gap
  doc.setFont('helvetica', 'bold');
  doc.text('Authorised Signatory', sigX, y + 15, { align: 'left' });

  // Bottom Center: Computer Generated Disclaimer
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text('This is a Computer Generated Document', PAGE_WIDTH / 2, PAGE_HEIGHT - 8, { align: 'center' });

  // ============================================================
  // PAGE 2 – PRODUCT TECHNICAL SPECIFICATIONS (OPTIONAL)
  // ============================================================
  if (quotation.include_tech_specs) {
    doc.addPage();
    let p2Y = 10;

    // Header Logo & Company Info
    if (logoBase64) {
      try {
        doc.addImage(logoBase64, 'PNG', MARGIN_X, p2Y, 42, 14);
      } catch (e) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(...COLORS.navyHeader);
        doc.text('EAGLE EYE', MARGIN_X, p2Y + 8);
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...COLORS.navyHeader);
    doc.text('EAGLE EYE SAFDRIVE PVT LTD', centerX, p2Y + 3, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.darkText);
    doc.text('No.491/1B, Near Srinivasa Avenue, Senthampalayam, Annur, Coimbatore - 641 107', centerX, p2Y + 7.5, { align: 'center' });

    p2Y += 16;

    // Banner
    doc.setFillColor(...COLORS.bannerBlue);
    doc.rect(MARGIN_X, p2Y, CONTENT_WIDTH, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...COLORS.white);
    doc.text('PRODUCT TECHNICAL SPECIFICATIONS', PAGE_WIDTH / 2, p2Y + 5, { align: 'center' });

    p2Y += 9;

    // Table Header
    const specCols = [
      { name: 'No.', width: 12, align: 'center' },
      { name: 'Specification', width: 58, align: 'left' },
      { name: 'Technical Parameter', width: 76, align: 'left' },
      { name: 'Remark', width: 40, align: 'left' },
    ];

    doc.setFillColor(...COLORS.bannerBlue);
    doc.rect(MARGIN_X, p2Y, CONTENT_WIDTH, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.white);

    let specCurX = MARGIN_X;
    specCols.forEach(col => {
      let tX = specCurX + 2;
      if (col.align === 'center') tX = specCurX + col.width / 2;
      doc.text(col.name, tX, p2Y + 4.8, { align: col.align });
      specCurX += col.width;
    });

    p2Y += 7;

    // Technical Specifications Data Rows
    const specsData = getTechnicalSpecsTemplate(quotation.tech_spec_template);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.blackText);

    specsData.forEach((row, idx) => {
      const specLines = doc.splitTextToSize(row.spec, specCols[1].width - 4);
      const paramLines = doc.splitTextToSize(row.param, specCols[2].width - 4);
      const remarkLines = doc.splitTextToSize(row.remark || '-', specCols[3].width - 4);

      const maxLines = Math.max(specLines.length, paramLines.length, remarkLines.length, 1);
      const rHeight = Math.max(7, maxLines * 4 + 2);

      let xPos = MARGIN_X;

      // No.
      doc.text(String(idx + 1), xPos + specCols[0].width / 2, p2Y + 4.5, { align: 'center' });
      xPos += specCols[0].width;

      // Spec
      doc.text(specLines, xPos + 2, p2Y + 4.5);
      xPos += specCols[1].width;

      // Param
      doc.text(paramLines, xPos + 2, p2Y + 4.5);
      xPos += specCols[2].width;

      // Remark
      doc.text(remarkLines, xPos + 2, p2Y + 4.5);

      // Grid line
      doc.setDrawColor(...COLORS.gridBorder);
      doc.setLineWidth(0.2);
      doc.line(MARGIN_X, p2Y + rHeight, MARGIN_X + CONTENT_WIDTH, p2Y + rHeight);

      p2Y += rHeight;
    });

    // Vertical borders
    let sX = MARGIN_X;
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.3);
    specCols.forEach(col => {
      doc.line(sX, p2Y - (specsData.length * 7) - 7, sX, p2Y);
      sX += col.width;
    });
    doc.line(sX, p2Y - (specsData.length * 7) - 7, sX, p2Y);

    // Footer on page 2
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text('This is a Computer Generated Document', PAGE_WIDTH / 2, PAGE_HEIGHT - 8, { align: 'center' });
  }

  // Return PDF ArrayBuffer as Node Buffer
  const pdfOutput = doc.output('arraybuffer');
  return Buffer.from(pdfOutput);
}

/**
 * Helper to return Technical Specification templates
 */
function getTechnicalSpecsTemplate(templateName) {
  const defaultSpecs = [
    { spec: 'GPS Receiver', param: 'High Sensitivity 66 Channel Receiver (-165 dBm)', remark: 'Standard' },
    { spec: 'GSM/GPRS Module', param: 'Quad Band GSM 850/900/1800/1900 MHz', remark: '4G LTE Compatible' },
    { spec: 'Operating Voltage', param: '9V DC to 36V DC Wide Input Range', remark: 'Vehicle Battery Powered' },
    { spec: 'Internal Battery Backup', param: 'Li-ion Rechargeable Battery (3.7V, 450mAh)', remark: '4+ hours backup' },
    { spec: 'Position Accuracy', param: '< 2.5 meters CEP', remark: 'High Precision' },
    { spec: 'Operating Temperature', param: '-20°C to +70°C', remark: 'Industrial Grade' },
    { spec: 'Certifications', param: 'AIS-140 Certified by ARAI / ICAT', remark: 'Compliant with Govt Specs' },
    { spec: 'Warranty', param: '3 Years Replacement Warranty against Manufacturing Defects', remark: 'Comprehensive Coverage' },
  ];

  if (templateName === 'speed_governor') {
    return [
      { spec: 'Device Type', param: 'Electronic Speed Limiting Device (SLD)', remark: 'AIS-018 / G.S.R. 290(E)' },
      { spec: 'Speed Accuracy', param: '± 2 km/h at set speed threshold', remark: 'Precision Controlled' },
      { spec: 'Operating Voltage', param: '12V / 24V DC', remark: 'Auto Voltage Selection' },
      { spec: 'Solenoid Valve / Fuel Control', param: 'High Pressure Anti-Rust Solenoid Valve', remark: 'Engine Safe' },
      { spec: 'Warranty', param: '3 Years Replacement Warranty', remark: 'Manufacturing Defects' },
    ];
  }

  return defaultSpecs;
}
