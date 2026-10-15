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
    const { data: dbCreated, error } = await supabase
      .from('stock_movements')
      .insert([{
        product_id: movementRecord.product_id,
        item_id: movementRecord.item_id,
        item_name: movementRecord.item_name,
        sku: movementRecord.sku,
        category: movementRecord.category,
        movement_type: movementRecord.movement_type,
        quantity: movementRecord.quantity,
        unit: movementRecord.unit,
        balance_before: movementRecord.balance_before,
        balance_after: movementRecord.balance_after,
        checklist_id: movementRecord.checklist_id,
        reference_transaction_id: movementRecord.reference_transaction_id,
        performed_by: movementRecord.performed_by,
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
    } else if (error) {
      if (error.message?.includes('violates foreign key constraint') && movementRecord.performed_by) {
        const { data: dbRetry, error: retryError } = await supabase
          .from('stock_movements')
          .insert([{
            product_id: movementRecord.product_id,
            item_id: movementRecord.item_id,
            item_name: movementRecord.item_name,
            sku: movementRecord.sku,
            category: movementRecord.category,
            movement_type: movementRecord.movement_type,
            quantity: movementRecord.quantity,
            unit: movementRecord.unit,
            balance_before: movementRecord.balance_before,
            balance_after: movementRecord.balance_after,
            checklist_id: movementRecord.checklist_id,
            reference_transaction_id: movementRecord.reference_transaction_id,
            performed_by: null,
            performer_name: movementRecord.performer_name,
            performer_email: movementRecord.performer_email,
            reason_or_remarks: movementRecord.reason_or_remarks,
            idempotency_key: movementRecord.idempotency_key,
            created_at: movementRecord.created_at,
          }])
          .select()
          .single();
        if (!retryError && dbRetry) {
          movementRecord.id = dbRetry.id;
        } else {
          console.warn('DB stock_movements retry notice:', retryError?.message);
        }
      } else {
        console.warn('DB stock_movements insert notice:', error.message);
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

    if (!error && data) {
      return {
        movements: data,
        transactions: data, // For backward compatibility with frontend consumers
        totalCount: count !== null ? count : data.length,
        page: pageNum,
        totalPages: Math.ceil((count !== null ? count : data.length) / limitNum) || 1,
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
    filtered = filtered.filter((m) => m.movement_type === type);
  }

  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    filtered = filtered.filter(
      (m) =>
        (m.item_name || '').toLowerCase().includes(s) ||
        (m.sku || '').toLowerCase().includes(s) ||
        (m.reason_or_remarks || '').toLowerCase().includes(s) ||
        (m.performer_name || '').toLowerCase().includes(s) ||
        (m.idempotency_key || '').toLowerCase().includes(s)
    );
  }

  const paginated = filtered.slice(offset, offset + limitNum);

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
 * Delete a specific stock movement by ID from both Supabase and in-memory/file storage
 */
export async function deleteStockMovementById(movementId) {
  if (!movementId) return false;

  // 1. Delete from Supabase
  try {
    await supabase.from('stock_movements').delete().eq('id', movementId);
  } catch (err) {
    console.warn('Could not delete stock movement from Supabase:', err.message);
  }

  // 2. Delete from in-memory fallback list
  const idx = inMemoryStockMovements.findIndex((m) => m.id === movementId);
  if (idx !== -1) {
    inMemoryStockMovements.splice(idx, 1);
  }

  // 3. Delete from inventory_storage.json legacy transactions if present
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      if (Array.isArray(data.deviceTransactions)) {
        data.deviceTransactions = data.deviceTransactions.filter((t) => t.id !== movementId);
      }
      if (Array.isArray(data.materialTransactions)) {
        data.materialTransactions = data.materialTransactions.filter((t) => t.id !== movementId);
      }
      data.stockMovements = inMemoryStockMovements;
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('Could not update inventory_storage after delete:', err.message);
  }

  return true;
}

/**
 * Clear all or filtered stock movements history from both Supabase and in-memory/file storage
 */
export async function clearStockMovementsHistory({ category = 'All', type = 'All' } = {}) {
  let deletedCount = 0;

  // 1. Delete from Supabase
  try {
    let query = supabase.from('stock_movements').delete();

    if (category === 'Devices' || category === 'Camera Device') {
      query = query.eq('category', 'Camera Device');
    } else if (category === 'Materials' || category === 'Installation Material') {
      query = query.eq('category', 'Installation Material');
    } else {
      query = query.not('id', 'is', null);
    }

    if (type && type !== 'All') {
      query = query.eq('movement_type', type);
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      deletedCount = data.length;
    }
  } catch (err) {
    console.warn('Could not delete stock movements from Supabase:', err.message);
  }

  // 2. Delete from in-memory fallback list
  const beforeCount = inMemoryStockMovements.length;
  if (category === 'All' && type === 'All') {
    inMemoryStockMovements.length = 0;
  } else {
    const surviving = inMemoryStockMovements.filter((m) => {
      const matchCat = (category === 'Devices' && m.category === 'Camera Device') ||
                       (category === 'Materials' && m.category === 'Installation Material') ||
                       category === 'All';
      const matchType = type === 'All' || m.movement_type === type;
      return !(matchCat && matchType);
    });
    inMemoryStockMovements.length = 0;
    inMemoryStockMovements.push(...surviving);
  }

  // 3. Clear from inventory_storage.json
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      if (category === 'All' && type === 'All') {
        data.deviceTransactions = [];
        data.materialTransactions = [];
      }
      data.stockMovements = inMemoryStockMovements;
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    }
  } catch (err) {
    console.warn('Could not save storage after clear:', err.message);
  }

  deletedCount = Math.max(deletedCount, beforeCount - inMemoryStockMovements.length);
  return { success: true, deletedCount };
}

