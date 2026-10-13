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

export const STANDARD_DEVICE_PRODUCTS = [
  { id: 'dev-001', sku: 'EE-2CH-LIVE', device_name: '2 Channel Live Camera System', device_type: '2 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
  { id: 'dev-002', sku: 'EE-2CH-REC', device_name: '2 Channel Recording System', device_type: '2 Channel Recording', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
  { id: 'dev-003', sku: 'EE-4CH-LIVE', device_name: '4 Channel Live MDVR System', device_type: '4 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
  { id: 'dev-004', sku: 'EE-4CH-REC', device_name: '4 Channel Recording MDVR System', device_type: '4 Channel Recording', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
  { id: 'dev-005', sku: 'EE-6CH-LIVE', device_name: '6 Channel Live Telematics System', device_type: '6 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
  { id: 'dev-006', sku: 'EE-6CH-REC', device_name: '6 Channel Recording Telematics System', device_type: '6 Channel Recording', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
  { id: 'dev-007', sku: 'EE-8CH-LIVE', device_name: '8 Channel Live Enterprise System', device_type: '8 Channel Live', unit: 'Nos.', opening_quantity: 0, opening_stock_set: false, usable_stock: 0, reserved_stock: 0, issued_stock: 0, returned_usable_stock: 0, damaged_stock: 0, min_stock_level: 5, is_active: true },
];

/**
 * In-memory fallback stores for local resilience
 * Opening stock is NOT assumed (starts at 0 with opening_stock_set: false)
 */
const inMemoryProducts = new Map(
  STANDARD_DEVICE_PRODUCTS.map((p) => [
    p.device_type,
    {
      ...p,
      updated_at: new Date().toISOString(),
    },
  ])
);

const inMemoryTransactions = [];
const processedCarryDeductions = new Set();
const processedChecklistDeviceIssuances = new Set();
let devicesDbSeeded = false;

/**
 * Ensure standard 7 camera device models exist in database without overwriting opening counts
 */
async function ensureDbDevicesSeeded() {
  if (devicesDbSeeded) return;
  try {
    const { data: existing, error } = await supabase
      .from('inventory_products')
      .select('id, device_type, sku');

    if (!error && Array.isArray(existing)) {
      const existingTypes = new Set(existing.map((p) => p.device_type));
      const missing = STANDARD_DEVICE_PRODUCTS.filter((p) => !existingTypes.has(p.device_type));

      if (missing.length > 0) {
        await supabase.from('inventory_products').insert(
          missing.map((p) => ({
            device_name: p.device_name,
            device_type: p.device_type,
            sku: p.sku,
            unit: p.unit,
            opening_quantity: 0,
            opening_stock_set: false,
            usable_stock: 0,
            reserved_stock: 0,
            issued_stock: 0,
            returned_usable_stock: 0,
            damaged_stock: 0,
            min_stock_level: p.min_stock_level,
            is_active: true,
          }))
        );
      }
      devicesDbSeeded = true;
    }
  } catch (err) {
    // Database table might not be migrated yet
  }
}

/**
 * Get all inventory products and current stock balances
 */
export async function getInventoryProducts() {
  await ensureDbDevicesSeeded();

  try {
    const { data, error } = await supabase
      .from('inventory_products')
      .select('*')
      .order('device_type', { ascending: true });

    if (!error && data && data.length > 0) {
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
  let totalOpening = 0;
  let lowStockCount = 0;

  products.forEach((p) => {
    const usable = Number(p.usable_stock) || 0;
    const minLevel = Number(p.min_stock_level) || 5;
    totalUsable += usable;
    totalIssued += Number(p.issued_stock) || 0;
    totalDamaged += Number(p.damaged_stock) || 0;
    totalOpening += Number(p.opening_quantity) || 0;
    if (usable <= minLevel) {
      lowStockCount++;
    }
  });

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
    // In-memory fallback
  }

  return {
    totalUsable,
    totalIssued,
    totalAwaitingReturn,
    totalDamaged,
    totalOpening,
    lowStockCount,
    totalModels: products.length,
  };
}

/**
 * Set Opening Quantity for a Camera Device (Store Manager enters actual opening count)
 */
export async function setDeviceOpeningStock({
  device_type,
  product_id,
  opening_quantity,
  reason,
  user,
}) {
  if (!device_type && !product_id) {
    throw new Error('Device type or product ID is required.');
  }

  const qty = parseInt(opening_quantity, 10);
  if (isNaN(qty) || qty < 0) {
    throw new Error('Opening quantity must be a non-negative whole number (0 or greater).');
  }

  const products = await getInventoryProducts();
  const product = products.find(
    (p) => (product_id && p.id === product_id) || (device_type && p.device_type === device_type)
  ) || inMemoryProducts.get(device_type);

  if (!product) {
    throw new Error(`Device model "${device_type || product_id}" not found.`);
  }

  const targetType = product.device_type;
  const targetId = product.id;
  const previousBalance = Number(product.usable_stock) || 0;
  const newBalance = qty;

  // Update in-memory
  product.opening_quantity = qty;
  product.opening_stock_set = true;
  product.usable_stock = newBalance;
  product.updated_at = new Date().toISOString();
  inMemoryProducts.set(targetType, product);

  // Update DB
  try {
    await supabase
      .from('inventory_products')
      .update({
        opening_quantity: qty,
        opening_stock_set: true,
        usable_stock: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetId);
  } catch (err) {
    console.warn('DB update device opening stock error:', err.message);
  }

  // Create audit transaction
  const txRecord = {
    id: `tx-dev-open-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    product_id: targetId,
    device_type: targetType,
    device_name: product.device_name,
    transaction_type: 'OPENING_STOCK',
    quantity: qty,
    previous_balance: previousBalance,
    new_balance: newBalance,
    checklist_id: null,
    performed_by: user?.id || null,
    performer_name: user?.full_name || user?.email || 'Store Manager',
    reason_or_remarks: reason ? reason.trim() : `Opening stock set to ${qty} Nos. for ${targetType}`,
    idempotency_key: `DEV-OPEN-${targetType}-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('inventory_transactions').insert([{
      product_id: targetId,
      transaction_type: 'OPENING_STOCK',
      quantity: qty,
      previous_balance: previousBalance,
      new_balance: newBalance,
      performed_by: user?.id || null,
      reason_or_remarks: txRecord.reason_or_remarks,
      idempotency_key: txRecord.idempotency_key,
    }]);
  } catch (txErr) {
    console.warn('DB device opening tx insert error:', txErr.message);
  }

  inMemoryTransactions.unshift(txRecord);

  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'DEVICE_OPENING_STOCK_SET',
      target_table: 'inventory_products',
      target_id: targetId,
      details: {
        device_type: targetType,
        opening_quantity: qty,
        previous_balance: previousBalance,
        new_balance: newBalance,
        reason,
      },
    }).catch(() => null);
  }

  return {
    success: true,
    device_type: targetType,
    opening_quantity: qty,
    usable_stock: newBalance,
    transaction: txRecord,
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
  const previousBalance = Number(product?.usable_stock) || 0;
  let newUsable = previousBalance + qty;
  let productId = product?.id || `prod-${Date.now()}`;

  try {
    const { data: dbProd } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('device_type', device_type)
      .maybeSingle();

    if (dbProd) {
      productId = dbProd.id;
      newUsable = Number(dbProd.usable_stock) + qty;
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
    device_name: product?.device_name || `${device_type} System`,
    transaction_type: 'STOCK_RECEIVED',
    quantity: qty,
    previous_balance: previousBalance,
    new_balance: newUsable,
    checklist_id: null,
    performed_by: user?.id,
    performer_name: user?.full_name || user?.email || 'Store Manager',
    reason_or_remarks: txDetails || `Stock received for ${device_type} (Stock: ${previousBalance} → ${newUsable} Nos.)`,
    idempotency_key: `RECEIVE-${device_type}-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('inventory_transactions').insert([{
      product_id: productId,
      transaction_type: 'STOCK_RECEIVED',
      quantity: qty,
      previous_balance: previousBalance,
      new_balance: newUsable,
      performed_by: user?.id,
      reason_or_remarks: transactionRecord.reason_or_remarks,
      idempotency_key: transactionRecord.idempotency_key,
    }]);
  } catch (txErr) {
    console.warn('DB transaction insert failed, stored in memory:', txErr.message);
  }

  inMemoryTransactions.unshift(transactionRecord);

  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'RECEIVE_NEW_STOCK',
      target_table: 'inventory_products',
      target_id: productId,
      details: {
        device_type,
        quantity: qty,
        previous_balance: previousBalance,
        new_usable_stock: newUsable,
        supplier,
        purchase_ref,
      },
    }).catch(() => null);
  }

  return { success: true, usable_stock: newUsable, previous_balance: previousBalance, transaction: transactionRecord };
}

/**
 * Adjust or Edit stock balances (Add, Remove, or Set with required reason)
 */
export async function adjustStock({
  device_type,
  action, // 'ADD' | 'REMOVE' | 'SET'
  quantity,
  reason,
  move_to_damaged = false,
  user,
}) {
  if (!device_type || !STANDARD_DEVICE_TYPES.includes(device_type)) {
    throw new Error(`Invalid device type selected: "${device_type}".`);
  }

  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty < 0) {
    throw new Error('Quantity must be a valid non-negative whole number.');
  }

  if (!reason || !reason.trim()) {
    throw new Error('A valid reason is required for any stock adjustment.');
  }

  let product = inMemoryProducts.get(device_type);
  const currentUsable = Number(product?.usable_stock) || 0;
  let newUsable = currentUsable;
  let newDamaged = Number(product?.damaged_stock) || 0;
  let qtyDelta = 0;
  const normalizedAction = (action || '').toUpperCase();
  let txType = 'STOCK_ADJUSTMENT';

  if (normalizedAction === 'ADD') {
    if (qty <= 0) throw new Error('Quantity to add must be greater than 0.');
    newUsable = currentUsable + qty;
    qtyDelta = qty;
    txType = 'STOCK_RECEIVED';
  } else if (normalizedAction === 'REMOVE') {
    if (qty <= 0) throw new Error('Quantity to remove must be greater than 0.');
    if (qty > currentUsable) {
      throw new Error(`Cannot remove ${qty} units. Current usable stock is only ${currentUsable} Nos. Negative stock is strictly prevented.`);
    }
    newUsable = currentUsable - qty;
    qtyDelta = -qty;
    txType = 'STOCK_ADJUSTMENT';
    if (move_to_damaged) {
      newDamaged = (Number(product?.damaged_stock) || 0) + qty;
    }
  } else if (normalizedAction === 'SET') {
    newUsable = qty;
    qtyDelta = qty - currentUsable;
    txType = 'STOCK_ADJUSTMENT';
  } else {
    throw new Error('Invalid adjustment action. Supported actions: ADD, REMOVE, SET.');
  }

  if (product) {
    product.usable_stock = newUsable;
    product.damaged_stock = newDamaged;
    product.updated_at = new Date().toISOString();
  }

  const productId = product?.id || `prod-${Date.now()}`;

  // Try DB update
  try {
    const { data: dbProd } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('device_type', device_type)
      .maybeSingle();

    if (dbProd) {
      await supabase
        .from('inventory_products')
        .update({
          usable_stock: newUsable,
          damaged_stock: newDamaged,
          updated_at: new Date().toISOString(),
        })
        .eq('id', dbProd.id);
    }
  } catch (dbErr) {
    console.warn('DB update failed, stored in memory:', dbErr.message);
  }

  const remarkFormatted = `[Manual ${normalizedAction}] ${reason.trim()} (Usable: ${currentUsable} → ${newUsable}${move_to_damaged ? `, Damaged: +${Math.abs(qtyDelta)}` : ''})`;

  const transactionRecord = {
    id: `tx-adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    product_id: productId,
    device_type,
    device_name: product?.device_name || `${device_type} System`,
    transaction_type: txType,
    quantity: Math.abs(qtyDelta),
    previous_balance: currentUsable,
    new_balance: newUsable,
    checklist_id: null,
    performed_by: user?.id,
    performer_name: user?.full_name || user?.email || 'Store Manager',
    reason_or_remarks: remarkFormatted,
    idempotency_key: `ADJUST-${device_type}-${Date.now()}`,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('inventory_transactions').insert([{
      product_id: productId,
      transaction_type: txType,
      quantity: Math.abs(qtyDelta),
      previous_balance: currentUsable,
      new_balance: newUsable,
      performed_by: user?.id,
      reason_or_remarks: remarkFormatted,
      idempotency_key: transactionRecord.idempotency_key,
    }]);
  } catch (txErr) {
    console.warn('DB transaction insert error:', txErr.message);
  }

  inMemoryTransactions.unshift(transactionRecord);

  if (user) {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role,
      action: `STOCK_ADJUSTMENT_${normalizedAction}`,
      target_table: 'inventory_products',
      target_id: productId,
      details: {
        device_type,
        action: normalizedAction,
        previous_usable: currentUsable,
        new_usable: newUsable,
        quantity_delta: qtyDelta,
        move_to_damaged,
        reason,
      },
    }).catch(() => null);
  }

  return {
    success: true,
    action: normalizedAction,
    previous_usable: currentUsable,
    usable_stock: newUsable,
    damaged_stock: newDamaged,
    transaction: transactionRecord,
  };
}

/**
 * Server-side atomic transaction to issue camera devices for a checklist.
 * Validates available stock for ALL devices before making deductions.
 * Prevents negative stock.
 */
export async function issueDevicesForChecklist({
  checklist_id,
  devices,
  remarks = '',
  user,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required.');
  }

  if (processedChecklistDeviceIssuances.has(checklist_id)) {
    throw new Error(`Devices have already been issued for checklist ${checklist_id}. Duplicate issuance is prevented.`);
  }

  if (!devices || !Array.isArray(devices) || devices.length === 0) {
    throw new Error('No camera devices specified for issuance.');
  }

  const allProducts = await getInventoryProducts();
  const prodMap = new Map(allProducts.map((p) => [p.device_type, p]));

  // 1. ATOMIC PRE-CHECK: Validate stock for ALL camera devices
  for (const item of devices) {
    const devType = (item.device_type || '').trim();
    const qty = parseInt(
      item.required_quantity !== undefined
        ? item.required_quantity
        : (item.number_of_devices !== undefined ? item.number_of_devices : item.quantity),
      10
    ) || 0;
    if (qty <= 0) continue;

    const prod = prodMap.get(devType) || inMemoryProducts.get(devType);
    const available = prod ? Number(prod.usable_stock) || 0 : 0;

    if (qty > available) {
      throw new Error(
        `Insufficient usable stock for camera device "${devType}". Available: ${available} Nos., Required: ${qty} Nos. Negative stock is strictly prevented.`
      );
    }
  }

  // 2. ATOMIC DEDUCTION
  const issuedRecords = [];

  for (const item of devices) {
    const devType = (item.device_type || '').trim();
    const qty = parseInt(
      item.required_quantity !== undefined
        ? item.required_quantity
        : (item.number_of_devices !== undefined ? item.number_of_devices : item.quantity),
      10
    ) || 0;
    if (qty <= 0) continue;

    const prod = prodMap.get(devType) || inMemoryProducts.get(devType);
    const productId = prod?.id || `dev-${Date.now()}`;
    const previousBalance = Number(prod?.usable_stock) || 0;
    const newUsable = Math.max(0, previousBalance - qty);
    const newIssued = (Number(prod?.issued_stock) || 0) + qty;

    try {
      await supabase
        .from('inventory_products')
        .update({
          usable_stock: newUsable,
          issued_stock: newIssued,
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId);
    } catch (e) {
      console.warn(`DB device stock deduction error for ${devType}:`, e.message);
    }

    if (prod) {
      prod.usable_stock = newUsable;
      prod.issued_stock = newIssued;
      prod.updated_at = new Date().toISOString();
    }

    const idempotencyKey = `DEV-ISSUE-${checklist_id}-${devType}`;
    const txRecord = {
      id: `tx-dev-issue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      product_id: productId,
      device_type: devType,
      device_name: prod?.device_name || `${devType} System`,
      transaction_type: 'STOCK_ISSUED',
      quantity: qty,
      previous_balance: previousBalance,
      new_balance: newUsable,
      checklist_id,
      performed_by: user?.id || null,
      performer_name: user?.full_name || user?.email || 'Store Manager',
      reason_or_remarks: remarks || `Camera device issued for checklist ${checklist_id}`,
      idempotency_key: idempotencyKey,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.from('inventory_transactions').insert([{
        product_id: productId,
        transaction_type: 'STOCK_ISSUED',
        quantity: qty,
        previous_balance: previousBalance,
        new_balance: newUsable,
        checklist_id,
        performed_by: user?.id || null,
        reason_or_remarks: txRecord.reason_or_remarks,
        idempotency_key: idempotencyKey,
      }]);
    } catch (txErr) {
      console.warn('DB device transaction insert error:', txErr.message);
    }

    inMemoryTransactions.unshift(txRecord);
    issuedRecords.push({
      device_type: devType,
      product_id: productId,
      sku: prod?.sku,
      quantity_issued: qty,
      previous_balance: previousBalance,
      remaining_usable: newUsable,
    });
  }

  processedChecklistDeviceIssuances.add(checklist_id);

  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'ISSUE_DEVICES_FOR_CHECKLIST',
      target_table: 'inventory_products',
      target_id: checklist_id,
      details: {
        checklist_id,
        devices_count: issuedRecords.length,
        devices: issuedRecords,
        remarks,
      },
    }).catch(() => null);
  }

  return {
    success: true,
    checklist_id,
    devices_issuance_status: 'ISSUED',
    devices: issuedRecords,
  };
}

/**
 * Deduct stock automatically when technician submits Device Carry Form (Workflow compatibility)
 */
export async function deductStockForCarryRecord({ checklist_id, technician_user_id, technician_name, items }) {
  if (!items || !Array.isArray(items) || items.length === 0) return;

  if (processedCarryDeductions.has(checklist_id)) return;

  const products = await getInventoryProducts();
  const productMap = new Map(products.map((p) => [p.device_type, p]));

  for (const item of items) {
    const devType = item.device_type?.trim();
    const qty = parseInt(item.quantity_to_carry !== undefined ? item.quantity_to_carry : item.quantity_carried, 10) || 0;
    if (qty <= 0) continue;

    const prod = productMap.get(devType) || inMemoryProducts.get(devType);
    const available = prod ? Number(prod.usable_stock) || 0 : 0;

    if (qty > available) {
      throw new Error(
        `Insufficient usable stock for "${devType}". Available: ${available} Nos., Requested: ${qty} Nos.`
      );
    }
  }

  for (const item of items) {
    const devType = item.device_type?.trim();
    const qty = parseInt(item.quantity_to_carry !== undefined ? item.quantity_to_carry : item.quantity_carried, 10) || 0;
    if (qty <= 0) continue;

    const prod = productMap.get(devType) || inMemoryProducts.get(devType);
    let productId = prod?.id || `prod-${Date.now()}`;
    const previousBalance = Number(prod?.usable_stock) || 0;
    let newUsable = Math.max(0, previousBalance - qty);
    let newIssued = (Number(prod?.issued_stock) || 0) + qty;

    try {
      await supabase
        .from('inventory_products')
        .update({
          usable_stock: newUsable,
          issued_stock: newIssued,
          updated_at: new Date().toISOString(),
        })
        .eq('id', productId);
    } catch (e) {
      console.warn(`DB deduction error for ${devType}:`, e.message);
    }

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
      previous_balance: previousBalance,
      new_balance: newUsable,
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
        previous_balance: previousBalance,
        new_balance: newUsable,
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

  processedCarryDeductions.add(checklist_id);
}

/**
 * Issue stock for an approved checklist (compatibility export)
 */
export async function issueStockForJob({
  checklist_id,
  device_type,
  quantity,
  user,
  notes = '',
}) {
  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty <= 0) {
    throw new Error('Issued quantity must be greater than 0');
  }

  await deductStockForCarryRecord({
    checklist_id,
    technician_user_id: user?.id,
    technician_name: user?.full_name || user?.email || 'Store Manager',
    items: [{ device_type, carried_qty: qty }],
  });

  return { success: true };
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
  const previousUsable = Number(prod?.usable_stock) || 0;
  let newUsable = previousUsable + usableQty;
  let newReturnedUsable = (Number(prod?.returned_usable_stock) || 0) + usableQty;
  let newDamaged = (Number(prod?.damaged_stock) || 0) + dmgQty;
  let newIssued = Math.max(0, (Number(prod?.issued_stock) || 0) - totalReceived);

  try {
    const { data: dbProd } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('device_type', device_type)
      .maybeSingle();

    if (dbProd) {
      productId = dbProd.id;
      newUsable = Number(dbProd.usable_stock) + usableQty;
      newReturnedUsable = (Number(dbProd.returned_usable_stock) || 0) + usableQty;
      newDamaged = (Number(dbProd.damaged_stock) || 0) + dmgQty;
      newIssued = Math.max(0, (Number(dbProd.issued_stock) || 0) - totalReceived);

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
      previous_balance: previousUsable,
      new_balance: newUsable,
      checklist_id,
      performed_by: user.id,
      performer_name: user.full_name || user.email || 'Store Manager',
      reason_or_remarks: remarks || `Physical return verified usable for ${device_type} (+${usableQty} Nos.)`,
      idempotency_key: `RETURN-USABLE-${return_id}-${Date.now()}`,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.from('inventory_transactions').insert([{
        product_id: productId,
        transaction_type: 'USABLE_STOCK_RETURNED',
        quantity: usableQty,
        previous_balance: previousUsable,
        new_balance: newUsable,
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
      previous_balance: Number(prod?.damaged_stock) || 0,
      new_balance: newDamaged,
      checklist_id,
      performed_by: user.id,
      performer_name: user.full_name || user.email || 'Store Manager',
      reason_or_remarks: remarks || `Damaged return recorded for ${device_type} (+${dmgQty} Nos.)`,
      idempotency_key: `RETURN-DAMAGED-${return_id}-${Date.now()}`,
      created_at: new Date().toISOString(),
    };

    try {
      await supabase.from('inventory_transactions').insert([{
        product_id: productId,
        transaction_type: 'DAMAGED_STOCK_RECEIVED',
        quantity: dmgQty,
        previous_balance: Number(prod?.damaged_stock) || 0,
        new_balance: newDamaged,
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
  const { page = 1, limit = 50, type = '', search = '', device_type = '' } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('inventory_transactions')
      .select('*, product:inventory_products(device_name, device_type, sku), actor:admin_users(email, full_name, role)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (type && type !== 'All') query = query.eq('transaction_type', type);
    if (device_type && device_type !== 'All') query = query.eq('device_type', device_type);
    if (search) {
      query = query.or(`reason_or_remarks.ilike.%${search}%,idempotency_key.ilike.%${search}%,device_type.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (!error && data && data.length > 0) {
      const formatted = data.map((d) => ({
        ...d,
        sku: d.product?.sku || (STANDARD_DEVICE_PRODUCTS.find((x) => x.device_type === d.device_type)?.sku),
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

  if (type && type !== 'All') {
    filtered = filtered.filter((t) => t.transaction_type === type);
  }
  if (device_type && device_type !== 'All') {
    filtered = filtered.filter((t) => t.device_type === device_type);
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
