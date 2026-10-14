import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Theme Color Palette matching Eagle Eye SafDrive Branding
const COLORS = {
  navy: [10, 25, 70],            // #0a1946 Dark Navy
  navyLight: [30, 58, 138],       // #1e3a8a Deep Blue
  purpleHeader: [243, 232, 255],  // #f3e8ff Light Purple Section Header
  purpleAccent: [147, 51, 234],   // #9333ea Purple Accent
  purpleText: [126, 34, 206],     // #7e22ce Deep Purple Text
  blueHeader: [239, 246, 255],    // #eff6ff Light Blue Section Header
  blueAccent: [37, 99, 235],     // #2563eb Blue Accent Line / Icon
  blueText: [29, 78, 216],       // #1d4ed8 Deep Blue Text
  emerald: [6, 95, 70],          // #065f46 Emerald Green Status
  emeraldBg: [236, 253, 245],    // #ecfdf5 Light Emerald
  amber: [180, 83, 9],           // #b45309 Amber Status
  grayBg: [248, 250, 252],       // #f8fafc Light Gray Cell Background
  grayBgAlt: [241, 245, 249],    // #f1f5f9 Slightly darker gray for alternating rows
  borderColor: [226, 232, 240],  // #e2e8f0 Cell Border Line
  darkText: [15, 23, 42],        // #0f172a Dark Slate Primary Text
  grayText: [100, 116, 139],     // #64748b Secondary Slate Text
  white: [255, 255, 255],
};

// Page Geometry Constants for A4
const PAGE_WIDTH = 210;          // A4 Width in mm
const PAGE_HEIGHT = 297;         // A4 Height in mm
const MARGIN_X = 14;             // Left & Right Margins (14mm)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 182mm exact content width
const MAX_Y = PAGE_HEIGHT - 22;  // Maximum Y before page break

/**
 * Sanitizes PDF text strings to replace special Unicode characters that cause WinAnsi encoding issues in jsPDF
 */
export function sanitizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/“/g, '"')
    .replace(/”/g, '"')
    .replace(/‘/g, "'")
    .replace(/’/g, "'")
    .replace(/₹/g, 'Rs.')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return sanitizeText(String(dateInput));
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(amt) {
  const num = parseFloat(amt) || 0;
  return `Rs. ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Loads the company logo image as Base64 string
 */
function getLogoBase64() {
  try {
    const logoPath = path.resolve(__dirname, '../assets/logo.png');
    if (fs.existsSync(logoPath)) {
      return fs.readFileSync(logoPath, { encoding: 'base64' });
    }
    const frontendLogoPath = path.resolve(__dirname, '../../../frontend/public/logo.png');
    if (fs.existsSync(frontendLogoPath)) {
      return fs.readFileSync(frontendLogoPath, { encoding: 'base64' });
    }
  } catch (e) {
    console.warn('Failed to load logo asset:', e.message);
  }
  return null;
}

/**
 * Draws a section header bar aligned with content margins
 */
function drawSectionHeader(doc, title, y, isPurple = false) {
  doc.setFillColor(...(isPurple ? COLORS.purpleHeader : COLORS.blueHeader));
  doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 7, 1, 1, 'F');

  // Left accent pill
  doc.setFillColor(...(isPurple ? COLORS.purpleAccent : COLORS.blueAccent));
  doc.rect(MARGIN_X, y, 2.5, 7, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.navy);
  doc.text(sanitizeText(title), MARGIN_X + 5, y + 4.8);

  doc.setDrawColor(...(isPurple ? COLORS.purpleAccent : COLORS.blueAccent));
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y + 7, MARGIN_X + CONTENT_WIDTH, y + 7);

  return y + 9;
}

/**
 * Generates an A4 PDF document for Technician Job Expenses
 * @param {Object} params
 * @param {Object} params.checklist - Checklist DB record
 * @param {Array} params.expenses - Array of expense items
 * @param {Object} [params.user] - Requesting technician user profile
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateTechnicianExpensePDF({ checklist, expenses = [], user = null }) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const logoBase64 = getLogoBase64();
  let y = 12;

  // Header on Page 2+
  const drawCompactHeader = (pageNum) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.navy);
    doc.text('EAGLE EYE SAFDRIVE - TECHNICIAN EXPENSE REPORT', MARGIN_X, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.grayText);
    doc.text(`Checklist No: ${sanitizeText(checklist.checklist_number)}`, PAGE_WIDTH - MARGIN_X, 14, { align: 'right' });

    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.4);
    doc.line(MARGIN_X, 17, PAGE_WIDTH - MARGIN_X, 17);
  };

  const checkAddPage = (neededHeight) => {
    if (y + neededHeight > MAX_Y) {
      doc.addPage();
      y = 22;
      drawCompactHeader(doc.internal.getNumberOfPages());
    }
  };

  // ============================================================
  // PAGE 1 — BRANDING & HEADER
  // ============================================================
  if (logoBase64) {
    try {
      doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', MARGIN_X, y, 40, 14);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.setTextColor(...COLORS.navy);
      doc.text('EAGLE EYE SAFDRIVE', MARGIN_X, y + 9);
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...COLORS.navy);
    doc.text('EAGLE EYE SAFDRIVE', MARGIN_X, y + 9);
  }

  // Header Titles
  const headerLeftX = MARGIN_X + 44;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.navy);
  doc.text('EAGLE EYE / SAFDRIVE', headerLeftX, y + 4.5);

  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.purpleText);
  doc.text('TECHNICIAN EXPENSE REPORT', headerLeftX, y + 8.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text('Travel & On-Site Installation Expense Voucher (Print & Submit Manually)', headerLeftX, y + 12.8);

  // Right Badge Box: Checklist Number & Date
  const rightBoxWidth = 56;
  const rightBoxX = PAGE_WIDTH - MARGIN_X - rightBoxWidth;
  doc.setFillColor(...COLORS.purpleHeader);
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.roundedRect(rightBoxX, y, rightBoxWidth, 14, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.purpleText);
  doc.text('CHECKLIST NUMBER', rightBoxX + 3.5, y + 4);

  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.navy);
  doc.text(sanitizeText(checklist.checklist_number), rightBoxX + 3.5, y + 8.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text(`Generated: ${formatDate(new Date())}`, rightBoxX + 3.5, y + 12.2);

  y += 18;

  // Thin dividing line
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 4;

  // ============================================================
  // JOB & SERVICE ENGINEER DETAILS GRID
  // ============================================================
  y = drawSectionHeader(doc, 'JOB & SERVICE ENGINEER DETAILS', y, false);

  const engineerName = checklist.service_engineer || user?.full_name || 'Assigned Engineer';
  const installationDate = formatDate(checklist.preferred_installation_date || checklist.created_at);

  const gridRows = [
    [
      { label: 'Checklist Number', value: checklist.checklist_number, bold: true },
      { label: 'Client / Company Name', value: checklist.client_name, bold: true },
      { label: 'Client Location / Site', value: checklist.client_location || 'On-site' },
    ],
    [
      { label: 'Service Engineer', value: engineerName, bold: true },
      { label: 'Installation / Service Date', value: installationDate },
      { label: 'Submission Type', value: 'Physical Paper Submission' },
    ],
  ];

  gridRows.forEach((row) => {
    const colCount = row.length;
    const colWidth = CONTENT_WIDTH / colCount;
    let maxCellHeight = 11;

    row.forEach((cell) => {
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(sanitizeText(cell.value || '-'), colWidth - 6);
      const cellH = Math.max(11, 4.5 + lines.length * 3.6);
      if (cellH > maxCellHeight) maxCellHeight = cellH;
    });

    row.forEach((cell, idx) => {
      const cellX = MARGIN_X + idx * colWidth;
      doc.setFillColor(...COLORS.grayBg);
      doc.setDrawColor(...COLORS.borderColor);
      doc.setLineWidth(0.2);
      doc.rect(cellX, y, colWidth, maxCellHeight, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.grayText);
      doc.text(sanitizeText(cell.label).toUpperCase(), cellX + 3, y + 4);

      doc.setFont('helvetica', cell.bold ? 'bold' : 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.darkText);
      const valStr = sanitizeText(cell.value || '-');
      const lines = doc.splitTextToSize(valStr, colWidth - 6);
      doc.text(lines, cellX + 3, y + 7.8);
    });

    y += maxCellHeight;
  });

  y += 5;

  // ============================================================
  // ITEMISED EXPENSES TABLE
  // ============================================================
  checkAddPage(30);
  y = drawSectionHeader(doc, 'ITEMISED TRAVEL & JOB EXPENSES', y, true);

  // Table Columns Widths (Total: 182mm)
  // S.No: 10mm, Date: 22mm, Category: 32mm, Description: 62mm, Payment Method: 28mm, Amount: 28mm
  const colW = {
    sno: 10,
    date: 22,
    category: 32,
    desc: 62,
    payment: 28,
    amount: 28,
  };

  const drawTableHeader = () => {
    doc.setFillColor(...COLORS.navy);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 7, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.white);

    let currX = MARGIN_X;
    doc.text('#', currX + 3, y + 4.8);
    currX += colW.sno;

    doc.text('Date', currX + 2, y + 4.8);
    currX += colW.date;

    doc.text('Category', currX + 2, y + 4.8);
    currX += colW.category;

    doc.text('Description / Details', currX + 2, y + 4.8);
    currX += colW.desc;

    doc.text('Payment Method', currX + 2, y + 4.8);
    currX += colW.payment;

    doc.text('Amount (Rs.)', currX + colW.amount - 3, y + 4.8, { align: 'right' });

    y += 7;
  };

  drawTableHeader();

  let totalExpenseAmount = 0;

  if (expenses.length === 0) {
    doc.setFillColor(...COLORS.grayBg);
    doc.setDrawColor(...COLORS.borderColor);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 12, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text('No expenses recorded for this installation job.', MARGIN_X + 6, y + 7.5);
    y += 12;
  } else {
    expenses.forEach((item, index) => {
      const amt = parseFloat(item.amount) || 0;
      totalExpenseAmount += amt;

      const dateStr = formatDate(item.expense_date);
      const catStr = sanitizeText(item.category || 'Travel');
      const descStr = sanitizeText(item.description || '-');
      const payStr = sanitizeText(item.payment_method || 'Cash');
      const amtStr = formatCurrency(amt);

      // Check height needed for description text wrapping
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      const descLines = doc.splitTextToSize(descStr, colW.desc - 4);
      let noteLines = [];
      if (item.notes && item.notes.trim()) {
        noteLines = doc.splitTextToSize(`Note: ${sanitizeText(item.notes)}`, colW.desc - 4);
      }
      const totalLinesCount = descLines.length + noteLines.length;
      const rowHeight = Math.max(7.5, 4 + totalLinesCount * 3.4);

      // Page break check for table row
      if (y + rowHeight > MAX_Y) {
        doc.addPage();
        y = 22;
        drawCompactHeader(doc.internal.getNumberOfPages());
        drawTableHeader();
      }

      // Alternating row background
      const isAlt = index % 2 === 1;
      doc.setFillColor(...(isAlt ? COLORS.grayBgAlt : COLORS.white));
      doc.setDrawColor(...COLORS.borderColor);
      doc.setLineWidth(0.15);
      doc.rect(MARGIN_X, y, CONTENT_WIDTH, rowHeight, 'FD');

      let currX = MARGIN_X;

      // S.No
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.grayText);
      doc.text(String(index + 1), currX + 3, y + 4.8);
      currX += colW.sno;

      // Date
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.darkText);
      doc.text(dateStr, currX + 2, y + 4.8);
      currX += colW.date;

      // Category Pill / Text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.purpleText);
      doc.text(catStr, currX + 2, y + 4.8);
      currX += colW.category;

      // Description
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.darkText);
      doc.text(descLines, currX + 2, y + 4.5);
      if (noteLines.length > 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6.8);
        doc.setTextColor(...COLORS.grayText);
        doc.text(noteLines, currX + 2, y + 4.5 + descLines.length * 3.2);
      }
      currX += colW.desc;

      // Payment Method
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.darkText);
      doc.text(payStr, currX + 2, y + 4.8);
      currX += colW.payment;

      // Amount
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.navy);
      doc.text(amtStr, currX + colW.amount - 3, y + 4.8, { align: 'right' });

      y += rowHeight;
    });
  }

  // ============================================================
  // TOTAL SUMMARY ROW
  // ============================================================
  checkAddPage(15);
  doc.setFillColor(...COLORS.purpleHeader);
  doc.setDrawColor(...COLORS.purpleAccent);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 8, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.navy);
  doc.text(`TOTAL EXPENSES CLAIMED (${expenses.length} Item${expenses.length === 1 ? '' : 's'}):`, MARGIN_X + 6, y + 5.3);

  doc.setFontSize(10);
  doc.setTextColor(...COLORS.purpleText);
  doc.text(formatCurrency(totalExpenseAmount), MARGIN_X + CONTENT_WIDTH - 4, y + 5.5, { align: 'right' });

  y += 12;

  // ============================================================
  // GENERAL NOTES & REMARKS (IF PROVIDED)
  // ============================================================
  const notesList = expenses.filter(e => e.notes && e.notes.trim()).map(e => `${e.category}: ${e.notes.trim()}`);
  if (checklist.remarks && checklist.remarks.trim()) {
    notesList.unshift(`Job Remarks: ${checklist.remarks.trim()}`);
  }

  if (notesList.length > 0) {
    checkAddPage(20);
    y = drawSectionHeader(doc, 'EXPENSE NOTES & VOUCHER DETAILS', y, false);

    doc.setFillColor(...COLORS.grayBg);
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);

    const notesCombined = notesList.map((n, i) => `${i + 1}. ${sanitizeText(n)}`).join('\n');
    const noteTextLines = doc.splitTextToSize(notesCombined, CONTENT_WIDTH - 6);
    const boxHeight = Math.max(12, 5 + noteTextLines.length * 3.6);

    doc.rect(MARGIN_X, y, CONTENT_WIDTH, boxHeight, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.darkText);
    doc.text(noteTextLines, MARGIN_X + 3, y + 4.5);

    y += boxHeight + 6;
  }

  // ============================================================
  // PHYSICAL SUBMISSION & VERIFICATION SIGNATURE BOXES
  // ============================================================
  // Need ~42mm for signature blocks
  checkAddPage(42);

  y = drawSectionHeader(doc, 'SIGNATURE & PHYSICAL SUBMISSION ACKNOWLEDGEMENT', y, false);

  const sigBoxWidth = (CONTENT_WIDTH - 6) / 2; // 88mm each
  const sigBoxHeight = 32;

  // Box 1: Technician Declaration & Signature
  doc.setFillColor(...COLORS.grayBg);
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN_X, y, sigBoxWidth, sigBoxHeight, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.navy);
  doc.text('SUBMITTED BY TECHNICIAN', MARGIN_X + 3.5, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...COLORS.grayText);
  const techCertify = 'I certify that the expenses listed above were actually incurred by me for official Eagle Eye SafDrive installation/service work. Physical receipts/bills are attached.';
  const certLines = doc.splitTextToSize(techCertify, sigBoxWidth - 7);
  doc.text(certLines, MARGIN_X + 3.5, y + 9);

  // Line for sign
  doc.setDrawColor(...COLORS.grayText);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X + 4, y + sigBoxHeight - 8, MARGIN_X + sigBoxWidth - 4, y + sigBoxHeight - 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.darkText);
  doc.text(`Service Engineer: ${sanitizeText(engineerName)}`, MARGIN_X + 4, y + sigBoxHeight - 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Signature & Date', MARGIN_X + sigBoxWidth - 28, y + sigBoxHeight - 4);

  // Box 2: Accounts / Office Physical Submission Acknowledgement
  const box2X = MARGIN_X + sigBoxWidth + 6;
  doc.setFillColor(...COLORS.grayBg);
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.2);
  doc.rect(box2X, y, sigBoxWidth, sigBoxHeight, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.navy);
  doc.text('RECEIVED & VERIFIED BY ACCOUNTS / OFFICE', box2X + 3.5, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...COLORS.grayText);
  const ackText = 'Submitted on paper: Physical printout and original receipts received, audited, and processed for manual physical filing.';
  const ackLines = doc.splitTextToSize(ackText, sigBoxWidth - 7);
  doc.text(ackLines, box2X + 3.5, y + 9);

  // Line for verification sign
  doc.setDrawColor(...COLORS.grayText);
  doc.setLineWidth(0.2);
  doc.line(box2X + 4, y + sigBoxHeight - 8, box2X + sigBoxWidth - 4, y + sigBoxHeight - 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.darkText);
  doc.text('Received By: ____________________', box2X + 4, y + sigBoxHeight - 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('Office Stamp / Date', box2X + sigBoxWidth - 28, y + sigBoxHeight - 4);

  y += sigBoxHeight + 6;

  // ============================================================
  // FOOTER & PAGE NUMBERING (ALL PAGES)
  // ============================================================
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, PAGE_HEIGHT - 12, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.grayText);
    doc.text('Eagle Eye SafDrive • Physical Submission Technician Expense Report • Confidential', MARGIN_X, PAGE_HEIGHT - 8);

    doc.text(`Page ${i} of ${totalPages}`, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 8, { align: 'right' });
  }

  // Return PDF ArrayBuffer as Node Buffer
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
