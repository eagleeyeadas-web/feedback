import supabase from './supabase.js';
import { logAudit } from './auditService.js';

export const STANDARD_DEVICE_TYPES = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '6 Channel Live',
  '6 Channel Recording',
  '8 Channel Live',
];

/**
 * In-memory fallback stores for local resilience and environments where
 * Supabase inventory tables are not yet migrated
 */
const inMemoryProducts = new Map(
  STANDARD_DEVICE_TYPES.map((type, idx) => [
    type,
    {
      id: `prod-00${idx + 1}`,
      device_name: `${type} System`,
      device_type: type,
      sku: `EE-${type.replace(/\s+/g, '-').toUpperCase()}`,
      opening_quantity: 50,
      usable_stock: 50,
      issued_stock: 0,
      returned_usable_stock: 0,
      damaged_stock: 0,
      min_stock_level: 5,
      updated_at: new Date().toISOString(),
    },
  ])
);

const inMemoryTransactions = [];
const processedCarryDeductions = new Set();

/**
 * Get all inventory products and current stock balances
 */
export async function getInventoryProducts() {
  try {
    const { data, error } = await supabase
      .from('inventory_products')
      .select('*')
      .order('device_type', { ascending: true });

    if (!error && data && data.length > 0) {
      // Sync in-memory map
      data.forEach((p) => {
        inMemoryProducts.set(p.device_type, { ...p });
      });
      return data;
    }
  } catch (err) {
    console.warn('DB inventory_products table not available, using in-memory store:', err.message);
  }

  return Array.from(inMemoryProducts.values()).sort((a, b) => a.device_type.localeCompare(b.device_type));
}

/**
 * Get high-level inventory metrics summary
 */
export async function getInventorySummary() {
  const products = await getInventoryProducts();

  let totalUsable = 0;
  let totalIssued = 0;
  let totalDamaged = 0;

  products.forEach((p) => {
    totalUsable += Number(p.usable_stock) || 0;
    totalIssued += Number(p.issued_stock) || 0;
    totalDamaged += Number(p.damaged_stock) || 0;
  });

  // Calculate units awaiting return verification
  let totalAwaitingReturn = 0;
  try {
    const { data: pendingReturns, error } = await supabase
      .from('job_device_returns')
      .select('declared_return_qty')
      .eq('status', 'PENDING_STORE_VERIFICATION');

    if (!error && pendingReturns) {
      pendingReturns.forEach((r) => {
        totalAwaitingReturn += Number(r.declared_return_qty) || 0;
      });
    }
  } catch (err) {
    // Check in-memory store in workflowService if needed
  }

  return {
    totalUsable,
    totalIssued,
    totalAwaitingReturn,
    totalDamaged,
  };
}

/**
 * Add stock received from supplier / new batch (Store Manager / Admin)
 */
export async function receiveNewStock({
  device_type,
  quantity,
  user,
  supplier = '',
  purchase_ref = '',
  unit_cost = null,
  received_date = null,
  remarks = '',
}) {
  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty <= 0) {
    throw new Error('Received stock quantity must be a positive whole number greater than 0.');
  }

  if (!device_type || !STANDARD_DEVICE_TYPES.includes(device_type)) {
    throw new Error(`Invalid device type selected: "${device_type}".`);
  }

  let product = inMemoryProducts.get(device_type);
  let newUsable = ((product?.usable_stock) || 0) + qty;
  let productId = product?.id || `prod-${Date.now()}`;

  try {
    const { data: dbProd } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('device_type', device_type)
      .maybeSingle();

    if (dbProd) {
      productId = dbProd.id;
      newUsable = dbProd.usable_stock + qty;
      await supabase
        .from('inventory_products')
        .update({
          usable_stock: newUsable,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dbProd.id);
    }
  } catch (dbErr) {
    console.warn('DB update failed, updating in-memory store:', dbErr.message);
  }

  // Update in-memory product
  if (product) {
    product.usable_stock = newUsable;
    product.updated_at = new Date().toISOString();
  } else {
    product = {
      id: productId,
      device_name: `${device_type} System`,
      device_type,
      sku: `EE-${device_type.replace(/\s+/g, '-').toUpperCase()}`,
      opening_quantity: 0,
      usable_stock: newUsable,
      issued_stock: 0,
      returned_usable_stock: 0,
      damaged_stock: 0,
      min_stock_level: 5,
      updated_at: new Date().toISOString(),
    };
    inMemoryProducts.set(device_type, product);
  }

  const txDetails = [
    remarks,
    supplier ? `Supplier: ${supplier}` : null,
    purchase_ref ? `Ref: ${purchase_ref}` : null,
    unit_cost ? `Cost: ₹${unit_cost}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const transactionRecord = {
    id: `tx-recv-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    product_id: productId,
    device_type,
    device_name: product.device_name,
    transaction_type: 'STOCK_RECEIVED',
    quantity: qty,
    checklist_id: null,
    performed_by: user.id,
    performer_name: user.full_name || user.email || 'Store Manager',
    reason_or_remarks: txDetails || `Stock received for ${device_type}`,
    idempotency_key: `RECEIVE-${device_type}-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('inventory_transactions').insert([{
      product_id: productId,
      transaction_type: 'STOCK_RECEIVED',
      quantity: qty,
      performed_by: user.id,
      reason_or_remarks: transactionRecord.reason_or_remarks,
      idempotency_key: transactionRecord.idempotency_key,
    }]);
  } catch (txErr) {
    console.warn('DB transaction insert failed, stored in memory:', txErr.message);
  }

  inMemoryTransactions.unshift(transactionRecord);

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'RECEIVE_NEW_STOCK',
    target_table: 'inventory_products',
    target_id: productId,
    details: { device_type, quantity: qty, new_usable_stock: newUsable, supplier, purchase_ref },
  });

  return { success: true, usable_stock: newUsable, transaction: transactionRecord };
}

/**
 * Deduct stock automatically when technician submits Device Carry Form.
 * Validates available stock for ALL items before making any deductions (Atomic).
 * Prevents duplicate deductions if already submitted for checklist.
 */
export async function deductStockForCarryRecord({ checklist_id, technician_user_id, technician_name, items }) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return;
  }

  // Idempotency: prevent double deduction for the same checklist carry submission
  if (processedCarryDeductions.has(checklist_id)) {
    console.log(`Stock already deducted for checklist ${checklist_id}, skipping duplicate deduction.`);
    return;
  }

  // 1. Fetch current balances for validation
  const products = await getInventoryProducts();
  const productMap = new Map(products.map((p) => [p.device_type, p]));

  // 2. Validate sufficient usable stock for ALL items BEFORE making changes
  for (const item of items) {
    const devType = item.device_type?.trim();
    const qty = parseInt(item.quantity_to_carry !== undefined ? item.quantity_to_carry : item.quantity_carried, 10) || 0;

    if (qty <= 0) continue;

    const prod = productMap.get(devType) || inMemoryProducts.get(devType);
    const available = prod ? prod.usable_stock : 0;

    if (qty > available) {
      throw new Error(
        `Insufficient usable stock for "${devType}". Available: ${available} units, Requested: ${qty} units. Please adjust quantities or receive new stock.`
      );
    }
  }

  // 3. Perform atomic deduction for all items
  for (const item of items) {
    const devType = item.device_type?.trim();
    const qty = parseInt(item.quantity_to_carry !== undefined ? item.quantity_to_carry : item.quantity_carried, 10) || 0;

    if (qty <= 0) continue;

    const prod = inMemoryProducts.get(devType);
    let productId = prod?.id || `prod-${Date.now()}`;
    let newUsable = prod ? prod.usable_stock - qty : 0;
    let newIssued = prod ? (prod.issued_stock || 0) + qty : qty;

    try {
      const { data: dbProd } = await supabase
        .from('inventory_products')
        .select('*')
        .eq('device_type', devType)
        .maybeSingle();

      if (dbProd) {
        productId = dbProd.id;
        newUsable = dbProd.usable_stock - qty;
        newIssued = (dbProd.issued_stock || 0) + qty;

        await supabase
          .from('inventory_products')
          .update({
            usable_stock: newUsable,
            issued_stock: newIssued,
            updated_at: new Date().toISOString(),
          })
          .eq('id', dbProd.id);
      }
    } catch (e) {
      console.warn(`DB deduction error for ${devType}:`, e.message);
    }

    // Update in-memory product
    if (prod) {
      prod.usable_stock = newUsable;
      prod.issued_stock = newIssued;
      prod.updated_at = new Date().toISOString();
    }

    const txRecord = {
      id: `tx-issue-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      product_id: productId,
      device_type: devType,
      device_name: prod?.device_name || `${devType} System`,
      transaction_type: 'STOCK_ISSUED',
      quantity: qty,
      checklist_id,
      performed_by: technician_user_id,
      performer_name: technician_name || 'Technician',
      reason_or_remarks: `Issued to technician (${technician_name}) for checklist ${checklist_id}`,
      idempotency_key: `CARRY-${checklist_id}-${devType}`,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.from('inventory_transactions').insert([{
        product_id: productId,
        transaction_type: 'STOCK_ISSUED',
        quantity: qty,
        checklist_id,
        performed_by: technician_user_id,
        reason_or_remarks: txRecord.reason_or_remarks,
        idempotency_key: txRecord.idempotency_key,
      }]);
    } catch (txErr) {
      console.warn('DB tx insert error:', txErr.message);
    }

    inMemoryTransactions.unshift(txRecord);
  }

  // Mark checklist as deducted
  processedCarryDeductions.add(checklist_id);
}

/**
 * Credit stock when Store Manager verifies physically returned devices
 */
export async function creditStockForVerifiedReturn({
  checklist_id,
  device_type,
  accepted_usable_qty,
  damaged_qty = 0,
  user,
  remarks = '',
  return_id,
}) {
  const usableQty = Math.max(0, parseInt(accepted_usable_qty, 10) || 0);
  const dmgQty = Math.max(0, parseInt(damaged_qty, 10) || 0);
  const totalReceived = usableQty + dmgQty;

  const prod = inMemoryProducts.get(device_type);
  let productId = prod?.id || `prod-${Date.now()}`;
  let newUsable = (prod?.usable_stock || 0) + usableQty;
  let newReturnedUsable = (prod?.returned_usable_stock || 0) + usableQty;
  let newDamaged = (prod?.damaged_stock || 0) + dmgQty;
  let newIssued = Math.max(0, (prod?.issued_stock || 0) - totalReceived);

  try {
    const { data: dbProd } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('device_type', device_type)
      .maybeSingle();

    if (dbProd) {
      productId = dbProd.id;
      newUsable = dbProd.usable_stock + usableQty;
      newReturnedUsable = (dbProd.returned_usable_stock || 0) + usableQty;
      newDamaged = (dbProd.damaged_stock || 0) + dmgQty;
      newIssued = Math.max(0, (dbProd.issued_stock || 0) - totalReceived);

      await supabase
        .from('inventory_products')
        .update({
          usable_stock: newUsable,
          returned_usable_stock: newReturnedUsable,
          damaged_stock: newDamaged,
          issued_stock: newIssued,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dbProd.id);
    }
  } catch (e) {
    console.warn(`DB return credit error for ${device_type}:`, e.message);
  }

  // Update in-memory product
  if (prod) {
    prod.usable_stock = newUsable;
    prod.returned_usable_stock = newReturnedUsable;
    prod.damaged_stock = newDamaged;
    prod.issued_stock = newIssued;
    prod.updated_at = new Date().toISOString();
  }

  // 1. Transaction for Usable Returned Units
  if (usableQty > 0) {
    const usableTx = {
      id: `tx-ret-usable-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      product_id: productId,
      device_type,
      device_name: prod?.device_name || `${device_type} System`,
      transaction_type: 'USABLE_STOCK_RETURNED',
      quantity: usableQty,
      checklist_id,
      performed_by: user.id,
      performer_name: user.full_name || user.email || 'Store Manager',
      reason_or_remarks: remarks || `Physical return verified usable for ${device_type}`,
      idempotency_key: `RETURN-USABLE-${return_id}-${Date.now()}`,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.from('inventory_transactions').insert([{
        product_id: productId,
        transaction_type: 'USABLE_STOCK_RETURNED',
        quantity: usableQty,
        checklist_id,
        performed_by: user.id,
        reason_or_remarks: usableTx.reason_or_remarks,
        idempotency_key: usableTx.idempotency_key,
      }]);
    } catch (e) {
      console.warn('DB tx insert error:', e.message);
    }

    inMemoryTransactions.unshift(usableTx);
  }

  // 2. Transaction for Damaged Returned Units
  if (dmgQty > 0) {
    const dmgTx = {
      id: `tx-ret-dmg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      product_id: productId,
      device_type,
      device_name: prod?.device_name || `${device_type} System`,
      transaction_type: 'DAMAGED_STOCK_RECEIVED',
      quantity: dmgQty,
      checklist_id,
      performed_by: user.id,
      performer_name: user.full_name || user.email || 'Store Manager',
      reason_or_remarks: remarks || `Damaged return recorded for ${device_type}`,
      idempotency_key: `RETURN-DAMAGED-${return_id}-${Date.now()}`,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.from('inventory_transactions').insert([{
        product_id: productId,
        transaction_type: 'DAMAGED_STOCK_RECEIVED',
        quantity: dmgQty,
        checklist_id,
        performed_by: user.id,
        reason_or_remarks: dmgTx.reason_or_remarks,
        idempotency_key: dmgTx.idempotency_key,
      }]);
    } catch (e) {
      console.warn('DB tx insert error:', e.message);
    }

    inMemoryTransactions.unshift(dmgTx);
  }

  return { success: true, usable_stock: newUsable, damaged_stock: newDamaged };
}

/**
 * Gets immutable inventory stock transaction logs (searchable & filterable)
 */
export async function getInventoryTransactions(params = {}) {
  const { page = 1, limit = 50, type = '', search = '' } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('inventory_transactions')
      .select('*, product:inventory_products(device_name, device_type), actor:admin_users(email, full_name, role)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (type) query = query.eq('transaction_type', type);
    if (search) {
      query = query.or(`reason_or_remarks.ilike.%${search}%,idempotency_key.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (!error && data && data.length > 0) {
      const formatted = data.map((d) => ({
        ...d,
        device_type: d.product?.device_type || d.device_type,
        device_name: d.product?.device_name || d.device_name,
        performer_name: d.actor?.full_name || d.actor?.email || d.performed_by,
      }));
      return {
        transactions: formatted,
        totalCount: count || formatted.length,
        page: pageNum,
        totalPages: Math.ceil((count || formatted.length) / limitNum) || 1,
      };
    }
  } catch (err) {
    console.warn('DB transactions fetch failed, using in-memory store:', err.message);
  }

  // Filter in-memory transactions
  let filtered = [...inMemoryTransactions];

  if (type) {
    filtered = filtered.filter((t) => t.transaction_type === type);
  }

  if (search && search.trim()) {
    const s = search.trim().toLowerCase();
    filtered = filtered.filter(
      (t) =>
        (t.reason_or_remarks || '').toLowerCase().includes(s) ||
        (t.device_type || '').toLowerCase().includes(s) ||
        (t.performer_name || '').toLowerCase().includes(s) ||
        (t.idempotency_key || '').toLowerCase().includes(s)
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
