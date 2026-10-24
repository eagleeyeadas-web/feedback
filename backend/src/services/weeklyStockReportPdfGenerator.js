/**
 * Weekly Stock Maintenance Report PDF Generator
 * 
 * Generates a clean, multi-page A4 PDF matching Eagle Eye SafDrive branding:
 * - Orange & Navy headers and accents
 * - Repeated table headers across page boundaries
 * - Consistent page numbers ("Page X of Y")
 * - Detailed physical stock breakdown, movements, technician issuance, and reconciliations
 */

import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLORS = {
  navy: [10, 25, 70],            // #0a1946 Dark Navy
  orange: [234, 88, 12],         // #ea580c SafDrive Orange
  orangeHeader: [255, 247, 237], // #fff7ed Light Orange
  blueHeader: [239, 246, 255],   // #eff6ff Light Blue
  blueAccent: [37, 99, 235],    // #2563eb
  emerald: [6, 95, 70],         // #065f46
  emeraldBg: [236, 253, 245],   // #ecfdf5
  amber: [180, 83, 9],          // #b45309
  amberBg: [254, 243, 199],     // #fef3c7
  rose: [190, 18, 60],          // #be123c
  roseBg: [254, 242, 242],      // #fef2f2
  grayBg: [248, 250, 252],      // #f8fafc Light Gray
  borderColor: [226, 232, 240], // #e2e8f0
  darkText: [15, 23, 42],       // #0f172a
  grayText: [100, 116, 139],    // #64748b
  white: [255, 255, 255],
};

const PAGE_WIDTH = 210;          // A4 width in mm
const PAGE_HEIGHT = 297;         // A4 height in mm
const MARGIN_X = 12;             // 12mm margins
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 186mm printable width
const MAX_Y = PAGE_HEIGHT - 16;  // Bottom cutoff before footer

export function sanitizeText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/—/g, '-')
    .replace(/–/g, '-')
    .replace(/“/g, '"')
    .replace(/”/g, '"')
    .replace(/‘/g, "'")
    .replace(/’/g, "'")
    .replace(/•/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLogoBase64() {
  try {
    const p1 = path.resolve(__dirname, '../assets/logo.png');
    if (fs.existsSync(p1)) return fs.readFileSync(p1, { encoding: 'base64' });
    const p2 = path.resolve(__dirname, '../../../frontend/public/logo.png');
    if (fs.existsSync(p2)) return fs.readFileSync(p2, { encoding: 'base64' });
  } catch (e) {
    // Ignore
  }
  return null;
}

export async function generateWeeklyStockReportPdf(reportData) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const metadata = reportData.report_metadata || reportData.metadata || {};
  const period = metadata.report_period || reportData.reportPeriod || {};
  const generatedBy = metadata.generated_by || {};
  const kpis = reportData.summary_kpis || {};
  const physicalItems = reportData.physical_stock_summary || reportData.stockSummary || [];
  const movements = reportData.stock_movement_history || reportData.stockMovements || [];
  const techIssuance = reportData.technician_issuance_summary || reportData.technicianIssuance || [];
  const materialReconciliations = reportData.material_reconciliation || reportData.materialReconciliation || [];
  const stockAlerts = reportData.stock_alerts || reportData.lowStockAlerts || [];
  const variances = reportData.reconciliation_variances || reportData.stockReconciliation?.itemsWithVariance || [];

  let currentY = 12;

  // Helper: check page break
  function checkPageBreak(requiredHeight) {
    if (currentY + requiredHeight > MAX_Y) {
      doc.addPage();
      currentY = 14;
      return true;
    }
    return false;
  }

  // Draw Page Header Banner
  function drawReportHeader() {
    doc.setFillColor(...COLORS.navy);
    doc.roundedRect(MARGIN_X, currentY, CONTENT_WIDTH, 26, 2, 2, 'F');

    // Orange top accent line
    doc.setFillColor(...COLORS.orange);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, 2, 'F');

    // Logo if available
    const logo = getLogoBase64();
    let textLeft = MARGIN_X + 6;
    if (logo) {
      try {
        doc.addImage(`data:image/png;base64,${logo}`, 'PNG', MARGIN_X + 5, currentY + 4, 18, 18);
        textLeft = MARGIN_X + 27;
      } catch (e) {
        textLeft = MARGIN_X + 6;
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...COLORS.white);
    doc.text('EAGLE EYE SAFDRIVE PVT LTD', textLeft, currentY + 9);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(254, 215, 170); // Light amber
    doc.text('WEEKLY STOCK MAINTENANCE REPORT (PHYSICAL STOCK)', textLeft, currentY + 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(226, 232, 240);
    const rangeText = `Reporting Period: ${period.formatted_range || `${period.start_date} to ${period.end_date}`} (${period.day_range_label || 'Monday - Sunday'})`;
    doc.text(rangeText, textLeft, currentY + 22);

    currentY += 29;

    // Metadata Bar
    doc.setFillColor(...COLORS.grayBg);
    doc.setDrawColor(...COLORS.borderColor);
    doc.roundedRect(MARGIN_X, currentY, CONTENT_WIDTH, 11, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.darkText);
    doc.text('GENERATED ON:', MARGIN_X + 3, currentY + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(sanitizeText(metadata.generated_at_formatted || new Date().toISOString()), MARGIN_X + 26, currentY + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.text('GENERATED BY:', MARGIN_X + 75, currentY + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(sanitizeText(`${generatedBy.name || 'Store Manager'} (${generatedBy.role || 'STORE_MANAGER'})`), MARGIN_X + 98, currentY + 4.5);

    doc.setFont('helvetica', 'bold');
    doc.text('RECONCILIATION:', MARGIN_X + 148, currentY + 4.5);
    if (kpis.reconciliation_status === 'RECONCILED') {
      doc.setTextColor(...COLORS.emerald);
      doc.text('RECONCILED (0 Variance)', MARGIN_X + 172, currentY + 4.5);
    } else {
      doc.setTextColor(...COLORS.rose);
      doc.text(`VARIANCE (${kpis.variance_count || 0})`, MARGIN_X + 172, currentY + 4.5);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text(
      `Physical Items: ${kpis.total_physical_items || 0}  |  Movements in Week: ${kpis.total_movements_in_period || 0}  |  Low Stock Items: ${kpis.low_stock_count || 0}`,
      MARGIN_X + 3,
      currentY + 9
    );

    currentY += 14;
  }

  // Draw Section Title
  function drawSectionTitle(title, subtitle = '') {
    checkPageBreak(12);
    doc.setFillColor(...COLORS.blueHeader);
    doc.setDrawColor(...COLORS.borderColor);
    doc.roundedRect(MARGIN_X, currentY, CONTENT_WIDTH, subtitle ? 9.5 : 7.5, 1, 1, 'FD');

    doc.setFillColor(...COLORS.blueAccent);
    doc.rect(MARGIN_X, currentY, 2.5, subtitle ? 9.5 : 7.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.navy);
    doc.text(title, MARGIN_X + 5, currentY + 5);

    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.grayText);
      doc.text(subtitle, MARGIN_X + 5, currentY + 8.5);
      currentY += 11.5;
    } else {
      currentY += 9.5;
    }
  }

  // Draw Initial Header
  drawReportHeader();

  // ============================================================
  // SECTION 1: PHYSICAL STOCK SUMMARY TABLE
  // ============================================================
  drawSectionTitle('1. WEEKLY PHYSICAL STOCK SUMMARY (PHYSICAL PRODUCTS ONLY)', 'Authoritative stock balances, receipts, issuances, returns, and adjustments');

  const stockSummaryCols = [
    { title: '#', width: 7, align: 'center' },
    { title: 'Physical Item', width: 44, align: 'left' },
    { title: 'SKU', width: 25, align: 'left' },
    { title: 'Unit', width: 14, align: 'center' },
    { title: 'Opening', width: 16, align: 'right' },
    { title: 'Added', width: 15, align: 'right' },
    { title: 'Issued', width: 15, align: 'right' },
    { title: 'Returned', width: 15, align: 'right' },
    { title: 'Adj.', width: 15, align: 'right' },
    { title: 'Closing', width: 20, align: 'right' },
  ];

  function drawStockSummaryTableHeader() {
    doc.setFillColor(...COLORS.navy);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.white);

    let colX = MARGIN_X;
    stockSummaryCols.forEach((col) => {
      const textX = col.align === 'right' ? colX + col.width - 2 : (col.align === 'center' ? colX + col.width / 2 : colX + 2);
      doc.text(col.title, textX, currentY + 4.2, { align: col.align });
      colX += col.width;
    });
    currentY += 6;
  }

  drawStockSummaryTableHeader();

  physicalItems.forEach((item, idx) => {
    if (checkPageBreak(7)) {
      drawStockSummaryTableHeader();
    }

    const rowH = 5.5;
    const isEven = idx % 2 === 0;
    doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, rowH, 'F');
    doc.setDrawColor(...COLORS.borderColor);
    doc.line(MARGIN_X, currentY + rowH, MARGIN_X + CONTENT_WIDTH, currentY + rowH);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.darkText);

    let colX = MARGIN_X;
    // #
    doc.text(String(item.index || idx + 1), colX + 3.5, currentY + 3.8, { align: 'center' });
    colX += stockSummaryCols[0].width;

    // Item Name
    doc.setFont('helvetica', 'bold');
    doc.text(sanitizeText(item.item_name), colX + 2, currentY + 3.8);
    doc.setFont('helvetica', 'normal');
    colX += stockSummaryCols[1].width;

    // SKU
    doc.setFontSize(5.8);
    doc.setTextColor(...COLORS.grayText);
    doc.text(sanitizeText(item.sku || '—'), colX + 2, currentY + 3.8);
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.darkText);
    colX += stockSummaryCols[2].width;

    // Unit
    doc.text(sanitizeText(item.unit || 'Nos.'), colX + 7, currentY + 3.8, { align: 'center' });
    colX += stockSummaryCols[3].width;

    // Opening
    doc.text(String(item.opening_stock), colX + stockSummaryCols[4].width - 2, currentY + 3.8, { align: 'right' });
    colX += stockSummaryCols[4].width;

    // Added
    if (item.stock_added > 0) doc.setTextColor(...COLORS.emerald);
    doc.text(item.stock_added > 0 ? `+${item.stock_added}` : '0', colX + stockSummaryCols[5].width - 2, currentY + 3.8, { align: 'right' });
    doc.setTextColor(...COLORS.darkText);
    colX += stockSummaryCols[5].width;

    // Issued
    if (item.issued > 0) doc.setTextColor(...COLORS.rose);
    doc.text(item.issued > 0 ? `-${item.issued}` : '0', colX + stockSummaryCols[6].width - 2, currentY + 3.8, { align: 'right' });
    doc.setTextColor(...COLORS.darkText);
    colX += stockSummaryCols[6].width;

    // Returned
    if (item.returned > 0) doc.setTextColor(...COLORS.emerald);
    doc.text(item.returned > 0 ? `+${item.returned}` : '0', colX + stockSummaryCols[7].width - 2, currentY + 3.8, { align: 'right' });
    doc.setTextColor(...COLORS.darkText);
    colX += stockSummaryCols[7].width;

    // Adjustments
    const adjSign = item.adjustments > 0 ? `+${item.adjustments}` : String(item.adjustments || 0);
    doc.text(adjSign, colX + stockSummaryCols[8].width - 2, currentY + 3.8, { align: 'right' });
    colX += stockSummaryCols[8].width;

    // Closing
    doc.setFont('helvetica', 'bold');
    if (item.is_out_of_stock) {
      doc.setTextColor(...COLORS.rose);
    } else if (item.is_low_stock) {
      doc.setTextColor(...COLORS.amber);
    }
    doc.text(String(item.closing_stock), colX + stockSummaryCols[9].width - 2, currentY + 3.8, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.darkText);

    currentY += rowH;
  });

  currentY += 4;

  // ============================================================
  // SECTION 2: STOCK MOVEMENT HISTORY TABLE
  // ============================================================
  drawSectionTitle('2. STOCK MOVEMENT HISTORY', 'Authoritative chronological audit log of physical movements in reporting week');

  const movCols = [
    { title: '#', width: 6, align: 'center' },
    { title: 'Date & Time', width: 24, align: 'left' },
    { title: 'Item', width: 32, align: 'left' },
    { title: 'Movement Type', width: 24, align: 'left' },
    { title: 'Qty', width: 11, align: 'right' },
    { title: 'Unit', width: 12, align: 'center' },
    { title: 'Prev', width: 10, align: 'right' },
    { title: 'New', width: 10, align: 'right' },
    { title: 'Recipient', width: 18, align: 'left' },
    { title: 'Checklist', width: 18, align: 'left' },
    { title: 'Remarks', width: 21, align: 'left' },
  ];

  function drawMovementTableHeader() {
    doc.setFillColor(...COLORS.navy);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...COLORS.white);

    let colX = MARGIN_X;
    movCols.forEach((col) => {
      const textX = col.align === 'right' ? colX + col.width - 1.5 : (col.align === 'center' ? colX + col.width / 2 : colX + 1.5);
      doc.text(col.title, textX, currentY + 4.2, { align: col.align });
      colX += col.width;
    });
    currentY += 6;
  }

  drawMovementTableHeader();

  if (movements.length === 0) {
    checkPageBreak(8);
    doc.setFillColor(...COLORS.grayBg);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, 7, 'F');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text('No physical stock movements recorded during this reporting week.', MARGIN_X + 6, currentY + 4.5);
    currentY += 10;
  } else {
    movements.forEach((mov, idx) => {
      if (checkPageBreak(6.5)) {
        drawMovementTableHeader();
      }

      const rowH = 5.2;
      const isEven = idx % 2 === 0;
      doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
      doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, rowH, 'F');
      doc.setDrawColor(...COLORS.borderColor);
      doc.line(MARGIN_X, currentY + rowH, MARGIN_X + CONTENT_WIDTH, currentY + rowH);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(...COLORS.darkText);

      let colX = MARGIN_X;
      // #
      doc.text(String(idx + 1), colX + 3, currentY + 3.6, { align: 'center' });
      colX += movCols[0].width;

      // Date Time
      doc.text(sanitizeText(mov.date_time_formatted || mov.dateTime || mov.date_time || '—'), colX + 1.5, currentY + 3.6);
      colX += movCols[1].width;

      // Item
      doc.setFont('helvetica', 'bold');
      doc.text(sanitizeText(mov.item_name || mov.itemName || '—').slice(0, 22), colX + 1.5, currentY + 3.6);
      doc.setFont('helvetica', 'normal');
      colX += movCols[2].width;

      // Movement Type
      const mTypeLabel = mov.movement_type_label || mov.type_label || mov.movement_type || mov.type || '—';
      doc.text(sanitizeText(mTypeLabel).slice(0, 18), colX + 1.5, currentY + 3.6);
      colX += movCols[3].width;

      // Quantity
      doc.setFont('helvetica', 'bold');
      doc.text(String(mov.quantity ?? 0), colX + movCols[4].width - 1.5, currentY + 3.6, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      colX += movCols[4].width;

      // Unit
      doc.text(sanitizeText(mov.unit || 'Nos.'), colX + 6, currentY + 3.6, { align: 'center' });
      colX += movCols[5].width;

      // Prev
      doc.text(String(mov.balance_before ?? mov.balanceBefore ?? '—'), colX + movCols[6].width - 1.5, currentY + 3.6, { align: 'right' });
      colX += movCols[6].width;

      // New
      doc.text(String(mov.balance_after ?? mov.balanceAfter ?? '—'), colX + movCols[7].width - 1.5, currentY + 3.6, { align: 'right' });
      colX += movCols[7].width;

      // Recipient
      const recipientText = mov.technician_recipient || mov.technician_name || mov.technicianName || '—';
      doc.text(sanitizeText(recipientText).slice(0, 14), colX + 1.5, currentY + 3.6);
      colX += movCols[8].width;

      // Checklist
      const chkText = mov.checklist_number || mov.checklistNumber || '—';
      doc.text(sanitizeText(chkText).slice(0, 14), colX + 1.5, currentY + 3.6);
      colX += movCols[9].width;

      // Remarks
      doc.setTextColor(...COLORS.grayText);
      doc.text(sanitizeText(mov.remarks || '—').slice(0, 20), colX + 1.5, currentY + 3.6);
      doc.setTextColor(...COLORS.darkText);

      currentY += rowH;
    });

    currentY += 4;
  }

  // ============================================================
  // SECTION 3: TECHNICIAN-WISE MATERIAL ISSUANCE SUMMARY
  // ============================================================
  drawSectionTitle('3. TECHNICIAN-WISE MATERIAL ISSUANCE SUMMARY', 'Attributed material issuance across authorized service engineers and unassigned recipients');

  techIssuance.forEach((tech) => {
    checkPageBreak(16);

    // Engineer Card Header
    doc.setFillColor(...COLORS.grayBg);
    doc.setDrawColor(...COLORS.borderColor);
    doc.roundedRect(MARGIN_X, currentY, CONTENT_WIDTH, 6.5, 1, 1, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.navy);
    doc.text(tech.engineer_name, MARGIN_X + 3, currentY + 4.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.grayText);
    const totalsSummary = tech.item_totals.length > 0
      ? tech.item_totals.map((t) => `${t.quantity} ${t.unit} of ${t.item_name}`).join(' | ')
      : 'No materials issued in reporting period';
    doc.text(`Total Transactions: ${tech.total_transactions}  •  ${totalsSummary}`, MARGIN_X + 45, currentY + 4.5);

    currentY += 8;

    // Sub-table for this engineer's transactions if any
    if (tech.transactions.length > 0) {
      doc.setFillColor(241, 245, 249);
      doc.rect(MARGIN_X + 2, currentY, CONTENT_WIDTH - 4, 4.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5.8);
      doc.setTextColor(...COLORS.darkText);
      doc.text('Date & Time', MARGIN_X + 4, currentY + 3.2);
      doc.text('Checklist No.', MARGIN_X + 32, currentY + 3.2);
      doc.text('Item', MARGIN_X + 68, currentY + 3.2);
      doc.text('Quantity', MARGIN_X + 115, currentY + 3.2, { align: 'right' });
      doc.text('Issued By', MARGIN_X + 125, currentY + 3.2);
      doc.text('Remarks', MARGIN_X + 152, currentY + 3.2);

      currentY += 4.5;

      tech.transactions.forEach((tx) => {
        checkPageBreak(5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(5.6);
        doc.setTextColor(...COLORS.darkText);
        doc.text(sanitizeText(tx.date_time_formatted), MARGIN_X + 4, currentY + 3);
        doc.text(sanitizeText(tx.checklist_number), MARGIN_X + 32, currentY + 3);
        doc.text(sanitizeText(tx.item_name), MARGIN_X + 68, currentY + 3);
        doc.text(`${tx.quantity} ${tx.unit}`, MARGIN_X + 115, currentY + 3, { align: 'right' });
        doc.text(sanitizeText(tx.issued_by).slice(0, 16), MARGIN_X + 125, currentY + 3);
        doc.text(sanitizeText(tx.remarks).slice(0, 22), MARGIN_X + 152, currentY + 3);
        currentY += 4.2;
      });
      currentY += 2;
    }
  });

  currentY += 3;

  // ============================================================
  // SECTION 4: MATERIAL USAGE & RETURN RECONCILIATION
  // ============================================================
  drawSectionTitle('4. MATERIAL USAGE AND RETURN RECONCILIATION', 'Comparison of issued stock, reported usage, declared returns, and store-verified usable returns');

  const reconCols = [
    { title: 'Material Item', width: 42, align: 'left' },
    { title: 'Unit', width: 14, align: 'center' },
    { title: 'Issued', width: 18, align: 'right' },
    { title: 'Reported Used', width: 24, align: 'right' },
    { title: 'Declared Ret.', width: 22, align: 'right' },
    { title: 'Store Verified', width: 22, align: 'right' },
    { title: 'Awaiting Verif.', width: 22, align: 'right' },
    { title: 'Dmg / Miss', width: 22, align: 'right' },
  ];

  function drawReconTableHeader() {
    doc.setFillColor(...COLORS.navy);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, 6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...COLORS.white);

    let colX = MARGIN_X;
    reconCols.forEach((col) => {
      const textX = col.align === 'right' ? colX + col.width - 2 : (col.align === 'center' ? colX + col.width / 2 : colX + 2);
      doc.text(col.title, textX, currentY + 4.2, { align: col.align });
      colX += col.width;
    });
    currentY += 6;
  }

  drawReconTableHeader();

  materialReconciliations.forEach((rec, idx) => {
    if (checkPageBreak(6.5)) {
      drawReconTableHeader();
    }

    const rowH = 5.2;
    const isEven = idx % 2 === 0;
    doc.setFillColor(isEven ? 255 : 248, isEven ? 255 : 250, isEven ? 255 : 252);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, rowH, 'F');
    doc.setDrawColor(...COLORS.borderColor);
    doc.line(MARGIN_X, currentY + rowH, MARGIN_X + CONTENT_WIDTH, currentY + rowH);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.2);
    doc.setTextColor(...COLORS.darkText);

    let colX = MARGIN_X;
    // Item Name
    doc.setFont('helvetica', 'bold');
    doc.text(sanitizeText(rec.item_name), colX + 2, currentY + 3.6);
    doc.setFont('helvetica', 'normal');
    colX += reconCols[0].width;

    // Unit
    doc.text(sanitizeText(rec.unit), colX + 7, currentY + 3.6, { align: 'center' });
    colX += reconCols[1].width;

    // Issued
    doc.text(String(rec.quantity_issued), colX + reconCols[2].width - 2, currentY + 3.6, { align: 'right' });
    colX += reconCols[2].width;

    // Used
    doc.text(String(rec.quantity_used), colX + reconCols[3].width - 2, currentY + 3.6, { align: 'right' });
    colX += reconCols[3].width;

    // Declared Return
    doc.text(String(rec.quantity_declared_returned), colX + reconCols[4].width - 2, currentY + 3.6, { align: 'right' });
    colX += reconCols[4].width;

    // Store Verified
    doc.setFont('helvetica', 'bold');
    if (rec.quantity_verified_accepted > 0) doc.setTextColor(...COLORS.emerald);
    doc.text(String(rec.quantity_verified_accepted), colX + reconCols[5].width - 2, currentY + 3.6, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.darkText);
    colX += reconCols[5].width;

    // Awaiting
    if (rec.quantity_awaiting_verification > 0) doc.setTextColor(...COLORS.amber);
    doc.text(String(rec.quantity_awaiting_verification), colX + reconCols[6].width - 2, currentY + 3.6, { align: 'right' });
    doc.setTextColor(...COLORS.darkText);
    colX += reconCols[6].width;

    // Damaged
    if (rec.damaged_or_missing > 0) doc.setTextColor(...COLORS.rose);
    doc.text(String(rec.damaged_or_missing), colX + reconCols[7].width - 2, currentY + 3.6, { align: 'right' });
    doc.setTextColor(...COLORS.darkText);

    currentY += rowH;
  });

  currentY += 4;

  // ============================================================
  // SECTION 5: STOCK ALERTS & RECONCILIATION VARIANCES
  // ============================================================
  drawSectionTitle('5. LOW-STOCK ALERTS & RECONCILIATION AUDIT', 'Threshold violations and physical balance reconciliation audit');

  checkPageBreak(25);

  const halfWidth = (CONTENT_WIDTH - 4) / 2;

  // Left Box: Stock Alerts
  doc.setFillColor(...COLORS.grayBg);
  doc.setDrawColor(...COLORS.borderColor);
  doc.roundedRect(MARGIN_X, currentY, halfWidth, 26, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.navy);
  doc.text('CONFIGURED THRESHOLD ALERTS', MARGIN_X + 4, currentY + 5);

  let alertY = currentY + 9;
  if (stockAlerts.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.emerald);
    doc.text('All physical stock items are above configured minimum thresholds.', MARGIN_X + 4, alertY);
  } else {
    stockAlerts.slice(0, 3).forEach((alt) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.2);
      const alertColor = alt.status === 'OUT_OF_STOCK' ? COLORS.rose : COLORS.amber;
      doc.setTextColor(...alertColor);
      doc.text(`[${alt.status === 'OUT_OF_STOCK' ? 'DEPLETED' : 'LOW'}] ${alt.item_name}:`, MARGIN_X + 4, alertY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.darkText);
      doc.text(`Current: ${alt.current_stock} ${alt.unit} (Min: ${alt.min_stock_level})`, MARGIN_X + 45, alertY);
      alertY += 4.5;
    });
  }

  // Right Box: Reconciliation Status
  const rightBoxX = MARGIN_X + halfWidth + 4;
  doc.setFillColor(...COLORS.grayBg);
  doc.roundedRect(rightBoxX, currentY, halfWidth, 26, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.navy);
  doc.text('RECONCILIATION INTEGRITY', rightBoxX + 4, currentY + 5);

  let varY = currentY + 9;
  if (variances.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.emerald);
    doc.text('All physical balances reconcile perfectly with movement history.', rightBoxX + 4, varY);
    doc.setTextColor(...COLORS.grayText);
    doc.text('Formula: Opening + Added + Returned - Issued + Adj = Closing', rightBoxX + 4, varY + 4.5);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.setTextColor(...COLORS.rose);
    doc.text(`${variances.length} Reconciliation Discrepancy(ies) Detected:`, rightBoxX + 4, varY);
    varY += 4.5;
    variances.slice(0, 2).forEach((v) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.setTextColor(...COLORS.darkText);
      doc.text(`${v.item_name}: Diff ${v.variance > 0 ? '+' : ''}${v.variance}`, rightBoxX + 4, varY);
      varY += 4;
    });
  }

  currentY += 30;

  // ============================================================
  // FOOTER & PAGE NUMBERING ON ALL PAGES
  // ============================================================
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, PAGE_HEIGHT - 10, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text(
      'Eagle Eye SafDrive Pvt Ltd  •  Store Manager Workspace  •  Authoritative Weekly Stock Maintenance Report',
      MARGIN_X,
      PAGE_HEIGHT - 6.5
    );
    doc.text(`Page ${p} of ${totalPages}`, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 6.5, { align: 'right' });
  }

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
