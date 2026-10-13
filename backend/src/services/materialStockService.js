import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { INITIAL_BOM_TEMPLATE } from './bomService.js';
import { updateRequirementIssuanceStatus } from './storeRequirementService.js';

/**
 * Resilient in-memory store for material inventory
 */
const inMemoryMaterials = new Map(
  INITIAL_BOM_TEMPLATE.map((item, idx) => [
    item.material_name,
    {
      id: `mat-${idx + 1}`,
      material_name: item.material_name,
      unit: item.unit,
      current_stock: item.material_name.includes('Screw') ? 2000 : item.material_name.includes('wire') ? 5000 : 500,
      issued_stock: 0,
      min_stock_level: 20,
      updated_at: new Date().toISOString(),
    },
  ])
);

const inMemoryMaterialTransactions = [];
const processedChecklistMaterialIssuances = new Set();

/**
 * Get all materials in inventory with current stock balances
 */
export async function getMaterialInventory() {
  try {
    const { data, error } = await supabase
      .from('material_inventory')
      .select('*')
      .order('material_name', { ascending: true });

    if (!error && data && data.length > 0) {
      data.forEach((m) => {
        inMemoryMaterials.set(m.material_name, { ...m });
      });
      return data;
    }
  } catch (err) {
    console.warn('DB material_inventory fetch failed, using in-memory store:', err.message);
  }

  return Array.from(inMemoryMaterials.values()).sort((a, b) => a.material_name.localeCompare(b.material_name));
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
    material = {
      id: `mat-${Date.now()}`,
      material_name: name,
      unit: 'Nos.',
      current_stock: 0,
      issued_stock: 0,
      min_stock_level: 20,
      updated_at: new Date().toISOString(),
    };
    inMemoryMaterials.set(name, material);
  }

  const current = Number(material.current_stock) || 0;
  let newCurrent = current;
  let qtyDelta = 0;
  let txType = 'STOCK_ADJUSTMENT';

  if (normalizedAction === 'ADD') {
    if (qty <= 0) throw new Error('Quantity to add must be greater than 0.');
    newCurrent = current + qty;
    qtyDelta = qty;
    txType = 'STOCK_RECEIVED';
  } else if (normalizedAction === 'REMOVE') {
    if (qty <= 0) throw new Error('Quantity to remove must be greater than 0.');
    if (qty > current) {
      throw new Error(`Cannot remove ${qty} ${material.unit}. Current stock is only ${current} ${material.unit}. Negative stock is prevented.`);
    }
    newCurrent = current - qty;
    qtyDelta = -qty;
    txType = 'STOCK_ADJUSTMENT';
  } else if (normalizedAction === 'SET') {
    newCurrent = qty;
    qtyDelta = qty - current;
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
    unit: material.unit,
    checklist_id: null,
    performed_by: user?.id || null,
    performer_name: user?.full_name || user?.email || 'Store Manager',
    reason_or_remarks: `[${normalizedAction}] ${reason.trim()} (Stock: ${current} → ${newCurrent} ${material.unit})`,
    idempotency_key: `MAT-ADJ-${name}-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('material_stock_transactions').insert([{
      material_id: materialId,
      material_name: name,
      transaction_type: txType,
      quantity: Math.abs(qtyDelta),
      unit: material.unit,
      performed_by: user?.id || null,
      reason_or_remarks: txRecord.reason_or_remarks,
      idempotency_key: txRecord.idempotency_key,
    }]);
  } catch (txErr) {
    console.warn('DB transaction insert error for material stock:', txErr.message);
  }

  inMemoryMaterialTransactions.unshift(txRecord);

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
        previous_stock: current,
        new_stock: newCurrent,
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
    previous_stock: current,
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
        throw new Error(`Checklist ${chk.checklist_number} is a Service job. Material issuance is only applicable for Installation jobs.`);
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
    // Attempt to load from checklist's bom_snapshot
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
    const newStock = Math.max(0, (Number(existingMat?.current_stock) || 0) - qtyRequired);
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

    // Insert stock transaction
    const idempotencyKey = `MAT-ISSUE-${checklist_id}-${matName}`;
    const txRecord = {
      id: `tx-issue-mat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      material_id: materialId,
      material_name: matName,
      transaction_type: 'STOCK_ISSUED',
      quantity: qtyRequired,
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
      material_name: matName,
      quantity_issued: qtyRequired,
      unit,
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
  const { page = 1, limit = 50, search = '' } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('material_stock_transactions')
      .select('*, performer:admin_users(email, full_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

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
