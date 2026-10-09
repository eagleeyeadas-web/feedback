import supabase from './supabase.js';
import { logAudit } from './auditService.js';

/**
 * Stage 3: Technical records actual installation details from job site
 */
export async function submitTechnicalReport({
  checklist_id,
  user,
  devices_carried_qty,
  devices_installed_qty,
  devices_unused_qty,
  devices_damaged_qty = 0,
  devices_missing_qty = 0,
  extra_devices_carried_qty = 0,
  extra_devices_installed_qty = 0,
  extra_devices_unused_qty = 0,
  extra_devices_damaged_qty = 0,
  extra_devices_missing_qty = 0,
  completion_status,
  remarks = '',
}) {
  const reportData = {
    checklist_id,
    technician_id: user.id,
    devices_carried_qty,
    devices_installed_qty,
    devices_unused_qty,
    devices_damaged_qty,
    devices_missing_qty,
    extra_devices_carried_qty,
    extra_devices_installed_qty,
    extra_devices_unused_qty,
    extra_devices_damaged_qty,
    extra_devices_missing_qty,
    completion_status,
    remarks,
    submitted_at: new Date().toISOString(),
  };

  const { data: created, error } = await supabase
    .from('technical_installation_reports')
    .upsert([reportData], { onConflict: 'checklist_id' })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Update checklist status
  await supabase
    .from('installation_checklists')
    .update({
      reconciliation_status: 'SITE_WORK_COMPLETED',
      installation_status: completion_status === 'Completed' ? 'Completed' : 'In Progress',
      updated_at: new Date().toISOString(),
    })
    .eq('id', checklist_id);

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'SUBMIT_TECHNICAL_REPORT',
    target_table: 'technical_installation_reports',
    target_id: created.id,
    details: { checklist_id, completion_status, devices_installed_qty, devices_unused_qty },
  });

  return created;
}

/**
 * Stage 4: Technical declares unused items to be returned to store
 */
export async function declareDeviceReturns({
  checklist_id,
  device_type,
  declared_return_qty,
  user,
  remarks = '',
}) {
  if (declared_return_qty < 0) {
    throw new Error('Declared return quantity cannot be negative');
  }

  const returnRecord = {
    checklist_id,
    device_type,
    declared_return_qty,
    declared_by: user.id,
    declared_at: new Date().toISOString(),
    status: 'PENDING_STORE_VERIFICATION',
    verification_remarks: remarks,
  };

  const { data: created, error } = await supabase
    .from('job_device_returns')
    .insert([returnRecord])
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase
    .from('installation_checklists')
    .update({
      reconciliation_status: 'PENDING_STORE_VERIFICATION',
      updated_at: new Date().toISOString(),
    })
    .eq('id', checklist_id);

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'DECLARE_RETURN',
    target_table: 'job_device_returns',
    target_id: created.id,
    details: { checklist_id, device_type, declared_return_qty },
  });

  return created;
}

/**
 * Stage 5: Store Manager physically verifies returned devices
 */
export async function verifyStoreReturn({
  return_id,
  accepted_usable_qty,
  damaged_qty = 0,
  missing_qty = 0,
  user,
  remarks = '',
}) {
  const { data: ret, error: fetchErr } = await supabase
    .from('job_device_returns')
    .select('*')
    .eq('id', return_id)
    .single();

  if (fetchErr || !ret) throw new Error('Return declaration record not found');

  const actual_received_qty = accepted_usable_qty + damaged_qty;
  const totalAccounted = actual_received_qty + missing_qty;
  const isDiscrepancy = totalAccounted !== ret.declared_return_qty;

  // 1. Credit verified usable stock
  if (accepted_usable_qty > 0) {
    const { data: product } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('device_type', ret.device_type)
      .single();

    if (product) {
      const newUsable = product.usable_stock + accepted_usable_qty;
      const newReturned = (product.returned_usable_stock || 0) + accepted_usable_qty;
      await supabase
        .from('inventory_products')
        .update({
          usable_stock: newUsable,
          returned_usable_stock: newReturned,
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id);

      await supabase.from('inventory_transactions').insert([{
        product_id: product.id,
        transaction_type: 'USABLE_STOCK_RETURNED',
        quantity: accepted_usable_qty,
        checklist_id: ret.checklist_id,
        performed_by: user.id,
        reason_or_remarks: remarks || `Physical store return verified for ${ret.device_type}`,
        idempotency_key: `RETURN-USABLE-${ret.id}-${Date.now()}`,
      }]);
    }
  }

  // 2. Track damaged stock separately (NOT in usable stock)
  if (damaged_qty > 0) {
    const { data: product } = await supabase
      .from('inventory_products')
      .select('*')
      .eq('device_type', ret.device_type)
      .single();

    if (product) {
      const newDamaged = (product.damaged_stock || 0) + damaged_qty;
      await supabase
        .from('inventory_products')
        .update({
          damaged_stock: newDamaged,
          updated_at: new Date().toISOString(),
        })
        .eq('id', product.id);

      await supabase.from('inventory_transactions').insert([{
        product_id: product.id,
        transaction_type: 'DAMAGED_STOCK_RECEIVED',
        quantity: damaged_qty,
        checklist_id: ret.checklist_id,
        performed_by: user.id,
        reason_or_remarks: remarks || `Damaged stock recorded for ${ret.device_type}`,
        idempotency_key: `RETURN-DAMAGED-${ret.id}-${Date.now()}`,
      }]);
    }
  }

  // 3. Update return record status
  const returnStatus = isDiscrepancy ? 'DISCREPANCY_FLAGGED' : 'VERIFIED_AND_RECONCILED';
  const { data: updatedReturn, error: updateErr } = await supabase
    .from('job_device_returns')
    .update({
      actual_received_qty,
      accepted_usable_qty,
      damaged_qty,
      missing_qty,
      status: returnStatus,
      verification_remarks: remarks,
      verified_by: user.id,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', return_id)
    .select()
    .single();

  if (updateErr) throw new Error(updateErr.message);

  // 4. Create Discrepancy if flagged
  if (isDiscrepancy) {
    await supabase.from('inventory_discrepancies').insert([{
      checklist_id: ret.checklist_id,
      device_type: ret.device_type,
      declared_qty: ret.declared_return_qty,
      verified_qty: accepted_usable_qty,
      discrepancy_qty: Math.abs(ret.declared_return_qty - totalAccounted),
      discrepancy_type: missing_qty > 0 ? 'MISSING_STOCK' : 'QUANTITY_MISMATCH',
      status: 'OPEN',
      flagged_by: user.id,
      resolution_notes: remarks,
    }]);

    await supabase
      .from('installation_checklists')
      .update({
        reconciliation_status: 'DISCREPANCY_OPEN',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ret.checklist_id);
  } else {
    await supabase
      .from('installation_checklists')
      .update({
        reconciliation_status: 'FULLY_RECONCILED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ret.checklist_id);
  }

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'VERIFY_STORE_RETURN',
    target_table: 'job_device_returns',
    target_id: return_id,
    details: { checklist_id: ret.checklist_id, accepted_usable_qty, damaged_qty, isDiscrepancy },
  });

  return updatedReturn;
}

/**
 * Stage 6: Admin resolves an open discrepancy
 */
export async function resolveDiscrepancy({
  discrepancy_id,
  user,
  resolution_notes,
  status = 'RESOLVED_ADMIN_APPROVED',
}) {
  const { data: disc, error: fetchErr } = await supabase
    .from('inventory_discrepancies')
    .select('*')
    .eq('id', discrepancy_id)
    .single();

  if (fetchErr || !disc) throw new Error('Discrepancy record not found');

  const { data: updated, error: updateErr } = await supabase
    .from('inventory_discrepancies')
    .update({
      status,
      resolution_notes,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', discrepancy_id)
    .select()
    .single();

  if (updateErr) throw new Error(updateErr.message);

  // Check if any open discrepancies remain for this checklist
  const { count: openCount } = await supabase
    .from('inventory_discrepancies')
    .select('*', { count: 'exact', head: true })
    .eq('checklist_id', disc.checklist_id)
    .eq('status', 'OPEN');

  if (!openCount || openCount === 0) {
    await supabase
      .from('installation_checklists')
      .update({
        reconciliation_status: 'FULLY_RECONCILED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', disc.checklist_id);
  }

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'RESOLVE_DISCREPANCY',
    target_table: 'inventory_discrepancies',
    target_id: discrepancy_id,
    details: { checklist_id: disc.checklist_id, resolution_notes },
  });

  return updated;
}
