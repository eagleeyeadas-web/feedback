/**
 * Weekly Stock Maintenance Report PDF Generator
 * 
 * Generates a clean, multi-page A4 PDF matching Eagle Eye SafDrive branding:
 * - Orange & Navy headers and accents
 * - Repeated table headers across page boundaries
 * - Consistent page numbers ("Page X of Y")
 * - Dedicated Technician-Wise Installation Report with grouped client & device rows
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
  blueAccent: [37, 99, 235],     // #2563eb
  emerald: [6, 95, 70],          // #065f46
  emeraldBg: [236, 253, 245],    // #ecfdf5
  amber: [180, 83, 9],           // #b45309
  amberBg: [254, 243, 199],      // #fef3c7
  rose: [190, 18, 60],           // #be123c
  roseBg: [254, 242, 242],       // #fef2f2
  grayBg: [248, 250, 252],       // #f8fafc Light Gray
  borderColor: [226, 232, 240],  // #e2e8f0
  darkText: [15, 23, 42],        // #0f172a
  grayText: [100, 116, 139],     // #64748b
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
  const report =
    reportData.technician_installation_report ||
    reportData.technicianInstallationReport ||
    {};
  const summary = report.summary || {};
  const technicians = report.technicians || [];

  const totalInstallations =
    summary.total_completed_installations ??
    summary.totalCompletedInstallations ??
    reportData.summary_kpis?.total_completed_installations ??
    0;

  const totalDevices =
    summary.total_devices_installed ??
    summary.totalDevicesInstalled ??
    reportData.summary_kpis?.total_devices_installed ??
    0;

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
    doc.text('WEEKLY STOCK MAINTENANCE REPORT', textLeft, currentY + 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(226, 232, 240);
    const rangeText = `Reporting Period: ${period.formatted_range || period.formattedRange || `${period.start_date || period.startDate} to ${period.end_date || period.endDate}`} (${period.day_range_label || period.dayRangeLabel || 'Monday - Sunday'})`;
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
    doc.text(
      sanitizeText(metadata.generated_at_formatted || metadata.generatedOn || new Date().toISOString()),
      MARGIN_X + 26,
      currentY + 4.5
    );

    doc.setFont('helvetica', 'bold');
    doc.text('GENERATED BY:', MARGIN_X + 85, currentY + 4.5);
    doc.setFont('helvetica', 'normal');
    const genByName = generatedBy.name || (typeof metadata.generatedBy === 'string' ? metadata.generatedBy.split('(')[0].trim() : 'Store Manager');
    doc.text(sanitizeText(genByName), MARGIN_X + 108, currentY + 4.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text(
      `Total Completed Installations: ${totalInstallations}  |  Total Devices Installed: ${totalDevices}  |  Reporting Timezone: Asia/Kolkata`,
      MARGIN_X + 3,
      currentY + 9
    );

    currentY += 15;
  }

  // Draw Section Title
  function drawSectionTitle(title, subtitle = '') {
    checkPageBreak(12);
    doc.setFillColor(...COLORS.blueHeader);
    doc.setDrawColor(...COLORS.borderColor);
    doc.roundedRect(MARGIN_X, currentY, CONTENT_WIDTH, subtitle ? 9.5 : 7.5, 1, 1, 'FD');

    doc.setFillColor(...COLORS.orange);
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
      currentY += 12;
    } else {
      currentY += 10;
    }
  }

  // Table columns definition (Total width = 186mm)
  const installationCols = [
    { title: '#', width: 8, align: 'center' },
    { title: 'Client Name', width: 48, align: 'left' },
    { title: 'Installed Date', width: 26, align: 'left' },
    { title: 'Device Type', width: 46, align: 'left' },
    { title: 'Quantity', width: 16, align: 'right' },
    { title: 'Location', width: 42, align: 'left' },
  ];

  function drawInstallationTableHeader() {
    doc.setFillColor(...COLORS.navy);
    doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, 5.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.white);

    let colX = MARGIN_X;
    installationCols.forEach((col) => {
      const textX =
        col.align === 'right'
          ? colX + col.width - 2
          : col.align === 'center'
          ? colX + col.width / 2
          : colX + 2;
      doc.text(col.title, textX, currentY + 3.8, { align: col.align });
      colX += col.width;
    });
    currentY += 5.5;
  }

  // Draw Header
  drawReportHeader();

  // Draw Technician-Wise Installation Report Section
  drawSectionTitle(
    'TECHNICIAN-WISE INSTALLATION REPORT',
    'Completed installations grouped by technician, client and devices'
  );

  if (technicians.length === 0) {
    doc.setFillColor(...COLORS.grayBg);
    doc.roundedRect(MARGIN_X, currentY, CONTENT_WIDTH, 12, 1, 1, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text('No active service technicians configured.', MARGIN_X + 6, currentY + 7);
    currentY += 15;
  } else {
    technicians.forEach((tech) => {
      const techName = tech.technician_name || tech.technicianName || 'Technician';
      const instCount = tech.completed_installations_count ?? tech.completedInstallationsCount ?? 0;
      const devCount = tech.total_devices_installed ?? tech.totalDevicesInstalled ?? 0;
      const installations = tech.installations || [];

      // Check break before technician card
      checkPageBreak(18);

      // Technician Card Header Bar
      doc.setFillColor(241, 245, 249); // slate-100
      doc.setDrawColor(...COLORS.borderColor);
      doc.roundedRect(MARGIN_X, currentY, CONTENT_WIDTH, 7.5, 1, 1, 'FD');

      // Left Accent bar
      doc.setFillColor(...COLORS.orange);
      doc.rect(MARGIN_X, currentY, 2, 7.5, 'F');

      // Technician Name
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...COLORS.navy);
      doc.text(sanitizeText(techName), MARGIN_X + 5, currentY + 5);

      // Installation & Device Counts Summary
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.orange);
      const countSummary = `${instCount} Installation${instCount === 1 ? '' : 's'}  •  ${devCount} Device${devCount === 1 ? '' : 's'} Installed`;
      doc.text(countSummary, MARGIN_X + CONTENT_WIDTH - 3, currentY + 5, { align: 'right' });

      currentY += 8.5;

      // If no completed installations, show clean empty state
      if (installations.length === 0) {
        doc.setFillColor(...COLORS.grayBg);
        doc.setDrawColor(...COLORS.borderColor);
        doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, 6.5, 'FD');

        doc.setFont('helvetica', 'italic');
        doc.setFontSize(6.5);
        doc.setTextColor(...COLORS.grayText);
        doc.text(
          `No completed installations recorded for ${techName} during this reporting period.`,
          MARGIN_X + 4,
          currentY + 4.2
        );
        currentY += 8.5;
        return;
      }

      // Draw table header for this technician
      drawInstallationTableHeader();

      // Render each installation with grouped device rows
      installations.forEach((inst, instIdx) => {
        const clientName = inst.client_name || inst.clientName || 'Not recorded';
        const installedDate = inst.installed_date || inst.installedDate || 'Not recorded';
        const loc = inst.installation_location || inst.location || 'Not recorded';
        const devices = inst.devices && inst.devices.length > 0
          ? inst.devices
          : [{ device_type: 'Device', quantity: 1 }];

        const isEvenInst = instIdx % 2 === 0;

        devices.forEach((dev, devIdx) => {
          if (checkPageBreak(6)) {
            drawInstallationTableHeader();
          }

          const rowH = 5.2;

          // Background
          if (!isEvenInst) {
            doc.setFillColor(250, 250, 252);
            doc.rect(MARGIN_X, currentY, CONTENT_WIDTH, rowH, 'F');
          }

          doc.setFontSize(6.5);

          // Row 0 shows Client Name, Date, Location, and Serial Number
          // Subsequent device rows of the same installation leave them blank for grouping!
          if (devIdx === 0) {
            // Serial Number
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COLORS.grayText);
            doc.text(String(inst.serial_number || instIdx + 1), MARGIN_X + 4, currentY + 3.6, { align: 'center' });

            // Client Name
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...COLORS.navy);
            const clientTruncated = doc.splitTextToSize(sanitizeText(clientName), installationCols[1].width - 4)[0];
            doc.text(clientTruncated, MARGIN_X + installationCols[0].width + 2, currentY + 3.6);

            // Installed Date
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...COLORS.darkText);
            doc.text(
              sanitizeText(installedDate),
              MARGIN_X + installationCols[0].width + installationCols[1].width + 2,
              currentY + 3.6
            );

            // Location
            const locTruncated = doc.splitTextToSize(sanitizeText(loc), installationCols[5].width - 4)[0];
            const locColX = MARGIN_X + installationCols[0].width + installationCols[1].width + installationCols[2].width + installationCols[3].width + installationCols[4].width;
            doc.text(locTruncated, locColX + 2, currentY + 3.6);
          }

          // Device Type
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...COLORS.darkText);
          const devTypeColX = MARGIN_X + installationCols[0].width + installationCols[1].width + installationCols[2].width;
          const devName = sanitizeText(dev.device_type || dev.deviceType || 'Device');
          doc.text(devName, devTypeColX + 2, currentY + 3.6);

          // Quantity
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(...COLORS.orange);
          const qtyColX = devTypeColX + installationCols[3].width;
          doc.text(String(dev.quantity || 1), qtyColX + installationCols[4].width - 2, currentY + 3.6, { align: 'right' });

          currentY += rowH;
        });

        // Separator line between client installations
        doc.setDrawColor(...COLORS.borderColor);
        doc.setLineWidth(0.15);
        doc.line(MARGIN_X, currentY, MARGIN_X + CONTENT_WIDTH, currentY);
        currentY += 1.5;
      });

      currentY += 4;
    });
  }

  // Footers and Page Numbers on all pages
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
      'Eagle Eye SafDrive Pvt Ltd  •  Store Manager Workspace  •  Technician-Wise Installation Report',
      MARGIN_X,
      PAGE_HEIGHT - 6.5
    );
    doc.text(`Page ${p} of ${totalPages}`, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 6.5, { align: 'right' });
  }

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
