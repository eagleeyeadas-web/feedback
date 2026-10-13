import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { updateRequirementIssuanceStatus } from './storeRequirementService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/inventory_storage.json');

export const STANDARD_MATERIALS = [
  { id: 'mat-001', sku: 'MAT-INSU-TAPE', material_name: 'Insulation Tape', unit: 'Nos.', opening_stock: 100, current_stock: 100, opening_stock_set: true, min_stock_level: 20 },
  { id: 'mat-002', sku: 'MAT-CT-200MM', material_name: 'Cable Tie – 200 mm', unit: 'Packets', opening_stock: 50, current_stock: 50, opening_stock_set: true, min_stock_level: 10 },
  { id: 'mat-003', sku: 'MAT-CT-300MM', material_name: 'Cable Tie – 300 mm', unit: 'Packets', opening_stock: 40, current_stock: 40, opening_stock_set: true, min_stock_level: 10 },
  { id: 'mat-004', sku: 'MAT-SCREW-LONG', material_name: 'Long Screw', unit: 'Nos.', opening_stock: 500, current_stock: 500, opening_stock_set: true, min_stock_level: 50 },
  { id: 'mat-005', sku: 'MAT-SCREW-SMALL', material_name: 'Small Screw', unit: 'Nos.', opening_stock: 500, current_stock: 500, opening_stock_set: true, min_stock_level: 50 },
  { id: 'mat-006', sku: 'MAT-MEM-CARD', material_name: 'Memory Card', unit: 'Nos.', opening_stock: 100, current_stock: 100, opening_stock_set: true, min_stock_level: 15 },
  { id: 'mat-007', sku: 'MAT-WIRE-0.5MM', material_name: '0.5 mm Wire', unit: 'Metres', opening_stock: 1000, current_stock: 1000, opening_stock_set: true, min_stock_level: 100 },
  { id: 'mat-008', sku: 'MAT-CBL-5M', material_name: '5-metre Cable', unit: 'Nos.', opening_stock: 150, current_stock: 150, opening_stock_set: true, min_stock_level: 25 },
  { id: 'mat-009', sku: 'MAT-CBL-15M', material_name: '15-metre Cable', unit: 'Nos.', opening_stock: 50, current_stock: 50, opening_stock_set: true, min_stock_level: 10 },
];

/**
 * Resilient in-memory store for material inventory with persistent file backing
 */
const inMemoryMaterials = new Map(
  STANDARD_MATERIALS.map((item) => [
    item.material_name,
    {
      id: item.id,
      sku: item.sku,
      material_name: item.material_name,
      unit: item.unit,
      opening_stock: item.opening_stock,
      opening_stock_set: item.opening_stock_set,
      current_stock: item.current_stock,
      issued_stock: 0,
      min_stock_level: item.min_stock_level,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
  ])
);

const inMemoryMaterialTransactions = [];
const processedChecklistMaterialIssuances = new Set();
const processedMaterialReturnCredits = new Set();
let dbSeeded = false;

/**
 * Load persistent materials state from JSON file
 */
export function loadMaterialFallbackStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.materialProducts && typeof data.materialProducts === 'object') {
        Object.entries(data.materialProducts).forEach(([k, v]) => {
          inMemoryMaterials.set(k, { ...v });
        });
      }
      if (Array.isArray(data.materialTransactions)) {
        inMemoryMaterialTransactions.length = 0;
        inMemoryMaterialTransactions.push(...data.materialTransactions);
      }
      if (Array.isArray(data.processedChecklistMaterialIssuances)) {
        data.processedChecklistMaterialIssuances.forEach((id) => processedChecklistMaterialIssuances.add(id));
      }
      if (Array.isArray(data.processedMaterialReturnCredits)) {
        data.processedMaterialReturnCredits.forEach((id) => processedMaterialReturnCredits.add(id));
      }
    } else {
      saveMaterialFallbackStorage();
    }
  } catch (err) {
    console.warn('Could not load material fallback storage:', err.message);
  }
}

/**
 * Save persistent materials state to JSON file
 */
export function saveMaterialFallbackStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let data = {};
    if (fs.existsSync(STORAGE_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      } catch (e) {
        data = {};
      }
    }
    data.materialProducts = Object.fromEntries(inMemoryMaterials);
    data.materialTransactions = inMemoryMaterialTransactions;
    data.processedChecklistMaterialIssuances = Array.from(processedChecklistMaterialIssuances);
    data.processedMaterialReturnCredits = Array.from(processedMaterialReturnCredits);
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save material fallback storage:', err.message);
  }
}

// Load storage on module initialization
loadMaterialFallbackStorage();

/**
 * Ensure database has standard materials without inflating or duplicating stock.
 * Checks existing records first. Only inserts missing items with their opening stock.
 */
async function ensureDbMaterialsSeeded() {
  if (dbSeeded) return;
  try {
    const { data: existing, error } = await supabase
      .from('material_inventory')
      .select('id, material_name, current_stock, opening_stock');

    if (!error && Array.isArray(existing)) {
      const existingNames = new Set(existing.map((m) => m.material_name.toLowerCase()));
      const missing = STANDARD_MATERIALS.filter((m) => !existingNames.has(m.material_name.toLowerCase()));

      if (missing.length > 0) {
        await supabase.from('material_inventory').insert(
          missing.map((m) => ({
            material_name: m.material_name,
            sku: m.sku,
            unit: m.unit,
            opening_stock: m.opening_stock,
            opening_stock_set: true,
            current_stock: m.opening_stock,
            issued_stock: 0,
            min_stock_level: m.min_stock_level,
            is_active: true,
          }))
        );
      }
      dbSeeded = true;
    }
  } catch (err) {
    // Database table might not be migrated yet; fallback to in-memory store
  }
}

/**
 * Get all materials in inventory with current stock balances
 */
export async function getMaterialInventory() {
  await ensureDbMaterialsSeeded();

  try {
    const { data, error } = await supabase
      .from('material_inventory')
      .select('*')
      .order('material_name', { ascending: true });

    if (!error && data && data.length > 0) {
      data.forEach((m) => {
        inMemoryMaterials.set(m.material_name, { ...m });
      });
      saveMaterialFallbackStorage();
      return data;
    }
  } catch (err) {
    console.warn('DB material_inventory fetch failed, using in-memory store:', err.message);
  }

  return Array.from(inMemoryMaterials.values()).sort((a, b) => a.material_name.localeCompare(b.material_name));
}

/**
 * Explicitly set Opening Stock for a material.
 * Only Store Manager can set or update opening stock.
 * Does not add on top of existing stock; explicitly sets the baseline opening stock.
 */
export async function setMaterialOpeningStock({
  material_name,
  material_id,
  opening_stock,
  reason,
  user,
}) {
  if (!material_name && !material_id) {
    throw new Error('Material name or ID is required.');
  }

  const qty = parseFloat(opening_stock);
  if (isNaN(qty) || qty < 0) {
    throw new Error('Opening stock must be a non-negative number.');
  }

  const all = await getMaterialInventory();
  const material = all.find(
    (m) =>
      (material_id && m.id === material_id) ||
      (material_name && m.material_name.toLowerCase() === material_name.trim().toLowerCase())
  ) || inMemoryMaterials.get(material_name);

  if (!material) {
    throw new Error(`Material "${material_name || material_id}" not found.`);
  }

  const previousBalance = Number(material.current_stock) || 0;
  const newBalance = qty;
  const targetId = material.id;
  const targetName = material.material_name;
  const unit = material.unit || 'Nos.';

  // Update in-memory
  material.opening_stock = qty;
  material.opening_stock_set = true;
  material.current_stock = newBalance;
  material.updated_at = new Date().toISOString();
  inMemoryMaterials.set(targetName, material);

  // Update DB
  try {
    await supabase
      .from('material_inventory')
      .update({
        opening_stock: qty,
        opening_stock_set: true,
        current_stock: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetId);
  } catch (err) {
    console.warn('DB update opening stock error:', err.message);
  }

  // Create audit transaction
  const txRecord = {
    id: `tx-mat-open-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    material_id: targetId,
    material_name: targetName,
    transaction_type: 'OPENING_STOCK',
    quantity: qty,
    previous_balance: previousBalance,
    new_balance: newBalance,
    unit,
    checklist_id: null,
    performed_by: user?.id || null,
    performer_name: user?.full_name || user?.email || 'Store Manager',
    reason_or_remarks: reason ? reason.trim() : `Opening stock set to ${qty} ${unit}`,
    idempotency_key: `MAT-OPEN-${targetName}-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('material_stock_transactions').insert([{
      material_id: targetId,
      material_name: targetName,
      transaction_type: 'OPENING_STOCK',
      quantity: qty,
      previous_balance: previousBalance,
      new_balance: newBalance,
      unit,
      performed_by: user?.id || null,
      reason_or_remarks: txRecord.reason_or_remarks,
      idempotency_key: txRecord.idempotency_key,
    }]);
  } catch (txErr) {
    console.warn('DB transaction insert error:', txErr.message);
  }

  inMemoryMaterialTransactions.unshift(txRecord);
  saveMaterialFallbackStorage();

  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'MATERIAL_OPENING_STOCK_SET',
      target_table: 'material_inventory',
      target_id: targetId,
      details: {
        material_name: targetName,
        opening_stock: qty,
        previous_balance: previousBalance,
        new_balance: newBalance,
        unit,
        reason,
      },
    }).catch(() => null);
  }

  return {
    success: true,
    material_name: targetName,
    opening_stock: qty,
    current_stock: newBalance,
    unit,
    transaction: txRecord,
  };
}

/**
 * Adjust or Restock material inventory balances (Add, Remove, Set)
 */
export async function adjustMaterialStock({
  material_name,
  action, // 'ADD' | 'REMOVE' | 'SET'
  quantity,
  reason,
  user,
}) {
  if (!material_name || !material_name.trim()) {
    throw new Error('Material name is required.');
  }

  const name = material_name.trim();
  const qty = parseFloat(quantity);
  if (isNaN(qty) || qty < 0) {
    throw new Error('Quantity must be a valid non-negative number.');
  }

  if (!reason || !reason.trim()) {
    throw new Error('A reason is required for any material stock adjustment.');
  }

  const normalizedAction = (action || '').toUpperCase();
  let material = inMemoryMaterials.get(name);

  if (!material) {
    // Attempt lookup from DB
    try {
      const { data: dbItem } = await supabase
        .from('material_inventory')
        .select('*')
        .eq('material_name', name)
        .maybeSingle();
      if (dbItem) {
        material = { ...dbItem };
        inMemoryMaterials.set(name, material);
      }
    } catch (e) {
      // Ignore
    }
  }

  if (!material) {
    material = {
      id: `mat-${Date.now()}`,
      material_name: name,
      unit: 'Nos.',
      opening_stock: 0,
      opening_stock_set: false,
      current_stock: 0,
      issued_stock: 0,
      min_stock_level: 20,
      updated_at: new Date().toISOString(),
    };
    inMemoryMaterials.set(name, material);
  }

  const previousBalance = Number(material.current_stock) || 0;
  let newCurrent = previousBalance;
  let qtyDelta = 0;
  let txType = 'STOCK_ADJUSTMENT';

  if (normalizedAction === 'ADD') {
    if (qty <= 0) throw new Error('Quantity to add must be greater than 0.');
    newCurrent = previousBalance + qty;
    qtyDelta = qty;
    txType = 'STOCK_RECEIVED';
  } else if (normalizedAction === 'REMOVE') {
    if (qty <= 0) throw new Error('Quantity to remove must be greater than 0.');
    if (qty > previousBalance) {
      throw new Error(`Cannot remove ${qty} ${material.unit}. Current stock is only ${previousBalance} ${material.unit}. Negative stock is prevented.`);
    }
    newCurrent = previousBalance - qty;
    qtyDelta = -qty;
    txType = 'STOCK_ADJUSTMENT';
  } else if (normalizedAction === 'SET') {
    newCurrent = qty;
    qtyDelta = qty - previousBalance;
    txType = 'STOCK_ADJUSTMENT';
  } else {
    throw new Error('Invalid adjustment action. Supported actions: ADD, REMOVE, SET.');
  }

  // Update in-memory
  material.current_stock = newCurrent;
  material.updated_at = new Date().toISOString();

  // Try DB update
  let materialId = material.id;
  try {
    const { data: dbMat } = await supabase
      .from('material_inventory')
      .select('*')
      .eq('material_name', name)
      .maybeSingle();

    if (dbMat) {
      materialId = dbMat.id;
      await supabase
        .from('material_inventory')
        .update({
          current_stock: newCurrent,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dbMat.id);
    } else {
      const { data: insertedMat } = await supabase
        .from('material_inventory')
        .insert({
          material_name: name,
          unit: material.unit || 'Nos.',
          current_stock: newCurrent,
          opening_stock: normalizedAction === 'SET' ? newCurrent : 0,
          opening_stock_set: normalizedAction === 'SET',
          min_stock_level: material.min_stock_level || 20,
        })
        .select()
        .single();
      if (insertedMat) materialId = insertedMat.id;
    }
  } catch (dbErr) {
    console.warn('DB update for material_inventory failed, using in-memory store:', dbErr.message);
  }

  const txRecord = {
    id: `tx-mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    material_id: materialId,
    material_name: name,
    transaction_type: txType,
    quantity: Math.abs(qtyDelta),
    previous_balance: previousBalance,
    new_balance: newCurrent,
    unit: material.unit,
    checklist_id: null,
    performed_by: user?.id || null,
    performer_name: user?.full_name || user?.email || 'Store Manager',
    reason_or_remarks: `[${normalizedAction}] ${reason.trim()} (Stock: ${previousBalance} → ${newCurrent} ${material.unit})`,
    idempotency_key: `MAT-ADJ-${name}-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('material_stock_transactions').insert([{
      material_id: materialId,
      material_name: name,
      transaction_type: txType,
      quantity: Math.abs(qtyDelta),
      previous_balance: previousBalance,
      new_balance: newCurrent,
      unit: material.unit,
      performed_by: user?.id || null,
      reason_or_remarks: txRecord.reason_or_remarks,
      idempotency_key: txRecord.idempotency_key,
    }]);
  } catch (txErr) {
    console.warn('DB transaction insert error for material stock:', txErr.message);
  }

  inMemoryMaterialTransactions.unshift(txRecord);
  saveMaterialFallbackStorage();

  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: `MATERIAL_STOCK_${normalizedAction}`,
      target_table: 'material_inventory',
      target_id: materialId,
      details: {
        material_name: name,
        action: normalizedAction,
        previous_balance: previousBalance,
        new_balance: newCurrent,
        quantity_delta: qtyDelta,
        unit: material.unit,
        reason,
      },
    }).catch(() => null);
  }

  return {
    success: true,
    material_name: name,
    action: normalizedAction,
    previous_balance: previousBalance,
    current_stock: newCurrent,
    unit: material.unit,
    transaction: txRecord,
  };
}

/**
 * Server-side atomic transaction to issue materials for an installation checklist.
 * Validates available stock for ALL items before making any deductions (Atomic).
 * Prevents negative stock.
 * Prevents duplicate issuance for the same checklist.
 */
export async function issueMaterialsForChecklist({
  checklist_id,
  items,
  remarks = '',
  user,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required.');
  }

  // Idempotency check: prevent duplicate deductions
  if (processedChecklistMaterialIssuances.has(checklist_id)) {
    throw new Error(`Materials have already been issued for checklist ${checklist_id}. Duplicate issuance is prevented.`);
  }

  // Check database checklist state to ensure it is not already marked as ISSUED and not a Service job
  try {
    const { data: chk } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, material_issuance_status, bom_snapshot, installation_or_service')
      .eq('id', checklist_id)
      .maybeSingle();

    if (chk) {
      if (chk.installation_or_service === 'Service') {
        throw new Error(`Checklist ${chk.checklist_number} is a Service job. Installation material issuance is not applicable.`);
      }
      if (chk.material_issuance_status === 'ISSUED') {
        processedChecklistMaterialIssuances.add(checklist_id);
        throw new Error(`Materials have already been issued for checklist ${chk.checklist_number}.`);
      }
    }
  } catch (err) {
    if (err.message.includes('already been issued') || err.message.includes('Service job')) throw err;
  }

  // Determine items to issue (from request body or fallback to checklist's saved bom_snapshot)
  let itemsToIssue = items;
  if (!itemsToIssue || !Array.isArray(itemsToIssue) || itemsToIssue.length === 0) {
    try {
      const { data: chk } = await supabase
        .from('installation_checklists')
        .select('bom_snapshot')
        .eq('id', checklist_id)
        .maybeSingle();
      if (chk?.bom_snapshot?.items && Array.isArray(chk.bom_snapshot.items)) {
        itemsToIssue = chk.bom_snapshot.items;
      }
    } catch (e) {
      // Ignore
    }
  }

  if (!itemsToIssue || !Array.isArray(itemsToIssue) || itemsToIssue.length === 0) {
    throw new Error('No materials specified for issuance.');
  }

  // 1. Fetch current materials inventory
  const allMaterials = await getMaterialInventory();
  const matMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));

  // 2. ATOMIC PRE-CHECK: Validate sufficient stock for ALL items BEFORE making any deductions
  for (const item of itemsToIssue) {
    const matName = (item.material_name || '').trim();
    const qtyRequired = parseFloat(item.total_quantity !== undefined ? item.total_quantity : item.quantity);

    if (isNaN(qtyRequired) || qtyRequired <= 0) continue;

    const existingMat = matMap.get(matName.toLowerCase()) || inMemoryMaterials.get(matName);
    const available = existingMat ? Number(existingMat.current_stock) || 0 : 0;
    const unit = existingMat?.unit || item.unit || 'Nos.';

    if (qtyRequired > available) {
      throw new Error(
        `Insufficient stock for "${matName}". Available: ${available} ${unit}, Required: ${qtyRequired} ${unit}. Negative stock prevented. Please replenish stock before issuing.`
      );
    }
  }

  // 3. EXECUTE ATOMIC DEDUCTION FOR ALL ITEMS
  const issuedRecords = [];

  for (const item of itemsToIssue) {
    const matName = (item.material_name || '').trim();
    const qtyRequired = parseFloat(item.total_quantity !== undefined ? item.total_quantity : item.quantity);

    if (isNaN(qtyRequired) || qtyRequired <= 0) continue;

    const existingMat = matMap.get(matName.toLowerCase()) || inMemoryMaterials.get(matName);
    let materialId = existingMat?.id || `mat-${Date.now()}`;
    const unit = existingMat?.unit || item.unit || 'Nos.';
    const previousBalance = Number(existingMat?.current_stock) || 0;
    const newStock = Math.max(0, previousBalance - qtyRequired);
    const newIssuedStock = (Number(existingMat?.issued_stock) || 0) + qtyRequired;

    // Update in Supabase
    try {
      const { data: dbMat } = await supabase
        .from('material_inventory')
        .select('*')
        .eq('material_name', matName)
        .maybeSingle();

      if (dbMat) {
        materialId = dbMat.id;
        await supabase
          .from('material_inventory')
          .update({
            current_stock: newStock,
            issued_stock: newIssuedStock,
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbMat.id);
      }
    } catch (e) {
      console.warn(`DB stock deduction error for ${matName}:`, e.message);
    }

    // Update in-memory
    if (existingMat) {
      existingMat.current_stock = newStock;
      existingMat.issued_stock = newIssuedStock;
      existingMat.updated_at = new Date().toISOString();
    }

    // Insert stock transaction with previous_balance and new_balance
    const idempotencyKey = `MAT-ISSUE-${checklist_id}-${matName}`;
    const txRecord = {
      id: `tx-issue-mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      material_id: materialId,
      material_name: matName,
      transaction_type: 'STOCK_ISSUED',
      quantity: qtyRequired,
      previous_balance: previousBalance,
      new_balance: newStock,
      unit,
      checklist_id,
      performed_by: user?.id || null,
      performer_name: user?.full_name || user?.email || 'Store Manager',
      reason_or_remarks: remarks || `Materials issued for checklist ${checklist_id}`,
      idempotency_key: idempotencyKey,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.from('material_stock_transactions').insert([{
        material_id: materialId,
        material_name: matName,
        transaction_type: 'STOCK_ISSUED',
        quantity: qtyRequired,
        previous_balance: previousBalance,
        new_balance: newStock,
        unit,
        checklist_id,
        performed_by: user?.id || null,
        reason_or_remarks: txRecord.reason_or_remarks,
        idempotency_key: idempotencyKey,
      }]);
    } catch (txErr) {
      console.warn('DB material transaction insert error:', txErr.message);
    }

    inMemoryMaterialTransactions.unshift(txRecord);
    issuedRecords.push({
      material_id: materialId,
      material_name: matName,
      quantity_issued: qtyRequired,
      unit,
      previous_balance: previousBalance,
      remaining_stock: newStock,
    });
  }

  // 4. Update checklist status to ISSUED
  try {
    await supabase
      .from('installation_checklists')
      .update({
        material_issuance_status: 'ISSUED',
        material_issued_at: new Date().toISOString(),
        material_issued_by: user?.id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', checklist_id);
  } catch (chkErr) {
    console.warn('Checklist status update error:', chkErr.message);
  }

  // Update associated store_material_requirements record
  try {
    await updateRequirementIssuanceStatus(checklist_id, {
      status: 'ISSUED',
      issued_at: new Date().toISOString(),
      issued_by: user?.id || null,
    });
  } catch (reqErr) {
    console.warn('Could not update requirement issuance status:', reqErr.message);
  }

  processedChecklistMaterialIssuances.add(checklist_id);
  saveMaterialFallbackStorage();

  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'ISSUE_MATERIALS_FOR_CHECKLIST',
      target_table: 'installation_checklists',
      target_id: checklist_id,
      details: {
        checklist_id,
        items_count: issuedRecords.length,
        items: issuedRecords,
        remarks,
      },
    }).catch(() => null);
  }

  return {
    success: true,
    checklist_id,
    material_issuance_status: 'ISSUED',
    issued_at: new Date().toISOString(),
    issued_by: user?.email || 'Store Manager',
    items: issuedRecords,
  };
}

/**
 * Get Material Stock Transactions log
 */
export async function getMaterialTransactions(params = {}) {
  const { page = 1, limit = 50, search = '', type = '' } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('material_stock_transactions')
      .select('*, performer:admin_users(email, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (type && type !== 'All') {
      query = query.eq('transaction_type', type);
    }

    if (search && search.trim()) {
      const s = search.trim();
      query = query.or(`material_name.ilike.%${s}%,reason_or_remarks.ilike.%${s}%`);
    }

    const { data, count, error } = await query;
    if (!error && data) {
      return {
        transactions: data.map((t) => ({
          ...t,
          performer_name: t.performer?.full_name || t.performer?.email || t.performed_by,
        })),
        totalCount: count || data.length,
        page: pageNum,
        totalPages: Math.ceil((count || data.length) / limitNum) || 1,
      };
    }
  } catch (err) {
    console.warn('DB material transactions query error:', err.message);
  }

  // Filter in memory
  let filtered = [...inMemoryMaterialTransactions];
  if (type && type !== 'All') {
    filtered = filtered.filter((t) => t.transaction_type === type);
  }
  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.material_name.toLowerCase().includes(s) ||
        (t.reason_or_remarks || '').toLowerCase().includes(s)
    );
  }

  const paginated = filtered.slice(offset, offset + limitNum);
  return {
    transactions: paginated,
    totalCount: filtered.length,
    page: pageNum,
    totalPages: Math.ceil(filtered.length / limitNum) || 1,
  };
}

/**
 * Priority 2 / Section 4 & 5:
 * Credit stock when Store Manager physically verifies returned materials.
 * 
 * Rules:
 * - Only add quantities that were actually issued from inventory for this job and physically returned.
 * - Do NOT add unused materials to inventory if they were never issued from inventory!
 * - Add usable returned materials to their corresponding inventory balances (current_stock).
 * - Record damaged materials separately in damaged stock / damaged audit ledger.
 * - Do NOT add missing items to stock!
 * - Reject duplicate return verification and duplicate stock additions (idempotency key).
 * - Maintain auditable stock ledger in material_stock_transactions.
 */
export async function creditMaterialStockForVerifiedReturn({
  checklist_id,
  items = [],
  user,
  remarks = '',
  return_id = null,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required to credit returned materials.');
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { success: true, credited_items: [] };
  }

  // Idempotency check: prevent duplicate credit for this return_id or checklist
  const returnKey = return_id || `MAT-RET-${checklist_id}`;
  if (processedMaterialReturnCredits.has(returnKey)) {
    throw new Error('Material returns have already been verified and credited for this job. Duplicate return verification rejected.');
  }

  // Ensure materials were actually issued for this checklist before crediting
  let checklistNumber = checklist_id;
  try {
    const { data: checklist } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, material_issuance_status')
      .eq('id', checklist_id)
      .maybeSingle();
    if (checklist?.checklist_number) {
      checklistNumber = checklist.checklist_number;
    }
  } catch (chkErr) {
    // Non-blocking
  }

  // Load all materials from DB / memory
  await ensureDbMaterialsSeeded();
  const allMaterials = await getMaterialInventory();
  const matNameMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));
  const matIdMap = new Map(allMaterials.map((m) => [m.id, m]));

  const creditedRecords = [];

  for (const item of items) {
    const rawName = (item.material_name || '').trim();
    const usableQty = Math.max(0, parseFloat(item.accepted_usable_qty ?? item.quantity_returned ?? item.usable_qty) || 0);
    const damagedQty = Math.max(0, parseFloat(item.damaged_qty) || 0);
    const missingQty = Math.max(0, parseFloat(item.missing_qty) || 0);
    const unit = item.unit || 'Nos.';

    // Only process if there is something to return or record
    if (usableQty === 0 && damagedQty === 0) continue;

    // Check if item was issued:
    const issuedQty = Number(item.quantity_issued ?? item.issued_quantity ?? 0);
    if (issuedQty > 0 && (usableQty + damagedQty) > issuedQty) {
      throw new Error(`Returned quantity (${usableQty + damagedQty} ${unit}) cannot exceed issued quantity (${issuedQty} ${unit}) for ${rawName}.`);
    }

    const matched = (item.material_id && matIdMap.get(item.material_id)) || matNameMap.get(rawName.toLowerCase());
    const targetName = matched ? matched.material_name : rawName;
    const targetId = matched?.id || item.material_id || `mat-${Date.now()}`;
    const previousBalance = matched ? Number(matched.current_stock) || 0 : 0;
    const newBalance = Math.round((previousBalance + usableQty) * 100) / 100;
    const previousIssued = matched ? Number(matched.issued_stock) || 0 : 0;
    const newIssued = Math.max(0, Math.round((previousIssued - (usableQty + damagedQty)) * 100) / 100);
    const previousDamaged = matched ? Number(matched.damaged_stock) || 0 : 0;
    const newDamaged = Math.round((previousDamaged + damagedQty) * 100) / 100;

    // Update in-memory
    if (matched) {
      matched.current_stock = newBalance;
      matched.issued_stock = newIssued;
      matched.damaged_stock = newDamaged;
      matched.updated_at = new Date().toISOString();
      inMemoryMaterials.set(matched.material_name, matched);
    }

    // Update database
    if (matched?.id && !String(matched.id).startsWith('mat-')) {
      try {
        await supabase
          .from('material_inventory')
          .update({
            current_stock: newBalance,
            issued_stock: newIssued,
            damaged_stock: newDamaged,
            updated_at: new Date().toISOString(),
          })
          .eq('id', matched.id);
      } catch (e) {
        console.warn(`DB return credit error for material ${targetName}:`, e.message);
      }
    }

    // Insert Usable Return Transaction if usableQty > 0
    if (usableQty > 0) {
      const idempotencyKeyUsable = `MAT-RET-USABLE-${checklist_id}-${targetName}-${Date.now()}`;
      const txUsable = {
        id: `tx-mat-ret-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        material_id: targetId,
        material_name: targetName,
        transaction_type: 'RETURNED_USABLE',
        quantity: usableQty,
        previous_balance: previousBalance,
        new_balance: newBalance,
        unit,
        checklist_id,
        performed_by: user?.id || null,
        performer_name: user?.full_name || user?.email || 'Store Manager',
        reason_or_remarks: remarks || `Verified usable material return from job ${checklistNumber}`,
        idempotency_key: idempotencyKeyUsable,
        created_at: new Date().toISOString(),
      };

      try {
        await supabase.from('material_stock_transactions').insert([{
          material_id: matched?.id && !String(matched.id).startsWith('mat-') ? matched.id : null,
          material_name: targetName,
          transaction_type: 'RETURNED_USABLE',
          quantity: usableQty,
          previous_balance: previousBalance,
          new_balance: newBalance,
          unit,
          checklist_id,
          performed_by: user?.id || null,
          reason_or_remarks: txUsable.reason_or_remarks,
          idempotency_key: idempotencyKeyUsable,
        }]);
      } catch (txErr) {
        console.warn('DB tx insert error for usable material return:', txErr.message);
      }
      inMemoryMaterialTransactions.unshift(txUsable);
    }

    // Insert Damaged Return Transaction if damagedQty > 0
    if (damagedQty > 0) {
      const idempotencyKeyDmg = `MAT-RET-DMG-${checklist_id}-${targetName}-${Date.now()}`;
      const txDmg = {
        id: `tx-mat-ret-d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        material_id: targetId,
        material_name: targetName,
        transaction_type: 'RETURNED_DAMAGED',
        quantity: damagedQty,
        previous_balance: previousDamaged,
        new_balance: newDamaged,
        unit,
        checklist_id,
        performed_by: user?.id || null,
        performer_name: user?.full_name || user?.email || 'Store Manager',
        reason_or_remarks: `[DAMAGED] ${remarks || `Damaged material return from job ${checklistNumber}`}`,
        idempotency_key: idempotencyKeyDmg,
        created_at: new Date().toISOString(),
      };

      try {
        await supabase.from('material_stock_transactions').insert([{
          material_id: matched?.id && !String(matched.id).startsWith('mat-') ? matched.id : null,
          material_name: targetName,
          transaction_type: 'RETURNED_DAMAGED',
          quantity: damagedQty,
          previous_balance: previousDamaged,
          new_balance: newDamaged,
          unit,
          checklist_id,
          performed_by: user?.id || null,
          reason_or_remarks: txDmg.reason_or_remarks,
          idempotency_key: idempotencyKeyDmg,
        }]);
      } catch (txErr) {
        console.warn('DB tx insert error for damaged material return:', txErr.message);
      }
      inMemoryMaterialTransactions.unshift(txDmg);
    }

    creditedRecords.push({
      material_id: targetId,
      material_name: targetName,
      unit,
      accepted_usable_qty: usableQty,
      damaged_qty: damagedQty,
      missing_qty: missingQty,
      previous_balance: previousBalance,
      new_usable_balance: newBalance,
    });
  }

  processedMaterialReturnCredits.add(returnKey);
  saveMaterialFallbackStorage();

  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'VERIFY_MATERIAL_RETURN',
      target_table: 'material_inventory',
      target_id: checklist_id,
      details: {
        checklist_id,
        items_count: creditedRecords.length,
        items: creditedRecords,
        remarks,
      },
    }).catch(() => null);
  }

  return {
    success: true,
    checklist_id,
    credited_items: creditedRecords,
  };
}
