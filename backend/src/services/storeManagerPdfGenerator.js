import { jsPDF } from 'jspdf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMaterialInventory } from './materialStockService.js';
import { getInventoryProducts } from './inventoryService.js';
import {
  calculateBomRequirements,
  parseDeviceConfigurations,
  parseExtraDeviceConfigurations,
  combineCarriedDevicesAllocation,
} from './bomService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Theme Color Palette matching Eagle Eye SafDrive Branding
const COLORS = {
  navy: [10, 25, 70],            // #0a1946 Dark Navy
  blueHeader: [239, 246, 255],    // #eff6ff Light Blue Section Header
  blueAccent: [37, 99, 235],     // #2563eb Blue Accent
  blueText: [29, 78, 216],       // #1d4ed8 Deep Blue Text
  emerald: [6, 95, 70],          // #065f46 Emerald Green
  emeraldBg: [236, 253, 245],    // #ecfdf5 Light Emerald
  amber: [180, 83, 9],           // #b45309 Amber Warning
  amberBg: [254, 243, 199],      // #fef3c7 Light Amber
  rose: [190, 18, 60],           // #be123c Rose Red Shortage
  roseBg: [254, 242, 242],       // #fef2f2 Light Rose
  grayBg: [248, 250, 252],       // #f8fafc Light Gray
  borderColor: [226, 232, 240],  // #e2e8f0 Border
  darkText: [15, 23, 42],        // #0f172a Primary Text
  grayText: [100, 116, 139],     // #64748b Secondary Text
  white: [255, 255, 255],
};

const PAGE_WIDTH = 210;          // A4 Width in mm
const PAGE_HEIGHT = 297;         // A4 Height in mm
const MARGIN_X = 14;             // Left & Right Margins (14mm)
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2; // 182mm exact width
const MAX_Y = PAGE_HEIGHT - 20;  // Maximum Y before page break

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

function formatDateTime(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return sanitizeText(String(dateInput));
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
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
function drawSectionHeader(doc, title, subtitle, y) {
  doc.setFillColor(...COLORS.blueHeader);
  doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, subtitle ? 9 : 7, 1, 1, 'F');

  // Left accent pill
  doc.setFillColor(...COLORS.blueAccent);
  doc.rect(MARGIN_X, y, 2.5, subtitle ? 9 : 7, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.navy);
  doc.text(sanitizeText(title), MARGIN_X + 5, y + 4.8);

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text(sanitizeText(subtitle), MARGIN_X + 5, y + 8);
  }

  doc.setDrawColor(...COLORS.blueAccent);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y + (subtitle ? 9 : 7), MARGIN_X + CONTENT_WIDTH, y + (subtitle ? 9 : 7));

  return y + (subtitle ? 11 : 9);
}

/**
 * Draws the BOM Table Header row
 */
function drawBomTableHeader(doc, y) {
  const colX = [
    MARGIN_X,          // 0: # (8mm)
    MARGIN_X + 8,      // 1: Material Name (58mm)
    MARGIN_X + 66,     // 2: SKU (26mm)
    MARGIN_X + 92,     // 3: Req Qty (22mm)
    MARGIN_X + 114,    // 4: Unit (18mm)
    MARGIN_X + 132,    // 5: Available (25mm)
    MARGIN_X + 157,    // 6: Shortage (25mm)
  ];

  doc.setFillColor(...COLORS.navy);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 6.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.white);

  doc.text('#', colX[0] + 4, y + 4.3, { align: 'center' });
  doc.text('REQUIRED FITTING MATERIAL', colX[1] + 2, y + 4.3);
  doc.text('SKU / CODE', colX[2] + 2, y + 4.3);
  doc.text('REQ QTY', colX[3] + 11, y + 4.3, { align: 'center' });
  doc.text('UNIT', colX[4] + 9, y + 4.3, { align: 'center' });
  doc.text('AVAIL STOCK', colX[5] + 12, y + 4.3, { align: 'center' });
  doc.text('SHORTAGE', colX[6] + 12, y + 4.3, { align: 'center' });

  return y + 6.5;
}

/**
 * Generates the dedicated Store Manager — Device & Material Requirement Sheet PDF
 * Strictly excludes any pricing, payment method, advance, or customer billing details.
 */
export async function generateStoreManagerRequirementPDF(data) {
  if (!data) throw new Error('Requirement or checklist data is required');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const isService = (data.job_type || data.installation_or_service || 'Installation') === 'Service';
  const checklistNumber = sanitizeText(data.checklist_number || 'N/A');
  const creationDate = data.submission_date || data.created_at || new Date().toISOString();

  // Load authoritative live inventory to guarantee real-time stock balances
  let materialInventoryMap = new Map();
  let deviceInventoryMap = new Map();
  try {
    const [allMats, allDevs] = await Promise.all([
      getMaterialInventory().catch(() => []),
      getInventoryProducts().catch(() => []),
    ]);
    materialInventoryMap = new Map(allMats.map((m) => [m.material_name.toLowerCase(), m]));
    deviceInventoryMap = new Map(allDevs.map((d) => [d.device_type, d]));
  } catch (e) {
    console.warn('Could not load inventory maps in PDF generator:', e.message);
  }

  // Normalize Device Configurations using robust parser (Required for Installation)
  let deviceConfigs = parseDeviceConfigurations(data);
  if (deviceConfigs.length === 0 && data.device_type) {
    deviceConfigs = [{
      device_type: data.device_type,
      number_of_devices: data.number_of_devices || 1,
      number_of_vehicles: data.number_of_vehicles || data.number_of_devices || 1,
    }];
  }

  // Parse Extra Devices Carried separately (Backup Stock)
  const extraConfigs = parseExtraDeviceConfigurations(data);
  const combinedAllocation = combineCarriedDevicesAllocation(deviceConfigs, extraConfigs);

  const totalRequiredDevices = deviceConfigs.reduce((sum, d) => sum + (Number(d.number_of_devices) || 1), 0);
  const totalExtraDevices = extraConfigs.reduce((sum, d) => sum + (Number(d.extra_quantity) || 0), 0);
  const totalCarriedDevices = combinedAllocation.reduce((sum, d) => sum + (Number(d.quantity_carried) || 0), 0);
  const totalVehicles = deviceConfigs.reduce((sum, d) => sum + (Number(d.number_of_vehicles) || 1), 0);

  // Normalize BOM Material Items
  let materialItems = [];
  if (!isService) {
    if (Array.isArray(data.material_items) && data.material_items.length > 0) {
      materialItems = data.material_items;
    } else if (data.bom_snapshot?.items && Array.isArray(data.bom_snapshot.items) && data.bom_snapshot.items.length > 0) {
      materialItems = data.bom_snapshot.items;
    }

    // Self-healing fallback: If materialItems is empty or has zero quantity, calculate from configured BOM
    if (materialItems.length === 0 && deviceConfigs.length > 0) {
      try {
        const calculated = await calculateBomRequirements(deviceConfigs);
        if (calculated?.items && calculated.items.length > 0) {
          materialItems = calculated.items;
        }
      } catch (e) {
        console.warn('BOM calculation for PDF fallback failed:', e.message);
      }
    }
  }

  // Enrich material items with live inventory stock & calculated shortage
  // Enforce rule: 8 Channel Live does not require Memory Card
  const enrichedMaterials = isService ? [] : materialItems
    .filter((item) => {
      // If job contains only 8 Channel Live, exclude Memory Card entirely
      const isOnly8Channel = deviceConfigs.length === 1 && (deviceConfigs[0].device_type || '').trim().toLowerCase() === '8 channel live';
      if (isOnly8Channel && (item.material_name || '').toLowerCase().includes('memory card')) {
        return false;
      }
      return true;
    })
    .map((item) => {
      const matName = sanitizeText(item.material_name || '');
      const inv = materialInventoryMap.get(matName.toLowerCase());
      const currentStock = inv ? Number(inv.current_stock) || 0 : (item.available_stock !== undefined ? Number(item.available_stock) : 0);
      const reqQty = Number(item.required_quantity !== undefined ? item.required_quantity : (item.total_required_quantity !== undefined ? item.total_required_quantity : item.total_quantity)) || 0;
      const shortage = Math.max(0, reqQty - currentStock);
      const sku = inv?.sku || item.material_sku || item.sku || 'N/A';
      const unit = sanitizeText(item.unit || inv?.unit || 'Nos.');

      return {
        material_name: matName,
        sku: sanitizeText(sku),
        required_quantity: reqQty,
        available_stock: currentStock,
        shortage,
        unit,
      };
    });

  const hasShortages = enrichedMaterials.some((m) => m.shortage > 0);
  const totalShortagesCount = enrichedMaterials.filter((m) => m.shortage > 0).length;

  let y = 10;

  // Helper to handle page break safely
  const checkAddPage = (neededSpace) => {
    if (y + neededSpace > MAX_Y) {
      doc.addPage();
      y = 14;
      return true;
    }
    return false;
  };

  // ============================================================
  // 1. TOP HEADER & BRANDING
  // ============================================================
  const logoBase64 = getLogoBase64();
  if (logoBase64) {
    try {
      doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', MARGIN_X, y, 22, 14);
    } catch (e) {
      console.warn('Could not render logo in PDF:', e.message);
    }
  }

  // Title and branding
  const brandX = logoBase64 ? MARGIN_X + 26 : MARGIN_X;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.navy);
  doc.text('EAGLE EYE SAFDRIVE', brandX, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text('Commercial Fleet Safety & Telematics Hardware Management', brandX, y + 9);

  // Right-side Checklist Number & Date Badges
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.navy);
  doc.text(`CHECKLIST #: ${checklistNumber}`, PAGE_WIDTH - MARGIN_X, y + 4.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.grayText);
  doc.text(`Created: ${formatDateTime(creationDate)}`, PAGE_WIDTH - MARGIN_X, y + 8.5, { align: 'right' });

  // Job Type Pill
  const jobTypeText = isService ? 'SERVICE CALL' : 'INSTALLATION JOB';
  const badgeColor = isService ? [126, 34, 206] : COLORS.blueAccent;
  doc.setFillColor(...(isService ? [243, 232, 255] : COLORS.blueHeader));
  doc.roundedRect(PAGE_WIDTH - MARGIN_X - 32, y + 10.5, 32, 5, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(...badgeColor);
  doc.text(jobTypeText, PAGE_WIDTH - MARGIN_X - 16, y + 14, { align: 'center' });

  y += 18;

  // Title Ribbon
  doc.setFillColor(...COLORS.navy);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 7.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.white);
  doc.text('STORE MANAGER — DEVICE & MATERIAL REQUIREMENT SHEET', MARGIN_X + 4, y + 5.2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(203, 213, 225);
  doc.text('Official Hardware Requisition & Allocation Form', PAGE_WIDTH - MARGIN_X - 4, y + 5.2, { align: 'right' });

  y += 11;

  // ============================================================
  // 2. JOB & CLIENT INFORMATION (NO PRICING OR BILLING)
  // ============================================================
  y = drawSectionHeader(doc, '1. CLIENT & INSTALLATION DETAILS', 'Site location, customer contact, and installation schedule', y);

  const clientGrid = [
    [
      { label: 'Client / Customer Name', value: data.client_name || '—' },
      { label: 'Mobile Number', value: data.client_mobile || '—' },
      { label: 'Job Type', value: isService ? 'Service Call' : 'Installation' },
    ],
    [
      { label: 'Installation Address / Location', value: data.client_location || 'Not provided' },
      {
        label: 'Google Maps Link',
        value: data.google_maps_location || null,
        isUrl: Boolean(data.google_maps_location),
      },
      {
        label: 'Expected Arrival Schedule',
        value: `${formatDate(data.expected_arrival_date || data.booking_start_date)} ${data.expected_arrival_time ? `(${sanitizeText(data.expected_arrival_time)})` : ''}`,
      },
    ],
  ];

  clientGrid.forEach((row) => {
    const colCount = row.length;
    const colWidth = CONTENT_WIDTH / colCount;
    let maxCellH = 11;

    row.forEach((cell) => {
      let valStr = cell.isUrl ? 'Open Google Maps Location' : sanitizeText(cell.value || '—');
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(valStr, colWidth - 6);
      const cellH = Math.max(11, 4.5 + lines.length * 3.6);
      if (cellH > maxCellH) maxCellH = cellH;
    });

    row.forEach((cell, idx) => {
      const cellX = MARGIN_X + idx * colWidth;
      doc.setFillColor(...COLORS.grayBg);
      doc.setDrawColor(...COLORS.borderColor);
      doc.setLineWidth(0.2);
      doc.rect(cellX, y, colWidth, maxCellH, 'FD');

      // Label
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.grayText);
      doc.text(sanitizeText(cell.label).toUpperCase(), cellX + 3, y + 3.8);

      // Value
      if (cell.isUrl && cell.value && cell.value.startsWith('http')) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.blueText);
        doc.text('Open Google Maps Location', cellX + 3, y + 7.5);
        doc.link(cellX, y, colWidth, maxCellH, { url: cell.value });
      } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.darkText);
        const valStr = sanitizeText(cell.value || '—');
        const lines = doc.splitTextToSize(valStr, colWidth - 6);
        doc.text(lines, cellX + 3, y + 7.5);
      }
    });

    y += maxCellH;
  });

  y += 5;

  // ============================================================
  // 3. ASSIGNED INSTALLATION TEAM & SALESPERSON
  // ============================================================
  y = drawSectionHeader(doc, '2. ASSIGNED INSTALLATION TEAM & SALESPERSON', 'Personnel responsible for site execution and job creation', y);

  const teamGrid = [
    { label: 'Service Engineer (Technician)', value: data.service_engineer || 'Unassigned' },
    { label: 'Service Assistant (Team Member 2)', value: data.service_assistant || 'None Assigned' },
    { label: 'Salesperson Name', value: data.salesperson_name || '—', highlight: true },
  ];

  const teamColWidth = CONTENT_WIDTH / 3;
  const teamCellH = 11;

  teamGrid.forEach((cell, idx) => {
    const cellX = MARGIN_X + idx * teamColWidth;
    doc.setFillColor(...(cell.highlight ? [239, 246, 255] : COLORS.grayBg));
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);
    doc.rect(cellX, y, teamColWidth, teamCellH, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...(cell.highlight ? COLORS.blueText : COLORS.grayText));
    doc.text(cell.label.toUpperCase(), cellX + 3, y + 3.8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...(cell.highlight ? COLORS.blueText : COLORS.darkText));
    doc.text(sanitizeText(cell.value), cellX + 3, y + 7.8);
  });

  y += teamCellH + 5;

  // ============================================================
  // 3. CAMERA DEVICE ALLOCATION (REQUIRED & EXTRA BACKUP DEVICES)
  // ============================================================
  checkAddPage(30);
  y = drawSectionHeader(doc, '3. CAMERA DEVICE ALLOCATION & STORE DISPATCH REQUIREMENTS', 'Authoritative device requirement showing installation devices, extra backup devices, and total issue quantities', y);

  // --- 3A. REQUIRED INSTALLATION DEVICES ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.navy);
  doc.text('3A. REQUIRED INSTALLATION DEVICES (CUSTOMER ORDER)', MARGIN_X, y + 3.5);
  y += 5;

  const reqColWidths = [12, 100, 35, 35];
  const reqColX = [
    MARGIN_X,
    MARGIN_X + reqColWidths[0],
    MARGIN_X + reqColWidths[0] + reqColWidths[1],
    MARGIN_X + reqColWidths[0] + reqColWidths[1] + reqColWidths[2],
  ];

  doc.setFillColor(...COLORS.navy);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.white);

  doc.text('#', reqColX[0] + 6, y + 3.8, { align: 'center' });
  doc.text('DEVICE MODEL / TYPE', reqColX[1] + 3, y + 3.8);
  doc.text('REQUIRED QUANTITY', reqColX[2] + 17, y + 3.8, { align: 'center' });
  doc.text('UNIT', reqColX[3] + 17, y + 3.8, { align: 'center' });

  y += 5.5;

  deviceConfigs.forEach((cfg, idx) => {
    checkAddPage(6);
    const dType = sanitizeText(cfg.device_type || '2 Channel Live');
    const dQty = Number(cfg.number_of_devices || cfg.quantity_carried) || 1;

    doc.setFillColor(...(idx % 2 === 0 ? COLORS.white : COLORS.grayBg));
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text(String(idx + 1), reqColX[0] + 6, y + 3.8, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.darkText);
    doc.text(dType, reqColX[1] + 3, y + 3.8);

    doc.text(`${dQty} Nos.`, reqColX[2] + 17, y + 3.8, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text('Nos.', reqColX[3] + 17, y + 3.8, { align: 'center' });

    y += 5.5;
  });

  // Required Subtotal
  doc.setFillColor(...COLORS.blueHeader);
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.setTextColor(...COLORS.navy);
  doc.text('SUBTOTAL (DEVICES REQUIRED FOR INSTALLATION):', reqColX[1] + 3, y + 3.8);
  doc.text(`${totalRequiredDevices} Units`, reqColX[2] + 17, y + 3.8, { align: 'center' });
  doc.text(`Vehicles: ${totalVehicles}`, reqColX[3] + 17, y + 3.8, { align: 'center' });
  y += 8;

  // --- 3B. EXTRA / BACKUP DEVICES CARRIED ---
  checkAddPage(20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.navy);
  doc.text('3B. EXTRA / BACKUP DEVICES CARRIED (ADDITIONAL STOCK TO SITE)', MARGIN_X, y + 3.5);
  y += 5;

  if (extraConfigs.length > 0) {
    doc.setFillColor(...COLORS.navy);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.white);

    doc.text('#', reqColX[0] + 6, y + 3.8, { align: 'center' });
    doc.text('EXTRA DEVICE MODEL / TYPE', reqColX[1] + 3, y + 3.8);
    doc.text('EXTRA QUANTITY CARRIED', reqColX[2] + 17, y + 3.8, { align: 'center' });
    doc.text('UNIT', reqColX[3] + 17, y + 3.8, { align: 'center' });

    y += 5.5;

    extraConfigs.forEach((cfg, idx) => {
      checkAddPage(6);
      const dType = sanitizeText(cfg.device_type || '2 Channel Live');
      const dQty = Number(cfg.extra_quantity || cfg.quantity) || 1;

      doc.setFillColor(...(idx % 2 === 0 ? COLORS.white : COLORS.grayBg));
      doc.setDrawColor(...COLORS.borderColor);
      doc.setLineWidth(0.2);
      doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.grayText);
      doc.text(String(idx + 1), reqColX[0] + 6, y + 3.8, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.darkText);
      doc.text(dType, reqColX[1] + 3, y + 3.8);

      doc.text(`${dQty} Nos.`, reqColX[2] + 17, y + 3.8, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.text('Nos.', reqColX[3] + 17, y + 3.8, { align: 'center' });

      y += 5.5;
    });

    // Extra Subtotal
    doc.setFillColor(...COLORS.blueHeader);
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.2);
    doc.setTextColor(...COLORS.navy);
    doc.text('SUBTOTAL (EXTRA / BACKUP DEVICES CARRIED):', reqColX[1] + 3, y + 3.8);
    doc.text(`${totalExtraDevices} Units`, reqColX[2] + 17, y + 3.8, { align: 'center' });
    doc.text('Backup Stock', reqColX[3] + 17, y + 3.8, { align: 'center' });
    y += 8;
  } else {
    doc.setFillColor(...COLORS.grayBg);
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 7, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text('No extra or backup devices carried for this installation job. (0 extra units)', MARGIN_X + 4, y + 4.5);
    y += 10;
  }

  // --- 3C. TOTAL QUANTITY TO ISSUE FOR EACH DEVICE TYPE (DISPATCH SUMMARY) ---
  checkAddPage(25);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.navy);
  doc.text('3C. TOTAL QUANTITY TO ISSUE FOR EACH DEVICE TYPE (STORE DISPATCH TOTAL)', MARGIN_X, y + 3.5);
  y += 5;

  const issueColWidths = [12, 70, 30, 30, 40];
  const issueColX = [
    MARGIN_X,
    MARGIN_X + issueColWidths[0],
    MARGIN_X + issueColWidths[0] + issueColWidths[1],
    MARGIN_X + issueColWidths[0] + issueColWidths[1] + issueColWidths[2],
    MARGIN_X + issueColWidths[0] + issueColWidths[1] + issueColWidths[2] + issueColWidths[3],
  ];

  doc.setFillColor(...COLORS.navy);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.white);

  doc.text('#', issueColX[0] + 6, y + 3.8, { align: 'center' });
  doc.text('DEVICE MODEL / TYPE', issueColX[1] + 3, y + 3.8);
  doc.text('REQUIRED', issueColX[2] + 15, y + 3.8, { align: 'center' });
  doc.text('EXTRA / BACKUP', issueColX[3] + 15, y + 3.8, { align: 'center' });
  doc.text('TOTAL TO ISSUE', issueColX[4] + 20, y + 3.8, { align: 'center' });

  y += 5.5;

  combinedAllocation.forEach((item, idx) => {
    checkAddPage(6);
    doc.setFillColor(...(idx % 2 === 0 ? COLORS.white : COLORS.grayBg));
    doc.setDrawColor(...COLORS.borderColor);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.grayText);
    doc.text(String(idx + 1), issueColX[0] + 6, y + 3.8, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.darkText);
    doc.text(sanitizeText(item.device_type), issueColX[1] + 3, y + 3.8);

    doc.setFont('helvetica', 'normal');
    doc.text(`${item.required_quantity || 0} Nos.`, issueColX[2] + 15, y + 3.8, { align: 'center' });
    doc.text(`${item.extra_quantity || 0} Nos.`, issueColX[3] + 15, y + 3.8, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COLORS.blueText);
    doc.text(`${item.quantity_carried} Nos.`, issueColX[4] + 20, y + 3.8, { align: 'center' });

    y += 5.5;
  });

  // Grand Total Expected to Leave Store Row
  doc.setFillColor(...COLORS.navy);
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_WIDTH, 6, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.white);
  doc.text('TOTAL UNITS EXPECTED TO LEAVE STORE (ALL CARRIED):', issueColX[1] + 3, y + 4.2);
  doc.text(`${totalRequiredDevices} Req.`, issueColX[2] + 15, y + 4.2, { align: 'center' });
  doc.text(`${totalExtraDevices} Extra`, issueColX[3] + 15, y + 4.2, { align: 'center' });
  doc.text(`${totalCarriedDevices} Units Total`, issueColX[4] + 20, y + 4.2, { align: 'center' });

  y += 10;

  // ============================================================
  // 5. AUTOMATIC BILL OF MATERIALS (BOM) — MOST IMPORTANT SECTION
  // ============================================================
  checkAddPage(35);
  y = drawSectionHeader(
    doc,
    '4. AUTOMATIC BILL OF MATERIALS (BOM) & SHORTAGE ANALYSIS',
    'Aggregated required fitting materials calculated from configured device BOMs (Stock not deducted until issued)',
    y
  );

  if (isService) {
    // Service Job Notice Banner
    doc.setFillColor(243, 232, 255); // soft purple
    doc.setDrawColor(216, 180, 254);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 14, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(107, 33, 168);
    doc.text('SERVICE CALL — NO AUTOMATIC INSTALLATION BOM GENERATED', MARGIN_X + 5, y + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(88, 28, 135);
    doc.text(
      'This job is a maintenance or repair service call. No standard installation BOM is automatically generated or deducted from store.\nAny specialized repair spare parts should be issued on-demand by the Store Manager.',
      MARGIN_X + 5,
      y + 9.5
    );

    y += 18;
  } else if (enrichedMaterials.length === 0) {
    // Empty BOM state
    doc.setFillColor(...COLORS.amberBg);
    doc.setDrawColor(...COLORS.amber);
    doc.setLineWidth(0.2);
    doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 11, 1, 1, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.amber);
    const warningMsg = sanitizeText(data.bom_snapshot?.warning || 'NO BOM MATERIALS CONFIGURED FOR SELECTED DEVICES');
    doc.text(warningMsg, MARGIN_X + 4, y + 6.5);

    y += 15;
  } else {
    // Draw BOM Table
    const bomColX = [
      MARGIN_X,          // 0: # (8mm)
      MARGIN_X + 8,      // 1: Material Name (58mm)
      MARGIN_X + 66,     // 2: SKU (26mm)
      MARGIN_X + 92,     // 3: Req Qty (22mm)
      MARGIN_X + 114,    // 4: Unit (18mm)
      MARGIN_X + 132,    // 5: Available (25mm)
      MARGIN_X + 157,    // 6: Shortage (25mm)
    ];

    y = drawBomTableHeader(doc, y);

    enrichedMaterials.forEach((item, idx) => {
      // Check for page break inside table
      if (checkAddPage(6)) {
        y = drawBomTableHeader(doc, y);
      }

      const hasItemShortage = item.shortage > 0;
      const isAlt = idx % 2 === 1;

      if (hasItemShortage) {
        doc.setFillColor(...COLORS.roseBg);
      } else if (isAlt) {
        doc.setFillColor(...COLORS.grayBg);
      } else {
        doc.setFillColor(...COLORS.white);
      }

      doc.setDrawColor(...COLORS.borderColor);
      doc.setLineWidth(0.2);
      doc.rect(MARGIN_X, y, CONTENT_WIDTH, 5.8, 'FD');

      // #
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.grayText);
      doc.text(String(idx + 1), bomColX[0] + 4, y + 4, { align: 'center' });

      // Material Name
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(hasItemShortage ? COLORS.rose : COLORS.darkText));
      doc.text(item.material_name, bomColX[1] + 2, y + 4);

      // SKU
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(...COLORS.grayText);
      doc.text(item.sku, bomColX[2] + 2, y + 4);

      // Required Qty
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.darkText);
      doc.text(String(item.required_quantity), bomColX[3] + 11, y + 4, { align: 'center' });

      // Unit
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.grayText);
      doc.text(item.unit, bomColX[4] + 9, y + 4, { align: 'center' });

      // Available Stock in Warehouse
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(item.available_stock > 0 ? COLORS.darkText : COLORS.rose));
      doc.text(String(item.available_stock), bomColX[5] + 12, y + 4, { align: 'center' });

      // Shortage
      if (hasItemShortage) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.rose);
        doc.text(`${item.shortage} (SHORT)`, bomColX[6] + 12, y + 4, { align: 'center' });
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.emerald);
        doc.text('0 (OK)', bomColX[6] + 12, y + 4, { align: 'center' });
      }

      y += 5.8;
    });

    y += 3;

    // BOM Stock Status Summary Box
    checkAddPage(12);
    if (hasShortages) {
      doc.setFillColor(...COLORS.roseBg);
      doc.setDrawColor(...COLORS.rose);
      doc.setLineWidth(0.3);
      doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 8.5, 1, 1, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.rose);
      doc.text(
        `! STOCK SHORTAGE DETECTED: ${totalShortagesCount} required material item(s) are short in warehouse. Stock replenishment or purchase requisition required before technician departure.`,
        MARGIN_X + 4,
        y + 5.3
      );
    } else {
      doc.setFillColor(...COLORS.emeraldBg);
      doc.setDrawColor(...COLORS.emerald);
      doc.setLineWidth(0.3);
      doc.roundedRect(MARGIN_X, y, CONTENT_WIDTH, 8.5, 1, 1, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...COLORS.emerald);
      doc.text(
        'v ALL MATERIALS FULLY AVAILABLE: Warehouse stock is sufficient for this installation. Ready for store physical issuance.',
        MARGIN_X + 4,
        y + 5.3
      );
    }

    y += 12;
  }

  // ============================================================
  // 6. STORE MANAGER VERIFICATION & ISSUANCE SIGN-OFF
  // ============================================================
  checkAddPage(32);
  y = drawSectionHeader(doc, '5. STORE ISSUANCE SIGN-OFF & VERIFICATION', 'Formal authorization and physical material handover records', y);

  // Policy notice
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.8);
  doc.setTextColor(...COLORS.grayText);
  doc.text(
    '* Stock is NOT deducted upon checklist creation or PDF generation. Inventory balances deduct only when Store Manager executes issuance in SafDrive.',
    MARGIN_X + 1,
    y + 2
  );

  y += 5;

  const signBoxW = CONTENT_WIDTH / 3;
  const signBoxH = 19;

  // Box 1: Store Manager
  doc.setFillColor(...COLORS.grayBg);
  doc.setDrawColor(...COLORS.borderColor);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN_X, y, signBoxW, signBoxH, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.navy);
  doc.text('STORE MANAGER ISSUANCE', MARGIN_X + 3, y + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text('Name: ______________________', MARGIN_X + 3, y + 9);
  doc.text('Signature: ___________________', MARGIN_X + 3, y + 13.5);
  doc.text('Date & Time: ________________', MARGIN_X + 3, y + 17.5);

  // Box 2: Service Engineer Handover
  const box2X = MARGIN_X + signBoxW;
  doc.setFillColor(...COLORS.grayBg);
  doc.rect(box2X, y, signBoxW, signBoxH, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.navy);
  doc.text('SERVICE ENGINEER RECEIPT', box2X + 3, y + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text(`Technician: ${sanitizeText(data.service_engineer || 'Unassigned')}`, box2X + 3, y + 9);
  doc.text('Signature: ___________________', box2X + 3, y + 13.5);
  doc.text('Date & Time: ________________', box2X + 3, y + 17.5);

  // Box 3: Issuance Status & Audit
  const box3X = MARGIN_X + signBoxW * 2;
  const isAlreadyIssued = data.material_issuance_status === 'ISSUED';
  doc.setFillColor(...(isAlreadyIssued ? COLORS.emeraldBg : COLORS.grayBg));
  doc.rect(box3X, y, signBoxW, signBoxH, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.navy);
  doc.text('STORE STATUS VERIFICATION', box3X + 3, y + 4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.grayText);
  doc.text(`Status: ${isAlreadyIssued ? 'STOCK ISSUED & DEDUCTED' : 'ISSUANCE PENDING'}`, box3X + 3, y + 9);
  doc.text(`Issued At: ${formatDateTime(data.material_issued_at)}`, box3X + 3, y + 13.5);
  doc.text('SafDrive Verification Stamp', box3X + 3, y + 17.5);

  y += signBoxH + 4;

  // ============================================================
  // PAGE NUMBERS & FOOTER ON ALL PAGES
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
    doc.text(
      'Eagle Eye SafDrive • Store Manager Requisition Sheet • Confidential Internal Document',
      MARGIN_X,
      PAGE_HEIGHT - 8
    );
    doc.text(`Page ${i} of ${totalPages}`, PAGE_WIDTH - MARGIN_X, PAGE_HEIGHT - 8, { align: 'right' });
  }

  const arrayBuffer = doc.output('arraybuffer');
  return Buffer.from(arrayBuffer);
}
