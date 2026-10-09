import supabase from './supabase.js';
import { logAudit } from './auditService.js';

/**
 * Gets current usable inventory products and stock balances
 */
export async function getInventoryProducts() {
  const { data, error } = await supabase
    .from('inventory_products')
    .select('*')
    .order('device_type', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Gets immutable inventory stock transaction logs
 */
export async function getInventoryTransactions(params = {}) {
  const { page = 1, limit = 20, type = '', search = '' } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

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
  if (error) throw new Error(error.message);

  return {
    transactions: data || [],
    totalCount: count || 0,
    page: pageNum,
    totalPages: Math.ceil((count || 0) / limitNum) || 1,
  };
}

/**
 * Adds new stock batch (Store Manager / Admin)
 */
export async function receiveNewStock({ device_type, quantity, user, remarks = '' }) {
  if (!quantity || quantity <= 0) {
    throw new Error('Received stock quantity must be greater than 0');
  }

  const { data: product, error: prodErr } = await supabase
    .from('inventory_products')
    .select('*')
    .eq('device_type', device_type)
    .single();

  if (prodErr || !product) {
    throw new Error(`Inventory product "${device_type}" not found`);
  }

  const newUsable = product.usable_stock + quantity;
  const { error: updateErr } = await supabase
    .from('inventory_products')
    .update({
      usable_stock: newUsable,
      updated_at: new Date().toISOString(),
    })
    .eq('id', product.id);

  if (updateErr) throw new Error(updateErr.message);

  // Insert transaction
  await supabase.from('inventory_transactions').insert([{
    product_id: product.id,
    transaction_type: 'STOCK_RECEIVED',
    quantity: quantity,
    performed_by: user.id,
    reason_or_remarks: remarks || `New stock batch received for ${device_type}`,
    idempotency_key: `RECEIVE-${product.id}-${Date.now()}`,
  }]);

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'RECEIVE_NEW_STOCK',
    target_table: 'inventory_products',
    target_id: product.id,
    details: { device_type, quantity, new_usable_stock: newUsable },
  });

  return { success: true, usable_stock: newUsable };
}

/**
 * Stage 2: Store Manager issues stock for an approved checklist
 */
export async function issueStockForJob({
  checklist_id,
  device_type,
  quantity,
  user,
  notes = '',
  idempotency_key = null,
}) {
  if (!quantity || quantity <= 0) {
    throw new Error('Issued quantity must be greater than 0');
  }

  const { data: product, error: prodErr } = await supabase
    .from('inventory_products')
    .select('*')
    .eq('device_type', device_type)
    .single();

  if (prodErr || !product) {
    throw new Error(`Inventory product for device type "${device_type}" not found`);
  }

  if (product.usable_stock < quantity) {
    throw new Error(`Insufficient usable stock for "${device_type}". Available: ${product.usable_stock}, Requested: ${quantity}`);
  }

  const key = idempotency_key || `ISSUE-${checklist_id}-${device_type}-${Date.now()}`;

  // 1. Deduct usable stock & increment issued_stock
  const newUsable = product.usable_stock - quantity;
  const newIssued = (product.issued_stock || 0) + quantity;

  const { error: updateErr } = await supabase
    .from('inventory_products')
    .update({
      usable_stock: newUsable,
      issued_stock: newIssued,
      updated_at: new Date().toISOString(),
    })
    .eq('id', product.id);

  if (updateErr) throw new Error(updateErr.message);

  // 2. Record inventory transaction
  await supabase.from('inventory_transactions').insert([{
    product_id: product.id,
    transaction_type: 'STOCK_ISSUED',
    quantity: quantity,
    checklist_id,
    performed_by: user.id,
    reason_or_remarks: notes || `Stock issued for checklist ${checklist_id}`,
    idempotency_key: key,
  }]);

  // 3. Record job device issue entry
  await supabase.from('job_device_issues').insert([{
    checklist_id,
    device_type,
    requested_quantity: quantity,
    issued_quantity: quantity,
    issued_by: user.id,
    notes,
  }]);

  // 4. Update checklist status to STORE_ISSUED
  await supabase
    .from('installation_checklists')
    .update({
      reconciliation_status: 'STORE_ISSUED',
      installation_status: 'In Progress',
      updated_at: new Date().toISOString(),
    })
    .eq('id', checklist_id);

  // 5. Audit log
  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'ISSUE_STOCK',
    target_table: 'inventory_products',
    target_id: product.id,
    details: { checklist_id, device_type, quantity, remaining_usable_stock: newUsable },
  });

  return { success: true, remainingUsableStock: newUsable };
}
