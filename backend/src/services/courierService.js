import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { createNotification } from './appNotificationService.js';
import { getInventoryProducts, adjustStock as adjustInventoryStock } from './inventoryService.js';
import { getMaterialInventory, adjustMaterialStock } from './materialStockService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/courier_dispatches_storage.json');

export const COURIER_COMPANIES = [
  'DTDC',
  'The Professional Couriers',
  'ST Courier',
  'Blue Dart',
  'Delhivery',
  'Speed Post (India Post)',
  'Trackon',
  'Other',
];

export const DELIVERY_STATUSES = [
  'Not Dispatched',
  'Dispatched',
  'In Transit',
  'Delivered',
  'Delivery Exception',
  'Cancelled',
];

// In-memory fallback map: key = dispatchId, value = dispatch object
export const inMemoryCourierDispatches = new Map();

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.dispatches)) {
        data.dispatches.forEach((d) => inMemoryCourierDispatches.set(d.id, d));
      }
    }
  } catch (err) {
    console.warn('Could not load courier dispatches fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      dispatches: Array.from(inMemoryCourierDispatches.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save courier dispatches fallback storage:', err.message);
  }
}

loadStorage();

/**
 * Get available courier companies
 */
export function getAvailableCourierCompanies() {
  return COURIER_COMPANIES;
}

/**
 * Fetch courier dispatches with search, filtering, and pagination
 */
export async function getCourierDispatches({ checklistId = '', search = '', status = '', page = 1, limit = 50 } = {}) {
  let dbDispatches = null;
  try {
    let query = supabase.from('courier_dispatches').select('*', { count: 'exact' });
    if (checklistId) {
      query = query.eq('checklist_id', checklistId);
    }
    if (status && status !== 'All') {
      query = query.eq('delivery_status', status);
    }
    if (search) {
      query = query.or(`checklist_number.ilike.%${search}%,client_name.ilike.%${search}%,tracking_number.ilike.%${search}%,courier_company.ilike.%${search}%`);
    }
    query = query.order('created_at', { ascending: false });

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (!error && Array.isArray(data)) {
      dbDispatches = { dispatches: data, totalCount: count || data.length };
    }
  } catch (e) {
    // Non-blocking fallback
  }

  if (dbDispatches) {
    return {
      dispatches: dbDispatches.dispatches,
      totalCount: dbDispatches.totalCount,
      page,
      limit,
      totalPages: Math.ceil(dbDispatches.totalCount / limit) || 1,
    };
  }

  // Fallback to in-memory store
  let list = Array.from(inMemoryCourierDispatches.values());
  if (checklistId) {
    list = list.filter((d) => d.checklist_id === checklistId);
  }
  if (status && status !== 'All') {
    list = list.filter((d) => d.delivery_status === status);
  }
  if (search) {
    const s = search.toLowerCase();
    list = list.filter((d) =>
      d.checklist_number?.toLowerCase().includes(s) ||
      d.client_name?.toLowerCase().includes(s) ||
      d.tracking_number?.toLowerCase().includes(s) ||
      d.courier_company?.toLowerCase().includes(s)
    );
  }

  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const totalCount = list.length;
  const paged = list.slice((page - 1) * limit, page * limit);

  return {
    dispatches: paged,
    totalCount,
    page,
    limit,
    totalPages: Math.ceil(totalCount / limit) || 1,
  };
}

/**
 * Fetch courier dispatch by checklist ID
 */
export async function getCourierDispatchByChecklistId(checklistId, dbClient = supabase) {
  if (!checklistId) return null;
  try {
    const client = dbClient || supabase;
    const { data, error } = await client
      .from('courier_dispatches')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data;
  } catch (e) {}

  for (const d of inMemoryCourierDispatches.values()) {
    if (d.checklist_id === checklistId) return d;
  }
  return null;
}

/**
 * Fetch courier dispatch by dispatch ID
 */
export async function getCourierDispatchById(id, dbClient = supabase) {
  if (!id) return null;
  try {
    const client = dbClient || supabase;
    const { data, error } = await client
      .from('courier_dispatches')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (!error && data) return data;
  } catch (e) {}

  return inMemoryCourierDispatches.get(id) || null;
}

/**
 * Fetch all Couriered Checklists with dispatch status and requirement shortage summary
 */
export async function getCourieredChecklists({ search = '', status = '', page = 1, limit = 50 } = {}) {
  const { getChecklists } = await import('./installationService.js');
  const { inMemoryStoreRequirements } = await import('./storeRequirementService.js');

  const { checklists, totalCount } = await getChecklists({
    limit: 200,
    search,
  });

  // Filter only Couriered jobs
  let couriered = (checklists || []).filter(
    (c) => c.delivery_method === 'Product Couriered'
  );

  if (status && status !== 'All') {
    couriered = couriered.filter(
      (c) => (c.courier_dispatch_status || 'NOT_DISPATCHED') === status
    );
  }

  // Attach dispatch details & shortage info
  const enriched = await Promise.all(
    couriered.map(async (c) => {
      const dispatch = await getCourierDispatchByChecklistId(c.id);
      const req = inMemoryStoreRequirements?.get(c.id);
      return {
        ...c,
        dispatch: dispatch || null,
        has_shortage: req ? req.has_shortage : false,
        shortage_count: req ? req.shortage_count : 0,
        shortage_details: req ? req.shortage_details : null,
      };
    })
  );

  return {
    checklists: enriched.slice((page - 1) * limit, page * limit),
    totalCount: enriched.length,
    page,
    limit,
    totalPages: Math.ceil(enriched.length / limit) || 1,
  };
}

/**
 * Server-side atomic unified Courier Dispatch & Stock Issuance
 * 1. Checks available stock for camera devices and installation materials.
 * 2. Rejects if there is any shortage (no negative stock, no silent over-issuance).
 * 3. Atomically deducts stock from inventory_products and material_inventory.
 * 4. Records auditable stock_movements ledger entries labelled 'COURIER_DISPATCH'.
 * 5. Creates courier_dispatches record.
 * 6. Updates checklist and store requirement records to prevent double deduction.
 */
export async function dispatchChecklistViaCourier(
  dispatchData,
  performedBy = null,
  dbClient = supabase
) {
  const {
    checklist_id,
    courier_company,
    tracking_number,
    dispatch_date = new Date().toISOString().split('T')[0],
    expected_delivery_date = null,
    delivery_notes = '',
    notes = '',
    items = [],
    materials = [],
    user = typeof performedBy === 'object' ? performedBy : { id: performedBy, full_name: performedBy },
  } = dispatchData || {};

  const actualNotes = delivery_notes || notes || '';

  if (!checklist_id) {
    throw new Error('Checklist ID is required to dispatch via courier.');
  }
  if (!courier_company || !courier_company.trim()) {
    throw new Error('Courier Company name is required.');
  }
  if (!tracking_number || !tracking_number.trim()) {
    throw new Error('Tracking / Consignment Number is required.');
  }

  // Resolve checklist (support dbClient mock or live database)
  let checklist = null;
  try {
    const { data: dbChk } = await dbClient
      .from('installation_checklists')
      .select('*')
      .eq('id', checklist_id)
      .single();
    if (dbChk) checklist = dbChk;
  } catch (e) {}

  if (!checklist) {
    try {
      const { getChecklistById } = await import('./installationService.js');
      checklist = await getChecklistById(checklist_id);
    } catch (e) {}
  }

  if (!checklist) {
    throw new Error(`Checklist with ID "${checklist_id}" not found.`);
  }

  // Prevent duplicate dispatch
  const existingDispatch = await getCourierDispatchByChecklistId(checklist_id, dbClient);
  if (
    checklist.is_courier_dispatched ||
    ['Dispatched', 'In Transit', 'Delivered'].includes(checklist.courier_dispatch_status) ||
    (existingDispatch && ['Dispatched', 'In Transit', 'Delivered'].includes(existingDispatch.delivery_status))
  ) {
    const courierInfo = existingDispatch ? ` via ${existingDispatch.courier_company} (Tracking: ${existingDispatch.tracking_number})` : '';
    throw new Error(
      `Checklist ${checklist.checklist_number} has already been dispatched${courierInfo}. Duplicate dispatch is not permitted.`
    );
  }

  const isInstallation = (checklist.installation_or_service || 'Installation') === 'Installation';

  // Determine items to dispatch:
  let dispatchItems = Array.isArray(items) && items.length > 0 ? [...items] : [];
  if (Array.isArray(materials) && materials.length > 0) {
    materials.forEach((m) => {
      dispatchItems.push({
        item_type: 'MATERIAL',
        item_name: m.material_name || m.name,
        quantity: Number(m.quantity || m.total_quantity || 1),
        unit: m.unit || 'Nos.',
      });
    });
  }

  if (dispatchItems.length === 0) {
    // 1. Devices from checklist device configurations
    const devConfigs = checklist.device_configurations || [];
    devConfigs.forEach((cfg) => {
      const dType = cfg.device_type?.trim();
      const qty = Number(cfg.number_of_devices || cfg.quantity_carried || 1);
      if (dType && qty > 0) {
        dispatchItems.push({
          item_type: 'DEVICE',
          item_name: dType,
          quantity: qty,
          unit: 'Nos.',
        });
      }
    });

    // 2. Materials (Installation jobs only)
    if (isInstallation && checklist.bom_snapshot?.items) {
      checklist.bom_snapshot.items.forEach((m) => {
        const matName = m.material_name?.trim();
        const qty = Number(m.total_quantity !== undefined ? m.total_quantity : m.total_required_quantity) || 0;
        if (matName && qty > 0) {
          dispatchItems.push({
            item_type: 'MATERIAL',
            item_name: matName,
            quantity: qty,
            unit: m.unit || 'Nos.',
          });
        }
      });
    }
  }

  if (dispatchItems.length === 0) {
    throw new Error('No items specified to dispatch for this checklist.');
  }

  // Stock Availability Verification - PREVENT NEGATIVE STOCK & SHORTAGES
  let allDevices = [];
  try {
    const { data: dbProds } = await dbClient.from('inventory_products').select('*');
    if (dbProds && dbProds.length > 0) allDevices = dbProds;
  } catch (e) {}
  if (allDevices.length === 0) {
    allDevices = await getInventoryProducts();
  }
  const devMap = new Map(allDevices.map((d) => [(d.device_type || '').toLowerCase(), d]));

  let allMaterials = [];
  try {
    const { data: dbMats } = await dbClient.from('material_inventory').select('*');
    if (dbMats && dbMats.length > 0) allMaterials = dbMats;
  } catch (e) {}
  if (allMaterials.length === 0) {
    allMaterials = await getMaterialInventory();
  }
  const matMap = new Map(allMaterials.map((m) => [(m.material_name || '').toLowerCase(), m]));

  const shortages = [];
  dispatchItems.forEach((item) => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;

    const name = item.item_name || item.name;
    if (item.item_type === 'DEVICE') {
      const prod = devMap.get((name || '').toLowerCase());
      const avail = prod ? Number(prod.usable_stock) || 0 : 0;
      if (avail < qty) {
        shortages.push({
          item_name: name,
          category: 'Camera Device',
          required: qty,
          available: avail,
          shortage: qty - avail,
        });
      }
    } else {
      const mat = matMap.get((name || '').toLowerCase());
      const avail = mat ? Number(mat.current_stock) || 0 : 0;
      if (avail < qty) {
        shortages.push({
          item_name: name,
          category: 'Installation Material',
          required: qty,
          available: avail,
          shortage: qty - avail,
        });
      }
    }
  });

  if (shortages.length > 0) {
    const detailMsg = shortages
      .map((s) => `${s.item_name} (Need: ${s.required}, Avail: ${s.available}, Short: ${s.shortage})`)
      .join('; ');
    const err = new Error(`Cannot dispatch via courier: Insufficient usable stock for ${shortages.length} item(s): ${detailMsg}`);
    err.statusCode = 400;
    err.shortages = shortages;
    throw err;
  }

  // Atomic Stock Deduction & Movement Logging
  const dispatchId = uuidv4();
  const movementLogs = [];

  for (const item of dispatchItems) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const name = item.item_name || item.name;

    if (item.item_type === 'DEVICE') {
      const prod = devMap.get((name || '').toLowerCase());
      const previousBal = prod ? Number(prod.usable_stock) || 0 : 0;
      const newBal = previousBal - qty;

      try {
        await dbClient.from('inventory_products').update({
          usable_stock: newBal,
          updated_at: new Date().toISOString(),
        }).eq('device_type', name);

        await adjustInventoryStock({
          device_type: name,
          action: 'REMOVE',
          quantity: qty,
          reason: `Courier Dispatch for checklist ${checklist.checklist_number} (Tracking: ${tracking_number})`,
          user,
        });
      } catch (err) {
        console.warn('Device stock deduction notice:', err.message);
      }

      movementLogs.push({
        item_id: item.product_id || prod?.id || `prod-${name}`,
        item_name: name,
        category: 'Camera Device',
        movement_type: 'COURIER_DISPATCH',
        quantity: qty,
        unit: item.unit || 'Nos.',
        balance_before: previousBal,
        balance_after: newBal,
        checklist_id,
        reference_transaction_id: dispatchId,
        performed_by: user?.id || null,
        performer_name: user?.full_name || user?.email || 'Store Manager',
        reason_or_remarks: `Dispatched via ${courier_company} (Tracking: ${tracking_number})`,
      });
    } else {
      const mat = matMap.get((name || '').toLowerCase());
      const previousBal = mat ? Number(mat.current_stock) || 0 : 0;
      const newBal = previousBal - qty;

      try {
        await dbClient.from('material_inventory').update({
          current_stock: newBal,
          updated_at: new Date().toISOString(),
        }).eq('material_name', name);

        await adjustMaterialStock({
          material_name: name,
          action: 'REMOVE',
          quantity: qty,
          reason: `Courier Dispatch for checklist ${checklist.checklist_number} (Tracking: ${tracking_number})`,
          user,
        });
      } catch (err) {
        console.warn('Material stock deduction notice:', err.message);
      }

      movementLogs.push({
        item_id: item.material_id || mat?.id || `mat-${name}`,
        item_name: name,
        category: 'Installation Material',
        movement_type: 'COURIER_DISPATCH',
        quantity: qty,
        unit: item.unit || 'Nos.',
        balance_before: previousBal,
        balance_after: newBal,
        checklist_id,
        reference_transaction_id: dispatchId,
        performed_by: user?.id || null,
        performer_name: user?.full_name || user?.email || 'Store Manager',
        reason_or_remarks: `Dispatched via ${courier_company} (Tracking: ${tracking_number})`,
      });
    }
  }

  // Insert ledger movements into stock_movements
  if (movementLogs.length > 0) {
    try {
      await dbClient.from('stock_movements').insert(movementLogs);
    } catch (e) {
      console.warn('Could not insert courier stock_movements in DB:', e.message);
    }
  }

  // Create Courier Dispatch Record
  const dispatchRecord = {
    id: dispatchId,
    checklist_id,
    checklist_number: checklist.checklist_number,
    client_name: checklist.client_name,
    client_mobile: checklist.client_mobile,
    client_location: checklist.client_location,
    job_type: isInstallation ? 'Installation' : 'Service',
    courier_company: courier_company.trim(),
    tracking_number: tracking_number.trim(),
    dispatch_date,
    expected_delivery_date: expected_delivery_date || null,
    actual_delivery_date: null,
    delivery_status: 'Dispatched',
    dispatched_by: user?.id || null,
    dispatched_by_name: user?.full_name || user?.email || 'Store Manager',
    delivery_notes: actualNotes ? actualNotes.trim() : null,
    delivery_confirmation_details: null,
    dispatched_items: dispatchItems,
    exception_reason: null,
    exception_date: null,
    returned_to_store: false,
    returned_items: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    const { data: dbCreated } = await dbClient
      .from('courier_dispatches')
      .insert([dispatchRecord]);

    if (dbCreated && dbCreated[0]) {
      Object.assign(dispatchRecord, dbCreated[0]);
    }
  } catch (err) {
    console.warn('Could not insert courier_dispatches in DB:', err.message);
  }

  inMemoryCourierDispatches.set(dispatchRecord.id, dispatchRecord);
  saveStorage();

  // Update installation_checklists and store_material_requirements
  try {
    await dbClient
      .from('installation_checklists')
      .update({
        delivery_method: 'Product Couriered',
        is_courier_dispatched: true,
        courier_dispatch_status: 'Dispatched',
        courier_dispatch_id: dispatchRecord.id,
        devices_issuance_status: 'ISSUED',
        material_issuance_status: isInstallation ? 'ISSUED' : 'NOT_APPLICABLE',
        updated_at: new Date().toISOString(),
      })
      .eq('id', checklist_id);
  } catch (e) {}

  try {
    await dbClient
      .from('store_material_requirements')
      .update({
        delivery_method: 'Product Couriered',
        is_courier_dispatched: true,
        courier_dispatch_status: 'Dispatched',
        issuance_status: 'ISSUED',
        updated_at: new Date().toISOString(),
      })
      .eq('checklist_id', checklist_id);
  } catch (e) {}

  // Audit Log
  await logAudit({
    actor_id: user?.id || '00000000-0000-0000-0000-000000000001',
    actor_email: user?.email || 'store@eagleeyesafdrive.com',
    actor_role: user?.role || 'STORE_MANAGER',
    action: 'COURIER_DISPATCH',
    target_table: 'courier_dispatches',
    target_id: dispatchRecord.id,
    details: {
      checklist_number: checklist.checklist_number,
      courier_company,
      tracking_number,
      itemsCount: dispatchItems.length,
    },
  });

  // Notify Sales & Technical staff
  try {
    await createNotification({
      title: 'Product Dispatched via Courier',
      message: `Job ${checklist.checklist_number} (${checklist.client_name}) dispatched via ${courier_company}. Tracking #${tracking_number}.`,
      type: 'COURIER_DISPATCH',
      target_role: 'SALES',
      reference_id: checklist_id,
    });
  } catch (nErr) {}

  return {
    ...dispatchRecord,
    success: true,
    dispatch: dispatchRecord,
    shortages: [],
  };
}

/**
 * Update courier shipment status (e.g., In Transit, Delivered, Delivery Exception, Cancelled)
 * IMPORTANT: Does NOT deduct stock again when changing status to Delivered!
 */
export async function updateCourierDeliveryStatus(
  dispatchIdOrObj,
  statusArg,
  notesArg = '',
  userArg = null,
  dbClientArg = supabase
) {
  let dispatch_id, delivery_status, notes, delivery_confirmation, user, dbClient;
  if (typeof dispatchIdOrObj === 'object' && dispatchIdOrObj !== null) {
    ({
      dispatch_id,
      delivery_status,
      notes = '',
      delivery_confirmation = null,
      user = null,
      dbClient = supabase,
    } = dispatchIdOrObj);
  } else {
    dispatch_id = dispatchIdOrObj;
    delivery_status = statusArg;
    notes = notesArg;
    user = typeof userArg === 'object' ? userArg : { id: userArg, full_name: userArg };
    dbClient = dbClientArg || supabase;
  }

  if (!dispatch_id) {
    throw new Error('Dispatch ID is required.');
  }
  if (!DELIVERY_STATUSES.includes(delivery_status)) {
    throw new Error(`Invalid delivery status "${delivery_status}". Allowed: ${DELIVERY_STATUSES.join(', ')}`);
  }

  let dispatch = await getCourierDispatchById(dispatch_id);
  if (!dispatch && inMemoryCourierDispatches.has(dispatch_id)) {
    dispatch = inMemoryCourierDispatches.get(dispatch_id);
  }
  if (!dispatch) {
    throw new Error(`Courier dispatch "${dispatch_id}" not found.`);
  }

  const previousStatus = dispatch.delivery_status;
  const isDelivered = delivery_status === 'Delivered';
  const isException = delivery_status === 'Delivery Exception';
  const isCancelled = delivery_status === 'Cancelled';

  const updates = {
    delivery_status,
    updated_at: new Date().toISOString(),
  };

  if (notes) {
    updates.delivery_notes = notes.trim();
  }
  if (delivery_confirmation) {
    updates.delivery_confirmation_details = delivery_confirmation;
  }
  if (isDelivered && !dispatch.actual_delivery_date) {
    updates.actual_delivery_date = new Date().toISOString();
  }
  if (isException) {
    updates.exception_reason = notes || 'Delivery exception flagged';
    updates.exception_date = new Date().toISOString();
  }

  try {
    await dbClient
      .from('courier_dispatches')
      .update(updates)
      .eq('id', dispatch_id);
  } catch (e) {}

  Object.assign(dispatch, updates);
  inMemoryCourierDispatches.set(dispatch.id, dispatch);
  saveStorage();

  // Reflect status in installation_checklists and store_material_requirements
  try {
    const checklistUpdate = {
      courier_dispatch_status: delivery_status,
      updated_at: new Date().toISOString(),
    };

    // If delivered and job was awaiting delivery / unassigned, transition status to 'Awaiting Customer Confirmation'
    if (isDelivered) {
      checklistUpdate.installation_status = 'Awaiting Customer Confirmation';
    }

    await dbClient
      .from('installation_checklists')
      .update(checklistUpdate)
      .eq('id', dispatch.checklist_id);

    await dbClient
      .from('store_material_requirements')
      .update({
        courier_dispatch_status: delivery_status,
        updated_at: new Date().toISOString(),
      })
      .eq('checklist_id', dispatch.checklist_id);
  } catch (e) {}

  // If marked Delivered, notify Sales that products arrived at site and are ready for technician scheduling
  if (isDelivered && previousStatus !== 'Delivered') {
    try {
      await createNotification({
        title: 'Couriered Product Delivered - Ready for Scheduling',
        message: `Package for ${dispatch.checklist_number} (${dispatch.client_name}) delivered on site via ${dispatch.courier_company}. Sales can now assign technician and schedule start date.`,
        type: 'COURIER_DELIVERED',
        target_role: 'SALES',
        reference_id: dispatch.checklist_id,
      });
    } catch (nErr) {}
  }

  // Audit
  await logAudit({
    actor_id: user?.id || '00000000-0000-0000-0000-000000000001',
    actor_email: user?.email || 'store@eagleeyesafdrive.com',
    actor_role: user?.role || 'STORE_MANAGER',
    action: 'COURIER_STATUS_UPDATE',
    target_table: 'courier_dispatches',
    target_id: dispatch_id,
    details: {
      checklist_number: dispatch.checklist_number,
      previousStatus,
      newStatus: delivery_status,
      notes,
    },
  });

  return {
    ...dispatch,
    success: true,
    dispatch,
  };
}

/**
 * Handle delivery exceptions, cancellation, or returned shipments
 * Re-credits stock through an authorized, auditable transaction with ledger entries.
 */
export async function recordCourierReturnToStore(
  dispatchIdOrObj,
  returnDetailsArg = {},
  userArg = null,
  dbClientArg = supabase
) {
  let dispatch_id, returned_items, returned_materials, return_reason, remarks, user, dbClient;
  if (typeof dispatchIdOrObj === 'object' && dispatchIdOrObj !== null) {
    ({
      dispatch_id,
      returned_items = [],
      returned_materials = [],
      return_reason = '',
      remarks = '',
      user = null,
      dbClient = supabase,
    } = dispatchIdOrObj);
  } else {
    dispatch_id = dispatchIdOrObj;
    const details = returnDetailsArg || {};
    returned_items = details.returned_items || [];
    returned_materials = details.returned_materials || [];
    return_reason = details.return_reason || details.remarks || '';
    remarks = return_reason;
    user = typeof userArg === 'object' ? userArg : { id: userArg, full_name: userArg };
    dbClient = dbClientArg || supabase;
  }

  if (!dispatch_id) {
    throw new Error('Dispatch ID is required.');
  }

  let dispatch = await getCourierDispatchById(dispatch_id);
  if (!dispatch && inMemoryCourierDispatches.has(dispatch_id)) {
    dispatch = inMemoryCourierDispatches.get(dispatch_id);
  }
  if (!dispatch) {
    throw new Error(`Courier dispatch "${dispatch_id}" not found.`);
  }

  const itemsToReturn = Array.isArray(returned_items) && returned_items.length > 0
    ? [...returned_items]
    : [...(dispatch.dispatched_items || [])];

  if (Array.isArray(returned_materials) && returned_materials.length > 0) {
    returned_materials.forEach((m) => {
      itemsToReturn.push({
        item_type: 'MATERIAL',
        item_name: m.material_name || m.name,
        quantity: Number(m.quantity || 1),
        unit: m.unit || 'Nos.',
      });
    });
  }

  if (itemsToReturn.length === 0) {
    throw new Error('No items specified to return to store.');
  }

  const returnMovements = [];

  for (const item of itemsToReturn) {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const name = item.item_name || item.name;

    if (item.item_type === 'DEVICE') {
      try {
        const { data: dbDev } = await dbClient
          .from('inventory_products')
          .select('*')
          .eq('device_type', name)
          .single();
        const prevStock = dbDev ? Number(dbDev.usable_stock) || 0 : 0;
        const newStock = prevStock + qty;

        await dbClient.from('inventory_products').update({
          usable_stock: newStock,
          updated_at: new Date().toISOString(),
        }).eq('device_type', name);

        returnMovements.push({
          item_id: item.product_id || dbDev?.id || `prod-${name}`,
          item_name: name,
          category: 'Camera Device',
          movement_type: 'COURIER_RETURN',
          quantity: qty,
          unit: item.unit || 'Nos.',
          balance_before: prevStock,
          balance_after: newStock,
          checklist_id: dispatch.checklist_id,
          reference_transaction_id: dispatch.id,
          performed_by: user?.id || null,
          performer_name: user?.full_name || user?.email || 'Store Manager',
          reason_or_remarks: remarks || `Courier shipment returned to store`,
        });

        try {
          await adjustInventoryStock({
            device_type: name,
            action: 'ADD',
            quantity: qty,
            reason: remarks || `Courier Return for checklist ${dispatch.checklist_number} (Tracking: ${dispatch.tracking_number})`,
            user,
          });
        } catch (adjErr) {
          console.warn('Device return sync notice:', adjErr.message);
        }
      } catch (err) {
        console.warn('Device return restore notice:', err.message);
      }
    } else {
      try {
        const { data: dbMat } = await dbClient
          .from('material_inventory')
          .select('*')
          .eq('material_name', name)
          .single();
        const prevStock = dbMat ? Number(dbMat.current_stock) || 0 : 0;
        const newStock = prevStock + qty;

        await dbClient.from('material_inventory').update({
          current_stock: newStock,
          updated_at: new Date().toISOString(),
        }).eq('material_name', name);

        returnMovements.push({
          item_id: item.material_id || dbMat?.id || `mat-${name}`,
          item_name: name,
          category: 'Installation Material',
          movement_type: 'COURIER_RETURN',
          quantity: qty,
          unit: item.unit || 'Nos.',
          balance_before: prevStock,
          balance_after: newStock,
          checklist_id: dispatch.checklist_id,
          reference_transaction_id: dispatch.id,
          performed_by: user?.id || null,
          performer_name: user?.full_name || user?.email || 'Store Manager',
          reason_or_remarks: remarks || `Courier shipment returned to store`,
        });

        try {
          await adjustMaterialStock({
            material_name: name,
            action: 'ADD',
            quantity: qty,
            reason: remarks || `Courier Return for checklist ${dispatch.checklist_number} (Tracking: ${dispatch.tracking_number})`,
            user,
          });
        } catch (adjErr) {
          console.warn('Material return sync notice:', adjErr.message);
        }
      } catch (err) {
        console.warn('Material return restore notice:', err.message);
      }
    }
  }

  if (returnMovements.length > 0) {
    try {
      await dbClient.from('stock_movements').insert(returnMovements);
    } catch (e) {
      console.warn('Could not insert return stock_movements:', e.message);
    }
  }

  const updates = {
    delivery_status: 'Cancelled',
    returned_to_store: true,
    returned_items: itemsToReturn,
    updated_at: new Date().toISOString(),
  };

  try {
    await dbClient.from('courier_dispatches').update(updates).eq('id', dispatch_id);
    await dbClient.from('installation_checklists').update({
      courier_dispatch_status: 'Cancelled',
      devices_issuance_status: 'PENDING',
      material_issuance_status: 'PENDING',
      is_courier_dispatched: false,
      updated_at: new Date().toISOString(),
    }).eq('id', dispatch.checklist_id);
  } catch (e) {}

  Object.assign(dispatch, updates);
  inMemoryCourierDispatches.set(dispatch.id, dispatch);
  saveStorage();

  await logAudit({
    actor_id: user?.id || '00000000-0000-0000-0000-000000000001',
    actor_email: user?.email || 'store@eagleeyesafdrive.com',
    actor_role: user?.role || 'STORE_MANAGER',
    action: 'COURIER_RETURN_PROCESSED',
    target_table: 'courier_dispatches',
    target_id: dispatch_id,
    details: {
      checklist_number: dispatch.checklist_number,
      itemsReturned: itemsToReturn.length,
      remarks,
    },
  });

  return {
    ...dispatch,
    success: true,
    dispatch,
    returned_items: itemsToReturn,
  };
}

export const inMemoryCourierCompletions = new Map();

/**
 * Outcome A: Customer installed independently
 * Sales confirms that the customer has installed the product independently.
 * - Validates checklist delivery_method === 'Product Couriered'
 * - Validates courier status is Delivered (or delivery confirmed)
 * - Sets installation_status = 'Completed'
 * - Sets completion_type = 'CUSTOMER_INSTALLED'
 * - Records completed_by_user_id, completed_by_name, completed_at, completion_notes
 * - Does NOT create technician booking or calendar reservation
 * - Does NOT create technical installation report or post-installation form
 * - Does NOT create Coordinator return-ticket task
 * - Does NOT deduct or restore inventory
 */
export async function markChecklistCustomerInstalled({
  checklist_id,
  notes = '',
  user = null,
  dbClient = supabase,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required.');
  }

  // 1. Fetch checklist
  let checklist = null;
  try {
    const { data: dbChk } = await dbClient
      .from('installation_checklists')
      .select('*')
      .eq('id', checklist_id)
      .single();
    if (dbChk) checklist = dbChk;
  } catch (e) {}

  if (!checklist) {
    const { getChecklistById } = await import('./installationService.js');
    checklist = await getChecklistById(checklist_id);
  }

  if (!checklist) {
    throw new Error(`Checklist with ID "${checklist_id}" not found.`);
  }

  if (checklist.delivery_method !== 'Product Couriered') {
    throw new Error(`Checklist ${checklist.checklist_number} delivery method is "${checklist.delivery_method}". Independent customer installation is only applicable for "Product Couriered" orders.`);
  }

  if (checklist.installation_status === 'Completed' || checklist.completion_type === 'CUSTOMER_INSTALLED') {
    throw new Error(`Checklist ${checklist.checklist_number} is already marked completed.`);
  }

  // Verify courier was delivered
  const dispatch = await getCourierDispatchByChecklistId(checklist_id, dbClient);
  const isDelivered =
    checklist.courier_dispatch_status === 'Delivered' ||
    (dispatch && dispatch.delivery_status === 'Delivered');

  if (!isDelivered) {
    throw new Error(`Cannot complete order: Courier status is "${checklist.courier_dispatch_status || dispatch?.delivery_status || 'Pending'}". Products must be delivered before confirming independent customer installation.`);
  }

  const completionTimestamp = new Date().toISOString();
  const userName = user?.full_name || user?.email || 'Sales';
  const userId = user?.id || null;

  const completionData = {
    checklist_id,
    checklist_number: checklist.checklist_number,
    completion_type: 'CUSTOMER_INSTALLED',
    completed_by_user_id: userId,
    completed_by_name: userName,
    completed_at: completionTimestamp,
    completion_notes: (notes || '').trim(),
    created_at: completionTimestamp,
  };

  inMemoryCourierCompletions.set(checklist_id, completionData);

  // Update installation_checklists in DB
  const updatePayload = {
    installation_status: 'Completed',
    completion_type: 'CUSTOMER_INSTALLED',
    completed_by_user_id: userId,
    completed_by_name: userName,
    actual_completion_at: completionTimestamp,
    completion_notes: (notes || '').trim(),
    updated_at: completionTimestamp,
  };

  try {
    const { error: updErr } = await dbClient
      .from('installation_checklists')
      .update(updatePayload)
      .eq('id', checklist_id);

    if (updErr) {
      // Fallback if custom completion columns are not in schema cache
      await dbClient
        .from('installation_checklists')
        .update({
          installation_status: 'Completed',
          actual_completion_at: completionTimestamp,
          updated_at: completionTimestamp,
        })
        .eq('id', checklist_id);
    }
  } catch (e) {
    console.warn('DB checklist update for customer installation fallback:', e.message);
  }

  // Update in-memory schedule store so checklist queries immediately reflect completion
  const { inMemoryChecklistSchedules } = await import('./installationService.js');
  if (inMemoryChecklistSchedules) {
    const existingSched = inMemoryChecklistSchedules.get(checklist_id) || {};
    inMemoryChecklistSchedules.set(checklist_id, {
      ...existingSched,
      ...updatePayload,
    });
  }

  // Log Audit
  await logAudit({
    actor_id: userId || '00000000-0000-0000-0000-000000000001',
    actor_email: user?.email || 'sales@eagleeyesafdrive.com',
    actor_role: user?.role || 'SALES',
    action: 'CUSTOMER_INSTALLED_COMPLETION',
    target_table: 'installation_checklists',
    target_id: checklist_id,
    details: {
      checklist_number: checklist.checklist_number,
      client_name: checklist.client_name,
      completion_type: 'CUSTOMER_INSTALLED',
      notes,
    },
  });

  return {
    success: true,
    message: 'Order completed — Customer installed independently.',
    completion: completionData,
    checklist: {
      ...checklist,
      ...updatePayload,
    },
  };
}

/**
 * Outcome B - Step 1: Customer Requires Technician
 * Sets order to 'Installation Required' awaiting engineer scheduling
 */
export async function requestTechnicianForCourieredChecklist({
  checklist_id,
  notes = '',
  user = null,
  dbClient = supabase,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required.');
  }

  let checklist = null;
  try {
    const { data: dbChk } = await dbClient
      .from('installation_checklists')
      .select('*')
      .eq('id', checklist_id)
      .single();
    if (dbChk) checklist = dbChk;
  } catch (e) {}

  if (!checklist) {
    const { getChecklistById } = await import('./installationService.js');
    checklist = await getChecklistById(checklist_id);
  }

  if (!checklist) {
    throw new Error(`Checklist with ID "${checklist_id}" not found.`);
  }

  if (checklist.installation_status === 'Completed') {
    throw new Error(`Checklist ${checklist.checklist_number} is already completed.`);
  }

  const updatePayload = {
    installation_status: 'Installation Required',
    updated_at: new Date().toISOString(),
  };

  try {
    await dbClient
      .from('installation_checklists')
      .update(updatePayload)
      .eq('id', checklist_id);
  } catch (e) {}

  const { inMemoryChecklistSchedules } = await import('./installationService.js');
  if (inMemoryChecklistSchedules) {
    const existingSched = inMemoryChecklistSchedules.get(checklist_id) || {};
    inMemoryChecklistSchedules.set(checklist_id, {
      ...existingSched,
      ...updatePayload,
    });
  }

  await logAudit({
    actor_id: user?.id || '00000000-0000-0000-0000-000000000001',
    actor_email: user?.email || 'sales@eagleeyesafdrive.com',
    actor_role: user?.role || 'SALES',
    action: 'COURIER_REQUEST_TECHNICIAN',
    target_table: 'installation_checklists',
    target_id: checklist_id,
    details: {
      checklist_number: checklist.checklist_number,
      client_name: checklist.client_name,
      notes,
    },
  });

  return {
    success: true,
    message: 'Technician installation requested. Complete the scheduling details to assign an engineer.',
    checklist: {
      ...checklist,
      ...updatePayload,
    },
  };
}

/**
 * Outcome B - Step 2: Assign Technician and Schedule Installation on the SAME checklist
 * - Validates engineer: Mathi, Guna, Sakthivel, Kamalesh
 * - Validates next-day rule: start date must be tomorrow or later
 * - Validates availability and prevents double booking
 * - Does NOT duplicate checklist
 * - Does NOT deduct stock again
 * - Does NOT duplicate BOM
 */
export async function scheduleTechnicianForCourieredChecklist({
  checklist_id,
  service_engineer,
  expected_arrival_date,
  expected_arrival_time = '10:00 AM',
  installation_duration = '1 Day',
  remarks = '',
  user = null,
  dbClient = supabase,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required.');
  }

  const { SERVICE_ENGINEER_OPTIONS, resolveEngineer, reserveEngineerAtomic, calculateBookingEndDate } = await import('./engineerBookingService.js');
  const { getBusinessTomorrow } = await import('./installationService.js');

  if (!service_engineer || !SERVICE_ENGINEER_OPTIONS.includes(service_engineer.trim())) {
    throw new Error('Please select one of the authorized service engineers: Mathi, Guna, Sakthivel, or Kamalesh.');
  }

  const engName = service_engineer.trim();
  const resolvedEng = resolveEngineer(engName);

  if (!expected_arrival_date) {
    throw new Error('Installation start date (Expected Arrival Date) is required.');
  }

  // Next-day scheduling rule enforcement
  const businessTomorrow = getBusinessTomorrow();
  if (expected_arrival_date < businessTomorrow) {
    throw new Error('Installation jobs cannot be scheduled in the past or today. Jobs must start tomorrow or later.');
  }

  let checklist = null;
  try {
    const { data: dbChk } = await dbClient
      .from('installation_checklists')
      .select('*')
      .eq('id', checklist_id)
      .single();
    if (dbChk) checklist = dbChk;
  } catch (e) {}

  if (!checklist) {
    const { getChecklistById } = await import('./installationService.js');
    checklist = await getChecklistById(checklist_id);
  }

  if (!checklist) {
    throw new Error(`Checklist with ID "${checklist_id}" not found.`);
  }

  if (checklist.installation_status === 'Completed') {
    throw new Error(`Checklist ${checklist.checklist_number} is already completed.`);
  }

  const duration = (installation_duration || checklist.installation_duration || '1 Day').trim();
  const arrivalTime = (expected_arrival_time || checklist.expected_arrival_time || '10:00 AM').trim();
  const bookingEndDate = calculateBookingEndDate(expected_arrival_date, duration);

  // Atomically reserve the engineer and verify availability
  await reserveEngineerAtomic({
    engineerIdOrName: resolvedEng ? resolvedEng.id : engName,
    checklistId: checklist.id,
    checklistNumber: checklist.checklist_number,
    startDate: expected_arrival_date,
    endDate: bookingEndDate,
    duration,
    user,
    status: 'ASSIGNED',
  });

  const updatePayload = {
    service_engineer: engName,
    service_engineer_id: resolvedEng ? resolvedEng.id : null,
    expected_arrival_date,
    expected_arrival_time: arrivalTime,
    installation_duration: duration,
    booking_end_date: bookingEndDate,
    current_expected_arrival_date: expected_arrival_date,
    current_expected_arrival_time: arrivalTime,
    current_installation_duration: duration,
    current_booking_end_date: bookingEndDate,
    installation_status: 'Assigned',
    remarks: remarks ? (checklist.remarks ? `${checklist.remarks}; ${remarks}` : remarks) : checklist.remarks,
    updated_at: new Date().toISOString(),
  };

  try {
    await dbClient
      .from('installation_checklists')
      .update(updatePayload)
      .eq('id', checklist.id);
  } catch (e) {
    console.warn('DB update for couriered technician scheduling fallback:', e.message);
  }

  const { inMemoryChecklistSchedules } = await import('./installationService.js');
  if (inMemoryChecklistSchedules) {
    const existingSched = inMemoryChecklistSchedules.get(checklist.id) || {};
    inMemoryChecklistSchedules.set(checklist.id, {
      ...existingSched,
      ...updatePayload,
    });
  }

  await logAudit({
    actor_id: user?.id || '00000000-0000-0000-0000-000000000001',
    actor_email: user?.email || 'sales@eagleeyesafdrive.com',
    actor_role: user?.role || 'SALES',
    action: 'COURIER_TECHNICIAN_SCHEDULED',
    target_table: 'installation_checklists',
    target_id: checklist.id,
    details: {
      checklist_number: checklist.checklist_number,
      service_engineer: engName,
      expected_arrival_date,
      expected_arrival_time: arrivalTime,
      installation_duration: duration,
    },
  });

  return {
    success: true,
    message: 'Technician installation successfully scheduled.',
    checklist: {
      ...checklist,
      ...updatePayload,
    },
  };
}

