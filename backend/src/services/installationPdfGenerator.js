import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Document Theme Color Palette
const COLORS = {
  navy: [10, 25, 70],            // #0a1946 Dark Navy
  blueHeader: [239, 246, 255],    // #eff6ff Light Blue Table Header
  blueAccent: [37, 99, 235],     // #2563eb Blue Accent
  blueText: [29, 78, 216],       // #1d4ed8 Deep Blue Text
  emerald: [6, 95, 70],          // #065f46 Emerald Status
  amber: [180, 83, 9],           // #b45309 Amber Status
  rose: [190, 18, 60],           // #be123c Rose Status
  grayBg: [248, 250, 252],       // #f8fafc Light Gray Cell Background
  borderColor: [226, 232, 240],  // #e2e8f0 Cell Border
  darkText: [15, 23, 42],        // #0f172a Dark Slate Text
  grayText: [100, 116, 139],     // #64748b Secondary Gray Text
  white: [255, 255, 255],
};

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN_X = 12;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 186mm

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
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateInput) {
  if (!dateInput) return '—';
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
  return `Rs. ${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
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
 * Draws a section header bar
 */
function drawSectionHeader(doc, title, y) {
  doc.setFillColor(...COLORS.blueHeader);
  doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 7, 1, 1, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.navy);
  doc.text(sanitizeText(title), MARGIN_X + 3, y + 4.8);

  doc.setDrawColor(...COLORS.blueAccent);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y + 7, MARGIN_X + CONTENT_WIDTH, y + 7);

  return y + 9;
}

/**
 * Draws a grid of key-value cells
 */
function drawKeyValueGrid(doc, rows, startY) {
  let y = startY;

  rows.forEach((row) => {
    const colCount = row.length;
    const colWidth = CONTENT_WIDTH / colCount;

    // Calculate required row height based on text wrapping
    let maxCellHeight = 10.5;
    row.forEach((cell) => {
      const valStr = sanitizeText(cell.value || '—');
      const lines = doc.splitTextToSize(valStr, colWidth - 5);
      const cellH = Math.max(10.5, 4.5 + lines.length * 3.5);
      if (cellH > maxCellHeight) maxCellHeight = cellH;
    });

    row.forEach((cell, idx) => {
      const cellX = MARGIN_X + idx * colWidth;

      doc.setFillColor(...COLORS.grayBg);
      doc.setDrawColor(...COLORS.borderColor);
      doc.setLineWidth(0.2);
      doc.rect(cellX, y, colWidth, maxCellHeight, 'FD');

      // Label
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.grayText);
      doc.text(sanitizeText(cell.label).toUpperCase(), cellX + 2.5, y + 3.8);

      // Value
      doc.setFont('helvetica', cell.bold !== false ? 'bold' : 'normal');
      doc.setFontSize(8);

      if (cell.color) {
        doc.setTextColor(...cell.color);
      } else {
        doc.setTextColor(...COLORS.darkText);
      }

      const valStr = sanitizeText(cell.value || '—');
      const lines = doc.splitTextToSize(valStr, colWidth - 5);
      doc.text(lines, cellX + 2.5, y + 7.5);
    });

    y += maxCellHeight;
  });

  return y;
}

/**
 * Generates an A4 PDF document for an Installation Checklist
 * @param {Object} item - The installation checklist database record
 * @returns {Promise<Buffer>} PDF Buffer
 */
export async function generateInstallationChecklistPDF(item) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const logoBase64 = getLogoBase64();
  let y = 10;

  // ============================================================
  // PAGE 1 — HEADER & BRANDING
  // ============================================================
  if (logoBase64) {
    try {
      doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', MARGIN_X, y, 38, 13);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...COLORS.navy);
      doc.text('EAGLE EYE SAFDRIVE', MARGIN_X, y + 8);
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...COLORS.navy);
    doc.text('EAGLE EYE SAFDRIVE', MARGIN_X, y + 8);
  }

  // Header Titles
  const headerLeftX = MARGIN_X + 42;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.navy);
  doc.text('EAGLE EYE / SAFDRIVE', headerLeftX, y + 4);

  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.blueText);
  doc.text('INSTALLATION INITIATION CHECKLIST', headerLeftX, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.grayText);
  doc.text('Advanced Vehicle Telematics & Camera Systems', headerLeftX, y + 11.5);

  // Right Badge Box: Checklist Number & Date
  const rightBoxX = PAGE_WIDTH - MARGIN_X - 52;
  doc.setFillColor(...COLORS.blueHeader);
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.roundedRect(rightBoxX, y, 52, 14, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text('CHECKLIST NUMBER', rightBoxX + 3, y + 4);

  doc.setFontSize(9);
  doc.setTextColor(...COLORS.navy);
  doc.text(sanitizeText(item.checklist_number || '—'), rightBoxX + 3, y + 8.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.darkText);
  doc.text(`Date: ${formatDate(item.created_at)}`, rightBoxX + 3, y + 12);

  y += 18;

  // Header Divider
  doc.setDrawColor(...COLORS.navy);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 5;

  // ============================================================
  // SUMMARY BADGES (4-Column)
  // ============================================================
  const summaryRows = [
    [
      { label: 'Installation / Service', value: item.installation_or_service || '—', color: COLORS.navy },
      {
        label: 'Installation Status',
        value: item.installation_status || 'Pending',
        color: item.installation_status === 'Completed' ? COLORS.emerald : COLORS.blueText,
      },
      {
        label: 'Payment Status',
        value: item.payment_status || 'Pending',
        color: item.payment_status === 'Paid' ? COLORS.emerald : COLORS.amber,
      },
      { label: 'Confirmed Price', value: formatCurrency(item.confirmed_price), color: COLORS.navy },
    ],
  ];

  y = drawKeyValueGrid(doc, summaryRows, y);
  y += 5;

  // ============================================================
  // SECTION 1 — 1. CLIENT DETAILS
  // ============================================================
  y = drawSectionHeader(doc, '1. CLIENT DETAILS', y);

  const clientRows = [
    [
      { label: 'Client Name', value: item.client_name || '—' },
      { label: 'Client Mobile Number', value: item.client_mobile || '—' },
    ],
    [
      { label: 'Client Location', value: item.client_location || '—' },
      { label: 'Google Maps Location', value: item.google_maps_location || 'Not provided', color: item.google_maps_location ? COLORS.blueText : COLORS.grayText },
    ],
  ];

  y = drawKeyValueGrid(doc, clientRows, y);
  y += 5;

  // ============================================================
  // SECTION 2 — 2. DEVICE DETAILS
  // ============================================================
  y = drawSectionHeader(doc, '2. DEVICE DETAILS', y);

  const deviceRows = [
    [
      { label: 'Type of Device', value: item.device_type || '—' },
      { label: 'Number of Devices', value: String(item.number_of_devices || '0') },
      { label: 'Number of Vehicles', value: String(item.number_of_vehicles || '0') },
      { label: 'Extra Devices Carried?', value: item.extra_devices ? 'Yes' : 'No', color: item.extra_devices ? COLORS.blueText : COLORS.darkText },
    ],
  ];

  if (item.extra_devices) {
    deviceRows.push([
      { label: 'Type of Extra Device', value: item.extra_device_type || '—' },
      { label: 'Number of Extra Devices Carried', value: String(item.extra_device_count || '—') },
    ]);
  }

  y = drawKeyValueGrid(doc, deviceRows, y);
  y += 5;

  // ============================================================
  // SECTION 3 — 3. PRICING & PAYMENT DETAILS
  // ============================================================
  y = drawSectionHeader(doc, '3. PRICING & PAYMENT DETAILS', y);

  const pricingRows = [
    [
      { label: 'Confirmed Price with Client', value: formatCurrency(item.confirmed_price), color: COLORS.navy },
      { label: 'Payment Method', value: item.payment_method || '—' },
      { label: 'Advance Received?', value: item.advance_received ? `Yes (${formatCurrency(item.advance_amount)})` : 'No' },
    ],
    [
      { label: 'Pending Payment?', value: item.pending_payment ? `Yes (${formatCurrency(item.pending_amount)})` : 'No' },
      { label: 'Advance Amount Received', value: item.advance_received ? formatCurrency(item.advance_amount) : 'Rs. 0', color: COLORS.emerald },
      { label: 'Pending Payment Amount', value: item.pending_payment ? formatCurrency(item.pending_amount) : 'Rs. 0', color: COLORS.rose },
    ],
  ];

  y = drawKeyValueGrid(doc, pricingRows, y);

  // ============================================================
  // PAGE 2 — INSTALLATION DETAILS, TEAM, CONFIRMATION & REMARKS
  // ============================================================
  doc.addPage();
  y = 10;

  // Compact Header on Page 2
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.navy);
  doc.text('EAGLE EYE SAFDRIVE - INSTALLATION INITIATION CHECKLIST', MARGIN_X, y + 3);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.grayText);
  doc.text(`Checklist No: ${sanitizeText(item.checklist_number)}`, PAGE_WIDTH - MARGIN_X, y + 3, { align: 'right' });

  y += 6;
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 5;

  // SECTION 4 — 4. INSTALLATION DETAILS
  y = drawSectionHeader(doc, '4. INSTALLATION DETAILS', y);

  const installationRows = [
    [
      { label: 'Installation Duration', value: item.installation_duration || '—' },
      { label: 'Vehicle Type', value: item.vehicle_type || '—' },
      { label: 'Installation or Service', value: item.installation_or_service || '—' },
    ],
    [
      { label: 'Expected Date of Arrival at Client Place', value: formatDate(item.expected_arrival_date) },
      { label: 'Expected Time of Arrival at Client Place', value: item.expected_arrival_time || '—' },
    ],
  ];

  y = drawKeyValueGrid(doc, installationRows, y);
  y += 5;

  // SECTION 5 — 5. INSTALLATION TEAM
  y = drawSectionHeader(doc, '5. INSTALLATION TEAM', y);

  const teamRows = [
    [
      { label: 'Team Member 1 - Service Engineer', value: item.service_engineer || '—' },
      { label: 'Team Member 2 - Service Assistant', value: item.service_assistant || '—' },
    ],
  ];

  y = drawKeyValueGrid(doc, teamRows, y);
  y += 5;

  // SECTION 6 — 6. FINAL CONFIRMATION
  y = drawSectionHeader(doc, '6. FINAL CONFIRMATION', y);

  const confirmationRows = [
    [
      { label: 'Installation Status', value: item.installation_status || '—', color: item.installation_status === 'Completed' ? COLORS.emerald : COLORS.blueText },
      { label: 'Payment Status', value: item.payment_status || '—', color: item.payment_status === 'Paid' ? COLORS.emerald : COLORS.amber },
      { label: 'Client Confirmation', value: item.client_confirmation || '—', color: item.client_confirmation === 'Confirmed' ? COLORS.emerald : COLORS.rose },
    ],
  ];

  y = drawKeyValueGrid(doc, confirmationRows, y);
  y += 5;

  // REMARKS SECTION (IF PRESENT)
  if (item.remarks && item.remarks.trim()) {
    y = drawSectionHeader(doc, 'REMARKS & NOTES', y);

    doc.setFillColor(...COLORS.grayBg);
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);

    const remarksStr = sanitizeText(item.remarks);
    const remarkLines = doc.splitTextToSize(remarksStr, CONTENT_WIDTH - 6);
    const boxHeight = Math.max(14, 6 + remarkLines.length * 4);

    doc.rect(MARGIN_X, y, CONTENT_WIDTH, boxHeight, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.darkText);
    doc.text(remarkLines, MARGIN_X + 3, y + 5);

    y += boxHeight + 6;
  } else {
    y += 3;
  }

  // AUTHORIZED SIGNATURE AREA & FOOTER
  // Ensure signature area has enough space
  if (y + 35 > PAGE_HEIGHT - 15) {
    doc.addPage();
    y = 20;
  } else {
    y += 5;
  }

  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y, PAGE_WIDTH - MARGIN_X, y);
  y += 8;

  // Signature Block
  const sigBoxY = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.navy);
  doc.text('EAGLE EYE SAFDRIVE MANAGEMENT', MARGIN_X, sigBoxY + 3);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text('Official Installation Initiation Record • Confidential', MARGIN_X, sigBoxY + 7);

  // Right Signature Line
  const sigRightX = PAGE_WIDTH - MARGIN_X - 50;
  doc.setDrawColor(...COLORS.grayText);
  doc.setLineWidth(0.3);
  doc.line(sigRightX, sigBoxY + 10, PAGE_WIDTH - MARGIN_X, sigBoxY + 10);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.darkText);
  doc.text('Authorized Signature', sigRightX + 25, sigBoxY + 14, { align: 'center' });

  // ============================================================
  // PAGE NUMBERS FOOTER (ALL PAGES)
  // ============================================================
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text(`Page ${i} of ${totalPages}`, PAGE_WIDTH / 2, 289, { align: 'center' });
  }

  // Return PDF ArrayBuffer as Node Buffer
  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
