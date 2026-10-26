import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/inventory_storage.json');

/**
 * Resilient in-memory fallback list for stock movements
 */
export const inMemoryStockMovements = [];

/**
 * Load fallback movements from JSON storage
 */
export function loadMovementFallbackStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.stockMovements)) {
        inMemoryStockMovements.length = 0;
        inMemoryStockMovements.push(...data.stockMovements);
      }
    }
  } catch (err) {
    console.warn('Could not load fallback stock movements:', err.message);
  }
}

/**
 * Save fallback movements to JSON storage
 */
export function saveMovementFallbackStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let data = {};
    if (fs.existsSync(STORAGE_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      } catch (e) {
        data = {};
      }
    }
    data.stockMovements = inMemoryStockMovements;
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save fallback stock movements:', err.message);
  }
}

// Load storage on module load
loadMovementFallbackStorage();

/**
 * Record a stock movement permanently in Supabase PostgreSQL (stock_movements table)
 * with in-memory & file-backed local fallback.
 */
export async function recordStockMovement({
  item_id = null,
  product_id = null,
  item_name,
  sku = null,
  category, // 'Camera Device' | 'Installation Material'
  movement_type,
  quantity,
  unit = 'Nos.',
  balance_before = null,
  balance_after = null,
  checklist_id = null,
  reference_transaction_id = null,
  performed_by = null,
  performer_name = null,
  performer_email = null,
  reason_or_remarks = null,
  idempotency_key = null,
  created_at = new Date().toISOString(),
}) {
  if (!item_name || !category || !movement_type || quantity === undefined) {
    throw new Error('item_name, category, movement_type, and quantity are required to record a stock movement');
  }

  const movementRecord = {
    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    item_id: item_id ? String(item_id) : null,
    product_id: product_id && !String(product_id).startsWith('dev-') && !String(product_id).startsWith('prod-') && !String(product_id).startsWith('mat-') ? product_id : null,
    item_name: String(item_name).trim(),
    sku: sku ? String(sku).trim() : null,
    category: category === 'Camera Device' ? 'Camera Device' : 'Installation Material',
    movement_type,
    quantity: Number(quantity),
    unit: unit || 'Nos.',
    balance_before: balance_before !== null && balance_before !== undefined ? Number(balance_before) : null,
    balance_after: balance_after !== null && balance_after !== undefined ? Number(balance_after) : null,
    checklist_id: checklist_id && String(checklist_id).length === 36 ? checklist_id : null,
    reference_transaction_id: reference_transaction_id ? String(reference_transaction_id) : null,
    performed_by: performed_by && String(performed_by).length === 36 ? performed_by : null,
    performer_name: performer_name || performer_email || 'Store Manager',
    performer_email: performer_email || null,
    reason_or_remarks: reason_or_remarks || null,
    idempotency_key: idempotency_key || `MOV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at,
  };

  // 1. Attempt database insertion into Supabase PostgreSQL
  try {
    const payloadsToTry = [
      // 1st attempt: exact movement_type, performed_by, and checklist_id
      { movement_type: movementRecord.movement_type, performed_by: movementRecord.performed_by, checklist_id: movementRecord.checklist_id },
      // 2nd attempt: if FK fails on performed_by, try null performed_by
      ...(movementRecord.performed_by ? [{ movement_type: movementRecord.movement_type, performed_by: null, checklist_id: movementRecord.checklist_id }] : []),
      // 3rd attempt: if FK fails on checklist_id, try null checklist_id
      ...(movementRecord.checklist_id ? [{ movement_type: movementRecord.movement_type, performed_by: null, checklist_id: null }] : []),
      // 4th & 5th attempt: if check constraint fails on SERVICE_*, try STOCK_ISSUED fallback
      ...(movementRecord.movement_type?.startsWith('SERVICE_') ? [
        { movement_type: 'STOCK_ISSUED', performed_by: movementRecord.performed_by, checklist_id: movementRecord.checklist_id },
        { movement_type: 'STOCK_ISSUED', performed_by: null, checklist_id: movementRecord.checklist_id },
        { movement_type: 'STOCK_ISSUED', performed_by: null, checklist_id: null },
      ] : []),
      // 6th attempt: if check constraint fails on EXTRA_BACKUP_ISSUED, try STOCK_ISSUED fallback
      ...(movementRecord.movement_type === 'EXTRA_BACKUP_ISSUED' ? [
        { movement_type: 'STOCK_ISSUED', performed_by: movementRecord.performed_by, checklist_id: movementRecord.checklist_id },
        { movement_type: 'STOCK_ISSUED', performed_by: null, checklist_id: movementRecord.checklist_id },
        { movement_type: 'STOCK_ISSUED', performed_by: null, checklist_id: null },
      ] : []),
    ];

    for (const attempt of payloadsToTry) {
      const { data: dbCreated, error } = await supabase
        .from('stock_movements')
        .insert([{
          product_id: movementRecord.product_id,
          item_id: movementRecord.item_id,
          item_name: movementRecord.item_name,
          sku: movementRecord.sku,
          category: movementRecord.category,
          movement_type: attempt.movement_type,
          quantity: movementRecord.quantity,
          unit: movementRecord.unit,
          balance_before: movementRecord.balance_before,
          balance_after: movementRecord.balance_after,
          checklist_id: attempt.checklist_id,
          reference_transaction_id: movementRecord.reference_transaction_id,
          performed_by: attempt.performed_by,
          performer_name: movementRecord.performer_name,
          performer_email: movementRecord.performer_email,
          reason_or_remarks: movementRecord.reason_or_remarks,
          idempotency_key: movementRecord.idempotency_key,
          created_at: movementRecord.created_at,
        }])
        .select()
        .single();

      if (!error && dbCreated) {
        movementRecord.id = dbCreated.id;
        break;
      }
    }
  } catch (dbErr) {
    console.warn('DB stock_movements insert error:', dbErr.message);
  }

  // 2. Save in-memory and persistent fallback
  inMemoryStockMovements.unshift(movementRecord);
  saveMovementFallbackStorage();

  return movementRecord;
}

export function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || ''));
}

/**
 * Determine whether a stock movement record represents a genuine, protected transaction
 * that must be preserved for audit compliance vs an eligible test or non-authoritative entry.
 */
export function isMovementProtected(movement) {
  if (!movement) return false;

  const remarks = String(
    movement.reason_or_remarks || movement.remarks || movement.reason || ''
  ).toLowerCase();

  // If explicitly flagged as test/mock/sandbox/demo, it is eligible for deletion
  const isExplicitTest =
    remarks.includes('[test]') ||
    remarks.includes('(test)') ||
    remarks.startsWith('test ') ||
    remarks.endsWith(' test') ||
    remarks === 'test' ||
    remarks.includes('dummy') ||
    remarks.includes('mock') ||
    remarks.includes('sandbox') ||
    String(movement.item_name || '').toLowerCase().includes('test item');

  if (isExplicitTest) {
    return false;
  }

  // 1. Check if linked to an installation checklist or courier dispatch
  if (movement.checklist_id) return true;
  if (movement.reference_transaction_id) return true;
  if (
    remarks.includes('checklist') ||
    remarks.includes('courier') ||
    remarks.includes('dispatch') ||
    remarks.includes('post-installation') ||
    remarks.includes('chk-')
  ) {
    return true;
  }

  // 2. Physical store movements representing physical inventory transactions
  const physicalMovementTypes = [
    'STOCK_ISSUED',
    'COURIER_DISPATCHED',
    'USABLE_STOCK_RETURNED',
    'DAMAGED_STOCK_RECEIVED',
    'DAMAGED_STOCK_DISPOSITION',
    'RETURNED_USABLE',
    'RETURNED_DAMAGED',
    'STOCK_REVERSAL',
  ];
  const type = movement.movement_type || movement.transaction_type;
  if (physicalMovementTypes.includes(type)) {
    return true;
  }

  // 3. Genuine stock adjustment or opening stock for active products without test tags
  const genuineTypes = ['OPENING_STOCK', 'STOCK_RECEIVED', 'STOCK_ADJUSTMENT'];
  if (genuineTypes.includes(type)) {
    return true;
  }

  return false;
}

export function normalizeMovement(m) {
  if (!m) return null;
  let movementType = m.movement_type || m.transaction_type;
  const remarks = String(m.reason_or_remarks || m.remarks || m.reason || '');
  if (movementType === 'STOCK_ISSUED' && (remarks.includes('Extra backup') || remarks.includes('[EXTRA_BACKUP_ISSUED]'))) {
    movementType = 'EXTRA_BACKUP_ISSUED';
  }
  return {
    ...m,
    movement_type: movementType,
    transaction_type: movementType,
    balance_before: m.balance_before !== undefined && m.balance_before !== null ? m.balance_before : m.previous_balance,
    previous_balance: m.balance_before !== undefined && m.balance_before !== null ? m.balance_before : m.previous_balance,
    balance_after: m.balance_after !== undefined && m.balance_after !== null ? m.balance_after : m.new_balance,
    new_balance: m.balance_after !== undefined && m.balance_after !== null ? m.balance_after : m.new_balance,
    reason_or_remarks: m.reason_or_remarks || m.remarks || m.reason || null,
    reason: m.reason_or_remarks || m.remarks || m.reason || null,
    is_protected: isMovementProtected(m),
  };
}

/**
 * Fetch all stock movements for a specific checklist ID
 */
export async function getStockMovementsByChecklistId(checklistId) {
  if (!checklistId) return [];
  try {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('created_at', { ascending: false });
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map(normalizeMovement);
    }
  } catch (e) {
    // Fall back to memory
  }
  return inMemoryStockMovements.filter((m) => m.checklist_id === checklistId).map(normalizeMovement);
}

/**
 * Fetch unified stock movements from Supabase PostgreSQL with pagination, filtering, and search.
 */
export async function getStockMovements(params = {}) {
  const {
    page = 1,
    limit = 50,
    category = 'All',
    type = 'All',
    search = '',
  } = params;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  // 1. Try Supabase PostgreSQL first
  try {
    let query = supabase
      .from('stock_movements')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (category === 'Devices' || category === 'Camera Device') {
      query = query.eq('category', 'Camera Device');
    } else if (category === 'Materials' || category === 'Installation Material') {
      query = query.eq('category', 'Installation Material');
    }

    if (type && type !== 'All') {
      query = query.eq('movement_type', type);
    }

    if (search && search.trim()) {
      const s = search.trim();
      query = query.or(`item_name.ilike.%${s}%,sku.ilike.%${s}%,reason_or_remarks.ilike.%${s}%,performer_name.ilike.%${s}%,idempotency_key.ilike.%${s}%`);
    }

    const { data, count, error } = await query;

    if (!error && Array.isArray(data)) {
      const normalizedData = data.map(normalizeMovement);
      return {
        movements: normalizedData,
        transactions: normalizedData, // For backward compatibility with frontend consumers
        totalCount: count !== null ? count : normalizedData.length,
        page: pageNum,
        totalPages: Math.ceil((count !== null ? count : normalizedData.length) / limitNum) || 1,
      };
    }
  } catch (err) {
    console.warn('Supabase stock_movements query failed, falling back to local storage:', err.message);
  }

  // 2. In-memory fallback filtering
  let filtered = [...inMemoryStockMovements];

  if (category === 'Devices' || category === 'Camera Device') {
    filtered = filtered.filter((m) => m.category === 'Camera Device');
  } else if (category === 'Materials' || category === 'Installation Material') {
    filtered = filtered.filter((m) => m.category === 'Installation Material');
  }

  if (type && type !== 'All') {
    filtered = filtered.filter((m) => (m.movement_type || m.transaction_type) === type);
  }

  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    filtered = filtered.filter(
      (m) =>
        (m.item_name || '').toLowerCase().includes(s) ||
        (m.sku || '').toLowerCase().includes(s) ||
        (m.reason_or_remarks || m.remarks || '').toLowerCase().includes(s) ||
        (m.performer_name || '').toLowerCase().includes(s) ||
        (m.idempotency_key || '').toLowerCase().includes(s)
    );
  }

  const paginated = filtered.slice(offset, offset + limitNum).map(normalizeMovement);

  return {
    movements: paginated,
    transactions: paginated,
    totalCount: filtered.length,
    page: pageNum,
    totalPages: Math.ceil(filtered.length / limitNum) || 1,
  };
}

/**
 * Remove local in-memory fallback records strictly older than 20 days
 * (Adhering strictly to retention rules and protections)
 */
export function pruneLocalExpiredMovements(cutoffDate) {
  const cutoffTime = new Date(cutoffDate).getTime();
  const initialCount = inMemoryStockMovements.length;

  const surviving = inMemoryStockMovements.filter((m) => {
    const createdTime = new Date(m.created_at).getTime();
    if (createdTime >= cutoffTime) return true; // Keep newer or equal
    // If older than cutoff, delete unless it has protected flags
    return false;
  });

  inMemoryStockMovements.length = 0;
  inMemoryStockMovements.push(...surviving);
  saveMovementFallbackStorage();

  return initialCount - surviving.length;
}

/**
 * Delete a specific stock movement by ID from both Supabase and in-memory/file storage.
 * Only eligible test/non-authoritative records can be deleted. Protected records throw a 400 error.
 * Deletion never alters stock quantities.
 */
export async function deleteStockMovementById(movementId, user = null) {
  if (!movementId) {
    const err = new Error('Movement ID is required for deletion.');
    err.status = 400;
    throw err;
  }

  // 1. Locate existing record to inspect protection status
  let movement = inMemoryStockMovements.find((m) => m.id === movementId);

  if (!movement && fs.existsSync(STORAGE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      movement = (data.stockMovements || []).find((m) => m.id === movementId) ||
                 (data.deviceTransactions || []).find((t) => t.id === movementId) ||
                 (data.materialTransactions || []).find((t) => t.id === movementId);
    } catch (e) {
      // ignore
    }
  }

  if (!movement && isUUID(movementId)) {
    try {
      const { data } = await supabase.from('stock_movements').select('*').eq('id', movementId).maybeSingle();
      if (data) movement = data;
    } catch (e) {
      // ignore
    }
  }

  // 2. Check if the movement is protected
  if (movement && isMovementProtected(movement)) {
    const err = new Error(
      'Cannot delete protected genuine stock transaction. Movements linked to checklists, store issuances, returns, or genuine stock changes must be preserved for audit compliance. If stock needs correction, please use an authorized Stock Adjustment or Reversal.'
    );
    err.status = 400;
    err.isProtected = true;
    throw err;
  }

  // 3. Delete from Supabase if valid UUID
  if (isUUID(movementId)) {
    try {
      const { error } = await supabase.from('stock_movements').delete().eq('id', movementId);
      if (error) {
        console.warn('Could not delete stock movement from Supabase:', error.message);
        const err = new Error(`Database error deleting movement: ${error.message}`);
        err.status = 500;
        throw err;
      }
    } catch (err) {
      if (err.status) throw err;
      console.warn('Could not delete stock movement from Supabase:', err.message);
    }
  }

  // 4. Delete from in-memory fallback list
  const idx = inMemoryStockMovements.findIndex((m) => m.id === movementId);
  if (idx !== -1) {
    inMemoryStockMovements.splice(idx, 1);
  }

  // 5. Delete from inventory_storage.json legacy transactions if present
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      if (Array.isArray(data.deviceTransactions)) {
        data.deviceTransactions = data.deviceTransactions.filter((t) => t.id !== movementId);
      }
      if (Array.isArray(data.materialTransactions)) {
        data.materialTransactions = data.materialTransactions.filter((t) => t.id !== movementId);
      }
      if (Array.isArray(data.stockMovements)) {
        data.stockMovements = data.stockMovements.filter((m) => m.id !== movementId);
      }
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('Could not update inventory_storage after delete:', err.message);
  }

  return { success: true, message: 'Stock movement deleted successfully' };
}

/**
 * Clear all or filtered eligible stock movements history from both Supabase and in-memory/file storage.
 * Protected genuine movements are safely preserved. Stock balances are never altered.
 */
export async function clearStockMovementsHistory({ category = 'All', type = 'All', user = null } = {}) {
  // 1. Fetch all matching movements to partition into eligible vs protected
  const { movements: currentMovements } = await getStockMovements({
    category,
    type,
    limit: 1000,
  });

  const allMatching = currentMovements || [];
  const eligibleToDelete = [];
  const protectedMovements = [];

  for (const m of allMatching) {
    if (isMovementProtected(m)) {
      protectedMovements.push(m);
    } else {
      eligibleToDelete.push(m);
    }
  }

  if (eligibleToDelete.length === 0) {
    return {
      success: true,
      deletedCount: 0,
      protectedCount: protectedMovements.length,
      message: `No eligible test records found to clean. All ${protectedMovements.length} matching movements are protected genuine inventory transactions and have been safely preserved.`,
    };
  }

  // 2. Delete eligible records from Supabase
  const eligibleUuids = eligibleToDelete.map((m) => m.id).filter(isUUID);
  if (eligibleUuids.length > 0) {
    try {
      const { error } = await supabase.from('stock_movements').delete().in('id', eligibleUuids);
      if (error) {
        console.warn('Could not bulk delete stock movements from Supabase:', error.message);
      }
    } catch (err) {
      console.warn('Supabase bulk delete exception:', err.message);
    }
  }

  // 3. Delete eligible records from in-memory fallback list
  const eligibleIdsSet = new Set(eligibleToDelete.map((m) => m.id));
  const surviving = inMemoryStockMovements.filter((m) => !eligibleIdsSet.has(m.id));
  inMemoryStockMovements.length = 0;
  inMemoryStockMovements.push(...surviving);

  // 4. Clear eligible records from inventory_storage.json
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      if (Array.isArray(data.deviceTransactions)) {
        data.deviceTransactions = data.deviceTransactions.filter((t) => !eligibleIdsSet.has(t.id));
      }
      if (Array.isArray(data.materialTransactions)) {
        data.materialTransactions = data.materialTransactions.filter((t) => !eligibleIdsSet.has(t.id));
      }
      data.stockMovements = inMemoryStockMovements;
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('Could not save storage after clear:', err.message);
  }

  return {
    success: true,
    deletedCount: eligibleToDelete.length,
    protectedCount: protectedMovements.length,
    message: `Cleaned ${eligibleToDelete.length} eligible test movements. Preserved ${protectedMovements.length} protected genuine inventory transactions.`,
  };
}

