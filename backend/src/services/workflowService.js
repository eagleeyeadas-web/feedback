import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { deductStockForCarryRecord, creditStockForVerifiedReturn } from './inventoryService.js';
import {
  parseDeviceConfigurations,
  parseExtraDeviceConfigurations,
  combineCarriedDevicesAllocation,
  calculateJobFinalBom,
} from './bomService.js';
import { creditMaterialStockForVerifiedReturn } from './materialStockService.js';
import { normalizeChecklistDeviceConfigs, inMemoryChecklistBomSnapshots, inMemoryChecklistSchedules, inMemoryChecklistServiceItems, normalizeServiceItems } from './installationService.js';
import { completeEngineerBookingByChecklistId } from './engineerBookingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.resolve(__dirname, '../data/workflow_storage.json');

/**
 * In-memory fallback stores for workflow records if Supabase tables are not yet migrated
 */
export const inMemoryCarryRecords = new Map();
export const inMemoryCompletionReports = new Map();
export const inMemoryReturns = new Map();
export const inMemoryMaterialReturns = new Map();
export const inMemoryChecklistFinalBoms = new Map();
export const inMemoryAdditionalInstallations = new Map(); // checklist_id -> array of additional customer installation records

function loadFallbackStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.carryRecords && typeof data.carryRecords === 'object') {
        Object.entries(data.carryRecords).forEach(([k, v]) => inMemoryCarryRecords.set(k, v));
      }
      if (data.completionReports && typeof data.completionReports === 'object') {
        Object.entries(data.completionReports).forEach(([k, v]) => inMemoryCompletionReports.set(k, v));
      }
      if (data.returns && typeof data.returns === 'object') {
        Object.entries(data.returns).forEach(([k, v]) => inMemoryReturns.set(k, v));
      }
      if (data.materialReturns && typeof data.materialReturns === 'object') {
        Object.entries(data.materialReturns).forEach(([k, v]) => inMemoryMaterialReturns.set(k, v));
      }
      if (data.finalBoms && typeof data.finalBoms === 'object') {
        Object.entries(data.finalBoms).forEach(([k, v]) => inMemoryChecklistFinalBoms.set(k, v));
      }
      if (data.additionalInstallations && typeof data.additionalInstallations === 'object') {
        Object.entries(data.additionalInstallations).forEach(([k, v]) => inMemoryAdditionalInstallations.set(k, v));
      }
    }
  } catch (err) {
    console.warn('Could not load workflow fallback storage:', err.message);
  }
}

function saveFallbackStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      carryRecords: Object.fromEntries(inMemoryCarryRecords),
      completionReports: Object.fromEntries(inMemoryCompletionReports),
      returns: Object.fromEntries(inMemoryReturns),
      materialReturns: Object.fromEntries(inMemoryMaterialReturns),
      finalBoms: Object.fromEntries(inMemoryChecklistFinalBoms),
      additionalInstallations: Object.fromEntries(inMemoryAdditionalInstallations),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save workflow fallback storage:', err.message);
  }
}

// Initialize on module load
loadFallbackStorage();

/**
 * Permanently delete workflow cache entries for a deleted checklist
 */
export function deleteWorkflowRecordsForChecklist(checklistId) {
  inMemoryCarryRecords.delete(checklistId);
  inMemoryCompletionReports.delete(checklistId);
  inMemoryReturns.delete(checklistId);
  inMemoryMaterialReturns.delete(checklistId);
  inMemoryChecklistFinalBoms.delete(checklistId);
  inMemoryAdditionalInstallations.delete(checklistId);
  saveFallbackStorage();
}

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

  // Prevent duplicate carry submission
  const existingCarry = await getDeviceCarryRecord(checklist_id);
  if (existingCarry && existingCarry.source !== 'SALES_CHECKLIST' && existingCarry.items && existingCarry.items.length > 0) {
    throw new Error('Device carry record has already been submitted for this installation job. Duplicate carry submission rejected.');
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

  // 3. Atomically validate available stock and deduct from usable stock
  // If any requested quantity exceeds available stock, throws error and halts submission!
  await deductStockForCarryRecord({
    checklist_id,
    technician_user_id: user.id,
    technician_name: user.full_name || user.email,
    items: processedItems,
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
    let { data: createdRecord, error: recordErr } = await supabase
      .from('job_device_carry_records')
      .insert([carryRecord])
      .select()
      .single();

    if (recordErr && recordErr.message?.includes('violates foreign key constraint') && carryRecord.technician_user_id) {
      const retryResult = await supabase
        .from('job_device_carry_records')
        .insert([{ ...carryRecord, technician_user_id: null }])
        .select()
        .single();
      if (!retryResult.error && retryResult.data) {
        createdRecord = retryResult.data;
        recordErr = null;
      }
    }

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
    saveFallbackStorage();
  }

  // 4. Update installation checklist status
  const updatedInstallationStatus = checklist.installation_status || 'Assigned';

  try {
    const { error: updErr } = await supabase
      .from('installation_checklists')
      .update({
        carry_status: 'RECORDED',
        installation_status: updatedInstallationStatus,
        reconciliation_status: 'CARRY_RECORDED',
        updated_at: new Date().toISOString(),
      })
      .eq('id', checklist_id);

    if (updErr && updErr.code === 'PGRST204') {
      await supabase
        .from('installation_checklists')
        .update({
          installation_status: updatedInstallationStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', checklist_id);
    }
  } catch (err) {
    console.warn('DB update warning for carry_status:', err.message);
  }

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

  const inMem = inMemoryCarryRecords.get(checklist_id);
  if (inMem) return inMem;

  // Fallback: Authoritative carry record derived directly from Sales checklist device allocation
  try {
    const { data: checklist } = await supabase
      .from('installation_checklists')
      .select('*')
      .eq('id', checklist_id)
      .maybeSingle();

    if (checklist) {
      if ((checklist.installation_or_service || 'Installation') === 'Service') {
        const rawList = (Array.isArray(checklist.service_items) && checklist.service_items.length > 0)
          ? checklist.service_items
          : (inMemoryChecklistServiceItems.get(checklist.id) || []);
        const sItems = normalizeServiceItems(rawList);
        const issuedItems = sItems.filter((it) => (it.quantity_issued || 0) > 0);
        return {
          id: `carry-service-${checklist.id}`,
          checklist_id: checklist.id,
          checklist_number: checklist.checklist_number,
          source: 'SERVICE_CHECKLIST',
          status: 'SUBMITTED',
          total_devices_required: 0,
          total_extra_devices: 0,
          total_devices_carried: issuedItems.reduce((sum, it) => sum + (it.quantity_issued || 0), 0),
          items: issuedItems.map((it) => ({
            id: it.id,
            item_id: it.item_id,
            device_type: it.item_name,
            item_name: it.item_name,
            item_type: it.item_type,
            quantity_carried: it.quantity_issued,
            quantity_declared_to_carry: it.quantity_issued,
          })),
        };
      }

      const normalized = normalizeChecklistDeviceConfigs(checklist);
      const reqConfigs = normalized.device_configurations || [];
      const extraConfigs = normalized.extra_device_configurations || [];
      const combined = normalized.devices_carried || combineCarriedDevicesAllocation(reqConfigs, extraConfigs);
      const totalCarried = normalized.total_devices_carried || combined.reduce((sum, c) => sum + (Number(c.quantity_carried) || 0), 0);

      return {
        id: `carry-${checklist.id}`,
        checklist_id: checklist.id,
        checklist_number: checklist.checklist_number,
        source: 'SALES_CHECKLIST',
        status: 'SUBMITTED',
        total_devices_required: normalized.total_devices_required || reqConfigs.reduce((sum, c) => sum + (Number(c.number_of_devices) || 0), 0),
        total_extra_devices: normalized.total_extra_devices || extraConfigs.reduce((sum, c) => sum + (Number(c.extra_quantity) || 0), 0),
        total_devices_carried: totalCarried,
        required_items: reqConfigs.map((c) => ({
          device_type: c.device_type,
          quantity: Number(c.number_of_devices) || 1,
          number_of_devices: Number(c.number_of_devices) || 1,
        })),
        extra_items: extraConfigs.map((c) => ({
          device_type: c.device_type,
          quantity: Number(c.extra_quantity) || 1,
          extra_quantity: Number(c.extra_quantity) || 1,
        })),
        items: combined.map((c) => ({
          device_type: c.device_type,
          required_quantity: Number(c.required_quantity) || 0,
          extra_quantity: Number(c.extra_quantity) || 0,
          quantity_carried: Number(c.quantity_carried) || 1,
          quantity_declared_to_carry: Number(c.quantity_carried) || 1,
        })),
      };
    }
  } catch (e) {
    // Non-blocking
  }

  return null;
}

/**
 * Start Installation Job after Carry Form completion
 */
export async function startInstallationJob({ checklist_id, user }) {
  const carryRecord = await getDeviceCarryRecord(checklist_id);
  if (!carryRecord) {
    throw new Error('Mandatory Pre-Installation Device Carry Form must be completed before starting installation.');
  }

  let updated = null;
  const nowIso = new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from('installation_checklists')
      .update({
        installation_status: 'Assigned',
        actual_start_datetime: nowIso,
        updated_at: nowIso,
      })
      .eq('id', checklist_id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST204' || (error.message && error.message.includes('schema cache'))) {
        const { data: fbData, error: fbErr } = await supabase
          .from('installation_checklists')
          .update({
            installation_status: 'Assigned',
            updated_at: nowIso,
          })
          .eq('id', checklist_id)
          .select()
          .single();
        if (fbErr) throw new Error(fbErr.message);
        updated = fbData;
      } else {
        throw new Error(error.message);
      }
    } else {
      updated = data;
    }
  } catch (err) {
    if (err.message && err.message.includes('schema cache')) {
      const { data: fbData } = await supabase
        .from('installation_checklists')
        .update({
          installation_status: 'Assigned',
          updated_at: nowIso,
        })
        .eq('id', checklist_id)
        .select()
        .single();
      updated = fbData || { id: checklist_id, installation_status: 'Assigned' };
    } else {
      throw err;
    }
  }

  // Update in-memory schedule store
  const existingSched = inMemoryChecklistSchedules.get(checklist_id) || {};
  existingSched.actual_start_datetime = nowIso;
  existingSched.installation_status = 'Assigned';
  inMemoryChecklistSchedules.set(checklist_id, existingSched);

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
 * Record Additional Customer Installations using extra loose components & materials
 */
export async function recordAdditionalCustomerInstallations({
  checklist_id,
  user,
  installations = [],
  checklist = null,
  replace = false,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required to record additional customer installations.');
  }

  if (!Array.isArray(installations) || installations.length === 0) {
    return [];
  }

  let chk = checklist;
  if (!chk) {
    const { data } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, client_name, client_mobile, client_location, service_engineer, service_engineer_id')
      .eq('id', checklist_id)
      .maybeSingle();
    chk = data || {};
  }

  const originalCustomerName = chk.client_name || 'Original Customer';
  const checklistNumber = chk.checklist_number || null;
  const techId = user?.id || chk.service_engineer_id || null;
  const techName = user?.name || user?.email || chk.service_engineer || 'Technician';
  const isUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

  const existingList = inMemoryAdditionalInstallations.get(checklist_id) || [];

  const validatedRecords = installations.map((inst, idx) => {
    const rawType = (inst.recipient_customer_type || 'SAME_CUSTOMER').toUpperCase();
    const isSameCustomer = rawType === 'SAME_CUSTOMER' || rawType === 'ORIGINAL_CUSTOMER';
    const recipientType = isSameCustomer ? rawType : 'ANOTHER_CUSTOMER';

    const recipientName = (
      inst.recipient_customer_name ||
      inst.customer_name ||
      inst.recipient_name ||
      (isSameCustomer ? originalCustomerName : '')
    ).trim();
    if (!recipientName) {
      throw new Error(`Installation #${idx + 1}: Recipient customer name is required.`);
    }

    const instDate = inst.installation_date || new Date().toISOString().split('T')[0];
    const mobileVal = (inst.recipient_mobile || inst.customer_mobile || (isSameCustomer ? chk.client_mobile : '') || '').trim() || null;
    const locationVal = (inst.installation_location || inst.location || (isSameCustomer ? chk.client_location : '') || '').trim() || null;
    const mapsLink = (inst.maps_link || inst.google_maps_link || '').trim() || null;

    const rawComponents = inst.components_used || inst.components || [];
    const componentsUsed = Array.isArray(rawComponents)
      ? rawComponents.map((c) => ({
          component_name: (c.component_name || c.name || c.item_name || '').trim(),
          quantity: Math.max(0, Number(c.quantity_installed ?? c.quantity) || 0),
          quantity_installed: Math.max(0, Number(c.quantity_installed ?? c.quantity) || 0),
          unit: c.unit || 'Nos.',
        })).filter((c) => c.component_name && (c.quantity > 0 || c.quantity_installed > 0))
      : [];

    const rawMaterials = inst.materials_used || inst.materials || [];
    const materialsUsed = Array.isArray(rawMaterials)
      ? rawMaterials.map((m) => ({
          material_name: (m.material_name || m.name || m.item_name || '').trim(),
          quantity: Math.max(0, Number(m.quantity_installed ?? m.quantity) || 0),
          quantity_installed: Math.max(0, Number(m.quantity_installed ?? m.quantity) || 0),
          unit: m.unit || 'Nos.',
        })).filter((m) => m.material_name && (m.quantity > 0 || m.quantity_installed > 0))
      : [];

    let recordId = isUuid(inst.id) ? inst.id : null;
    if (!recordId) {
      const match = existingList.find((ex) => {
        const exName = (ex.recipient_customer_name || ex.customer_name || '').trim().toLowerCase();
        return exName && exName === recipientName.toLowerCase();
      });
      if (match && isUuid(match.id)) {
        recordId = match.id;
      } else {
        recordId = crypto.randomUUID();
      }
    }
    const subUserId = isUuid(user?.id) ? user.id : null;
    const techUuid = isUuid(techId) ? techId : null;
    const recipientChkId = isUuid(inst.recipient_checklist_id) ? inst.recipient_checklist_id : null;
    const recipientChkNum = inst.recipient_checklist_number ? String(inst.recipient_checklist_number).trim() : 'Not Linked';

    return {
      id: recordId,
      checklist_id,
      original_checklist_id: checklist_id,
      checklist_number: checklistNumber,
      original_checklist_number: checklistNumber,
      original_customer_name: originalCustomerName,
      submitting_user_id: subUserId,
      technician_id: techUuid,
      technician_name: techName,
      recipient_customer_type: recipientType,
      recipient_customer_name: recipientName,
      customer_name: recipientName,
      recipient_mobile: mobileVal,
      customer_mobile: mobileVal,
      installation_location: locationVal,
      location: locationVal,
      maps_link: mapsLink,
      google_maps_link: mapsLink,
      installation_date: instDate,
      device_configuration: (inst.device_configuration || '').trim() || null,
      components_used: componentsUsed,
      components: componentsUsed,
      materials_used: materialsUsed,
      materials: materialsUsed,
      notes: (inst.notes || '').trim() || null,
      recipient_checklist_id: recipientChkId,
      recipient_checklist_number: recipientChkNum,
      status: inst.status || 'COMPLETED',
      created_at: inst.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  // 1. Try DB persistence into additional_customer_installations table
  try {
    const { data: inserted, error: insErr } = await supabase
      .from('additional_customer_installations')
      .upsert(validatedRecords, { onConflict: 'id' })
      .select();

    if (insErr) {
      console.warn('Could not upsert into additional_customer_installations table:', insErr.message);
    }
  } catch (err) {
    console.warn('DB additional_customer_installations error, fallback to memory:', err.message);
  }

  // 2. Compute accumulated records
  let finalRecords = [];
  if (replace) {
    finalRecords = validatedRecords;
  } else {
    const recordMap = new Map();
    existingList.forEach((r) => recordMap.set(r.id, r));
    validatedRecords.forEach((r) => recordMap.set(r.id, r));
    finalRecords = Array.from(recordMap.values());
  }
  inMemoryAdditionalInstallations.set(checklist_id, finalRecords);
  saveFallbackStorage();

  // 3. Also persist accumulated extra_installations inside installation_checklists.final_bom_snapshot (guaranteed DB storage)
  if (isUuid(checklist_id)) {
    try {
      const { data: curChk } = await supabase
        .from('installation_checklists')
        .select('final_bom_snapshot')
        .eq('id', checklist_id)
        .maybeSingle();

      const existingBom = curChk?.final_bom_snapshot || {};
      const updatedBom = {
        ...existingBom,
        extra_installations: finalRecords,
      };

      await supabase
        .from('installation_checklists')
        .update({ final_bom_snapshot: updatedBom })
        .eq('id', checklist_id);
    } catch (chkErr) {
      console.warn('Could not update extra_installations in installation_checklists DB:', chkErr.message);
    }
  }

  // Audit
  try {
    await logAudit({
      user,
      action: 'RECORD_ADDITIONAL_CUSTOMER_INSTALLATIONS',
      entity: 'installation_checklists',
      entity_id: checklist_id,
      details: {
        count: validatedRecords.length,
        installations: validatedRecords.map((r) => ({
          id: r.id,
          recipient: r.recipient_customer_name,
          type: r.recipient_customer_type,
          configuration: r.device_configuration,
          components_count: r.components_used.length,
        })),
      },
    });
  } catch (auditErr) {
    // non-blocking
  }

  return finalRecords;
}

/**
 * Normalizes an extra installation record to guarantee both naming conventions
 */
function normalizeExtraInstallationRecord(r) {
  if (!r || typeof r !== 'object') return r;
  const name = r.recipient_customer_name || r.customer_name || r.recipient_name || '';
  const mobile = r.recipient_mobile || r.customer_mobile || null;
  const loc = r.installation_location || r.location || null;
  const mapLink = r.maps_link || r.google_maps_link || null;
  const comps = (r.components_used || r.components || []).map((c) => ({
    component_name: c.component_name || c.name || '',
    quantity: Number(c.quantity_installed ?? c.quantity) || 0,
    quantity_installed: Number(c.quantity_installed ?? c.quantity) || 0,
    unit: c.unit || 'Nos.',
  }));
  const mats = (r.materials_used || r.materials || []).map((m) => ({
    material_name: m.material_name || m.name || '',
    quantity: Number(m.quantity_installed ?? m.quantity) || 0,
    quantity_installed: Number(m.quantity_installed ?? m.quantity) || 0,
    unit: m.unit || 'Nos.',
  }));

  return {
    ...r,
    checklist_id: r.checklist_id || r.original_checklist_id,
    original_checklist_id: r.checklist_id || r.original_checklist_id,
    customer_name: name,
    recipient_customer_name: name,
    customer_mobile: mobile,
    recipient_mobile: mobile,
    location: loc,
    installation_location: loc,
    google_maps_link: mapLink,
    maps_link: mapLink,
    components: comps,
    components_used: comps,
    materials: mats,
    materials_used: mats,
    recipient_checklist_number: r.recipient_checklist_number || 'Not Linked',
  };
}

/**
 * Get Additional Customer Installations by checklist or technician
 */
export async function getAdditionalCustomerInstallations(param = {}) {
  let checklist_id;
  let technician_id;
  if (typeof param === 'string') {
    checklist_id = param;
  } else if (param && typeof param === 'object') {
    checklist_id = param.checklist_id || param.checklistId;
    technician_id = param.technician_id || param.technicianId;
  }

  // 1. Try DB table additional_customer_installations
  try {
    let query = supabase.from('additional_customer_installations').select('*').order('created_at', { ascending: false });
    if (checklist_id) {
      query = query.eq('checklist_id', checklist_id);
    }
    if (technician_id) {
      query = query.eq('technician_id', technician_id);
    }
    const { data, error } = await query;
    if (!error && Array.isArray(data) && data.length > 0) {
      return data.map(normalizeExtraInstallationRecord);
    }
  } catch (err) {
    console.warn('Could not query additional_customer_installations from DB:', err.message);
  }

  // 2. Try DB technical_installation_reports / installation_checklists
  if (checklist_id) {
    try {
      const { data: rep } = await supabase
        .from('technical_installation_reports')
        .select('final_bom, backup_items')
        .eq('checklist_id', checklist_id)
        .maybeSingle();

      if (rep?.final_bom?.extra_installations && Array.isArray(rep.final_bom.extra_installations) && rep.final_bom.extra_installations.length > 0) {
        return rep.final_bom.extra_installations.map(normalizeExtraInstallationRecord);
      }

      const { data: chk } = await supabase
        .from('installation_checklists')
        .select('final_bom_snapshot')
        .eq('id', checklist_id)
        .maybeSingle();

      if (chk?.final_bom_snapshot?.extra_installations && Array.isArray(chk.final_bom_snapshot.extra_installations) && chk.final_bom_snapshot.extra_installations.length > 0) {
        return chk.final_bom_snapshot.extra_installations.map(normalizeExtraInstallationRecord);
      }
    } catch (dbErr) {
      // fallback
    }
  }

  // 3. Fallback to inMemory
  if (checklist_id) {
    const mem = inMemoryAdditionalInstallations.get(checklist_id);
    if (Array.isArray(mem) && mem.length > 0) return mem.map(normalizeExtraInstallationRecord);
    const compRep = inMemoryCompletionReports.get(checklist_id);
    if (Array.isArray(compRep?.extra_installations) && compRep.extra_installations.length > 0) {
      return compRep.extra_installations.map(normalizeExtraInstallationRecord);
    }
    return [];
  }
  const all = [];
  for (const list of inMemoryAdditionalInstallations.values()) {
    if (Array.isArray(list)) all.push(...list);
  }
  if (technician_id) {
    return all.filter((r) => r.technician_id === technician_id).map(normalizeExtraInstallationRecord);
  }
  return all.map(normalizeExtraInstallationRecord);
}

/**
 * Detects whether an item or material name refers to screw hardware.
 * Screws (Long Screw, Small Screw) are excluded from the Post-Installation Form's
 * material selection, usage, and return fields.
 */
export function isScrewMaterial(itemOrName) {
  if (!itemOrName) return false;
  const name = typeof itemOrName === 'string'
    ? itemOrName
    : (itemOrName.item_name || itemOrName.material_name || itemOrName.product_name || itemOrName.device_type || '');
  const sku = typeof itemOrName === 'object' ? (itemOrName.sku || '') : '';
  const n = String(name).toLowerCase().replace(/[-_()]/g, ' ').replace(/\s+/g, ' ').trim();
  const s = String(sku).toLowerCase();
  return (
    s.includes('screw') ||
    n === 'long screw' ||
    n === 'small screw' ||
    n === 'screw long' ||
    n === 'screw small' ||
    n.includes('long screw') ||
    n.includes('small screw') ||
    n.includes('screw')
  );
}

/**
 * Checks if a product/material name belongs to the device component category
 */
export function isDeviceComponent(itemOrName) {
  if (!itemOrName) return false;
  const name = typeof itemOrName === 'string'
    ? itemOrName
    : (itemOrName.item_name || itemOrName.material_name || itemOrName.product_name || itemOrName.device_type || '');
  const lower = String(name).toLowerCase();
  return (
    lower.includes('camera') ||
    lower.includes('display') ||
    lower.includes('screen') ||
    lower.includes('mdvr') ||
    lower.includes('sensor') ||
    lower.includes('system')
  );
}

/**
 * Stage 3: Technical submits Post-Installation Completion Form
 */
export async function submitInstallationCompletionReport(param1, param2) {
  let opts = {};
  if (param2 && typeof param2 === 'object') {
    const userObj = param2.user || (typeof param1 === 'object' ? param1 : { id: param1, email: 'tech@eagleeye.com', role: 'TECHNICAL' });
    opts = { ...param2, user: userObj };
    if (!opts.checklist_id && typeof param1 === 'string') {
      opts.checklist_id = param1;
    }
  } else if (param1 && typeof param1 === 'object') {
    opts = param1;
  }

  const checklist_id = opts.checklist_id;
  const user = opts.user || { id: 'tech-user', email: 'tech@eagleeye.com', role: 'TECHNICAL' };

  const { data: checklist, error: checkErr } = await supabase
    .from('installation_checklists')
    .select('*')
    .eq('id', checklist_id)
    .maybeSingle();

  if (checkErr || !checklist) {
    throw new Error('Installation checklist not found');
  }

  const isServiceJob = (checklist.installation_or_service || 'Installation') === 'Service';
  const rawSList = (Array.isArray(checklist.service_items) && checklist.service_items.length > 0)
    ? checklist.service_items
    : (inMemoryChecklistServiceItems.get(checklist_id) || []);
  const serviceItems = isServiceJob ? normalizeServiceItems(rawSList) : [];
  const issuedServiceItems = serviceItems.filter((it) => (it.quantity_issued || 0) > 0);

  const items = (opts.items || opts.device_items || []).filter(
    (i) => !isScrewMaterial(i.device_type || i.item_name)
  );
  const rawMaterialItems = (opts.material_items || opts.materials || []).filter(
    (m) => !isScrewMaterial(m.material_name || m.item_name)
  );
  const completion_status = opts.completion_status || 'Site Work Completed';
  const remarks = opts.remarks || opts.completion_notes || '';

  if (!isServiceJob && (!items || !Array.isArray(items) || items.length === 0)) {
    throw new Error('Completion report items are required');
  }
  if (isServiceJob && issuedServiceItems.length > 0 && (!items || !Array.isArray(items) || items.length === 0)) {
    throw new Error(`Reconciliation is required for the ${issuedServiceItems.length} items issued for this service job.`);
  }

  let totalCarried = 0;
  let totalInstalled = 0;
  let totalInstalledRequired = 0;
  let totalInstalledExtra = 0;
  let totalUnused = 0;
  let totalDamaged = 0;
  let totalMissing = 0;
  let hasDiscrepancy = false;

  const processedItems = items.map((item) => {
    const qtyCarried = Math.max(0, parseInt(item.quantity_carried, 10) || 0);
    const qtyInstalledReq = parseInt(item.quantity_installed_required, 10);
    const qtyInstalledExt = parseInt(item.quantity_installed_extra, 10);
    const hasReqExtSplit = !isNaN(qtyInstalledReq) || !isNaN(qtyInstalledExt);
    const safeInstalledReq = Math.max(0, qtyInstalledReq || 0);
    const safeInstalledExt = Math.max(0, qtyInstalledExt || 0);

    const qtyInstalled = hasReqExtSplit
      ? (safeInstalledReq + safeInstalledExt)
      : Math.max(0, parseInt(item.quantity_installed, 10) || 0);

    const qtyDamaged = Math.max(0, parseInt(item.quantity_damaged, 10) || 0);
    const qtyMissing = Math.max(0, parseInt(item.quantity_missing, 10) || 0);

    const rawReq = parseInt(item.quantity_installed_required, 10);
    const rawExt = parseInt(item.quantity_installed_extra, 10);
    const rawInst = parseInt(item.quantity_installed, 10);
    const rawRet = parseInt(item.quantity_to_return ?? item.quantity_returned, 10);
    const rawDam = parseInt(item.quantity_damaged, 10);
    const rawMis = parseInt(item.quantity_missing, 10);

    const qtyUnused = !isNaN(rawRet)
      ? Math.max(0, rawRet)
      : Math.max(0, qtyCarried - qtyInstalled - qtyDamaged - qtyMissing);

    if (
      (!isNaN(rawReq) && rawReq < 0) ||
      (!isNaN(rawExt) && rawExt < 0) ||
      (!isNaN(rawInst) && rawInst < 0) ||
      (!isNaN(rawRet) && rawRet < 0) ||
      (!isNaN(rawDam) && rawDam < 0) ||
      (!isNaN(rawMis) && rawMis < 0)
    ) {
      throw new Error(`Quantities for "${item.device_type || item.item_name}" cannot be negative numbers.`);
    }

    if (qtyCarried === 0 && qtyInstalled > 0) {
      throw new Error(`Cannot report installation of unissued product "${item.device_type || item.item_name}" (issued quantity is 0).`);
    }

    if (qtyInstalled > qtyCarried) {
      throw new Error(
        `Quantity installed (${qtyInstalled}) cannot exceed quantity carried (${qtyCarried}) for required device ${item.device_type}. Extra devices installed must be recorded using extra backup items or extra installations.`
      );
    }

    if (qtyUnused > qtyCarried) {
      throw new Error(`Unused quantity to return (${qtyUnused}) cannot exceed quantity carried (${qtyCarried}) for ${item.device_type}`);
    }

    const totalAccounted = qtyInstalled + qtyUnused + qtyDamaged + qtyMissing;
    const diff = qtyCarried - totalAccounted;

    if (diff !== 0) {
      throw new Error(
        `Reconciliation mismatch for ${item.device_type}: Quantity carried (${qtyCarried}) must equal Quantity installed (${qtyInstalled}) + Quantity returned (${qtyUnused}) + Damaged (${qtyDamaged}) + Missing (${qtyMissing}). Report cannot be submitted when quantities do not reconcile.`
      );
    }

    if ((qtyDamaged > 0 || qtyMissing > 0) && (!item.discrepancy_reason || !item.discrepancy_reason.trim())) {
      throw new Error(
        `Explanation remark is required for ${item.device_type} when recording damaged (${qtyDamaged}) or missing (${qtyMissing}) devices.`
      );
    }

    if (qtyDamaged > 0 || qtyMissing > 0) {
      hasDiscrepancy = true;
    }

    totalCarried += qtyCarried;
    totalInstalled += qtyInstalled;
    totalInstalledRequired += safeInstalledReq;
    totalInstalledExtra += safeInstalledExt;
    totalUnused += qtyUnused;
    totalDamaged += qtyDamaged;
    totalMissing += qtyMissing;

    return {
      checklist_id,
      device_type: item.device_type || item.item_name,
      quantity_carried: qtyCarried,
      quantity_installed: qtyInstalled,
      quantity_installed_required: safeInstalledReq,
      quantity_installed_extra: safeInstalledExt,
      quantity_to_return: qtyUnused,
      quantity_damaged: qtyDamaged,
      quantity_missing: qtyMissing,
      discrepancy_reason: item.discrepancy_reason ? item.discrepancy_reason.trim() : null,
    };
  });

  // Process fitting materials items (issued, used, returned, damaged, missing)
  let totalMaterialsReturned = 0;
  const processedMaterialItems = (Array.isArray(rawMaterialItems) ? rawMaterialItems : []).map((m) => {
    const rawIssued = parseFloat(m.quantity_issued ?? m.issued_quantity) || 0;
    const rawUsed = parseFloat(m.quantity_used ?? m.used_quantity) || 0;
    const rawReturned = parseFloat(m.quantity_returned ?? m.returned_quantity ?? m.declared_return_qty) || 0;
    const rawDamaged = parseFloat(m.quantity_damaged ?? m.damaged_qty) || 0;
    const rawMissing = parseFloat(m.quantity_missing ?? m.missing_qty) || 0;

    if (rawIssued < 0 || rawUsed < 0 || rawReturned < 0 || rawDamaged < 0 || rawMissing < 0) {
      throw new Error(`Quantities for material "${m.material_name || m.item_name}" cannot be negative numbers.`);
    }

    if (rawIssued === 0 && rawUsed > 0) {
      throw new Error(`Cannot report usage of unissued material "${m.material_name || m.item_name}" (issued quantity is 0).`);
    }

    const totalMatAccounted = rawUsed + rawReturned + rawDamaged + rawMissing;
    if (rawIssued > 0 && Math.abs(totalMatAccounted - rawIssued) > 0.001) {
      throw new Error(
        `Reconciliation mismatch for material "${m.material_name || m.item_name}": Quantity issued (${rawIssued}) must equal Used (${rawUsed}) + Returned (${rawReturned}) + Damaged (${rawDamaged}) + Missing (${rawMissing}). Total accounted is ${totalMatAccounted}.`
      );
    }

    if ((rawDamaged > 0 || rawMissing > 0) && (!m.remarks || !m.remarks.trim())) {
      throw new Error(
        `Explanation remark is required for material "${m.material_name || m.item_name}" when reporting damaged (${rawDamaged}) or missing (${rawMissing}) materials.`
      );
    }

    if (rawDamaged > 0 || rawMissing > 0) {
      hasDiscrepancy = true;
    }
    if (rawReturned > 0) {
      totalMaterialsReturned += rawReturned;
    }

    return {
      material_id: m.material_id || null,
      material_name: (m.material_name || m.item_name || '').trim(),
      unit: m.unit || 'Nos.',
      quantity_issued: rawIssued,
      quantity_used: rawUsed,
      quantity_returned: rawReturned,
      quantity_damaged: rawDamaged,
      quantity_missing: rawMissing,
      remarks: m.remarks ? m.remarks.trim() : null,
    };
  });

  // Reconcile extra loose backup items if declared/provided (screws excluded from post-installation form)
  let processedBackupItems = [];
  const rawBackupItems = (opts.backup_items || opts.backupItems || []).filter(
    (b) => !isScrewMaterial(b.item_name || b.material_name)
  );
  if (Array.isArray(rawBackupItems) && rawBackupItems.length > 0) {
    const { reconcileBackupItems } = await import('./backupItemService.js');
    const reconResult = await reconcileBackupItems({
      checklistId: checklist_id,
      user,
      items: rawBackupItems,
    });
    processedBackupItems = reconResult.items || [];
    if (processedBackupItems.some((b) => (Number(b.quantity_damaged) > 0 || Number(b.quantity_missing) > 0))) {
      hasDiscrepancy = true;
    }
  }

  // Process additional customer installations (if provided)
  const rawExtraInstallations = opts.extra_installations || opts.additional_customer_installations || [];
  let processedExtraInstallations = [];
  if (Array.isArray(rawExtraInstallations) && rawExtraInstallations.length > 0) {
    processedExtraInstallations = await recordAdditionalCustomerInstallations({
      checklist_id,
      user,
      installations: rawExtraInstallations,
      checklist,
      replace: true,
    });
  }

  // 3. Calculate Final BOM based on ALL devices actually installed (including extra devices installed)
  // Formula: Final BOM = Sum of (actual installed quantity for each device type × configured BOM quantity per device type)
  const installedConfigs = processedItems
    .filter((i) => i.quantity_installed > 0)
    .map((i) => ({
      device_type: i.device_type,
      number_of_devices: i.quantity_installed,
      number_of_vehicles: i.quantity_installed,
    }));

  let finalBomSnapshot = null;
  if (!isServiceJob) {
    try {
      finalBomSnapshot = await calculateJobFinalBom({
        installedDeviceConfigs: installedConfigs,
        preliminaryBomSnapshot: checklist.bom_snapshot || inMemoryChecklistBomSnapshots?.get(checklist_id),
        actualMaterialsIssued: processedMaterialItems,
        actualMaterialsUsed: processedMaterialItems.filter((m) => m.quantity_used > 0),
        actualMaterialsReturned: processedMaterialItems.filter((m) => m.quantity_returned > 0),
      });
    } catch (bomErr) {
      console.warn('Could not calculate final BOM snapshot:', bomErr.message);
    }

    if (finalBomSnapshot && processedExtraInstallations.length > 0) {
      finalBomSnapshot.extra_installations = processedExtraInstallations;
    }
  }

  // Calculate extra devices metrics strictly from declared loose backup items
  let extraDevCarried = 0;
  let extraDevInstalled = 0;
  let extraDevUnused = 0;
  let extraDevDamaged = 0;
  let extraDevMissing = 0;

  processedBackupItems.forEach((b) => {
    const isDev = b.category === 'Device Component' || isDeviceComponent(b.item_name || b.material_name);
    if (isDev) {
      extraDevCarried += Number(b.quantity ?? b.quantity_carried ?? 0);
      extraDevInstalled += Number(b.quantity_used ?? 0);
      extraDevUnused += Number(b.quantity_returned ?? 0);
      extraDevDamaged += Number(b.quantity_damaged ?? 0);
      extraDevMissing += Number(b.quantity_missing ?? 0);
    }
  });

  const reportData = {
    checklist_id,
    technician_id: user.id,
    devices_carried_qty: totalCarried,
    devices_installed_qty: totalInstalled,
    devices_installed_required_qty: totalInstalledRequired,
    devices_installed_extra_qty: totalInstalledExtra || extraDevInstalled,
    devices_unused_qty: totalUnused,
    devices_damaged_qty: totalDamaged,
    devices_missing_qty: totalMissing,
    extra_devices_carried_qty: extraDevCarried,
    extra_devices_installed_qty: extraDevInstalled,
    extra_devices_unused_qty: extraDevUnused,
    extra_devices_damaged_qty: extraDevDamaged,
    extra_devices_missing_qty: extraDevMissing,
    material_items: processedMaterialItems,
    backup_items: processedBackupItems,
    extra_installations: processedExtraInstallations,
    final_bom: finalBomSnapshot,
    completion_status: completion_status === 'Completed' ? 'Completed' : 'Site Work Completed',
    remarks: remarks ? remarks.trim() : null,
    submitted_at: new Date().toISOString(),
  };

  let reportId = null;

  try {
    const dbPayload = { ...reportData };
    let { data: created, error } = await supabase
      .from('technical_installation_reports')
      .upsert([dbPayload], { onConflict: 'checklist_id' })
      .select()
      .single();

    if (error && error.message?.includes('extra_installations')) {
      delete dbPayload.extra_installations;
      const retryResult = await supabase
        .from('technical_installation_reports')
        .upsert([dbPayload], { onConflict: 'checklist_id' })
        .select()
        .single();
      if (!retryResult.error) {
        created = retryResult.data;
        error = null;
      } else {
        error = retryResult.error;
      }
    }

    if (error && error.message?.includes('violates foreign key constraint') && dbPayload.technician_id) {
      delete dbPayload.extra_installations;
      const retryResult = await supabase
        .from('technical_installation_reports')
        .upsert([{ ...dbPayload, technician_id: null }], { onConflict: 'checklist_id' })
        .select()
        .single();
      if (!retryResult.error && retryResult.data) {
        created = retryResult.data;
        error = null;
      }
    }

    if (error) throw error;
    reportId = created.id;

    // Insert items
    const reportItems = processedItems.map((i) => ({ ...i, report_id: reportId }));
    const { error: repItemErr } = await supabase.from('technical_installation_report_items').insert(reportItems);
    if (repItemErr) {
      console.warn('Failed to insert full technical_installation_report_items, retrying with core columns:', repItemErr.message);
      const coreReportItems = processedItems.map((i) => ({
        report_id: reportId,
        checklist_id: i.checklist_id,
        device_type: i.device_type,
        quantity_carried: i.quantity_carried,
        quantity_installed: i.quantity_installed,
        quantity_to_return: i.quantity_to_return,
        quantity_damaged: i.quantity_damaged,
        quantity_missing: i.quantity_missing,
        discrepancy_reason: i.discrepancy_reason,
      }));
      await supabase.from('technical_installation_report_items').insert(coreReportItems);
    }
  } catch (dbErr) {
    console.warn('DB technical_installation_reports not available, using in-memory store:', dbErr.message);
    reportId = `report-${checklist_id}-${Date.now()}`;
  }

  // Always keep in-memory cache synchronized with the latest submitted report
  const savedReport = {
    ...reportData,
    id: reportId,
    items: processedItems,
    device_items: processedItems,
    material_items: processedMaterialItems,
    extra_installations: processedExtraInstallations,
  };
  inMemoryCompletionReports.set(checklist_id, savedReport);
  saveFallbackStorage();

  // Auto create return declaration if unused devices exist
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

  // Auto create material return declaration if unused fitting materials exist (excluding screws)
  const returnedMaterialItems = processedMaterialItems
    .filter((m) => !isScrewMaterial(m.material_name))
    .filter((m) => m.quantity_returned > 0);
  if (returnedMaterialItems.length > 0) {
    await declareMaterialReturns({
      checklist_id,
      items: returnedMaterialItems,
      user,
      remarks: remarks || 'Unused fitting materials returned from installation work',
    });
  }

  // Update checklist status automatically across all workspaces
  const finalInstStatus = 'Completed';
  const finalReconStatus = hasDiscrepancy
    ? 'DISCREPANCY_OPEN'
    : (totalUnused > 0 || returnedMaterialItems.length > 0)
    ? 'PENDING_STORE_VERIFICATION'
    : 'FULLY_RECONCILED';

  reportData.reconciliation_status = finalReconStatus;
  const existingReport = inMemoryCompletionReports.get(checklist_id);
  if (existingReport) {
    existingReport.reconciliation_status = finalReconStatus;
    inMemoryCompletionReports.set(checklist_id, existingReport);
    saveFallbackStorage();
  }

  if (finalBomSnapshot) {
    inMemoryChecklistFinalBoms.set(checklist_id, finalBomSnapshot);
    saveFallbackStorage();
  }

  const now = opts.actual_completion_datetime || opts.actual_completion_date || new Date().toISOString();
  const submissionTime = opts.submission_datetime || opts.post_installation_submitted_at || new Date().toISOString();

  // Scenario E: Check for late completion and notify HR if completed after scheduled end date
  try {
    const { recordLateCompletion } = await import('./overdueDetectionService.js');
    await recordLateCompletion({
      checklist,
      actualCompletionDatetime: now,
      submissionDatetime: submissionTime,
      user,
    });
  } catch (lateErr) {
    console.warn('Late completion recording warning:', lateErr.message);
  }

  try {
    const { error: updErr } = await supabase
      .from('installation_checklists')
      .update({
        installation_status: finalInstStatus,
        completion_type: 'TECHNICIAN_INSTALLED',
        reconciliation_status: finalReconStatus,
        final_bom_snapshot: finalBomSnapshot,
        actual_materials_used: processedMaterialItems.filter((m) => m.quantity_used > 0),
        actual_materials_returned: returnedMaterialItems,
        material_return_status: returnedMaterialItems.length > 0 ? 'PENDING_STORE_VERIFICATION' : 'NOT_APPLICABLE',
        actual_completion_datetime: now,
        actual_completion_at: now,
        post_installation_submitted_at: submissionTime,
        updated_at: submissionTime,
      })
      .eq('id', checklist_id);

    if (updErr) {
      console.warn('DB update warning for checklist status, falling back to core status update:', updErr.message);
      const { error: coreErr } = await supabase
        .from('installation_checklists')
        .update({
          installation_status: finalInstStatus,
          completion_type: 'TECHNICIAN_INSTALLED',
          reconciliation_status: finalReconStatus,
          actual_completion_datetime: now,
          updated_at: submissionTime,
        })
        .eq('id', checklist_id);

      if (coreErr) {
        await supabase
          .from('installation_checklists')
          .update({
            installation_status: finalInstStatus,
            completion_type: 'TECHNICIAN_INSTALLED',
            updated_at: submissionTime,
          })
          .eq('id', checklist_id);
      }
    }

    // Update in-memory schedule store
    const compSched = inMemoryChecklistSchedules.get(checklist_id) || {};
    compSched.actual_completion_datetime = now;
    compSched.actual_completion_at = now;
    compSched.post_installation_submitted_at = submissionTime;
    compSched.installation_status = finalInstStatus;
    inMemoryChecklistSchedules.set(checklist_id, compSched);

    // Update engineer_bookings to COMPLETED with actual completion date
    await supabase
      .from('engineer_bookings')
      .update({
        status: 'COMPLETED',
        actual_completion_datetime: now,
        updated_at: submissionTime,
      })
      .eq('checklist_id', checklist_id);
  } catch (err) {
    console.warn('DB update warning for checklist status:', err.message);
  }

  // Also sync in-memory and persistent storage fallback
  try {
    completeEngineerBookingByChecklistId(checklist_id, now);
  } catch (e) {}

  // Stage 3 Notification: Trigger persistent & real-time Coordinator notification for Post-Installation Report
  try {
    const { notifyCoordinatorOnPostInstallationReport } = await import('./coordinatorBookingService.js');
    await notifyCoordinatorOnPostInstallationReport({
      checklist,
      report: savedReport,
      technicianName: checklist.service_engineer || user?.full_name || user?.name || user?.email || 'Technician',
      user,
      submissionTime,
      actualCompletionDatetime: now,
    });
  } catch (notifErr) {
    console.warn('[WORKFLOW] Coordinator post-installation notification error (report safely saved):', notifErr.message);
  }

  // Requirement 4: Trigger Return Ticket Booking Task for Coordinator
  try {
    const { triggerReturnTicketBookingTask } = await import('./coordinatorBookingService.js');
    await triggerReturnTicketBookingTask({
      checklist,
      user,
      actualCompletionDatetime: now,
      submissionDatetime: submissionTime,
    });
  } catch (ticketErr) {
    console.warn('Could not trigger return ticket booking task for coordinator:', ticketErr.message);
  }

  // Stage 3B: If extra devices were installed for another customer, notify Store Manager
  const otherCustomerInstalls = (processedExtraInstallations || []).filter(
    (e) => e.recipient_customer_type === 'ANOTHER_CUSTOMER'
  );
  if (otherCustomerInstalls.length > 0) {
    try {
      const { createNotification } = await import('./appNotificationService.js');
      const chkNum = checklist?.checklist_number || checklist_id;
      const names = otherCustomerInstalls.map((c) => c.recipient_customer_name).filter(Boolean).join(', ');
      await createNotification({
        targetRole: 'STORE_MANAGER',
        title: `Extra Devices Installed for Other Customer: ${chkNum}`,
        message: `Technician ${checklist?.service_engineer || user?.name || 'Technician'} installed extra carried devices for ${names} under checklist ${chkNum}.`,
        type: 'EXTRA_DEVICE_INSTALLATION_RECORDED',
        checklistId: checklist_id,
        checklistNumber: chkNum,
        metadata: {
          checklist_id,
          checklist_number: chkNum,
          recipient_names: names,
          action_label: 'View in Incoming Jobs',
          action_url: `/store?tab=incoming&checklist=${checklist_id}`,
          idempotency_key: `extra-inst-store-${checklist_id}`,
        },
      });
    } catch (storeNotifErr) {
      console.warn('[WORKFLOW] Store Manager extra devices notification warning:', storeNotifErr.message);
    }
  }

  await logAudit({
    actor_id: user.id,
    actor_email: user.email,
    actor_role: user.role,
    action: 'SUBMIT_INSTALLATION_COMPLETION_REPORT',
    target_table: 'technical_installation_reports',
    target_id: reportId,
    details: {
      checklist_id,
      totalInstalled,
      totalInstalledRequired,
      totalInstalledExtra,
      totalUnused,
      totalDamaged,
      totalMissing,
      materialsReturnedCount: returnedMaterialItems.length,
      hasDiscrepancy,
    },
  });

  return {
    ...reportData,
    id: reportId,
    checklist_id,
    items: processedItems,
    device_items: processedItems,
    material_items: processedMaterialItems,
    backup_items: processedBackupItems,
    summary: reportData,
    final_bom_snapshot: finalBomSnapshot,
    status: finalInstStatus,
    reconciliation_status: finalReconStatus,
    total_devices_installed: totalInstalled,
    total_devices_installed_required: totalInstalledRequired,
    total_devices_installed_extra: totalInstalledExtra,
    total_devices_to_return: totalUnused,
    total_devices_carried: totalCarried,
    total_devices_damaged: totalDamaged,
    total_devices_missing: totalMissing,
    materials_returned: returnedMaterialItems,
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
      const [{ data: items }, extraInstallations] = await Promise.all([
        supabase.from('technical_installation_report_items').select('*').eq('report_id', report.id),
        getAdditionalCustomerInstallations({ checklist_id }),
      ]);

      const cached = inMemoryCompletionReports.get(checklist_id);
      const effectiveItems = ((items && items.length > 0)
        ? items
        : (cached?.items || cached?.device_items || report.items || []))
        .filter((it) => !isScrewMaterial(it.device_type || it.item_name));

      const rawMaterials = report.material_items || cached?.material_items || [];
      const sanitizedMaterials = Array.isArray(rawMaterials)
        ? rawMaterials.filter((m) => !isScrewMaterial(m.material_name || m.item_name))
        : [];

      return {
        ...report,
        items: effectiveItems,
        device_items: effectiveItems,
        material_items: sanitizedMaterials,
        backup_items: report.backup_items || cached?.backup_items || [],
        extra_installations: (extraInstallations && extraInstallations.length > 0)
          ? extraInstallations
          : (cached?.extra_installations || report.extra_installations || []),
      };
    }
  } catch (err) {
    console.warn('Error fetching completion report from DB, checking in-memory store:', err.message);
  }

  const cached = inMemoryCompletionReports.get(checklist_id);
  if (cached) {
    const extraInstallations = await getAdditionalCustomerInstallations({ checklist_id });
    const cachedMaterials = Array.isArray(cached.material_items)
      ? cached.material_items.filter((m) => !isScrewMaterial(m.material_name || m.item_name))
      : [];
    const cachedItems = (cached.items || cached.device_items || []).filter(
      (it) => !isScrewMaterial(it.device_type || it.item_name)
    );
    return {
      ...cached,
      items: cachedItems,
      device_items: cachedItems,
      material_items: cachedMaterials,
      backup_items: cached.backup_items || [],
      extra_installations: extraInstallations || cached.extra_installations || [],
    };
  }

  return null;
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
    id: crypto.randomUUID(),
    checklist_id,
    device_type,
    declared_return_qty,
    declared_by: user.id,
    declared_at: new Date().toISOString(),
    status: 'PENDING_STORE_VERIFICATION',
    verification_remarks: remarks,
  };

  try {
    let { data: created, error } = await supabase
      .from('job_device_returns')
      .insert([{
        id: returnRecord.id,
        checklist_id,
        device_type,
        declared_return_qty,
        declared_by: user.id,
        declared_at: returnRecord.declared_at,
        status: 'PENDING_STORE_VERIFICATION',
        verification_remarks: remarks,
      }])
      .select()
      .maybeSingle();

    if (error && error.message?.includes('violates foreign key constraint') && user.id) {
      const retry = await supabase
        .from('job_device_returns')
        .insert([{
          id: returnRecord.id,
          checklist_id,
          device_type,
          declared_return_qty,
          declared_by: null,
          declared_at: returnRecord.declared_at,
          status: 'PENDING_STORE_VERIFICATION',
          verification_remarks: remarks,
        }])
        .select()
        .maybeSingle();

      if (!retry.error && retry.data) {
        created = retry.data;
        error = null;
      }
    }

    if (!error && created) {
      returnRecord.id = created.id;
    }
  } catch (dbErr) {
    console.warn('DB job_device_returns not available, using in-memory returns:', dbErr.message);
  }

  inMemoryReturns.set(returnRecord.id, returnRecord);
  saveFallbackStorage();

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
 * Stage 4B: Technical declares unused fitting materials returned to store
 */
export async function declareMaterialReturns({
  checklist_id,
  items = [],
  user,
  remarks = '',
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required to declare material returns');
  }
  const validItems = (Array.isArray(items) ? items : []).filter(
    (it) => !isScrewMaterial(it.material_name || it.item_name)
  );
  if (validItems.length === 0) {
    return [];
  }

  const createdRecords = [];

  for (const item of validItems) {
    const declaredQty = parseFloat(item.quantity_returned ?? item.declared_return_qty) || 0;
    if (declaredQty <= 0) continue;

    const returnId = `matret-${checklist_id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const returnRecord = {
      id: returnId,
      checklist_id,
      material_id: item.material_id || null,
      material_name: (item.material_name || '').trim(),
      unit: item.unit || 'Nos.',
      quantity_issued: parseFloat(item.quantity_issued) || 0,
      quantity_used: parseFloat(item.quantity_used) || 0,
      declared_return_qty: declaredQty,
      accepted_usable_qty: 0,
      damaged_qty: parseFloat(item.quantity_damaged ?? item.damaged_qty) || 0,
      missing_qty: parseFloat(item.quantity_missing ?? item.missing_qty) || 0,
      status: 'PENDING_STORE_VERIFICATION',
      declared_by: user?.id || null,
      declared_at: new Date().toISOString(),
      verification_remarks: remarks,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      const { data: created, error } = await supabase
        .from('job_material_returns')
        .insert([{
          checklist_id,
          material_id: returnRecord.material_id,
          material_name: returnRecord.material_name,
          unit: returnRecord.unit,
          quantity_issued: returnRecord.quantity_issued,
          quantity_used: returnRecord.quantity_used,
          declared_return_qty: returnRecord.declared_return_qty,
          status: 'PENDING_STORE_VERIFICATION',
          declared_by: returnRecord.declared_by,
          declared_at: returnRecord.declared_at,
          verification_remarks: remarks,
        }])
        .select()
        .single();

      if (!error && created) {
        returnRecord.id = created.id;
      }
    } catch (dbErr) {
      console.warn('DB job_material_returns not available, using in-memory store:', dbErr.message);
    }

    inMemoryMaterialReturns.set(returnRecord.id, returnRecord);
    createdRecords.push(returnRecord);
  }

  saveFallbackStorage();

  try {
    await supabase
      .from('installation_checklists')
      .update({
        material_return_status: 'PENDING_STORE_VERIFICATION',
        updated_at: new Date().toISOString(),
      })
      .eq('id', checklist_id);
  } catch (chkErr) {
    // Non-blocking
  }

  await logAudit({
    actor_id: user?.id,
    actor_email: user?.email,
    actor_role: user?.role,
    action: 'DECLARE_MATERIAL_RETURNS',
    target_table: 'job_material_returns',
    target_id: checklist_id,
    details: { checklist_id, count: createdRecords.length },
  }).catch(() => null);

  return createdRecords;
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

  // Prevent duplicate return verification
  if (ret.status !== 'PENDING_STORE_VERIFICATION') {
    throw new Error('Return declaration has already been verified and reconciled. Duplicate return verification rejected.');
  }

  const actual_received_qty = accepted_usable_qty + damaged_qty;
  const totalAccounted = actual_received_qty + missing_qty;
  const isDiscrepancy = totalAccounted !== ret.declared_return_qty;

  // 1. Credit verified usable stock and record damaged stock atomically via inventoryService
  await creditStockForVerifiedReturn({
    checklist_id: ret.checklist_id,
    device_type: ret.device_type,
    accepted_usable_qty,
    damaged_qty,
    user,
    remarks,
    return_id,
  });

  // 2. Update return record status
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
  saveFallbackStorage();

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(return_id);
  if (isUuid) {
    try {
      let { error: updErr } = await supabase
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

      if (updErr && updErr.message?.includes('violates foreign key constraint')) {
        await supabase
          .from('job_device_returns')
          .update({
            actual_received_qty,
            accepted_usable_qty,
            damaged_qty,
            missing_qty,
            status: returnStatus,
            verification_remarks: remarks,
            verified_by: null,
            verified_at: updatedReturn.verified_at,
            updated_at: updatedReturn.updated_at,
          })
          .eq('id', return_id);
      }
    } catch (e) {
      console.warn('Could not update job_device_returns in DB:', e.message);
    }
  }

  // 3. Create Discrepancy if flagged
  const pendingForJob = Array.from(inMemoryReturns.values()).filter(
    (r) => r.checklist_id === ret.checklist_id && r.status === 'PENDING_STORE_VERIFICATION' && r.id !== return_id
  );
  const checklistFinalStatus = isDiscrepancy
    ? 'DISCREPANCY_OPEN'
    : (pendingForJob.length > 0 ? 'PENDING_STORE_VERIFICATION' : 'FULLY_RECONCILED');

  const completionRep = inMemoryCompletionReports.get(ret.checklist_id);
  if (completionRep) {
    completionRep.reconciliation_status = checklistFinalStatus;
    inMemoryCompletionReports.set(ret.checklist_id, completionRep);
  }

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
        reconciliation_status: checklistFinalStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ret.checklist_id);
  } else {
    await supabase
      .from('installation_checklists')
      .update({
        reconciliation_status: checklistFinalStatus,
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
 * Helper to update checklist reconciliation and material return status
 */
async function updateChecklistReconciliationAfterMaterialVerification(checklist_id) {
  const pendingDeviceReturns = Array.from(inMemoryReturns.values()).filter(
    (r) => r.checklist_id === checklist_id && r.status === 'PENDING_STORE_VERIFICATION'
  );
  const pendingMatReturns = Array.from(inMemoryMaterialReturns.values()).filter(
    (r) => r.checklist_id === checklist_id && r.status === 'PENDING_STORE_VERIFICATION'
  );

  const hasPending = pendingDeviceReturns.length > 0 || pendingMatReturns.length > 0;
  const newReconStatus = hasPending ? 'PENDING_STORE_VERIFICATION' : 'FULLY_RECONCILED';
  const newMatStatus = pendingMatReturns.length > 0 ? 'PENDING_STORE_VERIFICATION' : 'VERIFIED_AND_RECONCILED';

  const compRep = inMemoryCompletionReports.get(checklist_id);
  if (compRep) {
    compRep.reconciliation_status = newReconStatus;
    inMemoryCompletionReports.set(checklist_id, compRep);
  }

  try {
    await supabase
      .from('installation_checklists')
      .update({
        reconciliation_status: newReconStatus,
        material_return_status: newMatStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', checklist_id);
  } catch (e) {
    // Non-blocking
  }
}

/**
 * Stage 5B: Store Manager physically verifies returned materials and updates inventory
 *
 * Rules:
 * - Store Manager must physically verify returned materials before updating inventory.
 * - Add usable returned materials to their corresponding inventory balances.
 * - Record damaged materials separately in damaged stock.
 * - Do not add missing items to stock.
 * - Only add quantities that were actually issued from inventory and physically returned.
 * - Do not add unused materials to inventory if they were never issued from inventory.
 * - Reject duplicate return verification and duplicate stock additions.
 */
export async function verifyStoreMaterialReturn({
  return_id,
  checklist_id,
  items,
  accepted_usable_qty,
  damaged_qty = 0,
  missing_qty = 0,
  user,
  remarks = '',
}) {
  if (return_id) {
    let ret = inMemoryMaterialReturns.get(return_id);
    if (!ret) {
      try {
        const { data: dbRet, error } = await supabase
          .from('job_material_returns')
          .select('*')
          .eq('id', return_id)
          .single();
        if (!error && dbRet) ret = dbRet;
      } catch (e) {
        console.warn('Could not fetch material return from DB:', e.message);
      }
    }

    if (!ret) {
      throw new Error('Material return declaration record not found');
    }

    if (ret.status !== 'PENDING_STORE_VERIFICATION') {
      throw new Error('Material return declaration has already been verified and reconciled. Duplicate return verification rejected.');
    }

    const usable = Math.max(0, parseFloat(accepted_usable_qty !== undefined ? accepted_usable_qty : ret.declared_return_qty) || 0);
    const dmg = Math.max(0, parseFloat(damaged_qty) || 0);
    const miss = Math.max(0, parseFloat(missing_qty) || 0);
    const totalAccounted = usable + dmg + miss;
    const isDiscrepancy = totalAccounted !== Number(ret.declared_return_qty);

    await creditMaterialStockForVerifiedReturn({
      checklist_id: ret.checklist_id,
      items: [
        {
          material_id: ret.material_id,
          material_name: ret.material_name,
          unit: ret.unit,
          quantity_issued: ret.quantity_issued,
          accepted_usable_qty: usable,
          damaged_qty: dmg,
          missing_qty: miss,
        },
      ],
      user,
      remarks,
      return_id: ret.id,
    });

    const returnStatus = isDiscrepancy ? 'DISCREPANCY_FLAGGED' : 'VERIFIED_AND_RECONCILED';
    const updatedReturn = {
      ...ret,
      accepted_usable_qty: usable,
      damaged_qty: dmg,
      missing_qty: miss,
      status: returnStatus,
      verification_remarks: remarks,
      verified_by: user?.id,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    inMemoryMaterialReturns.set(return_id, updatedReturn);
    saveFallbackStorage();

    try {
      await supabase
        .from('job_material_returns')
        .update({
          accepted_usable_qty: usable,
          damaged_qty: dmg,
          missing_qty: miss,
          status: returnStatus,
          verification_remarks: remarks,
          verified_by: user?.id,
          verified_at: updatedReturn.verified_at,
          updated_at: updatedReturn.updated_at,
        })
        .eq('id', return_id);
    } catch (e) {
      console.warn('Could not update job_material_returns in DB:', e.message);
    }

    await updateChecklistReconciliationAfterMaterialVerification(ret.checklist_id);

    return updatedReturn;
  }

  // Batch verification for checklist
  if (checklist_id && Array.isArray(items) && items.length > 0) {
    const verifiedItems = [];
    for (const item of items) {
      const returnRecordId = item.return_id || item.id;
      let matchedReturn = returnRecordId ? inMemoryMaterialReturns.get(returnRecordId) : null;
      if (!matchedReturn) {
        matchedReturn = Array.from(inMemoryMaterialReturns.values()).find(
          (r) => r.checklist_id === checklist_id && (r.material_id === item.material_id || r.material_name.toLowerCase() === (item.material_name || '').toLowerCase())
        );
      }

      if (matchedReturn && matchedReturn.status !== 'PENDING_STORE_VERIFICATION') {
        throw new Error(`Material return for "${item.material_name}" has already been verified and reconciled. Duplicate return verification rejected.`);
      }

      verifiedItems.push({
        ...item,
        return_id: matchedReturn?.id || `batch-${checklist_id}-${item.material_name}`,
      });
    }

    await creditMaterialStockForVerifiedReturn({
      checklist_id,
      items: verifiedItems,
      user,
      remarks,
      return_id: `MAT-VERIFY-BATCH-${checklist_id}`,
    });

    for (const vItem of verifiedItems) {
      const retId = vItem.return_id;
      const existing = inMemoryMaterialReturns.get(retId);
      if (existing) {
        existing.accepted_usable_qty = parseFloat(vItem.accepted_usable_qty ?? vItem.quantity_returned) || 0;
        existing.damaged_qty = parseFloat(vItem.damaged_qty) || 0;
        existing.missing_qty = parseFloat(vItem.missing_qty) || 0;
        existing.status = 'VERIFIED_AND_RECONCILED';
        existing.verified_by = user?.id;
        existing.verified_at = new Date().toISOString();
        existing.updated_at = new Date().toISOString();
        inMemoryMaterialReturns.set(retId, existing);
      }
    }
    saveFallbackStorage();

    await updateChecklistReconciliationAfterMaterialVerification(checklist_id);

    return { success: true, checklist_id, verified_items: verifiedItems };
  }

  throw new Error('Either return_id or (checklist_id and items) must be provided.');
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
      .eq('status', 'PENDING_STORE_VERIFICATION')
      .order('created_at', { ascending: false });

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
 * Fetch all declared store returns (both pending and verified)
 */
export async function getAllStoreReturns() {
  const returns = [];

  try {
    const { data: dbReturns, error } = await supabase
      .from('job_device_returns')
      .select('*, installation_checklists(checklist_number, client_name, service_engineer)')
      .order('created_at', { ascending: false });

    if (!error && dbReturns) {
      returns.push(...dbReturns);
    }
  } catch (e) {
    console.warn('Error fetching all returns from DB:', e.message);
  }

  for (const [id, ret] of inMemoryReturns.entries()) {
    if (!returns.some((r) => r.id === id)) {
      returns.push(ret);
    }
  }

  return returns;
}

/**
 * Fetch all pending store material returns
 */
export async function getPendingStoreMaterialReturns() {
  const returns = [];

  try {
    const { data: dbReturns, error } = await supabase
      .from('job_material_returns')
      .select('*, installation_checklists(checklist_number, client_name, service_engineer)')
      .eq('status', 'PENDING_STORE_VERIFICATION')
      .order('created_at', { ascending: false });

    if (!error && dbReturns) {
      returns.push(...dbReturns);
    }
  } catch (e) {
    console.warn('Error fetching pending material returns from DB:', e.message);
  }

  for (const [id, ret] of inMemoryMaterialReturns.entries()) {
    if (ret.status === 'PENDING_STORE_VERIFICATION' && !returns.some((r) => r.id === id)) {
      returns.push(ret);
    }
  }

  return returns;
}

/**
 * Fetch all declared store material returns
 */
export async function getAllStoreMaterialReturns() {
  const returns = [];

  try {
    const { data: dbReturns, error } = await supabase
      .from('job_material_returns')
      .select('*, installation_checklists(checklist_number, client_name, service_engineer)')
      .order('created_at', { ascending: false });

    if (!error && dbReturns) {
      returns.push(...dbReturns);
    }
  } catch (e) {
    console.warn('Error fetching all material returns from DB:', e.message);
  }

  for (const [id, ret] of inMemoryMaterialReturns.entries()) {
    if (!returns.some((r) => r.id === id)) {
      returns.push(ret);
    }
  }

  return returns.filter((r) => !isScrewMaterial(r.material_name));
}

/**
 * Delete a specific return record by ID from DB and in-memory fallback stores
 */
export async function deleteStoreReturnById(returnId) {
  if (!returnId) return false;

  // 1. Delete from Supabase
  try {
    await Promise.all([
      supabase.from('job_device_returns').delete().eq('id', returnId),
      supabase.from('job_material_returns').delete().eq('id', returnId),
    ]);
  } catch (err) {
    console.warn('Could not delete return from Supabase:', err.message);
  }

  // 2. Delete from in-memory fallback stores
  inMemoryReturns.delete(returnId);
  inMemoryMaterialReturns.delete(returnId);

  // 3. Save to workflow_storage.json
  saveFallbackStorage();

  return true;
}

/**
 * Clear all or status-filtered store returns from DB and in-memory fallback stores
 */
export async function clearStoreReturnsHistory({ status = 'ALL' } = {}) {
  let deletedCount = 0;

  // 1. Delete from Supabase
  try {
    let devQuery = supabase.from('job_device_returns').delete();
    let matQuery = supabase.from('job_material_returns').delete();

    if (status === 'VERIFIED_ONLY' || status === 'COMPLETED') {
      devQuery = devQuery.in('status', ['VERIFIED_ACCEPTED', 'VERIFIED_AND_RECONCILED']);
      matQuery = matQuery.in('status', ['VERIFIED_ACCEPTED', 'VERIFIED_AND_RECONCILED']);
    } else if (status === 'PENDING_ONLY') {
      devQuery = devQuery.eq('status', 'PENDING_STORE_VERIFICATION');
      matQuery = matQuery.eq('status', 'PENDING_STORE_VERIFICATION');
    } else {
      devQuery = devQuery.not('id', 'is', null);
      matQuery = matQuery.not('id', 'is', null);
    }

    await Promise.all([devQuery, matQuery]);
  } catch (err) {
    console.warn('Could not clear returns from Supabase:', err.message);
  }

  // 2. Clear from in-memory maps
  const initialCount = inMemoryReturns.size + inMemoryMaterialReturns.size;

  if (status === 'VERIFIED_ONLY' || status === 'COMPLETED') {
    for (const [id, r] of inMemoryReturns.entries()) {
      if (r.status === 'VERIFIED_ACCEPTED' || r.status === 'VERIFIED_AND_RECONCILED') {
        inMemoryReturns.delete(id);
      }
    }
    for (const [id, r] of inMemoryMaterialReturns.entries()) {
      if (r.status === 'VERIFIED_ACCEPTED' || r.status === 'VERIFIED_AND_RECONCILED') {
        inMemoryMaterialReturns.delete(id);
      }
    }
  } else if (status === 'PENDING_ONLY') {
    for (const [id, r] of inMemoryReturns.entries()) {
      if (r.status === 'PENDING_STORE_VERIFICATION') {
        inMemoryReturns.delete(id);
      }
    }
    for (const [id, r] of inMemoryMaterialReturns.entries()) {
      if (r.status === 'PENDING_STORE_VERIFICATION') {
        inMemoryMaterialReturns.delete(id);
      }
    }
  } else {
    // ALL
    inMemoryReturns.clear();
    inMemoryMaterialReturns.clear();
  }

  saveFallbackStorage();
  deletedCount = Math.max(0, initialCount - (inMemoryReturns.size + inMemoryMaterialReturns.size));

  return { success: true, deletedCount };
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
 * Enrich installation checklists with persisted workflow status from DB and fallback stores
 */
export async function enrichChecklistsWithWorkflowStatus(checklists) {
  if (!Array.isArray(checklists) || checklists.length === 0) return checklists;

  const ids = checklists.map((item) => item.id).filter(Boolean);

  const dbCarrySet = new Set();
  const dbReportMap = new Map();

  if (ids.length > 0) {
    try {
      const { data: carryRows, error: carryErr } = await supabase
        .from('job_device_carry_records')
        .select('checklist_id')
        .in('checklist_id', ids);

      if (!carryErr && Array.isArray(carryRows)) {
        carryRows.forEach((r) => dbCarrySet.add(r.checklist_id));
      }
    } catch (err) {
      // Non-blocking fallback
    }

    try {
      const { data: reportRows, error: repErr } = await supabase
        .from('technical_installation_reports')
        .select('id, checklist_id, completion_status')
        .in('checklist_id', ids);

      if (!repErr && Array.isArray(reportRows)) {
        reportRows.forEach((r) => dbReportMap.set(r.checklist_id, r));
      }
    } catch (err) {
      // Non-blocking fallback
    }
  }

  return checklists.map((item) => {
    let copy = { ...item };

    // 1. Check carry record in DB or in-memory fallback store, or automatically true from Sales allocation
    const inMemCarry = inMemoryCarryRecords.get(item.id);
    const hasCarryRecord =
      dbCarrySet.has(item.id) ||
      Boolean(inMemCarry) ||
      (Array.isArray(item.device_configurations) && item.device_configurations.length > 0) ||
      Boolean(item.device_type) ||
      (item.carry_status && item.carry_status.toUpperCase() === 'RECORDED');

    copy.carry_status = hasCarryRecord ? 'RECORDED' : 'NOT_RECORDED';
    if (!copy.reconciliation_status || copy.reconciliation_status === 'SALES_CREATED') {
      copy.reconciliation_status = hasCarryRecord ? 'SALES_ALLOCATED' : 'SALES_CREATED';
    }

    // 2. Check completion report in DB or in-memory fallback store
    const dbReport = dbReportMap.get(item.id);
    const inMemReport = inMemoryCompletionReports.get(item.id);
    const hasCompletionReport = Boolean(dbReport || inMemReport);
    copy.has_completion_report = hasCompletionReport;

    if (dbReport?.reconciliation_status) {
      copy.reconciliation_status = dbReport.reconciliation_status;
    } else if (inMemReport?.reconciliation_status) {
      copy.reconciliation_status = inMemReport.reconciliation_status;
    }

    const itemReturns = Array.from(inMemoryReturns.values()).filter((r) => r.checklist_id === item.id);
    copy.returns = itemReturns;
    copy.device_returns = itemReturns;

    const itemMatReturns = Array.from(inMemoryMaterialReturns.values())
      .filter((r) => r.checklist_id === item.id)
      .filter((r) => !isScrewMaterial(r.material_name));
    copy.material_returns = itemMatReturns;

    if (Array.isArray(copy.actual_materials_returned)) {
      copy.actual_materials_returned = copy.actual_materials_returned.filter(
        (m) => !isScrewMaterial(m.material_name || m.item_name)
      );
    }
    if (Array.isArray(copy.actual_materials_used)) {
      copy.actual_materials_used = copy.actual_materials_used.filter(
        (m) => !isScrewMaterial(m.material_name || m.item_name)
      );
    }

    if (inMemReport) {
      if (!copy.final_bom_snapshot && (inMemReport.final_bom || inMemReport.final_bom_snapshot)) {
        copy.final_bom_snapshot = inMemReport.final_bom || inMemReport.final_bom_snapshot;
      }
      if (!copy.actual_materials_used && inMemReport.material_items) {
        copy.actual_materials_used = inMemReport.material_items
          .filter((m) => !isScrewMaterial(m.material_name))
          .filter((m) => m.quantity_used > 0);
      }
      if (!copy.actual_materials_returned && inMemReport.material_items) {
        copy.actual_materials_returned = inMemReport.material_items
          .filter((m) => !isScrewMaterial(m.material_name))
          .filter((m) => m.quantity_returned > 0);
      }
    }

    if (itemReturns.length > 0) {
      const anyPending = itemReturns.some((r) => r.status === 'PENDING_STORE_VERIFICATION');
      const anyDiscrepancy = itemReturns.some((r) => r.status === 'DISCREPANCY_FLAGGED');
      if (anyPending) {
        copy.reconciliation_status = 'PENDING_STORE_VERIFICATION';
      } else if (anyDiscrepancy) {
        copy.reconciliation_status = 'DISCREPANCY_OPEN';
      } else {
        copy.reconciliation_status = 'FULLY_RECONCILED';
      }
    }

    if (itemMatReturns.length > 0) {
      const anyMatPending = itemMatReturns.some((r) => r.status === 'PENDING_STORE_VERIFICATION');
      if (anyMatPending) {
        copy.reconciliation_status = 'PENDING_STORE_VERIFICATION';
        copy.material_return_status = 'PENDING_STORE_VERIFICATION';
      }
    } else if (copy.material_return_status === 'PENDING_STORE_VERIFICATION' && (!copy.actual_materials_returned || copy.actual_materials_returned.length === 0)) {
      copy.material_return_status = 'NOT_APPLICABLE';
      if (copy.reconciliation_status === 'PENDING_STORE_VERIFICATION' && (!copy.returns || copy.returns.length === 0)) {
        copy.reconciliation_status = 'FULLY_RECONCILED';
      }
    }


    // 3. PERSISTED INSTALLATION STATUS AS THE SOURCE OF TRUTH
    // Check persisted installation_status on checklist record
    const rawStatus = (item.installation_status || '').trim();
    const instStatusNormalized = rawStatus.toLowerCase();
    const isCompleted =
      instStatusNormalized === 'completed' ||
      instStatusNormalized === 'site work completed' ||
      hasCompletionReport;

    if (isCompleted) {
      copy.installation_status = 'Completed';
      copy.completion_type = item.completion_type || (hasCompletionReport ? 'TECHNICIAN_INSTALLED' : (item.delivery_method === 'Product Couriered' ? 'CUSTOMER_INSTALLED' : 'TECHNICIAN_INSTALLED'));
    } else if (rawStatus === 'Assign Later' || (!item.service_engineer && item.delivery_method === 'Product Couriered')) {
      copy.installation_status = 'Assign Later';
    } else {
      copy.installation_status = 'Assigned';
    }

    return copy;
  });
}
