/**
 * Weekly Stock Maintenance Report Service
 * 
 * Provides authoritative weekly physical stock summaries, movement histories,
 * technician-wise material issuance breakdowns, material usage and return reconciliations,
 * low-stock alert monitoring, and variance detection.
 * 
 * Critical inventory rule:
 * Store Manager maintains actual physical loose-product inventory only.
 * The weekly report must report actual physical stock and real transactions,
 * never virtual device sets.
 */

import supabase from './supabase.js';
import { getMaterialInventory, ACTIVE_REQUIRED_MATERIALS_ORDER } from './materialStockService.js';
import { inMemoryStockMovements } from './stockMovementService.js';
import {
  inMemoryCompletionReports,
  inMemoryAdditionalInstallations,
} from './workflowService.js';
import {
  getAllServiceEngineers,
  getActiveServiceEngineerNames,
} from './serviceEngineerService.js';

export const AUTHORIZED_SERVICE_ENGINEERS = [
  'Mathi',
  'Guna',
  'Sakthivel',
  'Kamalesh',
];

/**
 * Returns previous completed Monday–Sunday week range formatted in Asia/Kolkata timezone.
 * E.g. If today is Wednesday, 21 Oct 2026, the previous completed week is
 * Monday, 12 Oct 2026 through Sunday, 18 Oct 2026.
 */
export function getPreviousCompletedWeek(referenceDate = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(referenceDate);
  const year = parseInt(parts.find((p) => p.type === 'year').value, 10);
  const month = parseInt(parts.find((p) => p.type === 'month').value, 10);
  const day = parseInt(parts.find((p) => p.type === 'day').value, 10);

  // UTC-based day-of-week for the calendar date in Asia/Kolkata (Sunday=0, Monday=1, ..., Saturday=6)
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay();

  // Current Monday for reference date
  const currentMondayUtc = new Date(Date.UTC(year, month - 1, day - (dayOfWeek - 1)));
  // Previous completed Monday (7 days earlier)
  const prevMondayUtc = new Date(currentMondayUtc.getTime() - 7 * 24 * 60 * 60 * 1000);
  // Previous completed Sunday (6 days after previous Monday)
  const prevSundayUtc = new Date(prevMondayUtc.getTime() + 6 * 24 * 60 * 60 * 1000);

  const startDate = prevMondayUtc.toISOString().split('T')[0];
  const endDate = prevSundayUtc.toISOString().split('T')[0];

  return {
    startDate,
    endDate,
  };
}

/**
 * Converts Monday–Sunday reporting date strings (YYYY-MM-DD) into safe UTC timestamp boundaries:
 * startUtcIso = Monday 00:00:00.000 Asia/Kolkata (+05:30)
 * endUtcIso   = Following Monday 00:00:00.000 Asia/Kolkata (+05:30) -> query with `timestamp < endUtcIso`
 */
export function getWeekUtcBoundaries(startDateStr, endDateStr) {
  if (!startDateStr || !endDateStr) {
    const def = getPreviousCompletedWeek();
    startDateStr = def.startDate;
    endDateStr = def.endDate;
  }

  // Parse YYYY-MM-DD
  const startIso = new Date(`${startDateStr}T00:00:00+05:30`).toISOString();

  // Next Monday 00:00:00+05:30 (1 day after Sunday)
  const [y, m, d] = endDateStr.split('-').map(Number);
  const nextDayUtc = new Date(Date.UTC(y, m - 1, d + 1));
  const nextDayStr = nextDayUtc.toISOString().split('T')[0];
  const endIso = new Date(`${nextDayStr}T00:00:00+05:30`).toISOString();

  return {
    startDate: startDateStr,
    endDate: endDateStr,
    startUtcIso: startIso,
    endUtcIso: endIso,
  };
}

/**
 * Formats a Monday–Sunday range into a human-readable display string
 * e.g. "12 Oct 2026 – 18 Oct 2026"
 */
export function formatWeekRangeDisplay(startDateStr, endDateStr) {
  try {
    const d1 = new Date(`${startDateStr}T00:00:00+05:30`);
    const d2 = new Date(`${endDateStr}T00:00:00+05:30`);
    const opts = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' };
    const s1 = d1.toLocaleDateString('en-IN', opts);
    const s2 = d2.toLocaleDateString('en-IN', opts);
    return `${s1} – ${s2}`;
  } catch (e) {
    return `${startDateStr} – ${endDateStr}`;
  }
}

/**
 * Formats date and time in Asia/Kolkata
 */
export function formatKolkataDateTime(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Converts an ISO or timestamp into an Asia/Kolkata date string (YYYY-MM-DD)
 */
export function toKolkataDateString(dateInput) {
  if (!dateInput) return null;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Formats a date into a clean Asia/Kolkata display string: "22 Oct 2026"
 */
export function formatKolkataDateDisplay(dateInput) {
  if (!dateInput) return 'Not recorded';
  let d;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    d = new Date(`${dateInput}T12:00:00+05:30`);
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return String(dateInput);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Checks if an item or component represents a device (not non-returnable screws or consumable fitting materials)
 */
function isDeviceItem(name, category) {
  if (!name) return false;
  if (category === 'Device Component' || category === 'Camera Device') return true;
  const lower = name.toLowerCase();
  if (
    lower.includes('screw') ||
    lower.includes('wire') ||
    lower.includes('cable') ||
    lower.includes('tape') ||
    lower.includes('tie') ||
    lower.includes('conduit')
  ) {
    return false;
  }
  return true;
}

/**
 * Get Technician-Wise Installation Report for the selected reporting week
 */
export async function getTechnicianWiseInstallationReport({ startDate, endDate }) {
  // 1. Fetch active service engineers dynamically
  let serviceEngineersList = [];
  try {
    serviceEngineersList = await getAllServiceEngineers({ includeInactive: false });
  } catch (err) {
    serviceEngineersList = AUTHORIZED_SERVICE_ENGINEERS.map((name, i) => ({
      id: `eng-${i + 1}`,
      name,
      role: 'Service Engineer',
      is_active: true,
    }));
  }

  // 2. Fetch all installation checklists
  let allChecklists = [];
  try {
    const { data: dbChecklists, error } = await supabase
      .from('installation_checklists')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(dbChecklists)) {
      allChecklists = dbChecklists;
    }
  } catch (err) {
    console.warn('Error fetching installation_checklists in weekly report:', err.message);
  }

  // 3. Fetch completion reports from DB and merge with inMemory store
  let dbReports = [];
  try {
    const { data: repData, error } = await supabase
      .from('technical_installation_reports')
      .select('*');
    if (!error && Array.isArray(repData)) {
      dbReports = repData;
    }
  } catch (err) {
    console.warn('Error fetching technical_installation_reports in weekly report:', err.message);
  }

  const reportsByChecklistId = new Map();
  dbReports.forEach((r) => reportsByChecklistId.set(r.checklist_id, r));
  for (const [chkId, rep] of inMemoryCompletionReports.entries()) {
    reportsByChecklistId.set(chkId, rep);
  }

  // Synthesize or ensure any checklists present in completion reports are included in allChecklists
  const knownChecklistIds = new Set(allChecklists.map((c) => c.id));
  for (const [chkId, rep] of reportsByChecklistId.entries()) {
    if (!knownChecklistIds.has(chkId)) {
      allChecklists.push({
        id: chkId,
        checklist_number: rep.checklist_number || `CHK-${String(chkId).slice(0, 8)}`,
        client_name: rep.client_name || 'Client',
        client_location: rep.installation_location || rep.client_location || rep.location || '',
        google_maps_location: rep.google_maps_link || rep.google_maps_location || null,
        google_maps_link: rep.google_maps_link || null,
        service_engineer: rep.technician_name || rep.service_engineer,
        installation_status: rep.completion_status || 'Completed',
        actual_completion_datetime: rep.actual_installation_date || rep.actual_completion_datetime,
      });
      knownChecklistIds.add(chkId);
    }
  }

  // 4. Fetch completion report items from DB
  let dbReportItems = [];
  try {
    const { data: itemData, error } = await supabase
      .from('technical_installation_report_items')
      .select('*');
    if (!error && Array.isArray(itemData)) {
      dbReportItems = itemData;
    }
  } catch (err) {
    // Ignore
  }

  const itemsByReportId = new Map();
  const itemsByChecklistId = new Map();
  dbReportItems.forEach((it) => {
    if (it.report_id) {
      if (!itemsByReportId.has(it.report_id)) itemsByReportId.set(it.report_id, []);
      itemsByReportId.get(it.report_id).push(it);
    }
    if (it.checklist_id) {
      if (!itemsByChecklistId.has(it.checklist_id)) itemsByChecklistId.set(it.checklist_id, []);
      itemsByChecklistId.get(it.checklist_id).push(it);
    }
  });

  // 5. Fetch additional customer installations (extra device installations for another customer)
  let dbExtraInstallations = [];
  try {
    const { data: extraData, error } = await supabase
      .from('additional_customer_installations')
      .select('*');
    if (!error && Array.isArray(extraData)) {
      dbExtraInstallations = extraData;
    }
  } catch (err) {
    // Ignore
  }

  const allExtraInstallations = [...dbExtraInstallations];
  for (const [, list] of inMemoryAdditionalInstallations.entries()) {
    if (Array.isArray(list)) {
      list.forEach((extra) => {
        if (!allExtraInstallations.some((e) => e.id && e.id === extra.id)) {
          allExtraInstallations.push(extra);
        }
      });
    }
  }

  // 6. Process completed installations
  const completedInstallationsByTech = new Map(); // techKey -> Array of installation objects
  const processedChecklistIds = new Set();
  const processedExtraInstallationIds = new Set();

  for (const chk of allChecklists) {
    if (processedChecklistIds.has(chk.id)) continue;

    const report = reportsByChecklistId.get(chk.id);

    // Exclusion Criterion: Exclude assigned, in-progress, cancelled, failed, and incomplete installations
    const instStatus = (chk.installation_status || '').toLowerCase();
    const repStatus = (report?.completion_status || '').toLowerCase();

    const isSuccessfullyCompleted =
      instStatus === 'completed' ||
      repStatus === 'completed' ||
      repStatus === 'site work completed';

    if (!isSuccessfullyCompleted) {
      continue;
    }

    // Accurate completion date recorded by Post-Installation Form in Asia/Kolkata
    const actualCompletionDate =
      report?.actual_installation_date ||
      report?.actual_completion_datetime ||
      report?.submitted_at ||
      chk?.actual_completion_datetime ||
      chk?.actual_installation_date ||
      report?.created_at;

    const completionDateKolkata = toKolkataDateString(actualCompletionDate);
    if (!completionDateKolkata) {
      continue;
    }

    // Inclusive reporting period check [startDate, endDate]
    if (completionDateKolkata < startDate || completionDateKolkata > endDate) {
      continue;
    }

    processedChecklistIds.add(chk.id);

    // Technician attribution
    const techName = (chk.service_engineer || chk.technician_name || report?.technician_name || 'Unassigned').trim();

    // Devices installed for the original customer
    let reportItems = report?.items || report?.device_items || [];
    if (reportItems.length === 0 && report?.id && itemsByReportId.has(report.id)) {
      reportItems = itemsByReportId.get(report.id);
    }
    if (reportItems.length === 0 && itemsByChecklistId.has(chk.id)) {
      reportItems = itemsByChecklistId.get(chk.id);
    }

    // Group & aggregate identical device types for this installation
    const deviceMap = new Map();

    for (const item of reportItems) {
      const qtyInstalled = Number(item.quantity_installed) || 0;
      // Strict rule: Only count actual confirmed installed devices (never Sales-required, carried, returned, or damaged)
      if (qtyInstalled > 0) {
        const rawDeviceType = item.device_type || item.item_name || 'Device';
        const cur = deviceMap.get(rawDeviceType) || 0;
        deviceMap.set(rawDeviceType, cur + qtyInstalled);
      }
    }

    // Include loose backup items used for ORIGINAL_CUSTOMER
    const backupItems = report?.backup_items || [];
    for (const b of backupItems) {
      const usedQty = Number(b.quantity_used) || 0;
      if (usedQty > 0) {
        const bName = b.item_name || b.material_name || 'Device';
        if (isDeviceItem(bName, b.category)) {
          const cur = deviceMap.get(bName) || 0;
          deviceMap.set(bName, cur + usedQty);
        }
      }
    }

    // Fallback: If no Post-Installation Form items were recorded but checklist was marked completed (Installation jobs only)
    const isServiceJob = (chk.installation_or_service || 'Installation') === 'Service';
    if (deviceMap.size === 0 && chk.device_type && !report && !isServiceJob) {
      const devCount = Number(chk.device_count || chk.quantity || 1);
      deviceMap.set(chk.device_type, devCount);
    }

    const deviceRows = Array.from(deviceMap.entries()).map(([deviceType, quantity]) => ({
      device_type: deviceType,
      deviceType,
      quantity,
    }));

    const totalDevicesInThisJob = deviceRows.reduce((sum, d) => sum + d.quantity, 0);

    const clientName = (chk.client_name || report?.client_name || '').trim() || 'Not recorded';
    const loc = (chk.client_location || chk.installation_location || report?.installation_location || report?.location || chk.location || chk.district || chk.address || '').trim() || 'Not recorded';
    const mapsLink = chk.google_maps_location || chk.google_maps_link || report?.google_maps_link || report?.maps_link || chk.maps_link || null;

    const installationObj = {
      checklist_id: chk.id,
      checklistId: chk.id,
      checklist_number: chk.checklist_number || `CHK-${String(chk.id).slice(0, 8)}`,
      checklistNumber: chk.checklist_number || `CHK-${String(chk.id).slice(0, 8)}`,
      job_type: chk.installation_or_service || 'Installation',
      jobType: chk.installation_or_service || 'Installation',
      client_name: clientName,
      clientName: clientName,
      installed_date: formatKolkataDateDisplay(completionDateKolkata),
      installedDate: formatKolkataDateDisplay(completionDateKolkata),
      installed_date_raw: completionDateKolkata,
      installedDateRaw: completionDateKolkata,
      installation_location: loc,
      installationLocation: loc,
      location: loc,
      google_maps_link: mapsLink,
      googleMapsLink: mapsLink,
      devices: deviceRows,
      total_devices_installed: totalDevicesInThisJob,
      totalDevicesInstalled: totalDevicesInThisJob,
      is_additional_customer: false,
    };

    const techKey = techName.toLowerCase();
    if (!completedInstallationsByTech.has(techKey)) {
      completedInstallationsByTech.set(techKey, []);
    }
    completedInstallationsByTech.get(techKey).push(installationObj);
  }

  // 7. Process extra device installations completed for another customer
  for (const extra of allExtraInstallations) {
    const extraId = extra.id || `extra-${extra.checklist_id}-${extra.recipient_customer_name || extra.customer_name}`;
    if (processedExtraInstallationIds.has(extraId)) continue;

    // Check date in Asia/Kolkata
    const extraDateRaw = extra.installation_date || extra.installed_date || extra.created_at;
    const extraDateKolkata = toKolkataDateString(extraDateRaw);
    if (!extraDateKolkata) continue;

    if (extraDateKolkata < startDate || extraDateKolkata > endDate) {
      continue;
    }

    // Determine technician
    let extraTech = extra.service_engineer || extra.technician_name;
    if (!extraTech && extra.checklist_id) {
      const parentChk = allChecklists.find((c) => c.id === extra.checklist_id);
      extraTech = parentChk?.service_engineer || parentChk?.technician_name;
    }
    extraTech = (extraTech || 'Unassigned').trim();

    processedExtraInstallationIds.add(extraId);

    // Extract device components installed
    const devMap = new Map();
    const comps = extra.components || extra.components_used || extra.devices || [];
    for (const c of comps) {
      const q = Number(c.quantity_installed ?? c.quantity) || 0;
      if (q > 0) {
        const dType = c.component_name || c.device_type || c.name || 'Device';
        devMap.set(dType, (devMap.get(dType) || 0) + q);
      }
    }

    if (devMap.size === 0 && extra.device_type) {
      devMap.set(extra.device_type, Number(extra.quantity || 1));
    }

    const deviceRows = Array.from(devMap.entries()).map(([deviceType, quantity]) => ({
      device_type: deviceType,
      deviceType,
      quantity,
    }));

    const totalDev = deviceRows.reduce((sum, d) => sum + d.quantity, 0);
    const clientName = (extra.recipient_customer_name || extra.customer_name || 'Additional Customer').trim() || 'Not recorded';
    const loc = (extra.installation_location || extra.location || '').trim() || 'Not recorded';
    const mapsLink = extra.google_maps_link || extra.maps_link || null;

    const extraInstallationObj = {
      checklist_id: extraId,
      checklistId: extraId,
      checklist_number: extra.recipient_checklist_number || extra.checklist_number || 'Extra Installation',
      checklistNumber: extra.recipient_checklist_number || extra.checklist_number || 'Extra Installation',
      client_name: clientName,
      clientName,
      installed_date: formatKolkataDateDisplay(extraDateKolkata),
      installedDate: formatKolkataDateDisplay(extraDateKolkata),
      installed_date_raw: extraDateKolkata,
      installedDateRaw: extraDateKolkata,
      installation_location: loc,
      installationLocation: loc,
      location: loc,
      google_maps_link: mapsLink,
      googleMapsLink: mapsLink,
      devices: deviceRows,
      total_devices_installed: totalDev,
      totalDevicesInstalled: totalDev,
      is_additional_customer: true,
      original_checklist_id: extra.checklist_id || extra.original_checklist_id || null,
    };

    const techKey = extraTech.toLowerCase();
    if (!completedInstallationsByTech.has(techKey)) {
      completedInstallationsByTech.set(techKey, []);
    }
    completedInstallationsByTech.get(techKey).push(extraInstallationObj);
  }

  // 8. Group by technician (dynamic engineers + historical records)
  const allEngineersMap = new Map();

  serviceEngineersList.forEach((eng) => {
    allEngineersMap.set(eng.name.toLowerCase(), {
      id: eng.id,
      name: eng.name,
      is_active: eng.is_active !== false,
    });
  });

  // Ensure Core 4 engineers exist
  AUTHORIZED_SERVICE_ENGINEERS.forEach((name) => {
    if (!allEngineersMap.has(name.toLowerCase())) {
      allEngineersMap.set(name.toLowerCase(), {
        id: `eng-${name.toLowerCase()}`,
        name,
        is_active: true,
      });
    }
  });

  // Add any historical/inactive technician who has installations in this period
  for (const techKey of completedInstallationsByTech.keys()) {
    if (!allEngineersMap.has(techKey) && techKey !== 'unassigned') {
      const origName = completedInstallationsByTech.get(techKey)[0]?.service_engineer || techKey;
      allEngineersMap.set(techKey, {
        id: `eng-${techKey}`,
        name: origName.charAt(0).toUpperCase() + origName.slice(1),
        is_active: false,
      });
    }
  }

  // Sort technicians: Core 4 first, then other active, then historical, then Unassigned (if any)
  const sortedTechList = Array.from(allEngineersMap.values()).sort((a, b) => {
    const idxA = AUTHORIZED_SERVICE_ENGINEERS.indexOf(a.name);
    const idxB = AUTHORIZED_SERVICE_ENGINEERS.indexOf(b.name);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  if (completedInstallationsByTech.has('unassigned') && completedInstallationsByTech.get('unassigned').length > 0) {
    sortedTechList.push({
      id: 'eng-unassigned',
      name: 'Unassigned Recipient',
      is_active: false,
    });
  }

  let grandTotalCompletedInstallations = 0;
  let grandTotalDevicesInstalled = 0;

  const technicianGroups = sortedTechList.map((eng) => {
    const techKey = eng.name.toLowerCase();
    const installations = completedInstallationsByTech.get(techKey) || [];

    // Sort installations by date descending, then assign serial numbers: 1, 2, 3...
    installations.sort((a, b) => (b.installed_date_raw || '').localeCompare(a.installed_date_raw || ''));
    installations.forEach((inst, idx) => {
      inst.serial_number = idx + 1;
      inst.serialNumber = idx + 1;
    });

    const totalDevicesForTech = installations.reduce((sum, inst) => sum + inst.total_devices_installed, 0);

    grandTotalCompletedInstallations += installations.length;
    grandTotalDevicesInstalled += totalDevicesForTech;

    return {
      technician_id: eng.id,
      technicianId: eng.id,
      technician_name: eng.name,
      technicianName: eng.name,
      is_active: eng.is_active,
      isActive: eng.is_active,
      completed_installations_count: installations.length,
      completedInstallationsCount: installations.length,
      total_devices_installed: totalDevicesForTech,
      totalDevicesInstalled: totalDevicesForTech,
      has_installations: installations.length > 0,
      hasInstallations: installations.length > 0,
      installations,
    };
  });

  return {
    summary: {
      total_completed_installations: grandTotalCompletedInstallations,
      total_devices_installed: grandTotalDevicesInstalled,
      active_technicians_count: sortedTechList.filter((t) => t.is_active).length,
      reporting_period: {
        start_date: startDate,
        end_date: endDate,
        formatted_range: formatWeekRangeDisplay(startDate, endDate),
        timezone: 'Asia/Kolkata',
      },
      // camelCase aliases
      totalCompletedInstallations: grandTotalCompletedInstallations,
      totalDevicesInstalled: grandTotalDevicesInstalled,
      activeTechniciansCount: sortedTechList.filter((t) => t.is_active).length,
    },
    technicians: technicianGroups,
  };
}

/**
 * Generate Complete Authoritative Weekly Stock Maintenance Report
 */
export async function generateWeeklyStockReport({
  startDate: inputStartDate,
  endDate: inputEndDate,
  user,
} = {}) {
  // 1. Resolve date boundaries in Asia/Kolkata
  let targetStart = inputStartDate;
  let targetEnd = inputEndDate;

  if (!targetStart || !targetEnd) {
    const defaultRange = getPreviousCompletedWeek();
    targetStart = defaultRange.startDate;
    targetEnd = defaultRange.endDate;
  }

  const { startDate, endDate, startUtcIso, endUtcIso } = getWeekUtcBoundaries(targetStart, targetEnd);

  // 2. Build the Technician-Wise Installation Report
  const technicianInstallationReport = await getTechnicianWiseInstallationReport({
    startDate,
    endDate,
  });

  // 3. Fetch physical inventory items for summary preservation in JSON
  const rawMaterials = await getMaterialInventory();
  const physicalItems = ACTIVE_REQUIRED_MATERIALS_ORDER.map((name) => {
    const matched = rawMaterials.find((m) => m.material_name.toLowerCase() === name.toLowerCase());
    return (
      matched || {
        id: `mat-${name.toLowerCase().replace(/\s+/g, '-')}`,
        material_name: name,
        sku: `MAT-${name.toUpperCase().replace(/\s+/g, '-')}`,
        category: ['Camera', 'Live Display', 'Recording Display'].includes(name) ? 'Camera Device' : 'Installation Material',
        unit: name.includes('Wire') ? 'Metres' : name.includes('Tie') ? 'Packets' : 'Nos.',
        current_stock: 0,
        opening_stock: 0,
        min_stock_level: name.includes('Screw') ? 50 : 10,
      }
    );
  });

  // 4. Stock Movements for physical summary (Strictly within the 60-day retention window)
  const RETENTION_DAYS = 60;
  const sixtyDaysCutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const sixtyDaysCutoffIso = new Date(sixtyDaysCutoffTime).toISOString();
  const isPeriodBeyondRetention = new Date(startUtcIso).getTime() < sixtyDaysCutoffTime;
  const retentionNotice = isPeriodBeyondRetention
    ? 'Notice: The selected report period extends beyond the 60-day stock movement retention window. Detailed movements prior to ' +
      sixtyDaysCutoffIso.split('T')[0] +
      ' have been automatically pruned per SafDrive retention policy. Current inventory quantities remain authoritative.'
    : 'Stock movement history is retained for 60 days. Older records are automatically removed.';

  let allMovements = [];
  try {
    const { data: dbMovements, error } = await supabase
      .from('stock_movements')
      .select('*')
      .gte('created_at', sixtyDaysCutoffIso)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(dbMovements)) {
      allMovements = dbMovements;
    }
  } catch (err) {
    console.warn('DB stock_movements fetch error in weekly report:', err.message);
  }

  for (const m of inMemoryStockMovements) {
    if (m.created_at && new Date(m.created_at).getTime() >= sixtyDaysCutoffTime) {
      if (!allMovements.some((existing) => existing.id === m.id)) {
        allMovements.push(m);
      }
    }
  }
  allMovements.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  const weekMovements = allMovements.filter((m) => {
    const t = new Date(m.created_at).getTime();
    return t >= new Date(startUtcIso).getTime() && t < new Date(endUtcIso).getTime();
  });

  const physicalStockSummary = [];
  let totalSummaryOpening = 0;
  let totalSummaryAdded = 0;
  let totalSummaryIssued = 0;
  let totalSummaryReturned = 0;
  let totalSummaryAdjustments = 0;
  let totalSummaryClosing = 0;

  for (let idx = 0; idx < physicalItems.length; idx++) {
    const item = physicalItems[idx];
    const itemName = item.material_name;
    const itemKey = itemName.toLowerCase();

    const itemMovementsAll = allMovements.filter((m) => (m.item_name || '').toLowerCase() === itemKey);
    const itemMovementsBeforeWeek = itemMovementsAll.filter(
      (m) => new Date(m.created_at).getTime() < new Date(startUtcIso).getTime()
    );
    const itemMovementsInWeek = itemMovementsAll.filter((m) => {
      const t = new Date(m.created_at).getTime();
      return t >= new Date(startUtcIso).getTime() && t < new Date(endUtcIso).getTime();
    });

    let openingStock = 0;
    if (itemMovementsBeforeWeek.length > 0) {
      const lastBefore = itemMovementsBeforeWeek[itemMovementsBeforeWeek.length - 1];
      if (lastBefore.balance_after !== null && lastBefore.balance_after !== undefined) {
        openingStock = Number(lastBefore.balance_after);
      }
    } else if (itemMovementsInWeek.length > 0) {
      const firstInWeek = itemMovementsInWeek[0];
      if (firstInWeek.balance_before !== null && firstInWeek.balance_before !== undefined) {
        openingStock = Number(firstInWeek.balance_before);
      }
    } else {
      openingStock = Number(item.current_stock) || 0;
    }

    let stockAdded = 0;
    let stockIssued = 0;
    let stockReturned = 0;
    let adjustmentsNet = 0;

    for (const mov of itemMovementsInWeek) {
      const qty = Number(mov.quantity) || 0;
      const type = (mov.movement_type || mov.transaction_type || '').toUpperCase();
      if (type === 'STOCK_RECEIVED' || type === 'OPENING_STOCK') {
        stockAdded += qty;
      } else if (type === 'STOCK_ISSUED' || type === 'COURIER_DISPATCH' || type === 'COURIER_DISPATCHED' || type === 'SERVICE_DEVICE_ISSUED' || type === 'SERVICE_MATERIAL_ISSUED') {
        stockIssued += qty;
      } else if (type === 'USABLE_STOCK_RETURNED' || type === 'RETURNED_USABLE') {
        stockReturned += qty;
      } else if (type === 'STOCK_ADJUSTMENT') {
        adjustmentsNet += qty;
      }
    }

    const closingStock = openingStock + stockAdded + stockReturned - stockIssued + adjustmentsNet;

    totalSummaryOpening += openingStock;
    totalSummaryAdded += stockAdded;
    totalSummaryIssued += stockIssued;
    totalSummaryReturned += stockReturned;
    totalSummaryAdjustments += adjustmentsNet;
    totalSummaryClosing += closingStock;

    physicalStockSummary.push({
      index: idx + 1,
      id: item.id,
      item_id: item.id,
      name: itemName,
      item_name: itemName,
      sku: item.sku || `MAT-${itemName.toUpperCase()}`,
      unit: item.unit || 'Nos.',
      opening_stock: openingStock,
      openingStock,
      stock_added: stockAdded,
      stockAdded,
      issued: stockIssued,
      returned: stockReturned,
      adjustments: adjustmentsNet,
      closing_stock: closingStock,
      closingStock,
      is_historical_pruned: isPeriodBeyondRetention && itemMovementsBeforeWeek.length === 0,
    });
  }

  // Compile final structured report with clean metadata and Technician-Wise Installation Report
  return {
    report_metadata: {
      title: 'WEEKLY STOCK MAINTENANCE REPORT',
      company_name: 'EAGLE EYE SAFDRIVE PVT LTD',
      report_period: {
        start_date: startDate,
        end_date: endDate,
        formatted_range: formatWeekRangeDisplay(startDate, endDate),
        day_range_label: 'Monday – Sunday',
        timezone: 'Asia/Kolkata',
        is_beyond_retention_window: isPeriodBeyondRetention,
        retention_window_days: RETENTION_DAYS,
      },
      retention_notice: retentionNotice,
      generated_at: new Date().toISOString(),
      generated_at_formatted: formatKolkataDateTime(new Date()),
      generated_by: {
        id: user?.id || null,
        name: user?.full_name || user?.name || user?.email || 'Store Manager',
        email: user?.email || 'store@eagleeyesafdrive.com',
        role: user?.role || 'STORE_MANAGER',
      },
    },
    technician_installation_report: technicianInstallationReport,
    technicianInstallationReport,

    summary_kpis: {
      total_completed_installations: technicianInstallationReport.summary.total_completed_installations,
      total_devices_installed: technicianInstallationReport.summary.total_devices_installed,
      total_physical_items: physicalItems.length,
      total_opening_stock: totalSummaryOpening,
      total_stock_added: totalSummaryAdded,
      total_stock_issued: totalSummaryIssued,
      total_stock_returned: totalSummaryReturned,
      total_adjustments_net: totalSummaryAdjustments,
      total_closing_stock: totalSummaryClosing,
    },

    // Preserved for JSON consumers
    physical_stock_summary: physicalStockSummary,
    stockSummary: physicalStockSummary,

    // camelCase aliases
    reportPeriod: {
      startDate,
      endDate,
      formattedRange: formatWeekRangeDisplay(startDate, endDate),
      dayRangeLabel: 'Monday – Sunday',
      timezone: 'Asia/Kolkata',
    },
    metadata: {
      title: 'WEEKLY STOCK MAINTENANCE REPORT',
      companyName: 'EAGLE EYE SAFDRIVE PVT LTD',
      generatedOn: formatKolkataDateTime(new Date()),
      generatedBy: `${user?.full_name || user?.name || 'Store Manager'} (${user?.email || 'store@safdrive.com'})`,
    },
  };
}

