import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { getMaterialInventory, adjustMaterialStock } from './materialStockService.js';
import { getInventoryProducts, adjustStock } from './inventoryService.js';
import { isScrewMaterial } from './workflowService.js';
import { recordStockMovement } from './stockMovementService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/backup_items_storage.json');

/**
 * Resilient in-memory store with file backing for loose backup item declarations
 */
export const inMemoryDeclarations = new Map(); // checklist_id -> declaration object
const inMemoryVerifiedReturns = new Set(); // verification keys to prevent duplicate return credits

export function loadBackupItemsStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.declarations && typeof data.declarations === 'object') {
        Object.entries(data.declarations).forEach(([k, v]) => {
          inMemoryDeclarations.set(k, { ...v });
        });
      }
      if (Array.isArray(data.verifiedReturns)) {
        data.verifiedReturns.forEach((key) => inMemoryVerifiedReturns.add(key));
      }
    } else {
      saveBackupItemsStorage();
    }
  } catch (err) {
    console.warn('Could not load backup items storage:', err.message);
  }
}

function saveBackupItemsStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      declarations: Object.fromEntries(inMemoryDeclarations.entries()),
      verifiedReturns: Array.from(inMemoryVerifiedReturns),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save backup items storage:', err.message);
  }
}

// Initial load
loadBackupItemsStorage();

/**
 * Permanently delete backup declarations and items for a deleted checklist
 */
export function deleteBackupDeclarationForChecklist(checklistId) {
  if (inMemoryDeclarations.has(checklistId)) {
    inMemoryDeclarations.delete(checklistId);
    saveBackupItemsStorage();
  }
}

/**
 * Get available loose backup products from both Camera/Device Products and Material Inventory catalogs
 */
export async function getAvailableBackupProducts() {
  try {
    const [materials, devices] = await Promise.all([
      getMaterialInventory().catch(() => []),
      getInventoryProducts().catch(() => []),
    ]);

    // Category A: Camera / Device Products (Complete systems & MDVRs)
    const deviceProducts = (devices || []).map((d) => ({
      id: d.id,
      item_id: d.id,
      product_id: d.id,
      item_name: d.device_name || `${d.device_type} System`,
      display_name: d.device_name || d.device_type,
      device_type: d.device_type,
      sku: d.sku || 'N/A',
      unit: d.unit || 'Nos.',
      category: 'Device Component',
      category_group: 'A',
      item_type: 'DEVICE',
      available_stock: Number(d.usable_stock) || 0,
      current_stock: Number(d.usable_stock) || 0,
      min_stock_level: Number(d.min_stock_level) || 0,
    }));

    const categoryAComponents = [];
    const categoryBMaterials = [];

    (materials || []).forEach((m) => {
      const lower = (m.material_name || '').toLowerCase();
      const isDeviceComp =
        lower.includes('camera') ||
        lower.includes('display') ||
        lower.includes('screen') ||
        lower.includes('mdvr') ||
        lower.includes('sensor');

      const entry = {
        id: m.id,
        item_id: m.id,
        material_id: m.id,
        item_name: m.material_name,
        display_name: m.material_name,
        sku: m.sku || 'N/A',
        unit: m.unit || 'Nos.',
        category: isDeviceComp ? 'Device Component' : 'Installation Material',
        category_group: isDeviceComp ? 'A' : 'B',
        item_type: isDeviceComp ? 'COMPONENT' : 'MATERIAL',
        available_stock: Number(m.current_stock) || 0,
        current_stock: Number(m.current_stock) || 0,
        min_stock_level: Number(m.min_stock_level) || 0,
      };

      if (isDeviceComp) {
        categoryAComponents.push(entry);
        // If loose Display item exists, provide explicit Live Display and Recording Display options for technician selection
        if (lower === 'display') {
          categoryAComponents.push({
            ...entry,
            id: `${m.id}-live-display`,
            canonical_id: m.id,
            item_name: 'Live Display',
            display_name: 'Live Display',
          });
          categoryAComponents.push({
            ...entry,
            id: `${m.id}-recording-display`,
            canonical_id: m.id,
            item_name: 'Recording Display',
            display_name: 'Recording Display',
          });
        }
      } else {
        categoryBMaterials.push(entry);
        if (lower.includes('cable tie') && lower.includes('200')) {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-ct-200mm`,
            canonical_id: m.id,
            item_name: 'Cable Tie 200mm',
            display_name: 'Cable Tie 200mm',
          });
        }
        if (lower.includes('cable tie') && lower.includes('300')) {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-ct-300mm`,
            canonical_id: m.id,
            item_name: 'Cable Tie 300mm',
            display_name: 'Cable Tie 300mm',
          });
        }
        if (lower.includes('5-metre') || lower === '5m cable') {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-5m-cable`,
            canonical_id: m.id,
            item_name: '5m Cable',
            display_name: '5m Cable',
          });
        }
        if (lower.includes('15-metre') || lower === '15m cable') {
          categoryBMaterials.push({
            ...entry,
            id: `${m.id}-15m-cable`,
            canonical_id: m.id,
            item_name: '15m Cable',
            display_name: '15m Cable',
          });
        }
      }
    });

    // Deduplicate by normalized lowercase product name, prioritizing real UUID records over synthetic aliases
    const productMap = new Map();
    [...categoryAComponents, ...deviceProducts, ...categoryBMaterials].forEach((prod) => {
      const key = (prod.item_name || '').trim().toLowerCase();
      if (!key) return;
      if (!productMap.has(key)) {
        productMap.set(key, prod);
      } else {
        const existing = productMap.get(key);
        if (existing.canonical_id && !prod.canonical_id) {
          productMap.set(key, prod);
        }
      }
    });

    return Array.from(productMap.values());
  } catch (err) {
    console.warn('Could not load authoritative catalogue for backup products:', err.message);
    return [];
  }
}

/**
 * Resolves an item identifier (id, sku, or name) to a live inventory record.
 * Prioritizes:
 * 1. Exact UUID / ID match in materials and products
 * 2. Exact SKU match in materials and products
 * 3. Exact case-insensitive name match in materials and products
 * 4. Tokenized heuristic match (longest prefix / specific length checked first: e.g. 15m strictly before 5m)
 */
export function resolveInventoryTarget(item = {}, { allMats = [], allDevs = [] } = {}) {
  const itemId = item.item_id || item.id || item.material_id || item.product_id;
  const sku = item.item_sku || item.sku;
  const name = (item.item_name || item.material_name || item.device_type || item.name || '').trim();
  const lower = name.toLowerCase();

  // 1. Match by exact UUID / ID
  if (itemId) {
    const sId = String(itemId).trim().toLowerCase();
    const matById = allMats.find((m) => String(m.id || '').trim().toLowerCase() === sId);
    if (matById) return { type: 'MATERIAL', target: matById };
    const devById = allDevs.find((d) => String(d.id || '').trim().toLowerCase() === sId);
    if (devById) return { type: 'DEVICE', target: devById };
  }

  // 2. Match by exact SKU
  if (sku) {
    const sSku = String(sku).trim().toLowerCase();
    const matBySku = allMats.find((m) => (m.sku || '').trim().toLowerCase() === sSku);
    if (matBySku) return { type: 'MATERIAL', target: matBySku };
    const devBySku = allDevs.find((d) => (d.sku || '').trim().toLowerCase() === sSku);
    if (devBySku) return { type: 'DEVICE', target: devBySku };
  }

  // 3. Match by exact material name
  const matExact = allMats.find((m) => (m.material_name || '').trim().toLowerCase() === lower);
  if (matExact) return { type: 'MATERIAL', target: matExact };

  // 4. Match by exact device name / device type
  const devExact = allDevs.find((d) =>
    (d.device_type || '').trim().toLowerCase() === lower ||
    (d.device_name || '').trim().toLowerCase() === lower
  );
  if (devExact) return { type: 'DEVICE', target: devExact };

  // 5. Intelligent heuristics (Order is critical: check 15m strictly BEFORE 5m)
  // Cable lengths: test 15m before 5m with word boundaries to prevent substring collision
  if (/(?:^|\D)15\s*(?:m|metre|meter)s?(?:$|\D)/i.test(lower)) {
    const mat = allMats.find((m) => /(?:^|\D)15\s*(?:-| )?metre/i.test(m.material_name || '') || (m.material_name || '').toLowerCase().includes('15-metre'));
    if (mat) return { type: 'MATERIAL', target: mat };
  } else if (/(?:^|\D)5\s*(?:m|metre|meter)s?(?:$|\D)/i.test(lower)) {
    const mat = allMats.find((m) => /(?:^|\D)5\s*(?:-| )?metre/i.test(m.material_name || '') && !(m.material_name || '').includes('15'));
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  // Cable ties: 300 mm vs 200 mm
  if (lower.includes('cable tie') && (lower.includes('300') || lower.includes('300mm'))) {
    const mat = allMats.find((m) => m.material_name.toLowerCase().includes('cable tie') && m.material_name.includes('300'));
    if (mat) return { type: 'MATERIAL', target: mat };
  } else if (lower.includes('cable tie') && (lower.includes('200') || lower.includes('200mm'))) {
    const mat = allMats.find((m) => m.material_name.toLowerCase().includes('cable tie') && m.material_name.includes('200'));
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  // Display / Live Display
  if (lower.includes('display')) {
    const mat = allMats.find((m) => (m.material_name || '').toLowerCase().includes('display'));
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  // Camera loose component
  if (lower === 'camera' || lower.includes('camera')) {
    const mat = allMats.find((m) => (m.material_name || '').toLowerCase() === 'camera');
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  // Memory card
  if (lower.includes('memory card')) {
    const mat = allMats.find((m) => (m.material_name || '').toLowerCase().includes('memory card'));
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  // 0.5 mm Wire
  if (lower.includes('wire') && (lower.includes('0.5') || lower.includes('0.5mm'))) {
    const mat = allMats.find((m) => (m.material_name || '').toLowerCase().includes('0.5'));
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  // Screws
  if (lower.includes('long screw')) {
    const mat = allMats.find((m) => (m.material_name || '').toLowerCase().includes('long screw'));
    if (mat) return { type: 'MATERIAL', target: mat };
  } else if (lower.includes('small screw')) {
    const mat = allMats.find((m) => (m.material_name || '').toLowerCase().includes('small screw'));
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  // Tape
  if (lower.includes('insulation tape') || lower.includes('tape')) {
    const mat = allMats.find((m) => (m.material_name || '').toLowerCase().includes('insulation tape'));
    if (mat) return { type: 'MATERIAL', target: mat };
  }

  return { type: 'UNKNOWN', target: null };
}

/**
 * Enrich backup items with live usable stock balances and remaining quantities
 */
export async function enrichBackupItemsWithLiveStock(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  try {
    const [allMats, allDevs] = await Promise.all([
      getMaterialInventory().catch(() => []),
      getInventoryProducts().catch(() => []),
    ]);

    return items.map((it) => {
      const name = (it.item_name || '').trim();
      const resolved = resolveInventoryTarget({
        item_id: it.item_id,
        item_sku: it.item_sku,
        item_name: name,
      }, { allMats, allDevs });

      let currentStock = 0;
      let unit = it.unit || 'Nos.';
      let sku = it.item_sku || it.sku || null;

      if (resolved.type === 'MATERIAL' && resolved.target) {
        currentStock = Number(resolved.target.current_stock) || 0;
        unit = resolved.target.unit || unit;
        sku = resolved.target.sku || sku;
      } else if (resolved.type === 'DEVICE' && resolved.target) {
        currentStock = Number(resolved.target.usable_stock) || 0;
        unit = resolved.target.unit || unit;
        sku = resolved.target.sku || sku;
      }

      const qty = Number(it.quantity) || 0;
      const qtyIssued = Number(it.quantity_issued) || 0;
      const qtyRemaining = Math.max(0, qty - qtyIssued);
      const shortage = Math.max(0, qtyRemaining - currentStock);

      return {
        ...it,
        unit,
        item_sku: sku,
        quantity: qty,
        quantity_issued: qtyIssued,
        quantity_remaining: qtyRemaining,
        available_stock: currentStock,
        shortage,
      };
    });
  } catch (err) {
    return items.map((it) => ({
      ...it,
      quantity_remaining: Math.max(0, (Number(it.quantity) || 0) - (Number(it.quantity_issued) || 0)),
      available_stock: 0,
      shortage: 0,
    }));
  }
}

/**
 * Get pre-installation backup declaration for a checklist
 */
export async function getBackupDeclaration(checklistId) {
  if (!checklistId) return null;

  // 1. Fetch checklist to determine sales expectation
  let checklist = null;
  try {
    const { data, error } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, carry_extra_backup_items, extra_devices, service_engineer, service_engineer_id, installation_status, client_name')
      .eq('id', checklistId)
      .maybeSingle();
    if (!error && data) {
      checklist = data;
    }
  } catch (e) {
    // Non-blocking
  }

  const salesExpected = Boolean(checklist?.carry_extra_backup_items ?? checklist?.extra_devices);

  // 2. Try Supabase
  let decl = null;
  let items = [];
  try {
    const { data: dbDecl, error: declErr } = await supabase
      .from('pre_installation_backup_declarations')
      .select('*')
      .eq('checklist_id', checklistId)
      .maybeSingle();

    if (!declErr && dbDecl) {
      decl = dbDecl;
      const { data: rows, error: rowsErr } = await supabase
        .from('pre_installation_backup_items')
        .select('*')
        .eq('declaration_id', decl.id)
        .order('created_at', { ascending: true });

      if (!rowsErr && Array.isArray(rows)) {
        items = rows.map((r) => ({
          ...r,
          category: r.category || classifyBackupItemCategory(r.item_name),
        }));
      }
    }
  } catch (e) {
    // Fall back to memory
  }

  // 3. Fallback to memory
  if (!decl) {
    const cached = inMemoryDeclarations.get(checklistId);
    if (cached) {
      decl = cached;
      items = (cached.items || []).map((it) => ({
        ...it,
        category: it.category || classifyBackupItemCategory(it.item_name),
      }));
    }
  }

  if (!decl) {
    return {
      checklist_id: checklistId,
      checklist_number: checklist?.checklist_number || 'N/A',
      customer_name: checklist?.client_name || 'N/A',
      technician_name: checklist?.service_engineer || 'Unassigned',
      sales_expected: salesExpected,
      has_backup_items: false,
      no_items_reason: null,
      status: 'NOT_RECORDED',
      issuance_status: 'NOT_RECORDED',
      items: [],
      issuance_history: [],
    };
  }

  // Compute live quantities and stock availability for items
  const enrichedItems = await enrichBackupItemsWithLiveStock(items);

  // Self-healing: If all items show 0 issued, check stock_movements for recorded extra backup issuances
  const needsReconciliation = enrichedItems.length > 0 && enrichedItems.every((it) => (Number(it.quantity_issued) || 0) === 0);
  if (needsReconciliation) {
    try {
      const chkNum = checklist?.checklist_number || decl.checklist_number;
      const { data: movs } = await supabase
        .from('stock_movements')
        .select('item_name, quantity, reason_or_remarks, created_at')
        .or(`checklist_id.eq.${checklistId},reason_or_remarks.ilike.%${chkNum || checklistId}%`)
        .or(`movement_type.eq.EXTRA_BACKUP_ISSUED,reason_or_remarks.ilike.%Extra backup%`);

      if (Array.isArray(movs) && movs.length > 0) {
        let anyReconciled = false;
        for (const it of enrichedItems) {
          const matchingMovs = movs.filter((m) => {
            const mName = (m.item_name || '').toLowerCase().trim();
            const itName = (it.item_name || '').toLowerCase().trim();
            return mName === itName || itName.includes(mName) || mName.includes(itName);
          });
          if (matchingMovs.length > 0) {
            const totalIssuedInMovs = matchingMovs.reduce((sum, m) => sum + Math.abs(Number(m.quantity) || 0), 0);
            if (totalIssuedInMovs > 0) {
              const reqQty = Number(it.quantity) || 0;
              it.quantity_issued = Math.min(reqQty, totalIssuedInMovs);
              it.quantity_remaining = Math.max(0, reqQty - it.quantity_issued);
              anyReconciled = true;

              if (it.id) {
                // Update only valid columns: quantity_issued, updated_at
                supabase
                  .from('pre_installation_backup_items')
                  .update({ quantity_issued: it.quantity_issued, updated_at: new Date().toISOString() })
                  .eq('id', it.id)
                  .then(() => {})
                  .catch(() => {});
              }
            }
          }
        }
      }
    } catch (reconcileErr) {
      // Non-blocking
    }
  }

  // Compute overall issuance status
  let finalIssuanceStatus = decl.issuance_status;
  if (!finalIssuanceStatus || finalIssuanceStatus === 'DECLARED' || finalIssuanceStatus === 'Pending') {
    if (enrichedItems.length === 0 || !decl.has_backup_items) {
      finalIssuanceStatus = 'NOT_APPLICABLE';
    } else {
      const allIssued = enrichedItems.every(
        (it) => (Number(it.quantity_issued) || 0) >= (Number(it.quantity) || 0)
      );
      const anyIssued = enrichedItems.some(
        (it) => (Number(it.quantity_issued) || 0) > 0
      );
      finalIssuanceStatus = allIssued ? 'Issued' : anyIssued ? 'Partially Issued' : 'Pending';
    }
  }

  const result = {
    ...decl,
    checklist_number: checklist?.checklist_number || decl.checklist_number,
    customer_name: checklist?.client_name || decl.customer_name,
    technician_name: checklist?.service_engineer || decl.technician_name,
    sales_expected: salesExpected,
    issuance_status: finalIssuanceStatus,
    items: enrichedItems,
    issuance_history: Array.isArray(decl.issuance_history) ? decl.issuance_history : [],
  };

  inMemoryDeclarations.set(checklistId, result);
  return result;
}

export function classifyBackupItemCategory(name = '', declaredCategory = '') {
  if (declaredCategory === 'Device Component' || declaredCategory === 'Installation Material') {
    return declaredCategory;
  }
  const lower = (name || '').toLowerCase();
  if (
    lower.includes('camera') ||
    lower.includes('display') ||
    lower.includes('mdvr') ||
    lower.includes('sensor') ||
    lower.includes('system')
  ) {
    return 'Device Component';
  }
  return 'Installation Material';
}

/**
 * Save / Update pre-installation backup declaration
 */
export async function saveBackupDeclaration({
  checklistId,
  user,
  hasBackupItems,
  noItemsReason = '',
  items = [],
}) {
  if (!checklistId) {
    throw new Error('Checklist ID is required.');
  }

  // Fetch checklist
  let checklist = null;
  try {
    const { data, error } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, carry_extra_backup_items, extra_devices, service_engineer, service_engineer_id, installation_status')
      .eq('id', checklistId)
      .maybeSingle();
    if (!error && data) checklist = data;
  } catch (e) {
    // Non-blocking
  }

  const existingDecl = await getBackupDeclaration(checklistId);
  const isCarrying = Boolean(hasBackupItems);

  if (!isCarrying) {
    const salesExpected = Boolean(checklist?.carry_extra_backup_items ?? checklist?.extra_devices);
    if (salesExpected && (!noItemsReason || !noItemsReason.trim())) {
      throw new Error('Please provide a reason why no extra backup items are carried when Sales indicated backup items were needed.');
    }
  }

  let validatedItems = [];
  if (isCarrying) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Please add at least one backup item with a positive quantity.');
    }

    const itemMap = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = (it.item_name || it.material_name || '').trim();
      if (!name) {
        throw new Error(`Row #${i + 1}: Please select a product.`);
      }
      const qty = Number(it.quantity);
      if (isNaN(qty) || qty <= 0) {
        throw new Error(`Row #${i + 1} (${name}): Quantity must be a positive number greater than 0.`);
      }

      const unit = (it.unit || 'Nos.').trim();
      const itemId = (it.item_id || it.id || `item-${name.toLowerCase().replace(/\s+/g, '-')}`).trim();
      const sku = (it.sku || it.item_sku || '').trim();
      const category = classifyBackupItemCategory(name, it.category);

      // Combine duplicate rows if user selected same item
      const prevItem = existingDecl?.items?.find((pi) => (pi.item_name || '').toLowerCase() === name.toLowerCase());
      const prevIssued = Number(prevItem?.quantity_issued) || 0;

      if (itemMap.has(name.toLowerCase())) {
        const existing = itemMap.get(name.toLowerCase());
        existing.quantity += qty;
      } else {
        itemMap.set(name.toLowerCase(), {
          item_id: itemId,
          item_name: name,
          item_sku: sku || null,
          category,
          quantity: qty,
          unit: unit || 'Nos.',
          quantity_issued: prevIssued,
          quantity_used: 0,
          quantity_returned: 0,
          quantity_damaged: 0,
          quantity_missing: 0,
          discrepancy_reason: null,
        });
      }
    }
    validatedItems = Array.from(itemMap.values());
  }

  const isCorrection = Boolean(existingDecl && existingDecl.status && existingDecl.status !== 'NOT_RECORDED');

  // Maintain history when correcting
  const history = Array.isArray(existingDecl?.history) ? [...existingDecl.history] : [];
  if (isCorrection) {
    history.push({
      modified_at: new Date().toISOString(),
      modified_by: user?.email || user?.id || 'Technician',
      previous_has_backup_items: existingDecl.has_backup_items,
      previous_items_count: existingDecl.items?.length || 0,
      previous_items: existingDecl.items || [],
    });
  }

  const nowIso = new Date().toISOString();
  const isValidUuid = (val) =>
    typeof val === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

  const calculatedIssuanceStatus = (existingDecl?.issuance_status && existingDecl.issuance_status !== 'NOT_RECORDED')
    ? existingDecl.issuance_status
    : (isCarrying ? 'Pending' : 'NOT_APPLICABLE');

  const declarationPayload = {
    checklist_id: checklistId,
    technician_id: isValidUuid(user?.id)
      ? user.id
      : isValidUuid(checklist?.service_engineer_id)
      ? checklist.service_engineer_id
      : null,
    technician_name: user?.name || user?.email || checklist?.service_engineer || 'Technician',
    has_backup_items: isCarrying,
    no_items_reason: isCarrying ? null : (noItemsReason ? noItemsReason.trim() : null),
    status: isCorrection ? 'CORRECTED' : 'DECLARED',
    issuance_status: calculatedIssuanceStatus,
    declaration_timestamp: nowIso,
    history,
    issuance_history: existingDecl?.issuance_history || [],
    updated_at: nowIso,
  };

  let savedDeclaration = null;

  // 1. Try Supabase upsert with base columns
  try {
    const dbPayload = {
      checklist_id: checklistId,
      technician_id: declarationPayload.technician_id,
      technician_name: declarationPayload.technician_name,
      has_backup_items: declarationPayload.has_backup_items,
      no_items_reason: declarationPayload.no_items_reason,
      status: declarationPayload.status,
      declaration_timestamp: declarationPayload.declaration_timestamp,
      history: declarationPayload.history,
      updated_at: declarationPayload.updated_at,
    };

    const { data: upsertedDecl, error: declErr } = await supabase
      .from('pre_installation_backup_declarations')
      .upsert(
        {
          ...(isValidUuid(existingDecl?.id) ? { id: existingDecl.id } : {}),
          ...dbPayload,
          created_at: existingDecl?.created_at || nowIso,
        },
        { onConflict: 'checklist_id' }
      )
      .select()
      .single();

    if (!declErr && upsertedDecl) {
      savedDeclaration = {
        ...upsertedDecl,
        issuance_status: calculatedIssuanceStatus,
        issuance_history: declarationPayload.issuance_history,
      };

      // Delete old items and insert fresh rows
      await supabase
        .from('pre_installation_backup_items')
        .delete()
        .eq('declaration_id', savedDeclaration.id);

      if (validatedItems.length > 0) {
        const rowsToInsert = validatedItems.map((vi) => ({
          declaration_id: savedDeclaration.id,
          checklist_id: checklistId,
          item_id: isValidUuid(vi.item_id) ? vi.item_id : crypto.randomUUID(),
          item_name: vi.item_name,
          item_sku: vi.item_sku,
          quantity: vi.quantity,
          unit: vi.unit,
          quantity_issued: vi.quantity_issued || 0,
          quantity_used: vi.quantity_used || 0,
          quantity_returned: vi.quantity_returned || 0,
          quantity_damaged: vi.quantity_damaged || 0,
          quantity_missing: vi.quantity_missing || 0,
          discrepancy_reason: vi.discrepancy_reason || null,
          created_at: nowIso,
          updated_at: nowIso,
        }));

        const { data: insertedRows } = await supabase
          .from('pre_installation_backup_items')
          .insert(rowsToInsert)
          .select();

        const finalRows = insertedRows || rowsToInsert;
        savedDeclaration.items = finalRows.map((row) => ({
          ...row,
          category:
            validatedItems.find((vi) => (vi.item_name || '').toLowerCase() === (row.item_name || '').toLowerCase())?.category ||
            classifyBackupItemCategory(row.item_name),
        }));
      } else {
        savedDeclaration.items = [];
      }
    }
  } catch (err) {
    console.warn('Supabase backup declaration save failed, falling back to local store:', err.message);
  }

  // 2. Fallback to in-memory / local storage
  if (!savedDeclaration) {
    const declId = existingDecl?.id || `decl-${checklistId}`;
    savedDeclaration = {
      id: declId,
      ...declarationPayload,
      created_at: existingDecl?.created_at || nowIso,
      items: validatedItems.map((vi, idx) => ({
        id: `bitem-${declId}-${idx + 1}`,
        declaration_id: declId,
        checklist_id: checklistId,
        ...vi,
        created_at: nowIso,
        updated_at: nowIso,
      })),
    };
  }

  savedDeclaration.sales_expected = false;
  inMemoryDeclarations.set(checklistId, savedDeclaration);
  saveBackupItemsStorage();

  // Synchronize technician's backup declaration onto the parent installation checklist record
  try {
    await supabase
      .from('installation_checklists')
      .update({
        carry_extra_backup_items: isCarrying,
        carry_status: 'RECORDED',
        updated_at: nowIso,
      })
      .eq('id', checklistId);
  } catch (err) {
    console.warn('Could not update carry_status on installation_checklists:', err.message);
  }

  // Synchronize Store Manager requirement record with technician backup declaration
  try {
    const { syncStoreRequirementForChecklist } = await import('./storeRequirementService.js');
    await syncStoreRequirementForChecklist({
      ...checklist,
      carry_extra_backup_items: isCarrying,
      carry_status: 'RECORDED',
    });
  } catch (syncErr) {
    console.warn('Could not sync store requirement on backup declaration:', syncErr.message);
  }

  // Idempotently notify Store Manager and Coordinator of successful Pre-Installation submission
  try {
    const { createNotification } = await import('./appNotificationService.js');
    const chkNum = checklist?.checklist_number || savedDeclaration.checklist_number || 'N/A';
    const clientName = checklist?.client_name || savedDeclaration.customer_name || 'Client';
    const techName = savedDeclaration.technician_name || checklist?.service_engineer || 'Technician';

    // 1. Notify Store Manager: checklist is ready for material review
    await createNotification({
      targetRole: 'STORE',
      title: `Pre-Installation Submitted: ${chkNum}`,
      message: `Technician ${techName} submitted Pre-Installation Form for ${clientName}. Ready for material review.`,
      type: 'PRE_INSTALLATION_SUBMITTED',
      checklistId,
      checklistNumber: chkNum,
      metadata: {
        idempotency_key: `pre-install-store-${checklistId}`,
        checklist_id: checklistId,
        checklist_number: chkNum,
        technician_name: techName,
        has_backup_items: isCarrying,
        items_count: validatedItems.length,
      },
    }).catch(() => {});

    // 2. Notify Coordinator: checklist is ready for operational coordination
    await createNotification({
      targetRole: 'COORDINATOR',
      title: `Pre-Installation Submitted: ${chkNum}`,
      message: `Technician ${techName} submitted Pre-Installation Form for ${clientName}. Ready for travel & room booking.`,
      type: 'PRE_INSTALLATION_SUBMITTED',
      checklistId,
      checklistNumber: chkNum,
      metadata: {
        idempotency_key: `pre-install-coord-${checklistId}`,
        checklist_id: checklistId,
        checklist_number: chkNum,
        technician_name: techName,
        has_backup_items: isCarrying,
      },
    }).catch(() => {});
  } catch (notifErr) {
    console.warn('Could not dispatch pre-installation notifications:', notifErr.message);
  }

  // Audit log
  await logAudit({
    actor_id: user?.id,
    actor_email: user?.email,
    actor_role: user?.role || 'TECHNICAL',
    action: isCorrection ? 'CORRECT_BACKUP_ITEMS_DECLARATION' : 'DECLARE_BACKUP_ITEMS',
    target_table: 'pre_installation_backup_declarations',
    target_id: savedDeclaration.id,
    details: {
      checklist_id: checklistId,
      has_backup_items: isCarrying,
      items_count: validatedItems.length,
      is_correction: isCorrection,
    },
  });

  return savedDeclaration;
}

/**
 * Reconcile backup items during post-installation report submission
 */
export async function reconcileBackupItems({ checklistId, user, items = [] }) {
  const declaration = await getBackupDeclaration(checklistId);
  if (!declaration || !declaration.has_backup_items) {
    return { reconciled: true, items: [] };
  }

  const declaredItems = declaration.items || [];
  const inputMap = new Map();
  items.forEach((it) => {
    const key = (it.item_name || it.material_name || '').toLowerCase();
    inputMap.set(key, it);
  });

  const reconciledRows = [];

  for (const decItem of declaredItems) {
    const isIssuedState = declaration.issuance_status === 'Issued' || declaration.issuance_status === 'Partially Issued';
    const qtyCarried = (isIssuedState && decItem.quantity_issued !== undefined && decItem.quantity_issued !== null)
      ? Number(decItem.quantity_issued)
      : (Number(decItem.quantity) || 0);

    // Screws (Long Screw, Small Screw) are excluded from Post-Installation reconciliation & returns
    if (isScrewMaterial(decItem.item_name)) {
      reconciledRows.push({
        ...decItem,
        quantity_used: qtyCarried,
        quantity_returned: 0,
        quantity_damaged: 0,
        quantity_missing: 0,
        discrepancy_reason: null,
        updated_at: new Date().toISOString(),
      });
      continue;
    }

    const key = (decItem.item_name || '').toLowerCase();
    let rep = inputMap.get(key);
    if (!rep) {
      for (const [k, v] of inputMap.entries()) {
        if (k.trim() === key || k.includes(key) || key.includes(k)) {
          rep = v;
          break;
        }
      }
    }
    rep = rep || {};

    const rawUsed = Number(rep.quantity_used ?? rep.quantity_installed);
    const rawRet = Number(rep.quantity_returned ?? rep.quantity_to_return);
    const rawDam = Number(rep.quantity_damaged);
    const rawMis = Number(rep.quantity_missing);

    if (
      (!isNaN(rawUsed) && rawUsed < 0) ||
      (!isNaN(rawRet) && rawRet < 0) ||
      (!isNaN(rawDam) && rawDam < 0) ||
      (!isNaN(rawMis) && rawMis < 0)
    ) {
      throw new Error(`Quantities for backup item "${decItem.item_name}" cannot be negative numbers.`);
    }

    const qtyUsed = Math.max(0, Number(rep.quantity_used ?? rep.quantity_installed ?? 0));
    const qtyReturned = Math.max(0, Number(rep.quantity_returned ?? rep.quantity_to_return ?? 0));
    const qtyDamaged = Math.max(0, Number(rep.quantity_damaged ?? 0));
    const qtyMissing = Math.max(0, Number(rep.quantity_missing ?? 0));

    if (qtyUsed > qtyCarried) {
      throw new Error(
        `Extra used quantity (${qtyUsed}) cannot exceed extra carried quantity (${qtyCarried}) for backup item "${decItem.item_name}".`
      );
    }
    if (qtyReturned > qtyCarried) {
      throw new Error(
        `Extra returned quantity (${qtyReturned}) cannot exceed extra carried quantity (${qtyCarried}) for backup item "${decItem.item_name}".`
      );
    }
    if (qtyDamaged > qtyCarried) {
      throw new Error(
        `Extra damaged quantity (${qtyDamaged}) cannot exceed extra carried quantity (${qtyCarried}) for backup item "${decItem.item_name}".`
      );
    }
    if (qtyMissing > qtyCarried) {
      throw new Error(
        `Extra missing quantity (${qtyMissing}) cannot exceed extra carried quantity (${qtyCarried}) for backup item "${decItem.item_name}".`
      );
    }

    const totalAccounted = qtyUsed + qtyReturned + qtyDamaged + qtyMissing;
    if (totalAccounted !== qtyCarried) {
      throw new Error(
        `Backup item reconciliation mismatch for "${decItem.item_name}": Declared quantity (${qtyCarried}) must equal Used (${qtyUsed}) + Returned (${qtyReturned}) + Damaged (${qtyDamaged}) + Missing (${qtyMissing}). Currently accounts for ${totalAccounted}.`
      );
    }

    if ((qtyDamaged > 0 || qtyMissing > 0) && (!rep.discrepancy_reason || !rep.discrepancy_reason.trim())) {
      throw new Error(
        `Discrepancy remark is required for backup item "${decItem.item_name}" when reporting damaged (${qtyDamaged}) or missing (${qtyMissing}) items.`
      );
    }

    reconciledRows.push({
      ...decItem,
      quantity_used: qtyUsed,
      quantity_returned: qtyReturned,
      quantity_damaged: qtyDamaged,
      quantity_missing: qtyMissing,
      discrepancy_reason: rep.discrepancy_reason ? rep.discrepancy_reason.trim() : null,
      updated_at: new Date().toISOString(),
    });
  }

  // Update rows in Supabase
  try {
    for (const r of reconciledRows) {
      if (r.id) {
        await supabase
          .from('pre_installation_backup_items')
          .update({
            quantity_used: r.quantity_used,
            quantity_returned: r.quantity_returned,
            quantity_damaged: r.quantity_damaged,
            quantity_missing: r.quantity_missing,
            discrepancy_reason: r.discrepancy_reason,
            updated_at: r.updated_at,
          })
          .eq('id', r.id);
      }
    }
  } catch (e) {
    console.warn('Failed to update reconciled backup items in Supabase:', e.message);
  }

  // Update memory
  declaration.items = reconciledRows;
  declaration.status = 'RECONCILED';
  inMemoryDeclarations.set(checklistId, declaration);
  saveBackupItemsStorage();

  return {
    reconciled: true,
    items: reconciledRows,
  };
}

export const inFlightBackupIssuances = new Set();
export const completedBackupIssuances = new Map(); // key -> { result, timestamp }

// Periodic cleanup of completed idempotency cache (keep 1 hour)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of completedBackupIssuances.entries()) {
    if (now - (v.timestamp || 0) > 3600000) {
      completedBackupIssuances.delete(k);
    }
  }
}, 300000);
if (cleanupInterval.unref) {
  cleanupInterval.unref();
}

/**
 * Server-side atomic transaction for Store Manager to review and issue extra backup devices.
 * Supports full or partial issuance, checks live usable stock before deduction,
 * records distinct stock_movements with EXTRA_BACKUP_ISSUED, updates quantity_issued,
 * updates declaration issuance_status (Pending, Partially Issued, Issued), and maintains issuance history.
 * Prevents concurrent duplicate clicks, enforces server-side idempotency, and prevents negative inventory.
 */
export async function issueExtraBackupDevices({
  checklist_id,
  items = [],
  remarks = '',
  idempotency_key = null,
  user,
}) {
  if (!checklist_id) throw new Error('Checklist ID is required.');

  if (user && user.role) {
    const role = (user.role || '').toUpperCase();
    if (role !== 'STORE_MANAGER' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      throw new Error(`Unauthorized: Role "${user.role}" is not permitted to approve or issue extra backup stock.`);
    }
  }

  // 1. In-memory idempotency check (fast-path for duplicate button clicks or network retries)
  const reqIdempotencyKey = idempotency_key ? String(idempotency_key).trim() : null;
  if (reqIdempotencyKey && completedBackupIssuances.has(reqIdempotencyKey)) {
    const cached = completedBackupIssuances.get(reqIdempotencyKey);
    return cached.result;
  }

  // 2. In-flight concurrency lock to prevent simultaneous duplicate requests
  if (inFlightBackupIssuances.has(checklist_id)) {
    const conflictErr = new Error(`Stock issuance for extra backup devices is already in progress for checklist ${checklist_id}. Please wait.`);
    conflictErr.status = 409;
    throw conflictErr;
  }

  inFlightBackupIssuances.add(checklist_id);

  let canonicalChecklistId = checklist_id;

  try {
    const declaration = await getBackupDeclaration(checklist_id);
    if (!declaration || !declaration.has_backup_items) {
      throw new Error(`No loose backup items declared for checklist ${checklist_id}.`);
    }

    const declItems = declaration.items || [];
    if (declItems.length === 0) {
      throw new Error('No declared backup items found to issue.');
    }

    // Fetch parent checklist details for logging and recipient tracking
    let checklist = null;
    try {
      const { data } = await supabase
        .from('installation_checklists')
        .select('id, checklist_number, service_engineer, service_engineer_id, client_name')
        .eq('id', checklist_id)
        .maybeSingle();
      if (data) checklist = data;
    } catch (e) {}

    const techName = checklist?.service_engineer || declaration.technician_name || 'Assigned Technician';
    const chkNum = checklist?.checklist_number || declaration.checklist_number || checklist_id;
    canonicalChecklistId = checklist?.id || checklist_id;

    // 3. Database idempotency check: check if stock_movements already contains movements for this idempotency key or reference
    if (reqIdempotencyKey) {
      try {
        const { data: existingMovs } = await supabase
          .from('stock_movements')
          .select('id, item_name, quantity, reason_or_remarks, reference_transaction_id, idempotency_key, created_at')
          .or(`idempotency_key.eq.${reqIdempotencyKey},reference_transaction_id.eq.${reqIdempotencyKey}`);
        if (Array.isArray(existingMovs) && existingMovs.length > 0) {
          const replayResult = {
            success: true,
            already_issued: true,
            idempotent_replay: true,
            message: `Extra backup devices for checklist ${chkNum} were already issued (Transaction: ${reqIdempotencyKey}). Duplicate deduction prevented.`,
            issuance_status: 'Issued',
            issued_items: declItems.map((d) => ({
              item_name: d.item_name,
              quantity_issued: Number(d.quantity_issued) || Number(d.quantity),
              unit: d.unit || 'Nos.',
            })),
          };
          completedBackupIssuances.set(reqIdempotencyKey, { result: replayResult, timestamp: Date.now() });
          return replayResult;
        }
      } catch (checkMovErr) {
        // Non-blocking
      }
    }

    // 4. Pre-check: If all declared items have already been fully issued
    const allDeclaredAlreadyIssued = declItems.length > 0 && declItems.every(
      (it) => (Number(it.quantity_issued) || 0) >= (Number(it.quantity) || 0)
    );
    if (allDeclaredAlreadyIssued) {
      const alreadyResult = {
        success: true,
        already_issued: true,
        message: `All declared extra backup items for checklist ${chkNum} have already been fully issued. Duplicate deduction prevented.`,
        issuance_status: 'Issued',
        issued_items: declItems.map((d) => ({
          item_name: d.item_name,
          quantity_issued: Number(d.quantity_issued) || Number(d.quantity),
          unit: d.unit || 'Nos.',
        })),
      };
      if (reqIdempotencyKey) {
        completedBackupIssuances.set(reqIdempotencyKey, { result: alreadyResult, timestamp: Date.now() });
      }
      completedBackupIssuances.set(String(checklist_id), { result: alreadyResult, timestamp: Date.now() });
      if (canonicalChecklistId && canonicalChecklistId !== checklist_id) {
        completedBackupIssuances.set(String(canonicalChecklistId), { result: alreadyResult, timestamp: Date.now() });
      }
      return alreadyResult;
    }

    // Determine items to issue
    const itemsToProcess = [];

    if (Array.isArray(items) && items.length > 0) {
      for (const reqItem of items) {
        const name = (reqItem.item_name || '').trim();
        const qtyToIssue = Number(reqItem.quantity_to_issue !== undefined ? reqItem.quantity_to_issue : reqItem.quantity) || 0;
        if (qtyToIssue <= 0) continue;

        const targetDeclItem = declItems.find(
          (d) => (d.id && reqItem.item_id && d.id === reqItem.item_id) ||
                 (d.item_id && reqItem.item_id && d.item_id === reqItem.item_id) ||
                 (d.item_sku && reqItem.item_sku && d.item_sku.toLowerCase() === reqItem.item_sku.toLowerCase()) ||
                 (d.item_name || '').trim().toLowerCase() === name.toLowerCase()
        );
        if (!targetDeclItem) {
          throw new Error(`Item "${name}" is not part of the declared backup items for this checklist.`);
        }

        const remaining = Math.max(0, (Number(targetDeclItem.quantity) || 0) - (Number(targetDeclItem.quantity_issued) || 0));
        if (remaining <= 0) {
          if (items.length === 1) {
            return {
              success: true,
              already_issued: true,
              message: `All declared quantities for "${targetDeclItem.item_name}" have already been issued. Duplicate deduction prevented.`,
              issuance_status: declaration.issuance_status || 'Issued',
              issued_items: [],
            };
          }
          continue;
        }
        if (qtyToIssue > remaining) {
          throw new Error(
            `Cannot issue ${qtyToIssue} for "${name}". Maximum remaining unissued quantity is ${remaining}.`
          );
        }

        itemsToProcess.push({
          declItem: targetDeclItem,
          name: targetDeclItem.item_name,
          quantity_to_issue: qtyToIssue,
          unit: targetDeclItem.unit || 'Nos.',
        });
      }
    } else {
      for (const d of declItems) {
        const remaining = Math.max(0, (Number(d.quantity) || 0) - (Number(d.quantity_issued) || 0));
        if (remaining > 0) {
          itemsToProcess.push({
            declItem: d,
            name: d.item_name,
            quantity_to_issue: remaining,
            unit: d.unit || 'Nos.',
          });
        }
      }
    }

    if (itemsToProcess.length === 0) {
      const allIssued = declItems.every(
        (it) => (Number(it.quantity_issued) || 0) >= (Number(it.quantity) || 0)
      );
      if (allIssued) {
        const resObj = {
          success: true,
          already_issued: true,
          message: `All declared extra backup items for checklist ${chkNum} have already been fully issued. Duplicate deduction prevented.`,
          issuance_status: 'Issued',
          issued_items: [],
        };
        if (reqIdempotencyKey) {
          completedBackupIssuances.set(reqIdempotencyKey, { result: resObj, timestamp: Date.now() });
        }
        return resObj;
      }
      throw new Error('Please enter a positive quantity greater than 0 to issue.');
    }

    // Step 1: Check inventory availability for ALL items BEFORE deducting any stock
    const [allMats, allDevs] = await Promise.all([
      getMaterialInventory().catch(() => []),
      getInventoryProducts().catch(() => []),
    ]);

    const plannedDeductions = [];

    for (const item of itemsToProcess) {
      const name = (item.name || item.declItem?.item_name || item.declItem?.name || '').trim();
      const qty = item.quantity_to_issue;

      const resolved = resolveInventoryTarget({
        item_id: item.declItem?.item_id || item.item_id,
        item_sku: item.declItem?.item_sku || item.item_sku,
        item_name: name,
      }, { allMats, allDevs });

      if (resolved.type === 'UNKNOWN' || !resolved.target) {
        throw new Error(
          `Cannot issue backup item "${name}". No matching warehouse inventory product or installation material was found. Physical inventory deduction is required before marking as issued.`
        );
      }

      if (resolved.type === 'MATERIAL') {
        const mat = resolved.target;
        const available = Number(mat.current_stock) || 0;
        if (qty > available) {
          throw new Error(
            `Insufficient stock for backup material "${name}". In store: ${available} ${mat.unit || 'Nos.'}, required to issue: ${qty} ${mat.unit || 'Nos.'}.`
          );
        }
        plannedDeductions.push({
          type: 'MATERIAL',
          target: mat,
          declItem: item.declItem,
          name,
          quantity: qty,
          unit: mat.unit || item.unit || 'Nos.',
        });
      } else if (resolved.type === 'DEVICE') {
        const dev = resolved.target;
        const available = Number(dev.usable_stock) || 0;
        if (qty > available) {
          throw new Error(
            `Insufficient stock for backup device "${name}". In store: ${available} Nos., required to issue: ${qty} Nos.`
          );
        }
        plannedDeductions.push({
          type: 'DEVICE',
          target: dev,
          declItem: item.declItem,
          name,
          quantity: qty,
          unit: dev.unit || item.unit || 'Nos.',
        });
      }
    }

    // Step 2: Atomic Deduction & Ledger Movement Recording
    const nowIso = new Date().toISOString();
    const issuanceReferenceId = `EXT-ISS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const effectiveIdempotencyKey = reqIdempotencyKey || `MOV-EXT-${canonicalChecklistId}-${Date.now()}`;
    const issuedResults = [];

    for (const plan of plannedDeductions) {
      const { type, target, declItem, name, quantity, unit } = plan;

      if (type === 'MATERIAL') {
        const stockBefore = Number(target.current_stock) || 0;
        await adjustMaterialStock({
          material_name: target.material_name,
          action: 'REMOVE',
          quantity,
          reason: `Extra backup material issued to technician ${techName} for checklist ${chkNum}. ${remarks || ''}`.trim(),
          user,
          is_issuance: true,
          recordMovement: false, // Authoritative EXTRA_BACKUP_ISSUED movement logged below
        });
        const stockAfter = Math.max(0, stockBefore - quantity);

        await recordStockMovement({
          item_id: String(target.id),
          item_name: target.material_name,
          sku: target.sku || null,
          category: 'Installation Material',
          movement_type: 'EXTRA_BACKUP_ISSUED',
          quantity: -quantity,
          unit,
          balance_before: stockBefore,
          balance_after: stockAfter,
          checklist_id: canonicalChecklistId,
          reference_transaction_id: issuanceReferenceId,
          idempotency_key: effectiveIdempotencyKey,
          performed_by: user?.id && String(user.id).length === 36 ? user.id : null,
          performer_name: user?.name || user?.full_name || user?.email || 'Store Manager',
          performer_email: user?.email || null,
          reason_or_remarks: `Extra backup material issued: ${quantity} ${unit} to technician ${techName} for checklist ${chkNum}. ${remarks || ''}`.trim(),
          created_at: nowIso,
        }).catch((err) => console.warn('Movement recording notice:', err.message));
      } else if (type === 'DEVICE') {
        const stockBefore = Number(target.usable_stock) || 0;
        await adjustStock({
          device_type: target.device_type,
          action: 'REMOVE',
          quantity,
          reason: `Extra backup device issued to technician ${techName} for checklist ${chkNum}. ${remarks || ''}`.trim(),
          user,
          is_issuance: true,
          recordMovement: false, // Authoritative EXTRA_BACKUP_ISSUED movement logged below
        });
        const stockAfter = Math.max(0, stockBefore - quantity);

        await recordStockMovement({
          product_id: target.id && String(target.id).length === 36 ? target.id : null,
          item_name: target.device_type,
          sku: target.sku || null,
          category: 'Camera Device',
          movement_type: 'EXTRA_BACKUP_ISSUED',
          quantity: -quantity,
          unit,
          balance_before: stockBefore,
          balance_after: stockAfter,
          checklist_id: canonicalChecklistId,
          reference_transaction_id: issuanceReferenceId,
          idempotency_key: effectiveIdempotencyKey,
          performed_by: user?.id && String(user.id).length === 36 ? user.id : null,
          performer_name: user?.name || user?.full_name || user?.email || 'Store Manager',
          performer_email: user?.email || null,
          reason_or_remarks: `Extra backup device issued: ${quantity} ${unit} to technician ${techName} for checklist ${chkNum}. ${remarks || ''}`.trim(),
          created_at: nowIso,
        }).catch((err) => console.warn('Movement recording notice:', err.message));
      }

      // Update quantity_issued and remaining on declaration item
      declItem.quantity_issued = (Number(declItem.quantity_issued) || 0) + quantity;
      declItem.quantity_remaining = Math.max(0, (Number(declItem.quantity) || 0) - declItem.quantity_issued);
      declItem.updated_at = nowIso;

      // CRITICAL FIX: Only update valid columns in pre_installation_backup_items (NO quantity_remaining!)
      if (declItem.id) {
        try {
          const { error: itemUpdateErr } = await supabase
            .from('pre_installation_backup_items')
            .update({
              quantity_issued: declItem.quantity_issued,
              updated_at: nowIso,
            })
            .eq('id', declItem.id);
          if (itemUpdateErr) {
            console.warn('Could not update backup item in DB:', itemUpdateErr.message);
          }
        } catch (itemErr) {
          console.warn('Could not update backup item in DB:', itemErr.message);
        }
      }

      issuedResults.push({
        item_name: name,
        quantity_issued: quantity,
        total_issued: declItem.quantity_issued,
        quantity_remaining: declItem.quantity_remaining,
        unit,
      });
    }

    // Step 3: Compute overall issuance status
    const allIssued = declItems.every(
      (it) => (Number(it.quantity_issued) || 0) >= (Number(it.quantity) || 0)
    );
    const anyIssued = declItems.some(
      (it) => (Number(it.quantity_issued) || 0) > 0
    );
    const finalIssuanceStatus = allIssued ? 'Issued' : (anyIssued ? 'Partially Issued' : 'Pending');

    // Maintain issuance history
    const historyEntry = {
      action: 'EXTRA_BACKUP_ISSUED',
      reference_id: issuanceReferenceId,
      issued_at: nowIso,
      issued_by: user?.id || null,
      issued_by_name: user?.name || user?.full_name || user?.email || 'Store Manager',
      technician_recipient: techName,
      issued_items: issuedResults,
      remarks: remarks || null,
      issuance_status: finalIssuanceStatus,
    };

    const issuanceHistory = Array.isArray(declaration.issuance_history) ? [...declaration.issuance_history] : [];
    issuanceHistory.push(historyEntry);

    // Update declaration in Supabase and memory
    const fullDeclPayload = {
      issuance_status: finalIssuanceStatus,
      issued_by: user?.id && String(user.id).length === 36 ? user.id : null,
      issued_at: nowIso,
      issuance_history: issuanceHistory,
      history: issuanceHistory,
      updated_at: nowIso,
    };

    try {
      const { error: dbDeclErr } = await supabase
        .from('pre_installation_backup_declarations')
        .update(fullDeclPayload)
        .eq('id', declaration.id);

      if (dbDeclErr) {
        // Fallback for schema before migration 055: update only history JSONB and updated_at
        await supabase
          .from('pre_installation_backup_declarations')
          .update({
            history: issuanceHistory,
            updated_at: nowIso,
          })
          .eq('id', declaration.id);
      }
    } catch (dbDeclErr) {
      console.warn('Could not update pre_installation_backup_declarations DB:', dbDeclErr.message);
    }

    // Sync to store_material_requirements
    try {
      await supabase
        .from('store_material_requirements')
        .update({
          extra_devices_issuance_status: finalIssuanceStatus,
          updated_at: nowIso,
        })
        .or(`checklist_id.eq.${canonicalChecklistId},id.eq.${canonicalChecklistId}`);
    } catch (storeReqErr) {
      console.warn('Could not update store_material_requirements timestamp:', storeReqErr.message);
    }

    // Update in-memory declaration
    Object.assign(declaration, fullDeclPayload);
    inMemoryDeclarations.set(checklist_id, declaration);
    if (canonicalChecklistId && canonicalChecklistId !== checklist_id) {
      inMemoryDeclarations.set(canonicalChecklistId, declaration);
    }
    saveBackupItemsStorage();

    // Audit log
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'STORE_MANAGER',
      action: 'ISSUE_EXTRA_BACKUP_DEVICES',
      target_table: 'pre_installation_backup_declarations',
      target_id: declaration.id,
      details: {
        checklist_id,
        checklist_number: chkNum,
        reference_id: issuanceReferenceId,
        technician_name: techName,
        issued_items: issuedResults,
        issuance_status: finalIssuanceStatus,
        remarks,
      },
    });

    const enrichedFinalItems = await enrichBackupItemsWithLiveStock(declItems);
    const finalResponse = {
      success: true,
      message: `Extra backup devices successfully issued (${finalIssuanceStatus}).`,
      issuance_status: finalIssuanceStatus,
      issued_items: issuedResults,
      items: enrichedFinalItems,
      reference_id: issuanceReferenceId,
    };

    if (reqIdempotencyKey) {
      completedBackupIssuances.set(reqIdempotencyKey, { result: finalResponse, timestamp: Date.now() });
    }
    completedBackupIssuances.set(String(checklist_id), { result: finalResponse, timestamp: Date.now() });
    if (canonicalChecklistId && canonicalChecklistId !== checklist_id) {
      completedBackupIssuances.set(String(canonicalChecklistId), { result: finalResponse, timestamp: Date.now() });
    }

    return finalResponse;
  } finally {
    inFlightBackupIssuances.delete(checklist_id);
    if (canonicalChecklistId) inFlightBackupIssuances.delete(canonicalChecklistId);
  }
}

/**
 * Backward-compatible wrapper for issueBackupItemsForChecklist
 */
export async function issueBackupItemsForChecklist({
  checklist_id,
  items,
  remarks = '',
  user,
}) {
  return await issueExtraBackupDevices({
    checklist_id,
    items,
    remarks,
    user,
  });
}

/**
 * Reject extra backup devices request
 */
export async function rejectExtraBackupDevices({ checklist_id, reason = '', user }) {
  if (!checklist_id) throw new Error('Checklist ID is required.');

  if (user && user.role) {
    const role = (user.role || '').toUpperCase();
    if (role !== 'STORE_MANAGER' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
      throw new Error(`Unauthorized: Role "${user.role}" is not permitted to reject extra backup stock requests.`);
    }
  }

  const declaration = await getBackupDeclaration(checklist_id);
  if (!declaration || !declaration.has_backup_items) {
    throw new Error('No declared backup items found to reject.');
  }

  const nowIso = new Date().toISOString();
  const historyEntry = {
    rejected_at: nowIso,
    rejected_by: user?.id || null,
    rejected_by_name: user?.name || user?.full_name || user?.email || 'Store Manager',
    reason: reason || 'Store Manager rejected extra backup devices request',
    issuance_status: 'Rejected',
  };

  const issuanceHistory = Array.isArray(declaration.issuance_history) ? [...declaration.issuance_history] : [];
  issuanceHistory.push(historyEntry);

  const payload = {
    issuance_status: 'Rejected',
    issuance_history: issuanceHistory,
    updated_at: nowIso,
  };

  try {
    await supabase
      .from('pre_installation_backup_declarations')
      .update(payload)
      .eq('id', declaration.id);
  } catch (e) {}

  Object.assign(declaration, payload);
  inMemoryDeclarations.set(checklist_id, declaration);
  saveBackupItemsStorage();

  return {
    success: true,
    message: 'Extra backup devices request rejected.',
    issuance_status: 'Rejected',
  };
}

/**
 * Store Manager physically verifies returned loose backup items
 * Restores usable stock ONLY after physical verification.
 * Missing items are never added to stock.
 * Damaged items are recorded separately and not added to usable stock.
 * Prevents duplicate additions.
 * Safeguard: Unissued items are never restored to stock.
 */
export async function verifyStoreBackupItemReturn({
  checklistId,
  user,
  verificationItems = [],
  remarks = '',
}) {
  if (!checklistId) throw new Error('Checklist ID is required.');
  const verificationKey = `backup-ret-${checklistId}`;

  if (inMemoryVerifiedReturns.has(verificationKey)) {
    throw new Error('Returned backup items for this checklist have already been physically verified and processed.');
  }

  const declaration = await getBackupDeclaration(checklistId);
  if (!declaration || !declaration.items || declaration.items.length === 0) {
    throw new Error('No declared backup items found for this checklist.');
  }

  const verificationResults = [];

  for (const row of verificationItems) {
    const itemName = (row.item_name || '').trim();
    const acceptedUsable = Math.max(0, Number(row.accepted_usable_qty) || 0);
    const damagedQty = Math.max(0, Number(row.damaged_qty) || 0);
    const missingQty = Math.max(0, Number(row.missing_qty) || 0);

    let matchingDeclItem = declaration.items.find(
      (it) => it.item_name.toLowerCase() === itemName.toLowerCase()
    );
    if (!matchingDeclItem && itemName.toLowerCase().includes('display')) {
      matchingDeclItem = declaration.items.find((it) => it.item_name.toLowerCase().includes('display'));
    }

    if (!matchingDeclItem) {
      continue;
    }

    // Safeguard: Do NOT restore stock for unissued items
    const issuedQty = Number(matchingDeclItem.quantity_issued) || 0;
    if (issuedQty <= 0) {
      console.warn(`Skipping stock restoration for unissued backup item "${itemName}" (quantity_issued is 0).`);
      verificationResults.push({
        item_name: itemName,
        unit: matchingDeclItem.unit,
        accepted_usable_qty: 0,
        unissued_discarded_qty: acceptedUsable,
        damaged_qty: damagedQty,
        missing_qty: missingQty,
        notice: 'Unissued items cannot restore stock',
        verified_at: new Date().toISOString(),
      });
      continue;
    }

    // Do not restore more stock than was actually issued
    const finalUsableRestored = Math.min(acceptedUsable, issuedQty);

    // Only restore stock if the item was physically verified as usable by Store Manager
    // And only add the accepted usable quantity (never damaged or missing)
    if (finalUsableRestored > 0) {
      try {
        const allMats = await getMaterialInventory();
        let targetMat = allMats.find((m) => m.material_name.toLowerCase() === itemName.toLowerCase());
        if (!targetMat && itemName.toLowerCase().includes('display')) {
          targetMat = allMats.find((m) => m.material_name.toLowerCase() === 'display');
        }
        if (targetMat) {
          await adjustMaterialStock({
            material_name: targetMat.material_name,
            action: 'ADD',
            quantity: finalUsableRestored,
            reason: `Physical return verification for checklist ${checklistId}: ${finalUsableRestored} ${matchingDeclItem.unit || 'Nos.'} usable stock restored. ${remarks || ''}`.trim(),
            user,
          });
        } else {
          const allDevs = await getInventoryProducts();
          const devExists = allDevs.some((d) => d.device_type.toLowerCase() === itemName.toLowerCase());
          if (devExists) {
            await adjustStock({
              device_type: itemName,
              action: 'ADD',
              quantity: finalUsableRestored,
              reason: `Physical return verification for checklist ${checklistId}: ${finalUsableRestored} units usable stock restored. ${remarks || ''}`.trim(),
              user,
            });
          } else {
            await adjustMaterialStock({
              material_name: itemName,
              action: 'ADD',
              quantity: finalUsableRestored,
              reason: `Physical return verification for checklist ${checklistId}: ${finalUsableRestored} ${matchingDeclItem.unit || 'Nos.'} usable stock restored. ${remarks || ''}`.trim(),
              user,
            });
          }
        }
      } catch (stockAdjErr) {
        console.warn(`Stock adjustment on return verification for ${itemName}:`, stockAdjErr.message);
      }
    }

    verificationResults.push({
      item_name: itemName,
      unit: matchingDeclItem.unit,
      accepted_usable_qty: acceptedUsable,
      damaged_qty: damagedQty,
      missing_qty: missingQty,
      verified_at: new Date().toISOString(),
    });
  }

  inMemoryVerifiedReturns.add(verificationKey);
  saveBackupItemsStorage();

  await logAudit({
    actor_id: user?.id,
    actor_email: user?.email,
    actor_role: user?.role || 'STORE_MANAGER',
    action: 'VERIFY_BACKUP_ITEMS_RETURN',
    target_table: 'pre_installation_backup_declarations',
    target_id: declaration.id,
    details: {
      checklist_id: checklistId,
      verification_results: verificationResults,
      remarks,
    },
  });

  return {
    success: true,
    message: 'Returned backup items physically verified and usable stock restored.',
    verification_results: verificationResults,
  };
}

/**
 * Determines whether a checklist is technician-dependent:
 * - Non-courier checklists (Technician Carries) are technician-dependent.
 * - Product Courier is technician-dependent ONLY if a technician is assigned.
 */
export function isChecklistTechnicianDependent(checklist) {
  if (!checklist) return false;
  const deliveryMethod = checklist.delivery_method || 'Technician Carries';
  const isCourier = deliveryMethod === 'Product Couriered';
  if (!isCourier) {
    return true;
  }
  const tech = (checklist.service_engineer || '').trim();
  return Boolean(tech && tech.toLowerCase() !== 'unassigned');
}

/**
 * Determines whether a technician has successfully submitted the Pre-Installation Form
 * for a checklist across in-memory stores and DB records.
 */
export async function isPreInstallationSubmitted(checklistId, checklist = null) {
  if (!checklistId) return false;

  // 1. In-memory backup declarations
  const memDecl = inMemoryDeclarations.get(checklistId);
  if (memDecl && ['DECLARED', 'CORRECTED', 'VERIFIED'].includes(memDecl.status)) {
    return true;
  }

  // 2. In-memory carry records
  try {
    const { inMemoryCarryRecords } = await import('./workflowService.js');
    const memCarry = inMemoryCarryRecords?.get(checklistId);
    if (memCarry && ['SUBMITTED', 'AUDITED'].includes(memCarry.status)) {
      return true;
    }
  } catch (e) {}

  const isUuid = typeof checklistId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checklistId);
  if (!isUuid) {
    return false;
  }

  // 3. Supabase pre_installation_backup_declarations table
  try {
    const { data: dbDecl, error: declErr } = await supabase
      .from('pre_installation_backup_declarations')
      .select('status')
      .eq('checklist_id', checklistId)
      .maybeSingle();

    if (!declErr && dbDecl && ['DECLARED', 'CORRECTED', 'VERIFIED'].includes(dbDecl.status)) {
      return true;
    }
  } catch (e) {}

  // 4. Supabase job_device_carry_records table
  try {
    const { data: dbCarry, error: carryErr } = await supabase
      .from('job_device_carry_records')
      .select('status')
      .eq('checklist_id', checklistId)
      .maybeSingle();

    if (!carryErr && dbCarry && ['SUBMITTED', 'AUDITED'].includes(dbCarry.status)) {
      return true;
    }
  } catch (e) {}

  return false;
}
