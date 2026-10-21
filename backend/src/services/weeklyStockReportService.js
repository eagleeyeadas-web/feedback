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
  inMemoryReturns,
  inMemoryMaterialReturns,
  inMemoryCompletionReports,
} from './workflowService.js';

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
 * Generate Complete Authoritative Weekly Stock Report
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

  // 2. Fetch authoritative physical inventory products & loose materials
  const rawMaterials = await getMaterialInventory();
  // Filter active physical items matching canonical order or active status
  const physicalItems = ACTIVE_REQUIRED_MATERIALS_ORDER.map((name) => {
    const matched = rawMaterials.find((m) => m.material_name.toLowerCase() === name.toLowerCase());
    return matched || {
      id: `mat-${name.toLowerCase().replace(/\s+/g, '-')}`,
      material_name: name,
      sku: `MAT-${name.toUpperCase().replace(/\s+/g, '-')}`,
      category: ['Camera', 'Live Display', 'Recording Display'].includes(name) ? 'Camera Device' : 'Installation Material',
      unit: name.includes('Wire') ? 'Metres' : (name.includes('Tie') ? 'Packets' : 'Nos.'),
      current_stock: 0,
      opening_stock: 0,
      min_stock_level: name.includes('Screw') ? 50 : 10,
    };
  });

  // 3. Fetch all stock movements (Supabase with in-memory fallback)
  let allMovements = [];
  try {
    const { data: dbMovements, error } = await supabase
      .from('stock_movements')
      .select('*')
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(dbMovements)) {
      allMovements = dbMovements;
    }
  } catch (err) {
    console.warn('DB stock_movements fetch error in weekly report:', err.message);
  }

  // Merge with in-memory fallback if any missing
  for (const m of inMemoryStockMovements) {
    if (!allMovements.some((existing) => existing.id === m.id)) {
      allMovements.push(m);
    }
  }
  // Sort chronologically ascending
  allMovements.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  // 4. Fetch related installation checklists to enrich technician details and checklist numbers
  let allChecklists = [];
  try {
    const { data: dbChecklists, error } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, client_name, service_engineer, delivery_method, installation_status, material_issuance_status, created_at');

    if (!error && Array.isArray(dbChecklists)) {
      allChecklists = dbChecklists;
    }
  } catch (err) {
    console.warn('DB checklists fetch error in weekly report:', err.message);
  }
  const checklistMap = new Map(allChecklists.map((c) => [c.id, c]));

  // 5. Fetch returns (devices and materials) for reconciliation
  let allDeviceReturns = [];
  try {
    const { data: dbDevRet } = await supabase.from('job_device_returns').select('*');
    if (Array.isArray(dbDevRet)) allDeviceReturns = dbDevRet;
  } catch (e) {}
  for (const [id, r] of inMemoryReturns.entries()) {
    if (!allDeviceReturns.some((existing) => existing.id === id)) {
      allDeviceReturns.push(r);
    }
  }

  let allMaterialReturns = [];
  try {
    const { data: dbMatRet } = await supabase.from('job_material_returns').select('*');
    if (Array.isArray(dbMatRet)) allMaterialReturns = dbMatRet;
  } catch (e) {}
  for (const [id, r] of inMemoryMaterialReturns.entries()) {
    if (!allMaterialReturns.some((existing) => existing.id === id)) {
      allMaterialReturns.push(r);
    }
  }

  // 6. Filter movements strictly within reporting week
  const weekMovements = allMovements.filter((m) => {
    const t = new Date(m.created_at).getTime();
    return t >= new Date(startUtcIso).getTime() && t < new Date(endUtcIso).getTime();
  });

  // Track deduplicated movements to prevent double-counting of linked courier dispatch / adjustments
  const processedMovementIds = new Set();
  const processedCourierChecklistKeys = new Set();

  // ============================================================
  // SECTION 1: WEEKLY PHYSICAL STOCK SUMMARY
  // ============================================================
  const physicalStockSummary = [];
  let totalSummaryOpening = 0;
  let totalSummaryAdded = 0;
  let totalSummaryIssued = 0;
  let totalSummaryReturned = 0;
  let totalSummaryAdjustments = 0;
  let totalSummaryClosing = 0;
  let varianceCount = 0;
  let lowStockCount = 0;

  for (let idx = 0; idx < physicalItems.length; idx++) {
    const item = physicalItems[idx];
    const itemName = item.material_name;
    const itemKey = itemName.toLowerCase();

    // Movements for this specific physical item
    const itemMovementsAll = allMovements.filter(
      (m) => (m.item_name || '').toLowerCase() === itemKey
    );
    const itemMovementsBeforeWeek = itemMovementsAll.filter(
      (m) => new Date(m.created_at).getTime() < new Date(startUtcIso).getTime()
    );
    const itemMovementsInWeek = itemMovementsAll.filter((m) => {
      const t = new Date(m.created_at).getTime();
      return t >= new Date(startUtcIso).getTime() && t < new Date(endUtcIso).getTime();
    });

    // --- Calculate Opening Stock ---
    let openingStock = 0;
    let hasHistoricalOpening = false;

    if (itemMovementsBeforeWeek.length > 0) {
      // Last movement before start of Monday provides exact balance_after
      const lastBefore = itemMovementsBeforeWeek[itemMovementsBeforeWeek.length - 1];
      if (lastBefore.balance_after !== null && lastBefore.balance_after !== undefined) {
        openingStock = Number(lastBefore.balance_after);
        hasHistoricalOpening = true;
      }
    } else if (itemMovementsInWeek.length > 0) {
      // First movement in week provides exact balance_before
      const firstInWeek = itemMovementsInWeek[0];
      if (firstInWeek.balance_before !== null && firstInWeek.balance_before !== undefined) {
        openingStock = Number(firstInWeek.balance_before);
        hasHistoricalOpening = true;
      }
    }

    if (!hasHistoricalOpening) {
      // Fallback: If no movements occurred before this period, opening is current stock
      // or configured opening stock
      openingStock = Number(item.current_stock) || 0;
    }

    // --- Calculate Movements in the Week ---
    let stockAdded = 0;
    let stockIssued = 0;
    let stockReturned = 0;
    let adjustmentsNet = 0;

    for (const mov of itemMovementsInWeek) {
      const qty = Number(mov.quantity) || 0;
      const type = (mov.movement_type || mov.transaction_type || '').toUpperCase();
      const remarks = (mov.reason_or_remarks || mov.remarks || '').trim();

      // Check for duplicate courier dispatch records
      if (type === 'COURIER_DISPATCH' || type === 'COURIER_DISPATCHED') {
        const courierKey = `courier-${mov.checklist_id}-${itemKey}`;
        if (processedCourierChecklistKeys.has(courierKey)) {
          continue; // Prevent double-counting
        }
        processedCourierChecklistKeys.add(courierKey);
        stockIssued += qty;
        continue;
      }

      // Check for linked stock adjustment from courier dispatch
      if (type === 'STOCK_ADJUSTMENT' && remarks.includes('Courier Dispatch for checklist')) {
        const match = remarks.match(/checklist\s+([A-Z0-9-]+)/i);
        const chkRef = match ? match[1] : (mov.checklist_id || mov.id);
        const courierKey = `courier-${chkRef}-${itemKey}`;
        if (processedCourierChecklistKeys.has(courierKey)) {
          continue; // Already counted via COURIER_DISPATCH record
        }
        processedCourierChecklistKeys.add(courierKey);
        stockIssued += qty;
        continue;
      }

      // Reversals & Voids (Audit only, do not count as normal issuance)
      if (type === 'STOCK_REVERSAL' || remarks.toLowerCase().includes('void') || remarks.toLowerCase().includes('reversal')) {
        // Adjustments handle reversals appropriately
        if (mov.balance_after !== null && mov.balance_before !== null) {
          adjustmentsNet += (Number(mov.balance_after) - Number(mov.balance_before));
        }
        continue;
      }

      if (type === 'STOCK_RECEIVED' || type === 'OPENING_STOCK') {
        stockAdded += qty;
      } else if (type === 'STOCK_ISSUED') {
        stockIssued += qty;
      } else if (type === 'USABLE_STOCK_RETURNED' || type === 'RETURNED_USABLE') {
        stockReturned += qty;
      } else if (type === 'STOCK_ADJUSTMENT') {
        // Net signed adjustment based on recorded balance change or prefix
        if (mov.balance_after !== null && mov.balance_before !== null) {
          adjustmentsNet += (Number(mov.balance_after) - Number(mov.balance_before));
        } else if (remarks.startsWith('[ADD]')) {
          adjustmentsNet += qty;
        } else if (remarks.startsWith('[REMOVE]')) {
          adjustmentsNet -= qty;
        } else {
          adjustmentsNet += qty;
        }
      }
    }

    // --- Calculate Closing Stock ---
    let closingStock = openingStock;
    if (itemMovementsInWeek.length > 0) {
      const lastInWeek = itemMovementsInWeek[itemMovementsInWeek.length - 1];
      if (lastInWeek.balance_after !== null && lastInWeek.balance_after !== undefined) {
        closingStock = Number(lastInWeek.balance_after);
      } else {
        closingStock = openingStock + stockAdded + stockReturned - stockIssued + adjustmentsNet;
      }
    } else {
      closingStock = openingStock;
    }

    // --- Reconciliation Verification ---
    const expectedClosingStock = openingStock + stockAdded + stockReturned - stockIssued + adjustmentsNet;
    const variance = closingStock - expectedClosingStock;
    const isReconciled = variance === 0;
    if (!isReconciled) varianceCount++;

    const minLevel = Number(item.min_stock_level) || 0;
    const isLowStock = minLevel > 0 && closingStock <= minLevel;
    if (isLowStock) lowStockCount++;

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
      category: item.category || 'Installation Material',
      type: ['Camera', 'Live Display', 'Recording Display'].includes(itemName) ? 'DEVICE' : 'MATERIAL',
      unit: item.unit || 'Nos.',
      opening_stock: openingStock,
      openingStock: openingStock,
      stock_added: stockAdded,
      stockAdded: stockAdded,
      issued: stockIssued,
      returned: stockReturned,
      adjustments: adjustmentsNet,
      closing_stock: closingStock,
      closingStock: closingStock,
      expected_closing_stock: expectedClosingStock,
      expectedClosing: expectedClosingStock,
      variance,
      is_reconciled: isReconciled,
      min_stock_level: minLevel,
      minStock: minLevel,
      is_low_stock: isLowStock,
      is_out_of_stock: closingStock === 0,
      has_historical_opening: hasHistoricalOpening,
    });
  }

  // ============================================================
  // SECTION 2: DETAILED STOCK MOVEMENT HISTORY
  // ============================================================
  const stockMovementHistory = weekMovements.map((mov, i) => {
    const chk = mov.checklist_id ? checklistMap.get(mov.checklist_id) : null;
    const checklistNo = chk?.checklist_number || (mov.checklist_id ? `CHK-${String(mov.checklist_id).slice(0, 8)}` : '—');
    const recipient = chk?.service_engineer || mov.performer_name || '—';
    const movType = mov.movement_type || mov.transaction_type || 'STOCK_ADJUSTMENT';

    const isReversal = movType === 'STOCK_REVERSAL' ||
      (mov.reason_or_remarks || '').toLowerCase().includes('reversal') ||
      (mov.reason_or_remarks || '').toLowerCase().includes('void');

    const dtFormatted = formatKolkataDateTime(mov.created_at);
    const performer = mov.performer_name || mov.performer_email || 'Store Manager';
    const remarks = mov.reason_or_remarks || '—';
    const qty = Number(mov.quantity) || 0;
    const unit = mov.unit || 'Nos.';
    const balBefore = mov.balance_before !== null && mov.balance_before !== undefined ? Number(mov.balance_before) : '—';
    const balAfter = mov.balance_after !== null && mov.balance_after !== undefined ? Number(mov.balance_after) : '—';

    return {
      index: i + 1,
      id: mov.id,
      created_at: mov.created_at,
      date: mov.created_at,
      date_time: dtFormatted,
      dateTime: dtFormatted,
      date_time_formatted: dtFormatted,
      item_name: mov.item_name,
      itemName: mov.item_name,
      sku: mov.sku || '—',
      category: mov.category,
      movement_type: movType,
      type: movType,
      type_label: formatMovementTypeLabel(movType),
      quantity: qty,
      unit,
      balance_before: balBefore,
      balanceBefore: balBefore,
      balance_after: balAfter,
      balanceAfter: balAfter,
      technician_recipient: recipient,
      technician_name: recipient,
      technicianName: recipient,
      checklist_number: checklistNo,
      checklistNumber: checklistNo,
      checklist_id: mov.checklist_id || null,
      performed_by_name: performer,
      performed_by: performer,
      performedBy: performer,
      remarks,
      is_reversal: isReversal,
      is_void: isReversal,
      isVoid: isReversal,
    };
  });

  // ============================================================
  // SECTION 3: TECHNICIAN-WISE MATERIAL ISSUANCE SUMMARY
  // ============================================================
  // Groups: Mathi, Guna, Sakthivel, Kamalesh, Unassigned Recipient
  const technicianGroupsMap = new Map();
  AUTHORIZED_SERVICE_ENGINEERS.forEach((name) => {
    technicianGroupsMap.set(name.toLowerCase(), {
      engineer_name: name,
      is_unassigned: false,
      transactions: [],
      item_totals_map: new Map(),
    });
  });
  technicianGroupsMap.set('unassigned', {
    engineer_name: 'Unassigned Recipient',
    is_unassigned: true,
    transactions: [],
    item_totals_map: new Map(),
  });

  for (const mov of weekMovements) {
    const type = (mov.movement_type || mov.transaction_type || '').toUpperCase();
    if (type !== 'STOCK_ISSUED' && type !== 'COURIER_DISPATCH' && type !== 'COURIER_DISPATCHED') {
      continue;
    }

    const chk = mov.checklist_id ? checklistMap.get(mov.checklist_id) : null;
    const assignedEng = (chk?.service_engineer || '').trim();

    let targetGroup = technicianGroupsMap.get('unassigned');
    if (assignedEng) {
      const matched = AUTHORIZED_SERVICE_ENGINEERS.find((e) => e.toLowerCase() === assignedEng.toLowerCase());
      if (matched) {
        targetGroup = technicianGroupsMap.get(matched.toLowerCase());
      }
    }

    const qty = Number(mov.quantity) || 0;
    const unit = mov.unit || 'Nos.';
    const itemName = mov.item_name || 'Material';
    const dtFormatted = formatKolkataDateTime(mov.created_at);
    const issuedBy = mov.performer_name || 'Store Manager';
    const chkNumber = chk?.checklist_number || '—';

    targetGroup.transactions.push({
      id: mov.id,
      created_at: mov.created_at,
      date_time_formatted: dtFormatted,
      dateTime: dtFormatted,
      checklist_number: chkNumber,
      checklistNumber: chkNumber,
      item_name: itemName,
      itemName,
      quantity: qty,
      unit,
      issued_by: issuedBy,
      issuedBy,
      remarks: mov.reason_or_remarks || '—',
    });

    // Group item totals (preserve incompatible units!)
    const totalKey = `${itemName}__${unit}`;
    const curTotal = targetGroup.item_totals_map.get(totalKey) || {
      name: itemName,
      item_name: itemName,
      quantity: 0,
      unit,
    };
    curTotal.quantity += qty;
    targetGroup.item_totals_map.set(totalKey, curTotal);
  }

  const technicianIssuanceSummary = Array.from(technicianGroupsMap.values()).map((g) => {
    const itemTotalsList = Array.from(g.item_totals_map.values());
    const uniqueChecklists = new Set(
      g.transactions.map((t) => t.checklist_number).filter((c) => c && c !== '—')
    );

    return {
      engineer_name: g.engineer_name,
      technician_name: g.engineer_name,
      technicianName: g.engineer_name,
      is_unassigned: g.is_unassigned,
      total_transactions: g.transactions.length,
      item_totals: itemTotalsList,
      itemTotals: itemTotalsList,
      transactions: g.transactions,
      issuances: g.transactions,
      unique_checklist_count: uniqueChecklists.size,
      uniqueChecklistCount: uniqueChecklists.size,
    };
  });

  // ============================================================
  // SECTION 4: MATERIAL USAGE AND RETURN RECONCILIATION
  // ============================================================
  const materialReconciliation = [];
  // For each material, reconcile: Issued, Used (from Completion), Declared Returned, Store Verified Usable, Awaiting, Damaged
  const installationMaterialsOnly = physicalItems.filter(
    (item) => !['Camera', 'Live Display', 'Recording Display'].includes(item.material_name)
  );

  for (const mat of installationMaterialsOnly) {
    const matName = mat.material_name;
    const isScrew = matName.toLowerCase().includes('screw');

    // Issued quantity during this week
    const summaryItem = physicalStockSummary.find((s) => s.item_name === matName);
    const qtyIssued = summaryItem ? summaryItem.issued : 0;

    // Returns for this material verified/declared in the reporting week
    let declaredReturned = 0;
    let verifiedAcceptedUsable = 0;
    let awaitingVerification = 0;
    let damagedOrMissing = 0;

    for (const r of allMaterialReturns) {
      if ((r.material_name || '').toLowerCase() === matName.toLowerCase()) {
        const createdTime = new Date(r.declared_at || r.created_at || 0).getTime();
        const inWeek = createdTime >= new Date(startUtcIso).getTime() && createdTime < new Date(endUtcIso).getTime();

        if (inWeek) {
          const dec = Number(r.declared_return_qty) || 0;
          const usable = Number(r.accepted_usable_qty) || 0;
          const dmg = (Number(r.damaged_qty) || 0) + (Number(r.missing_qty) || 0);

          declaredReturned += dec;
          if (r.status === 'PENDING_STORE_VERIFICATION') {
            awaitingVerification += dec;
          } else {
            verifiedAcceptedUsable += usable;
            damagedOrMissing += dmg;
          }
        }
      }
    }

    // Material usage from completion reports in the week
    let qtyUsed = 0;
    let usageTracked = false;
    for (const chk of allChecklists) {
      const chkTime = new Date(chk.created_at || 0).getTime();
      const inWeek = chkTime >= new Date(startUtcIso).getTime() && chkTime < new Date(endUtcIso).getTime();
      if (inWeek) {
        const compRep = inMemoryCompletionReports.get(chk.id);
        const usedItems = compRep?.material_items || chk.actual_materials_used || [];
        const matchedUsed = usedItems.find((u) => (u.material_name || '').toLowerCase() === matName.toLowerCase());
        if (matchedUsed && matchedUsed.quantity_used !== undefined) {
          qtyUsed += Number(matchedUsed.quantity_used) || 0;
          usageTracked = true;
        }
      }
    }

    materialReconciliation.push({
      name: matName,
      item_name: matName,
      unit: mat.unit || 'Nos.',
      issued: qtyIssued,
      quantity_issued: qtyIssued,
      used: usageTracked ? qtyUsed : 'Not Tracked',
      quantity_used: usageTracked ? qtyUsed : 'Not Tracked',
      reportedReturned: isScrew ? 'Not Tracked' : declaredReturned,
      quantity_declared_returned: isScrew ? 'Not Tracked' : declaredReturned,
      verifiedUsable: isScrew ? 'Not Tracked' : verifiedAcceptedUsable,
      quantity_verified_accepted: isScrew ? 'Not Tracked' : verifiedAcceptedUsable,
      awaitingVerification: isScrew ? 0 : awaitingVerification,
      quantity_awaiting_verification: isScrew ? 0 : awaitingVerification,
      damagedMissing: isScrew ? 0 : damagedOrMissing,
      damaged_or_missing: isScrew ? 0 : damagedOrMissing,
      isScrew,
      notes: isScrew ? 'Non-returnable consumable fitting' : (verifiedAcceptedUsable > 0 ? 'Verified & Credited' : 'Normal Usage'),
    });
  }

  // ============================================================
  // SECTION 5: LOW-STOCK AND ZERO-STOCK ALERTS
  // ============================================================
  const stockAlerts = physicalStockSummary
    .filter((item) => item.min_stock_level > 0 && (item.is_low_stock || item.is_out_of_stock))
    .map((item) => ({
      name: item.item_name,
      item_name: item.item_name,
      category: item.category,
      current_stock: item.closing_stock,
      currentStock: item.closing_stock,
      min_stock_level: item.min_stock_level,
      minStock: item.min_stock_level,
      unit: item.unit,
      status: item.is_out_of_stock ? 'OUT_OF_STOCK' : 'LOW_STOCK',
      severity: item.is_out_of_stock ? 'CRITICAL' : 'WARNING',
      alert_label: item.is_out_of_stock ? 'Zero Stock Alert (Depleted)' : 'Low Stock Warning',
    }));

  // ============================================================
  // SECTION 6: RECONCILIATION VARIANCES & AUDIT
  // ============================================================
  const reconciliationVariances = physicalStockSummary
    .filter((item) => !item.is_reconciled)
    .map((item) => ({
      item_name: item.item_name,
      productName: item.item_name,
      opening_stock: item.opening_stock,
      stock_added: item.stock_added,
      issued: item.issued,
      returned: item.returned,
      adjustments: item.adjustments,
      closing_stock: item.closing_stock,
      expected_closing: item.expected_closing_stock,
      calculatedClosing: item.expected_closing_stock,
      actualLedgerBalance: item.closing_stock,
      variance: item.variance,
      unit: item.unit,
      explanation: `Expected ${item.expected_closing_stock} ${item.unit}, recorded balance is ${item.closing_stock} ${item.unit}. Discrepancy: ${item.variance > 0 ? '+' : ''}${item.variance} ${item.unit}.`,
    }));

  // Compile final structured report with snake_case and camelCase aliases
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
      },
      generated_at: new Date().toISOString(),
      generated_at_formatted: formatKolkataDateTime(new Date()),
      generated_by: {
        id: user?.id || null,
        name: user?.full_name || user?.name || user?.email || 'Store Manager',
        email: user?.email || 'store@eagleeyesafdrive.com',
        role: user?.role || 'STORE_MANAGER',
      },
    },
    summary_kpis: {
      total_physical_items: physicalItems.length,
      total_opening_stock: totalSummaryOpening,
      total_stock_added: totalSummaryAdded,
      total_stock_issued: totalSummaryIssued,
      total_stock_returned: totalSummaryReturned,
      total_adjustments_net: totalSummaryAdjustments,
      total_closing_stock: totalSummaryClosing,
      reconciliation_status: varianceCount === 0 ? 'RECONCILED' : 'VARIANCE_DETECTED',
      variance_count: varianceCount,
      low_stock_count: lowStockCount,
      total_movements_in_period: weekMovements.length,
    },
    physical_stock_summary: physicalStockSummary,
    stock_movement_history: stockMovementHistory,
    technician_issuance_summary: technicianIssuanceSummary,
    material_reconciliation: materialReconciliation,
    stock_alerts: stockAlerts,
    reconciliation_variances: reconciliationVariances,

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
    stockSummary: physicalStockSummary,
    stockMovements: stockMovementHistory,
    technicianIssuance: technicianIssuanceSummary,
    materialReconciliation: materialReconciliation,
    lowStockAlerts: stockAlerts,
    stockReconciliation: {
      isFullyReconciled: varianceCount === 0,
      summary: {
        varianceCount,
        lowStockCount,
      },
      itemsWithVariance: reconciliationVariances,
    },
  };

}

function formatMovementTypeLabel(type) {
  if (!type) return 'Movement';
  switch (type) {
    case 'OPENING_STOCK': return 'Opening Stock';
    case 'STOCK_RECEIVED': return 'Stock Received';
    case 'STOCK_ISSUED': return 'Stock Issued';
    case 'COURIER_DISPATCH':
    case 'COURIER_DISPATCHED': return 'Courier Dispatched';
    case 'STOCK_ADJUSTMENT': return 'Stock Adjustment';
    case 'STOCK_REVERSAL': return 'Stock Reversal';
    case 'USABLE_STOCK_RETURNED':
    case 'RETURNED_USABLE': return 'Usable Return';
    case 'DAMAGED_STOCK_RECEIVED':
    case 'RETURNED_DAMAGED': return 'Damaged Return';
    case 'DAMAGED_STOCK_DISPOSITION': return 'Damaged Disposition';
    default: return type.replace(/_/g, ' ');
  }
}
