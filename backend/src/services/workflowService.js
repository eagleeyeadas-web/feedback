import supabase from './supabase.js';
import { logAudit } from './auditService.js';

/**
 * In-memory fallback stores for workflow records if Supabase tables are not yet migrated
 */
const inMemoryCarryRecords = new Map();
const inMemoryCompletionReports = new Map();
const inMemoryReturns = new Map();

/**
 * Stage 2.5: Technical submits Pre-Installation Device Carry Form (Dynamic Device Selection)
 */
export async function submitDeviceCarryRecord({ checklist_id, user, items, remarks = '' }) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('At least one device type and quantity must be recorded to carry.');
  }

  // 1. Fetch checklist reference
  const { data: checklist, error: checkErr } = await supabase
    .from('installation_checklists')
    .select('*')
    .eq('id', checklist_id)
    .single();

  if (checkErr || !checklist) {
    throw new Error('Installation checklist not found');
  }

  // 2. Validate duplicate device types
  const seenTypes = new Set();
  const processedItems = items.map((item) => {
    if (!item.device_type || !item.device_type.trim()) {
      throw new Error('Device type selection is required for every row.');
    }
    const devType = item.device_type.trim();

    if (seenTypes.has(devType)) {
      throw new Error(`Duplicate device type selected: "${devType}". Please combine quantities into a single row.`);
    }
    seenTypes.add(devType);

    const rawQty = item.quantity_to_carry !== undefined ? item.quantity_to_carry : item.quantity_carried;
    const qtyCarried = parseInt(rawQty, 10);
    if (isNaN(qtyCarried) || qtyCarried <= 0) {
      throw new Error(`Quantity to carry for ${devType} must be a positive whole number greater than 0.`);
    }

    const qtyIssued = Math.max(0, parseInt(item.quantity_issued, 10) || 0);
    const diff = qtyCarried - qtyIssued;

    return {
      checklist_id,
      device_type: devType,
      quantity_issued: qtyIssued,
      quantity_carried: qtyCarried,
      discrepancy_quantity: diff,
      discrepancy_reason: item.discrepancy_reason ? item.discrepancy_reason.trim() : null,
    };
  });

  const carryRecord = {
    checklist_id,
    technician_user_id: user.id,
    technician_name: user.full_name || user.email,
    status: 'SUBMITTED',
    remarks: remarks ? remarks.trim() : null,
    submitted_at: new Date().toISOString(),
  };

  let recordId = null;

  // 3. Try database insert, fallback to in-memory store if table missing
  try {
    const { data: createdRecord, error: recordErr } = await supabase
      .from('job_device_carry_records')
      .insert([carryRecord])
      .select()
      .single();

    if (recordErr) throw recordErr;
    recordId = createdRecord.id;

    // Insert items
    const itemsToInsert = processedItems.map((i) => ({ ...i, carry_record_id: recordId }));
    await supabase.from('job_device_carry_items').insert(itemsToInsert);
  } catch (dbErr) {
    console.warn('DB job_device_carry_records not available, using in-memory store:', dbErr.message);
    recordId = `carry-${checklist_id}-${Date.now()}`;
    const savedRecord = { ...carryRecord, id: recordId, items: processedItems };
    inMemoryCarryRecords.set(checklist_id, savedRecord);
  }

  // 4. Update installation checklist status
  const updatedInstallationStatus = ['Pending', 'Assigned'].includes(checklist.installation_status)
    ? 'Ready to Start'
    : checklist.installation_status;

  await supabase
    .from('installation_checklists')
    .update({
      carry_status: 'RECORDED',
      installation_status: updatedInstallationStatus,
      reconciliation_status: 'CARRY_RECORDED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', checklist_id);

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'SUBMIT_DEVICE_CARRY_RECORD',
    target_table: 'job_device_carry_records',
    target_id: recordId,
    details: { checklist_id, itemsCount: processedItems.length },
  });

  return { id: recordId, checklist_id, items: processedItems, carryRecord };
}

/**
 * Get Device Carry Record for a checklist
 */
export async function getDeviceCarryRecord(checklist_id) {
  try {
    const { data: record, error: recordErr } = await supabase
      .from('job_device_carry_records')
      .select('*')
      .eq('checklist_id', checklist_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!recordErr && record) {
      const { data: items } = await supabase
        .from('job_device_carry_items')
        .select('*')
        .eq('carry_record_id', record.id);

      return { ...record, items: items || [] };
    }
  } catch (err) {
    console.warn('Error fetching carry record from DB, checking in-memory store:', err.message);
  }

  return inMemoryCarryRecords.get(checklist_id) || null;
}

/**
 * Start Installation Job after Carry Form completion
 */
export async function startInstallationJob({ checklist_id, user }) {
  const carryRecord = await getDeviceCarryRecord(checklist_id);
  if (!carryRecord) {
    throw new Error('Mandatory Pre-Installation Device Carry Form must be completed before starting installation.');
  }

  const { data: updated, error } = await supabase
    .from('installation_checklists')
    .update({
      installation_status: 'In Progress',
      updated_at: new Date().toISOString(),
    })
    .eq('id', checklist_id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'START_INSTALLATION_JOB',
    target_table: 'installation_checklists',
    target_id: checklist_id,
    details: { checklist_id },
  });

  return updated;
}

/**
 * Stage 3: Technical submits Post-Installation Completion Form
 */
export async function submitInstallationCompletionReport({
  checklist_id,
  user,
  items,
  completion_status = 'Site Work Completed',
  remarks = '',
}) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Completion report items are required');
  }

  const { data: checklist, error: checkErr } = await supabase
    .from('installation_checklists')
    .select('*')
    .eq('id', checklist_id)
    .single();

  if (checkErr || !checklist) {
    throw new Error('Installation checklist not found');
  }

  let totalCarried = 0;
  let totalInstalled = 0;
  let totalUnused = 0;
  let totalDamaged = 0;
  let totalMissing = 0;
  let hasDiscrepancy = false;

  const processedItems = items.map((item) => {
    const qtyCarried = Math.max(0, parseInt(item.quantity_carried, 10) || 0);
    const qtyInstalled = Math.max(0, parseInt(item.quantity_installed, 10) || 0);
    const qtyUnused = Math.max(0, parseInt(item.quantity_to_return, 10) || 0);
    const qtyDamaged = Math.max(0, parseInt(item.quantity_damaged, 10) || 0);
    const qtyMissing = Math.max(0, parseInt(item.quantity_missing, 10) || 0);

    if (qtyUnused > qtyCarried) {
      throw new Error(`Unused quantity to return (${qtyUnused}) cannot exceed quantity carried (${qtyCarried}) for ${item.device_type}`);
    }

    const totalAccounted = qtyInstalled + qtyUnused + qtyDamaged + qtyMissing;
    const diff = qtyCarried - totalAccounted;

    if (diff !== 0) {
      hasDiscrepancy = true;
      if (!item.discrepancy_reason || !item.discrepancy_reason.trim()) {
        throw new Error(
          `Reconciliation mismatch for ${item.device_type}: Carried (${qtyCarried}) != Installed (${qtyInstalled}) + Return (${qtyUnused}) + Damaged (${qtyDamaged}) + Missing (${qtyMissing}). Explanation remark is required.`
        );
      }
    }

    totalCarried += qtyCarried;
    totalInstalled += qtyInstalled;
    totalUnused += qtyUnused;
    totalDamaged += qtyDamaged;
    totalMissing += qtyMissing;

    return {
      checklist_id,
      device_type: item.device_type,
      quantity_carried: qtyCarried,
      quantity_installed: qtyInstalled,
      quantity_to_return: qtyUnused,
      quantity_damaged: qtyDamaged,
      quantity_missing: qtyMissing,
      discrepancy_reason: item.discrepancy_reason ? item.discrepancy_reason.trim() : null,
    };
  });

  const reportData = {
    checklist_id,
    technician_id: user.id,
    devices_carried_qty: totalCarried,
    devices_installed_qty: totalInstalled,
    devices_unused_qty: totalUnused,
    devices_damaged_qty: totalDamaged,
    devices_missing_qty: totalMissing,
    completion_status: completion_status === 'Completed' ? 'Completed' : 'Site Work Completed',
    remarks: remarks ? remarks.trim() : null,
    submitted_at: new Date().toISOString(),
  };

  let reportId = null;

  try {
    const { data: created, error } = await supabase
      .from('technical_installation_reports')
      .upsert([reportData], { onConflict: 'checklist_id' })
      .select()
      .single();

    if (error) throw error;
    reportId = created.id;

    // Insert items
    const reportItems = processedItems.map((i) => ({ ...i, report_id: reportId }));
    await supabase.from('technical_installation_report_items').insert(reportItems);
  } catch (dbErr) {
    console.warn('DB technical_installation_reports not available, using in-memory store:', dbErr.message);
    reportId = `report-${checklist_id}-${Date.now()}`;
    const savedReport = { ...reportData, id: reportId, items: processedItems };
    inMemoryCompletionReports.set(checklist_id, savedReport);
  }

  // Auto create return declaration if unused items exist
  if (totalUnused > 0) {
    for (const item of processedItems) {
      if (item.quantity_to_return > 0) {
        await declareDeviceReturns({
          checklist_id,
          device_type: item.device_type,
          declared_return_qty: item.quantity_to_return,
          user,
          remarks: `Completion report return declaration: ${item.discrepancy_reason || remarks || 'Unused site devices'}`,
        });
      }
    }
  }

  // Update checklist status automatically across all workspaces
  const finalInstStatus = 'Completed';
  const finalReconStatus = hasDiscrepancy
    ? 'DISCREPANCY_OPEN'
    : totalUnused > 0
    ? 'PENDING_STORE_VERIFICATION'
    : 'FULLY_RECONCILED';

  const now = new Date().toISOString();
  try {
    const { error: err1 } = await supabase
      .from('installation_checklists')
      .update({
        installation_status: finalInstStatus,
        updated_at: now,
      })
      .eq('id', checklist_id);

    if (err1) console.warn('Could not update installation_status in DB:', err1.message);

    // Try updating optional reconciliation_status if column exists
    await supabase
      .from('installation_checklists')
      .update({
        reconciliation_status: finalReconStatus,
      })
      .eq('id', checklist_id);
  } catch (err) {
    console.warn('DB update warning for checklist status:', err.message);
  }

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'SUBMIT_INSTALLATION_COMPLETION_REPORT',
    target_table: 'technical_installation_reports',
    target_id: reportId,
    details: { checklist_id, totalInstalled, totalUnused, totalDamaged, totalMissing, hasDiscrepancy },
  });

  return {
    id: reportId,
    checklist_id,
    items: processedItems,
    summary: reportData,
    status: finalInstStatus,
    reconciliation_status: finalReconStatus,
  };
}

/**
 * Get Installation Completion Report for a checklist
 */
export async function getInstallationCompletionReport(checklist_id) {
  try {
    const { data: report, error: repErr } = await supabase
      .from('technical_installation_reports')
      .select('*')
      .eq('checklist_id', checklist_id)
      .maybeSingle();

    if (!repErr && report) {
      const { data: items } = await supabase
        .from('technical_installation_report_items')
        .select('*')
        .eq('report_id', report.id);

      return { ...report, items: items || [] };
    }
  } catch (err) {
    console.warn('Error fetching completion report from DB, checking in-memory store:', err.message);
  }

  return inMemoryCompletionReports.get(checklist_id) || null;
}

/**
 * Stage 3: Legacy submitTechnicalReport wrapper
 */
export async function submitTechnicalReport(data) {
  return submitInstallationCompletionReport({
    checklist_id: data.checklist_id,
    user: data.user,
    items: [
      {
        device_type: 'Main Device',
        quantity_carried: data.devices_carried_qty || 0,
        quantity_installed: data.devices_installed_qty || 0,
        quantity_to_return: data.devices_unused_qty || 0,
        quantity_damaged: data.devices_damaged_qty || 0,
        quantity_missing: data.devices_missing_qty || 0,
        discrepancy_reason: data.remarks,
      },
    ],
    completion_status: data.completion_status,
    remarks: data.remarks,
  });
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
    id: `return-${checklist_id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    checklist_id,
    device_type,
    declared_return_qty,
    declared_by: user.id,
    declared_at: new Date().toISOString(),
    status: 'PENDING_STORE_VERIFICATION',
    verification_remarks: remarks,
  };

  try {
    const { data: created, error } = await supabase
      .from('job_device_returns')
      .insert([{
        checklist_id,
        device_type,
        declared_return_qty,
        declared_by: user.id,
        declared_at: returnRecord.declared_at,
        status: 'PENDING_STORE_VERIFICATION',
        verification_remarks: remarks,
      }])
      .select()
      .single();

    if (!error && created) {
      returnRecord.id = created.id;
    }
  } catch (dbErr) {
    console.warn('DB job_device_returns not available, using in-memory returns:', dbErr.message);
  }

  inMemoryReturns.set(returnRecord.id, returnRecord);

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
    target_id: returnRecord.id,
    details: { checklist_id, device_type, declared_return_qty },
  });

  return returnRecord;
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
  let ret = inMemoryReturns.get(return_id);

  if (!ret) {
    try {
      const { data: dbRet, error: fetchErr } = await supabase
        .from('job_device_returns')
        .select('*')
        .eq('id', return_id)
        .single();

      if (!fetchErr && dbRet) ret = dbRet;
    } catch (e) {
      console.warn('Could not fetch return from DB:', e.message);
    }
  }

  if (!ret) throw new Error('Return declaration record not found');

  const actual_received_qty = accepted_usable_qty + damaged_qty;
  const totalAccounted = actual_received_qty + missing_qty;
  const isDiscrepancy = totalAccounted !== ret.declared_return_qty;

  // 1. Credit verified usable stock (only usable returned devices increase usable stock)
  if (accepted_usable_qty > 0) {
    try {
      const { data: product } = await supabase
        .from('inventory_products')
        .select('*')
        .eq('device_type', ret.device_type)
        .maybeSingle();

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
    } catch (invErr) {
      console.warn('Inventory products table not available:', invErr.message);
    }
  }

  // 2. Track damaged stock separately (NOT in usable stock)
  if (damaged_qty > 0) {
    try {
      const { data: product } = await supabase
        .from('inventory_products')
        .select('*')
        .eq('device_type', ret.device_type)
        .maybeSingle();

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
    } catch (invErr) {
      console.warn('Inventory products table not available for damaged stock:', invErr.message);
    }
  }

  // 3. Update return record status
  const returnStatus = isDiscrepancy ? 'DISCREPANCY_FLAGGED' : 'VERIFIED_AND_RECONCILED';
  const updatedReturn = {
    ...ret,
    actual_received_qty,
    accepted_usable_qty,
    damaged_qty,
    missing_qty,
    status: returnStatus,
    verification_remarks: remarks,
    verified_by: user.id,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  inMemoryReturns.set(return_id, updatedReturn);

  try {
    await supabase
      .from('job_device_returns')
      .update({
        actual_received_qty,
        accepted_usable_qty,
        damaged_qty,
        missing_qty,
        status: returnStatus,
        verification_remarks: remarks,
        verified_by: user.id,
        verified_at: updatedReturn.verified_at,
        updated_at: updatedReturn.updated_at,
      })
      .eq('id', return_id);
  } catch (e) {
    console.warn('Could not update job_device_returns in DB:', e.message);
  }

  // 4. Create Discrepancy if flagged
  if (isDiscrepancy) {
    try {
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
    } catch (e) {
      console.warn('Could not insert discrepancy in DB:', e.message);
    }

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
 * Fetch all pending store returns
 */
export async function getPendingStoreReturns() {
  const returns = [];

  try {
    const { data: dbReturns, error } = await supabase
      .from('job_device_returns')
      .select('*, installation_checklists(checklist_number, client_name, service_engineer)')
      .eq('status', 'PENDING_STORE_VERIFICATION');

    if (!error && dbReturns) {
      returns.push(...dbReturns);
    }
  } catch (e) {
    console.warn('Error fetching pending returns from DB:', e.message);
  }

  for (const [id, ret] of inMemoryReturns.entries()) {
    if (ret.status === 'PENDING_STORE_VERIFICATION' && !returns.some((r) => r.id === id)) {
      returns.push(ret);
    }
  }

  return returns;
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
  let disc = null;

  try {
    const { data, error: fetchErr } = await supabase
      .from('inventory_discrepancies')
      .select('*')
      .eq('id', discrepancy_id)
      .single();

    if (!fetchErr && data) disc = data;
  } catch (e) {
    console.warn('Could not fetch discrepancy from DB:', e.message);
  }

  if (!disc) throw new Error('Discrepancy record not found');

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

  await supabase
    .from('installation_checklists')
    .update({
      reconciliation_status: 'FULLY_RECONCILED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', disc.checklist_id);

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

/**
 * Enrich installation checklists with persisted workflow status from in-memory fallback stores
 */
export async function enrichChecklistsWithWorkflowStatus(checklists) {
  if (!Array.isArray(checklists)) return checklists;

  return checklists.map((item) => {
    let copy = { ...item };

    // 1. Check carry record in-memory fallback store
    const carryRecord = inMemoryCarryRecords.get(item.id);
    if (carryRecord || item.carry_status === 'RECORDED') {
      copy.carry_status = 'RECORDED';
      if (!copy.reconciliation_status || copy.reconciliation_status === 'SALES_CREATED') {
        copy.reconciliation_status = 'CARRY_RECORDED';
      }
    }

    // 2. Check completion report in-memory fallback store
    const completionReport = inMemoryCompletionReports.get(item.id);
    if (
      completionReport ||
      item.installation_status === 'Completed' ||
      item.installation_status === 'Site Work Completed'
    ) {
      copy.installation_status = 'Completed';
      if (completionReport?.reconciliation_status) {
        copy.reconciliation_status = completionReport.reconciliation_status;
      }
    }

    return copy;
  });
}
