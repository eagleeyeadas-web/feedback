import supabase from './supabase.js';
import { getMaterialInventory, issueMaterialsForChecklist, processedChecklistMaterialIssuances } from './materialStockService.js';
import { getInventoryProducts, issueDevicesForChecklist, processedChecklistDeviceIssuances } from './inventoryService.js';
import {
  calculateBomRequirements,
  parseDeviceConfigurations,
  parseExtraDeviceConfigurations,
  combineCarriedDevicesAllocation,
} from './bomService.js';
import { enrichChecklistsWithWorkflowStatus, getAdditionalCustomerInstallations, getInstallationCompletionReport } from './workflowService.js';
import { getBackupDeclaration, issueBackupItemsForChecklist } from './backupItemService.js';
import { recordStockMovement } from './stockMovementService.js';

// In-memory fallback cache
export const inMemoryStoreRequirements = new Map();

/**
 * Automatically create or update the associated Store Manager material-requirement record
 * for an installation or service checklist.
 * Calculates device stock availability and material stock availability separately.
 */
export async function syncStoreRequirementForChecklist(checklistOrId) {
  let checklist = checklistOrId;
  if (typeof checklistOrId === 'string') {
    const { getChecklistById } = await import('./installationService.js');
    checklist = await getChecklistById(checklistOrId);
  }

  if (!checklist || !checklist.id) {
    throw new Error('Checklist with valid ID is required to sync Store Manager requirement');
  }

  const isInstallation = (checklist.installation_or_service || 'Installation') === 'Installation';
  const isCourier = checklist.delivery_method === 'Product Couriered';
  const checklistId = checklist.id;
  const checklistNumber = checklist.checklist_number || 'N/A';

  let bomSnapshot = null;
  let materialItems = [];
  let deviceItems = [];
  let hasShortage = false;
  let shortageCount = 0;
  const shortageDetails = [];

  // Normalize device configurations using robust parser
  let deviceConfigs = parseDeviceConfigurations(
    checklist,
    checklist.number_of_devices || 1,
    checklist.number_of_vehicles || 1
  );

  if (deviceConfigs.length === 0) {
    deviceConfigs = [{
      device_type: '2 Channel Live',
      number_of_devices: 1,
      number_of_vehicles: 1,
    }];
  }

  // 1. Authoritative Camera Devices stock availability check
  let deviceProductsMap = new Map();
  try {
    const allDevices = await getInventoryProducts();
    deviceProductsMap = new Map(allDevices.map((d) => [d.device_type, d]));
  } catch (e) {
    console.warn('Could not load camera device products map:', e.message);
  }

  const extraConfigs = parseExtraDeviceConfigurations(checklist);
  const combinedAllocation = combineCarriedDevicesAllocation(deviceConfigs, extraConfigs);

  const requiredDeviceItems = deviceConfigs.map((cfg) => {
    const dType = (cfg.device_type || '').trim();
    const reqQty = Number(cfg.number_of_devices) || 1;
    const prod = deviceProductsMap.get(dType);
    const availableStock = prod ? Number(prod.usable_stock) || 0 : 0;
    return {
      product_id: prod?.id || null,
      sku: prod?.sku || null,
      device_type: dType,
      required_quantity: reqQty,
      quantity: reqQty,
      number_of_devices: reqQty,
      unit: 'Nos.',
      available_stock: availableStock,
    };
  });

  const extraDeviceItems = extraConfigs.map((cfg) => {
    const dType = (cfg.device_type || '').trim();
    const extraQty = Number(cfg.extra_quantity) || 1;
    const prod = deviceProductsMap.get(dType);
    const availableStock = prod ? Number(prod.usable_stock) || 0 : 0;
    return {
      product_id: prod?.id || null,
      sku: prod?.sku || null,
      device_type: dType,
      extra_quantity: extraQty,
      required_quantity: extraQty,
      quantity: extraQty,
      number_of_devices: extraQty,
      unit: 'Nos.',
      available_stock: availableStock,
    };
  });

  deviceItems = combinedAllocation.map((cfg) => {
    const dType = (cfg.device_type || '').trim();
    const reqQty = Number(cfg.quantity_carried) || Number(cfg.number_of_devices) || 1;
    const prod = deviceProductsMap.get(dType);
    const availableStock = prod ? Number(prod.usable_stock) || 0 : 0;
    const shortage = Math.max(0, reqQty - availableStock);

    if ((isInstallation || isCourier) && shortage > 0) {
      hasShortage = true;
      shortageCount++;
      shortageDetails.push({
        category: 'Camera Device',
        item_name: dType,
        sku: prod?.sku || 'N/A',
        available_stock: availableStock,
        required_quantity: reqQty,
        shortage,
        unit: 'Nos.',
      });
    }

    return {
      product_id: prod?.id || null,
      sku: prod?.sku || null,
      device_type: dType,
      required_quantity: reqQty,
      quantity_carried: reqQty,
      required_for_installation: Number(cfg.required_quantity) || 0,
      extra_quantity: Number(cfg.extra_quantity) || 0,
      unit: 'Nos.',
      available_stock: availableStock,
      shortage: (isInstallation || isCourier) ? shortage : 0,
    };
  });

  // 2. Authoritative Installation Materials stock availability check (ONLY for technician Installation jobs!)
  if (isInstallation && !isCourier) {
    bomSnapshot = checklist.bom_snapshot && Array.isArray(checklist.bom_snapshot?.items) && checklist.bom_snapshot.items.length > 0
      ? checklist.bom_snapshot
      : null;

    if (!bomSnapshot && deviceConfigs.length > 0) {
      try {
        const calc = await calculateBomRequirements(deviceConfigs);
        if (calc && calc.configured) {
          bomSnapshot = calc;
        }
      } catch (err) {
        console.warn('Could not calculate BOM snapshot for requirement sync:', err.message);
      }
    }

    let materialInventoryMap = new Map();
    try {
      const allMaterials = await getMaterialInventory();
      materialInventoryMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));
    } catch (e) {
      console.warn('Could not load material inventory for shortage calculation:', e.message);
    }

    if (bomSnapshot?.items && Array.isArray(bomSnapshot.items)) {
      materialItems = bomSnapshot.items.map((item) => {
        const matName = item.material_name || '';
        const inv = materialInventoryMap.get(matName.toLowerCase());
        const availableStock = inv ? Number(inv.current_stock) || 0 : 0;
        const requiredQty = Number(item.total_quantity !== undefined ? item.total_quantity : item.total_required_quantity) || 0;
        const shortage = Math.max(0, requiredQty - availableStock);

        if (shortage > 0) {
          hasShortage = true;
          shortageCount++;
          shortageDetails.push({
            category: 'Installation Material',
            item_name: matName,
            sku: inv?.sku || item.material_sku || 'N/A',
            available_stock: availableStock,
            required_quantity: requiredQty,
            shortage,
            unit: item.unit || inv?.unit || 'Nos.',
          });
        }

        return {
          material_id: item.material_id || inv?.id || null,
          material_sku: inv?.sku || item.material_sku || null,
          material_name: matName,
          quantity_per_device: item.quantity_per_device !== undefined ? item.quantity_per_device : 'Combined',
          total_required_quantity: requiredQty,
          unit: item.unit || inv?.unit || 'Nos.',
          available_stock: availableStock,
          shortage,
          breakdown: item.breakdown || null,
        };
      });
    }
  }

  // Handle Service-specific requirements if job_type is Service
  let serviceItems = [];
  if (!isInstallation) {
    const { inMemoryChecklistServiceItems, normalizeServiceItems } = await import('./installationService.js');
    const rawService = (Array.isArray(checklist.service_items) && checklist.service_items.length > 0)
      ? checklist.service_items
      : (inMemoryChecklistServiceItems.get(checklistId) || []);
    serviceItems = normalizeServiceItems(rawService);

    let materialInventoryMap = new Map();
    try {
      const allMaterials = await getMaterialInventory();
      materialInventoryMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));
    } catch (e) {
      console.warn('Could not load material inventory:', e.message);
    }

    serviceItems = serviceItems.map((sItem) => {
      let availableStock = 0;
      let sku = sItem.sku || null;
      let itemId = sItem.item_id || null;

      if (sItem.item_type === 'DEVICE') {
        const dev = deviceProductsMap.get(sItem.item_name) || (sItem.item_id ? Array.from(deviceProductsMap.values()).find(d => d.id === sItem.item_id) : null);
        availableStock = dev ? Number(dev.usable_stock) || 0 : 0;
        sku = dev?.sku || sku;
        itemId = dev?.id || itemId;
      } else {
        const mat = materialInventoryMap.get(sItem.item_name.toLowerCase()) || (sItem.item_id ? Array.from(materialInventoryMap.values()).find(m => m.id === sItem.item_id) : null);
        availableStock = mat ? Number(mat.current_stock) || 0 : 0;
        sku = mat?.sku || sku;
        itemId = mat?.id || itemId;
      }

      const reqQty = Number(sItem.quantity_required) || 1;
      const issuedQty = Number(sItem.quantity_issued) || 0;
      const remainingQty = Math.max(0, reqQty - issuedQty);
      const shortage = Math.max(0, remainingQty - availableStock);

      if (shortage > 0) {
        hasShortage = true;
        shortageCount++;
        shortageDetails.push({
          category: sItem.item_type === 'DEVICE' ? 'Service Device' : 'Service Material',
          item_name: sItem.item_name,
          sku: sku || 'N/A',
          available_stock: availableStock,
          required_quantity: remainingQty,
          shortage,
          unit: sItem.unit || 'Nos.',
        });
      }

      const availabilityStatus = availableStock >= remainingQty
        ? 'Available'
        : (availableStock > 0 ? 'Partially Available' : 'Out of Stock');

      return {
        ...sItem,
        item_id: itemId,
        sku,
        available_stock: availableStock,
        quantity_remaining: remainingQty,
        shortage,
        availability_status: availabilityStatus,
      };
    });

    deviceItems = [];
    materialItems = [];
    bomSnapshot = null;
  }

  const existingReq = inMemoryStoreRequirements.get(checklistId);
  const prevDevicesIssued = existingReq?.devices_issuance_status === 'ISSUED' || existingReq?.status === 'ISSUED' || checklist.devices_issuance_status === 'ISSUED';
  const prevMaterialsIssued = existingReq?.material_issuance_status === 'ISSUED' || existingReq?.status === 'ISSUED' || checklist.material_issuance_status === 'ISSUED';
  const prevCourierDispatched = Boolean(existingReq?.is_courier_dispatched || checklist.is_courier_dispatched || (isCourier && prevDevicesIssued));

  // Determine requirement statuses, preserving prior stock issuance
  let reqStatus = (prevDevicesIssued && prevMaterialsIssued) ? 'ISSUED' : (existingReq?.status || 'PENDING_REVIEW');
  let materialIssuanceStatus = prevMaterialsIssued ? 'ISSUED' : (isInstallation ? (checklist.material_issuance_status || 'PENDING') : 'NOT_APPLICABLE');
  let devicesIssuanceStatus = prevDevicesIssued ? 'ISSUED' : (isInstallation ? (checklist.devices_issuance_status || 'PENDING') : 'NOT_APPLICABLE');

  if (isCourier) {
    devicesIssuanceStatus = (prevDevicesIssued || prevCourierDispatched) ? 'ISSUED' : (checklist.devices_issuance_status || 'PENDING');
    materialIssuanceStatus = (prevMaterialsIssued || prevCourierDispatched) ? 'ISSUED' : (checklist.material_issuance_status || 'NOT_APPLICABLE');
    if (devicesIssuanceStatus === 'ISSUED' || prevCourierDispatched || prevMaterialsIssued || existingReq?.status === 'ISSUED') {
      reqStatus = 'ISSUED';
      hasShortage = false;
      shortageCount = 0;
    } else if (hasShortage) {
      reqStatus = 'SHORTAGE_FLAGGED';
    } else {
      reqStatus = 'READY_FOR_ISSUANCE';
    }
  } else if (!isInstallation) {
    if (serviceItems.length === 0) {
      reqStatus = 'NOT_APPLICABLE';
      materialIssuanceStatus = 'NOT_APPLICABLE';
      devicesIssuanceStatus = 'NOT_APPLICABLE';
      hasShortage = false;
      shortageCount = 0;
    } else {
      const allIssued = serviceItems.every((it) => it.quantity_remaining === 0);
      const anyIssued = serviceItems.some((it) => (it.quantity_issued || 0) > 0);
      if (allIssued) {
        reqStatus = 'ISSUED';
        materialIssuanceStatus = 'ISSUED';
        devicesIssuanceStatus = 'ISSUED';
        hasShortage = false;
        shortageCount = 0;
      } else if (hasShortage) {
        reqStatus = 'SHORTAGE_FLAGGED';
        materialIssuanceStatus = anyIssued ? 'PARTIALLY_ISSUED' : 'PENDING';
        devicesIssuanceStatus = anyIssued ? 'PARTIALLY_ISSUED' : 'PENDING';
      } else if (anyIssued) {
        reqStatus = 'PARTIALLY_ISSUED';
        materialIssuanceStatus = 'PARTIALLY_ISSUED';
        devicesIssuanceStatus = 'PARTIALLY_ISSUED';
      } else {
        reqStatus = 'READY_FOR_ISSUANCE';
        materialIssuanceStatus = 'PENDING';
        devicesIssuanceStatus = 'PENDING';
      }
    }
  } else if (materialIssuanceStatus === 'ISSUED' && devicesIssuanceStatus === 'ISSUED') {
    reqStatus = 'ISSUED';
  } else if (hasShortage) {
    reqStatus = 'SHORTAGE_FLAGGED';
  } else {
    reqStatus = 'READY_FOR_ISSUANCE';
  }

  // Strictly persist only supported columns in store_material_requirements
  const DB_COLUMNS = new Set([
    'checklist_id',
    'checklist_number',
    'client_name',
    'client_mobile',
    'client_location',
    'google_maps_location',
    'job_type',
    'device_type',
    'number_of_devices',
    'number_of_vehicles',
    'device_configurations',
    'bom_snapshot',
    'material_items',
    'material_issuance_status',
    'status',
    'has_shortage',
    'shortage_count',
    'shortage_details',
    'material_issued_at',
    'material_issued_by',
    'salesperson_name',
    'service_engineer',
    'service_assistant',
    'expected_arrival_date',
    'expected_arrival_time',
    'installation_duration',
    'submission_date',
    'notes',
    'updated_at',
    'delivery_method',
    'courier_dispatch_status',
    'is_courier_dispatched',
  ]);

  const isValidUuid = (val) =>
    typeof val === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(val);

  const rawDbPayload = {
    checklist_id: checklistId,
    checklist_number: checklistNumber,
    client_name: (checklist.client_name || '').trim(),
    client_mobile: (checklist.client_mobile || '').trim(),
    client_location: (checklist.client_location || '').trim(),
    google_maps_location: checklist.google_maps_location ? checklist.google_maps_location.trim() : null,
    job_type: isInstallation ? 'Installation' : 'Service',
    device_type: checklist.device_type || (deviceConfigs[0]?.device_type) || '2 Channel Live',
    number_of_devices: combinedAllocation.reduce((s, c) => s + (Number(c.quantity_carried) || 0), 0) || Number(checklist.number_of_devices) || 1,
    number_of_vehicles: Number(checklist.number_of_vehicles) || Number(checklist.number_of_devices) || 1,
    device_configurations: deviceConfigs,
    device_items: deviceItems,
    service_items: serviceItems,
    devices_issuance_status: devicesIssuanceStatus,
    bom_snapshot: (isInstallation && !isCourier) ? bomSnapshot : null,
    material_items: (isInstallation && !isCourier) ? materialItems : [],
    material_issuance_status: materialIssuanceStatus,
    status: reqStatus,
    has_shortage: hasShortage,
    shortage_count: shortageCount,
    shortage_details: shortageDetails.length > 0 ? shortageDetails : null,
    material_issued_at: checklist.material_issued_at || existingReq?.material_issued_at || null,
    material_issued_by: isValidUuid(checklist.material_issued_by) ? checklist.material_issued_by : (existingReq?.material_issued_by || null),
    devices_issued_at: checklist.devices_issued_at || existingReq?.devices_issued_at || null,
    devices_issued_by: isValidUuid(checklist.devices_issued_by) ? checklist.devices_issued_by : (existingReq?.devices_issued_by || null),
    salesperson_name: checklist.salesperson_name || null,
    service_engineer: checklist.service_engineer || null,
    service_assistant: checklist.service_assistant || null,
    expected_arrival_date: checklist.expected_arrival_date || null,
    expected_arrival_time: checklist.expected_arrival_time || null,
    installation_duration: checklist.installation_duration || null,
    submission_date: checklist.created_at || new Date().toISOString(),
    notes: checklist.remarks || null,
    delivery_method: checklist.delivery_method || 'Technician Carries',
    courier_dispatch_status: (prevCourierDispatched || prevDevicesIssued) ? 'ISSUED' : (checklist.courier_dispatch_status || existingReq?.courier_dispatch_status || (checklist.delivery_method === 'Product Couriered' ? 'NOT_DISPATCHED' : 'NOT_APPLICABLE')),
    is_courier_dispatched: Boolean(checklist.is_courier_dispatched || existingReq?.is_courier_dispatched || prevCourierDispatched || prevDevicesIssued),
    updated_at: new Date().toISOString(),
  };

  const dbPayload = {};
  for (const [key, val] of Object.entries(rawDbPayload)) {
    if (DB_COLUMNS.has(key) && val !== undefined) {
      dbPayload[key] = val;
    }
  }

  // Upsert to Supabase store_material_requirements
  let savedRecord = null;
  try {
    const { data: res, error } = await supabase
      .from('store_material_requirements')
      .upsert(dbPayload, { onConflict: 'checklist_id' })
      .select()
      .maybeSingle();

    if (!error && res) {
      savedRecord = res;
    } else if (error) {
      console.warn(`Upsert store_material_requirements warning for ${checklistNumber}:`, error.message || error);
    }
  } catch (err) {
    console.warn(`Upsert store_material_requirements exception for ${checklistNumber}:`, err.message);
  }

  const totalCarried = combinedAllocation.reduce((s, c) => s + (Number(c.quantity_carried) || 0), 0) || Number(rawDbPayload.number_of_devices) || 1;
  const totalReq = deviceConfigs.reduce((s, c) => s + (Number(c.number_of_devices) || 1), 0);
  const totalExtra = extraConfigs.reduce((s, c) => s + (Number(c.extra_quantity) || 1), 0);

  const isCourierIssued = isCourier && Boolean(
    reqStatus === 'ISSUED' ||
    rawDbPayload.material_issuance_status === 'ISSUED' ||
    devicesIssuanceStatus === 'ISSUED' ||
    rawDbPayload.courier_dispatch_status === 'ISSUED' ||
    rawDbPayload.is_courier_dispatched ||
    existingReq?.status === 'ISSUED' ||
    existingReq?.material_issuance_status === 'ISSUED' ||
    existingReq?.devices_issuance_status === 'ISSUED' ||
    existingReq?.courier_dispatch_status === 'ISSUED' ||
    existingReq?.is_courier_dispatched ||
    processedChecklistDeviceIssuances.has(checklistId)
  );

  const stockIssuanceStatus = isCourier
    ? (isCourierIssued ? 'Completed' : 'Pending')
    : (reqStatus === 'ISSUED' ? 'Completed' : (devicesIssuanceStatus === 'ISSUED' || rawDbPayload.material_issuance_status === 'ISSUED' ? 'Partially Issued' : 'Pending'));

  const fullRecord = {
    ...(savedRecord || { id: `req-${checklistId}`, ...rawDbPayload }),
    is_courier: isCourier,
    delivery_method: checklist.delivery_method || rawDbPayload.delivery_method || (isCourier ? 'Product Couriered' : 'Technician Carries'),
    stock_issuance_status: stockIssuanceStatus,
    is_issued: isCourier ? isCourierIssued : (reqStatus === 'ISSUED'),
    courier_dispatch_status: rawDbPayload.courier_dispatch_status,
    is_courier_dispatched: rawDbPayload.is_courier_dispatched,
    status: reqStatus,
    device_items: deviceItems,
    service_items: isInstallation ? [] : serviceItems,
    devices_issuance_status: devicesIssuanceStatus,
    material_issuance_status: materialIssuanceStatus,
    bom_snapshot: (isInstallation && !isCourier) ? bomSnapshot : null,
    material_items: (isInstallation && !isCourier) ? materialItems : [],
    required_device_items: requiredDeviceItems,
    extra_device_items: isCourier ? [] : extraDeviceItems,
    extra_device_configurations: isCourier ? [] : extraConfigs,
    total_devices_carried: totalCarried,
    total_devices_required: totalReq,
    total_extra_devices: totalExtra,
    created_at: rawDbPayload.submission_date,
  };

  inMemoryStoreRequirements.set(checklistId, fullRecord);
  return fullRecord;
}

/**
 * Retrieve Store Manager material requirements with live inventory stock checks and live shortages
 */
export async function getStoreMaterialRequirements(params = {}) {
  const {
    page = 1,
    limit = 20,
    search = '',
    job_type = '',
    issuance_status = '',
    has_shortage = '',
  } = params;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  // Authoritative live inventory maps
  let materialMap = new Map();
  let deviceMap = new Map();

  try {
    const [allMats, allDevs] = await Promise.all([
      getMaterialInventory().catch(() => []),
      getInventoryProducts().catch(() => []),
    ]);
    materialMap = new Map(allMats.map((m) => [m.material_name.toLowerCase(), m]));
    deviceMap = new Map(allDevs.map((d) => [d.device_type, d]));
  } catch (e) {
    console.warn('Could not load inventory maps in getStoreMaterialRequirements:', e.message);
  }

  // Self-heal: ensure checklists from installation_checklists are populated in store_material_requirements
  try {
    const { count: storeReqTotal, error: countErr } = await supabase
      .from('store_material_requirements')
      .select('id', { count: 'exact', head: true });

    if (!countErr && (storeReqTotal === 0 || storeReqTotal === null)) {
      const { data: allChecklists, error: chkErr } = await supabase
        .from('installation_checklists')
        .select('*')
        .order('created_at', { ascending: false });

      if (!chkErr && Array.isArray(allChecklists) && allChecklists.length > 0) {
        console.log(`Auto-syncing ${allChecklists.length} installation checklists into store_material_requirements...`);
        for (const chk of allChecklists) {
          await syncStoreRequirementForChecklist(chk);
        }
      }
    }
  } catch (autoSyncErr) {
    console.warn('Auto-sync store requirements error:', autoSyncErr.message);
  }

  let dbRecords = null;
  let totalCount = 0;

  try {
    let query = supabase
      .from('store_material_requirements')
      .select('*', { count: 'exact' })
      .order('submission_date', { ascending: false });

    if (job_type && job_type !== 'All') {
      if (job_type === 'Courier') {
        query = query.eq('delivery_method', 'Product Couriered');
      } else if (job_type === 'Installation') {
        query = query.eq('job_type', 'Installation').or('delivery_method.neq.Product Couriered,delivery_method.is.null');
      } else if (job_type === 'Service') {
        query = query.eq('job_type', 'Service').or('delivery_method.neq.Product Couriered,delivery_method.is.null');
      } else {
        query = query.eq('job_type', job_type);
      }
    }
    if (issuance_status && issuance_status !== 'All') {
      query = query.eq('material_issuance_status', issuance_status);
    }
    if (has_shortage === 'true') {
      query = query.eq('has_shortage', true);
    }

    if (search && search.trim()) {
      const s = search.trim();
      query = query.or(
        `checklist_number.ilike.%${s}%,client_name.ilike.%${s}%,client_mobile.ilike.%${s}%,client_location.ilike.%${s}%`
      );
    }

    const { data, count, error } = await query.range(offset, offset + limitNum - 1);

    if (!error && Array.isArray(data)) {
      dbRecords = data;
      totalCount = count !== null ? count : data.length;
    }
  } catch (err) {
    console.warn('Could not query store_material_requirements table:', err.message);
  }

  if (dbRecords === null || dbRecords.length === 0) {
    try {
      let chkQuery = supabase
        .from('installation_checklists')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (search && search.trim()) {
        const s = search.trim();
        chkQuery = chkQuery.or(
          `checklist_number.ilike.%${s}%,client_name.ilike.%${s}%,client_mobile.ilike.%${s}%,client_location.ilike.%${s}%`
        );
      }

      const { data: chkList, count: chkCount } = await chkQuery.range(offset, offset + limitNum - 1);

      if (Array.isArray(chkList) && chkList.length > 0) {
        dbRecords = await Promise.all(chkList.map((c) => syncStoreRequirementForChecklist(c)));
        totalCount = chkCount || chkList.length;
      }
    } catch (e) {
      let allMem = Array.from(inMemoryStoreRequirements.values());
      if (job_type && job_type !== 'All') {
        allMem = allMem.filter((r) => {
          const isC = r.delivery_method === 'Product Couriered';
          if (job_type === 'Courier') return isC;
          if (job_type === 'Installation') return r.job_type === 'Installation' && !isC;
          if (job_type === 'Service') return r.job_type === 'Service' && !isC;
          return true;
        });
      }
      dbRecords = allMem.slice(offset, offset + limitNum);
      totalCount = allMem.length;
    }
  }

  // Backfill checklist details & workflow status (BOM, completion report, actual materials, returns)
  const allChecklistIds = (dbRecords || [])
    .map((r) => r.checklist_id || r.id)
    .filter(Boolean);

  if (allChecklistIds.length > 0) {
    try {
      let chkRows = null;
      try {
        const { data, error } = await supabase
          .from('installation_checklists')
          .select('id, checklist_number, salesperson_name, service_engineer, service_assistant, expected_arrival_date, expected_arrival_time, installation_duration, installation_status, final_bom_snapshot, actual_materials_used, actual_materials_returned, material_return_status, carry_extra_backup_items, extra_devices')
          .in('id', allChecklistIds);
        if (!error && Array.isArray(data)) chkRows = data;
      } catch (colErr) {
        const { data } = await supabase
          .from('installation_checklists')
          .select('id, checklist_number, salesperson_name, service_engineer, service_assistant, expected_arrival_date, expected_arrival_time, installation_duration, installation_status, carry_extra_backup_items, extra_devices')
          .in('id', allChecklistIds);
        if (Array.isArray(data)) chkRows = data;
      }

      if (Array.isArray(chkRows)) {
        const enrichedChk = await enrichChecklistsWithWorkflowStatus(chkRows);
        const chkMap = new Map(enrichedChk.map((c) => [c.id, c]));
        (dbRecords || []).forEach((r) => {
          const matched = chkMap.get(r.checklist_id || r.id);
          if (matched) {
            r.salesperson_name = r.salesperson_name || matched.salesperson_name || null;
            r.service_engineer = r.service_engineer || matched.service_engineer || null;
            r.service_assistant = r.service_assistant || matched.service_assistant || null;
            r.expected_arrival_date = r.expected_arrival_date || matched.expected_arrival_date || null;
            r.expected_arrival_time = r.expected_arrival_time || matched.expected_arrival_time || null;
            r.installation_duration = r.installation_duration || matched.installation_duration || null;
            r.installation_status = matched.installation_status || r.installation_status || null;
            r.final_bom_snapshot = matched.final_bom_snapshot || r.final_bom_snapshot || null;
            r.actual_materials_used = matched.actual_materials_used || r.actual_materials_used || null;
            r.actual_materials_returned = matched.actual_materials_returned || r.actual_materials_returned || null;
            r.material_return_status = matched.material_return_status || r.material_return_status || null;
            r.completion_report = matched.completion_report || r.completion_report || null;
            r.returns = matched.returns || r.returns || null;
            r.material_returns = matched.material_returns || r.material_returns || null;
            r.is_completion_submitted = matched.is_completion_submitted || false;
            r.carry_extra_backup_items = matched.carry_extra_backup_items !== undefined ? matched.carry_extra_backup_items : matched.extra_devices;
          }
        });
      }
    } catch (e) {
      console.warn('Could not backfill checklist workflow data:', e.message);
    }
  }

  // Enrich records with LIVE authoritative inventory stock & shortage
  const enrichedRecords = await Promise.all((dbRecords || []).map(async (rec) => {
    let liveHasShortage = false;
    let liveShortageCount = 0;
    const liveShortageDetails = [];

    // Parse and normalize device items
    const parsedDevices = parseDeviceConfigurations(rec);
    const extraConfigs = parseExtraDeviceConfigurations(rec);

    const requiredDeviceItems = parsedDevices.map((cfg) => {
      const dType = (cfg.device_type || '').trim();
      const reqQty = Number(cfg.number_of_devices) || 1;
      const dev = deviceMap.get(dType);
      return {
        product_id: dev?.id || null,
        sku: dev?.sku || null,
        device_type: dType,
        required_quantity: reqQty,
        quantity: reqQty,
        number_of_devices: reqQty,
        unit: 'Nos.',
        available_stock: dev ? Number(dev.usable_stock) || 0 : 0,
      };
    });

    const extraDeviceItems = extraConfigs.map((cfg) => {
      const dType = (cfg.device_type || '').trim();
      const extraQty = Number(cfg.extra_quantity) || 1;
      const dev = deviceMap.get(dType);
      return {
        product_id: dev?.id || null,
        sku: dev?.sku || null,
        device_type: dType,
        extra_quantity: extraQty,
        required_quantity: extraQty,
        quantity: extraQty,
        number_of_devices: extraQty,
        unit: 'Nos.',
        available_stock: dev ? Number(dev.usable_stock) || 0 : 0,
      };
    });

    const isCourier = rec.delivery_method === 'Product Couriered';
    const isInstallation = rec.job_type === 'Installation' && !isCourier;

    const enrichedDevices = (parsedDevices.length > 0 ? parsedDevices : (Array.isArray(rec.device_items) && rec.device_items.length > 0 ? rec.device_items : [])).map((dItem) => {
      const dType = dItem.device_type || '';
      const dev = deviceMap.get(dType);
      const currentStock = dev ? Number(dev.usable_stock) || 0 : 0;
      const requiredQty = Number(dItem.required_quantity ?? dItem.number_of_devices) || 1;
      const shortage = (isInstallation || isCourier) ? Math.max(0, requiredQty - currentStock) : 0;
      const itemAvailability = currentStock >= requiredQty
        ? 'Available'
        : currentStock > 0
        ? 'Partially Available'
        : 'Out of Stock';

      if (shortage > 0) {
        liveHasShortage = true;
        liveShortageCount++;
        liveShortageDetails.push({
          category: 'Camera Device',
          item_name: dType,
          sku: dev?.sku || 'N/A',
          available_stock: currentStock,
          required_quantity: requiredQty,
          shortage,
          unit: 'Nos.',
          availability_status: itemAvailability,
        });
      }

      return {
        ...dItem,
        sku: dev?.sku || dItem.sku || null,
        available_stock: currentStock,
        shortage,
        availability_status: itemAvailability,
      };
    });

    // Self-heal and enrich material items (Only for Installation jobs with technician carry!)
    let rawMats = Array.isArray(rec.material_items) ? rec.material_items : [];
    if (rawMats.length === 0 && isInstallation && parsedDevices.length > 0) {
      try {
        const autoCalc = await calculateBomRequirements(parsedDevices);
        if (autoCalc?.items && autoCalc.items.length > 0) {
          rawMats = autoCalc.items.map((it) => ({
            material_id: it.material_id,
            material_sku: it.material_sku,
            material_name: it.material_name,
            quantity_per_device: it.quantity_per_device !== undefined ? it.quantity_per_device : 'Combined',
            total_required_quantity: it.total_quantity,
            unit: it.unit,
            breakdown: it.breakdown,
          }));
          rec.material_items = rawMats;
          rec.bom_snapshot = autoCalc;
          inMemoryStoreRequirements.set(rec.checklist_id || rec.id, rec);
        }
      } catch (err) {
        console.warn('Auto-healing BOM requirements calculation error:', err.message);
      }
    }

    const enrichedMaterials = isCourier ? [] : rawMats.map((item) => {
      const matName = item.material_name || '';
      const inv = materialMap.get(matName.toLowerCase());
      const currentStock = inv ? Number(inv.current_stock) || 0 : 0;
      const requiredQty = Number(item.total_required_quantity !== undefined ? item.total_required_quantity : (item.total_quantity !== undefined ? item.total_quantity : item.required_quantity)) || 0;
      const shortage = isInstallation ? Math.max(0, requiredQty - currentStock) : 0;
      const itemAvailability = currentStock >= requiredQty
        ? 'Available'
        : currentStock > 0
        ? 'Partially Available'
        : 'Out of Stock';

      if (shortage > 0) {
        liveHasShortage = true;
        liveShortageCount++;
        liveShortageDetails.push({
          category: 'Installation Material',
          item_name: matName,
          sku: inv?.sku || item.material_sku || 'N/A',
          available_stock: currentStock,
          required_quantity: requiredQty,
          shortage,
          unit: item.unit || inv?.unit || 'Nos.',
          availability_status: itemAvailability,
        });
      }

      return {
        ...item,
        sku: inv?.sku || item.material_sku || null,
        available_stock: currentStock,
        shortage,
        availability_status: itemAvailability,
      };
    });

    // Enrich service_items if job is Service
    let enrichedServiceItems = [];
    if (rec.job_type === 'Service') {
      const { inMemoryChecklistServiceItems, normalizeServiceItems } = await import('./installationService.js');
      const rawService = (Array.isArray(rec.service_items) && rec.service_items.length > 0)
        ? rec.service_items
        : (inMemoryChecklistServiceItems.get(rec.checklist_id || rec.id) || []);
      const normalizedService = normalizeServiceItems(rawService);

      enrichedServiceItems = normalizedService.map((sItem) => {
        let currentStock = 0;
        let sku = sItem.sku || null;

        if (sItem.item_type === 'DEVICE') {
          const dev = deviceMap.get(sItem.item_name) || (sItem.item_id ? Array.from(deviceMap.values()).find((d) => d.id === sItem.item_id) : null);
          currentStock = dev ? Number(dev.usable_stock) || 0 : 0;
          sku = dev?.sku || sku;
        } else {
          const mat = materialMap.get(sItem.item_name.toLowerCase()) || (sItem.item_id ? Array.from(materialMap.values()).find((m) => m.id === sItem.item_id) : null);
          currentStock = mat ? Number(mat.current_stock) || 0 : 0;
          sku = mat?.sku || sku;
        }

        const reqQty = Number(sItem.quantity_required) || 1;
        const issuedQty = Number(sItem.quantity_issued) || 0;
        const remainingQty = Math.max(0, reqQty - issuedQty);
        const shortage = Math.max(0, remainingQty - currentStock);

        if (shortage > 0) {
          liveHasShortage = true;
          liveShortageCount++;
          liveShortageDetails.push({
            category: sItem.item_type === 'DEVICE' ? 'Service Device' : 'Service Material',
            item_name: sItem.item_name,
            sku: sku || 'N/A',
            available_stock: currentStock,
            required_quantity: remainingQty,
            shortage,
            unit: sItem.unit || 'Nos.',
          });
        }

        const itemAvailability = currentStock >= remainingQty
          ? 'Available'
          : (currentStock > 0 ? 'Partially Available' : 'Out of Stock');

        return {
          ...sItem,
          sku,
          available_stock: currentStock,
          quantity_remaining: remainingQty,
          shortage,
          availability_status: itemAvailability,
        };
      });
    }

    // Calculate BOM availability status
    let bomAvailabilityStatus = 'Available';
    if (isCourier) {
      if (enrichedDevices.length === 0) {
        bomAvailabilityStatus = 'Available';
      } else {
        const allAvail = enrichedDevices.every((it) => it.availability_status === 'Available');
        const allOut = enrichedDevices.every((it) => it.availability_status === 'Out of Stock');
        bomAvailabilityStatus = allAvail ? 'Available' : (allOut ? 'Out of Stock' : 'Partially Available');
      }
    } else if (rec.job_type === 'Service') {
      if (enrichedServiceItems.length === 0) {
        bomAvailabilityStatus = 'Not Applicable';
      } else {
        const allAvail = enrichedServiceItems.every((it) => it.availability_status === 'Available');
        const allOut = enrichedServiceItems.every((it) => it.availability_status === 'Out of Stock');
        bomAvailabilityStatus = allAvail ? 'Available' : (allOut ? 'Out of Stock' : 'Partially Available');
      }
    } else if (enrichedMaterials.length === 0) {
      bomAvailabilityStatus = 'Available';
    } else {
      const allAvailable = enrichedMaterials.every((m) => m.availability_status === 'Available');
      const allOutOfStock = enrichedMaterials.every((m) => m.availability_status === 'Out of Stock');
      if (allAvailable) {
        bomAvailabilityStatus = 'Available';
      } else if (allOutOfStock) {
        bomAvailabilityStatus = 'Out of Stock';
      } else {
        bomAvailabilityStatus = 'Partially Available';
      }
    }

    const chkId = rec.checklist_id || rec.id;
    const inMemReq = inMemoryStoreRequirements.get(chkId);
    const isCourierIssued = isCourier && Boolean(
      rec.status === 'ISSUED' ||
      rec.material_issuance_status === 'ISSUED' ||
      rec.devices_issuance_status === 'ISSUED' ||
      rec.courier_dispatch_status === 'ISSUED' ||
      rec.is_courier_dispatched ||
      inMemReq?.status === 'ISSUED' ||
      inMemReq?.material_issuance_status === 'ISSUED' ||
      inMemReq?.devices_issuance_status === 'ISSUED' ||
      inMemReq?.courier_dispatch_status === 'ISSUED' ||
      inMemReq?.is_courier_dispatched ||
      processedChecklistDeviceIssuances.has(chkId)
    );

    let liveStatus = rec.status;
    if (isCourier) {
      if (isCourierIssued) {
        liveStatus = 'ISSUED';
        liveHasShortage = false;
        liveShortageCount = 0;
      } else if (liveHasShortage) {
        liveStatus = 'SHORTAGE_FLAGGED';
      } else {
        liveStatus = 'READY_FOR_ISSUANCE';
      }
    } else if (rec.job_type === 'Service') {
      if (enrichedServiceItems.length === 0) {
        liveStatus = 'NOT_APPLICABLE';
        liveHasShortage = false;
        liveShortageCount = 0;
      } else {
        const allIssued = enrichedServiceItems.every((it) => it.quantity_remaining === 0);
        const anyIssued = enrichedServiceItems.some((it) => (it.quantity_issued || 0) > 0);
        if (allIssued) {
          liveStatus = 'ISSUED';
          liveHasShortage = false;
          liveShortageCount = 0;
        } else if (liveHasShortage) {
          liveStatus = 'SHORTAGE_FLAGGED';
        } else if (anyIssued) {
          liveStatus = 'PARTIALLY_ISSUED';
        } else {
          liveStatus = 'READY_FOR_ISSUANCE';
        }
      }
    } else if (rec.material_issuance_status === 'ISSUED' && rec.devices_issuance_status === 'ISSUED') {
      liveStatus = 'ISSUED';
    } else if (rec.material_issuance_status === 'ISSUED') {
      liveStatus = 'MATERIALS_ISSUED';
    } else if (rec.devices_issuance_status === 'ISSUED') {
      liveStatus = 'DEVICES_ISSUED';
    } else if (liveHasShortage) {
      liveStatus = 'SHORTAGE_FLAGGED';
    } else {
      liveStatus = 'READY_FOR_ISSUANCE';
    }

    const [backupDecl, extraInstList, compReport] = await Promise.all([
      getBackupDeclaration(chkId).catch(() => null),
      getAdditionalCustomerInstallations({ checklist_id: chkId }).catch(() => []),
      (rec.completion_report ? Promise.resolve(rec.completion_report) : getInstallationCompletionReport(chkId).catch(() => null)),
    ]);

    const finalExtraInst = (Array.isArray(extraInstList) && extraInstList.length > 0)
      ? extraInstList
      : (Array.isArray(compReport?.extra_installations) ? compReport.extra_installations : (Array.isArray(rec.extra_installations) ? rec.extra_installations : []));

    // Calculate 8 distinguished quantities according to Section 4
    // 1. Original products issued for primary customer
    const isOrigIssued = rec.devices_issuance_status === 'ISSUED' ||
      rec.status === 'ISSUED' ||
      isCourierIssued ||
      processedChecklistDeviceIssuances.has(chkId) ||
      Boolean(inMemReq?.devices_issuance_status === 'ISSUED') ||
      Boolean(inMemReq?.status === 'ISSUED') ||
      Boolean(inMemReq?.is_courier_dispatched);

    const origIssuedQty = isOrigIssued
      ? (enrichedDevices.length > 0
          ? enrichedDevices.reduce((sum, d) => sum + (Number(d.required_quantity ?? d.quantity ?? d.number_of_devices) || 0), 0)
          : (Number(rec.number_of_devices) || 0))
      : 0;

    // 2. Extra backup devices declared by the technician
    const extraDeclQty = backupDecl?.has_backup_items && Array.isArray(backupDecl.items)
      ? backupDecl.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
      : 0;

    // 3. Extra devices requested for issuance
    const extraReqQty = extraDeclQty;

    // 4. Extra devices actually issued
    const extraIssuedQty = backupDecl?.has_backup_items && Array.isArray(backupDecl.items)
      ? backupDecl.items.reduce((sum, it) => sum + (Number(it.quantity_issued) || 0), 0)
      : 0;

    // 5. Extra devices installed for the primary customer
    const sameCustInst = finalExtraInst.filter((inst) => {
      const type = (inst.recipient_customer_type || '').toUpperCase();
      return type === 'SAME_CUSTOMER' || type === 'ORIGINAL_CUSTOMER';
    });
    const extraSameCustQty = sameCustInst.reduce((sum, inst) => {
      const compMap = inst.installed_components || inst.components || inst.components_used || {};
      const devTotal = Array.isArray(compMap)
        ? compMap.reduce((cSum, c) => cSum + (Number(c.quantity_installed ?? c.quantity) || 0), 0)
        : Object.values(compMap).reduce((cSum, q) => cSum + (Number(q) || 0), 0);
      return sum + (devTotal > 0 ? devTotal : (Number(inst.number_of_devices) || 1));
    }, 0);

    const extraPrimaryInstalledQty = compReport?.extra_devices_installed_primary ?? (extraSameCustQty > 0 ? extraSameCustQty :
      (backupDecl?.has_backup_items && Array.isArray(backupDecl.items)
        ? backupDecl.items.reduce((sum, it) => sum + (Number(it.quantity_used) || 0), 0)
        : 0));

    // 6. Extra devices installed for another customer
    const otherCustInst = finalExtraInst.filter((inst) => {
      const type = (inst.recipient_customer_type || '').toUpperCase();
      return type !== 'SAME_CUSTOMER' && type !== 'ORIGINAL_CUSTOMER';
    });
    const extraOtherCustomerInstalledQty = otherCustInst.reduce((sum, inst) => {
      const compMap = inst.installed_components || inst.components || inst.components_used || {};
      const devTotal = Array.isArray(compMap)
        ? compMap.reduce((cSum, c) => cSum + (Number(c.quantity_installed ?? c.quantity) || 0), 0)
        : Object.values(compMap).reduce((cSum, q) => cSum + (Number(q) || 0), 0);
      return sum + (devTotal > 0 ? devTotal : (Number(inst.number_of_devices) || 1));
    }, 0);

    // 7. Extra devices returned unused
    const extraReturnedQty = backupDecl?.has_backup_items && Array.isArray(backupDecl.items)
      ? backupDecl.items.reduce((sum, it) => sum + (Number(it.quantity_returned) || 0), 0)
      : (compReport?.extra_devices_returned ?? 0);

    // 8. Extra devices reported damaged or missing
    const extraDamagedOrMissingQty = backupDecl?.has_backup_items && Array.isArray(backupDecl.items)
      ? backupDecl.items.reduce((sum, it) => sum + (Number(it.quantity_damaged || 0) + Number(it.quantity_missing || 0)), 0)
      : ((compReport?.extra_devices_damaged ?? 0) + (compReport?.extra_devices_missing ?? 0));

    const stockIssuanceStatus = isCourier
      ? (isCourierIssued ? 'Completed' : 'Pending')
      : (liveStatus === 'ISSUED' ? 'Completed' : 'Pending');

    return {
      ...rec,
      is_courier: isCourier,
      effective_job_type: isCourier ? 'Courier' : rec.job_type,
      job_type: isCourier ? 'Courier' : rec.job_type,
      delivery_method: rec.delivery_method || (isCourier ? 'Product Couriered' : 'Technician Carries'),
      stock_issuance_status: stockIssuanceStatus,
      is_issued: isCourier ? isCourierIssued : (liveStatus === 'ISSUED'),
      devices_issuance_status: isCourier
        ? (isCourierIssued ? 'ISSUED' : 'PENDING')
        : (rec.devices_issuance_status || (processedChecklistDeviceIssuances.has(chkId) ? 'ISSUED' : 'PENDING')),
      material_issuance_status: isCourier
        ? (isCourierIssued ? 'ISSUED' : 'PENDING')
        : (rec.material_issuance_status || 'PENDING'),
      courier_dispatch_status: isCourier
        ? (isCourierIssued ? 'ISSUED' : 'PENDING')
        : (rec.courier_dispatch_status || 'PENDING'),
      is_courier_dispatched: isCourier ? isCourierIssued : Boolean(rec.is_courier_dispatched),
      material_issued_at: rec.material_issued_at || (isCourierIssued ? inMemReq?.material_issued_at : null),
      material_issued_by: rec.material_issued_by || (isCourierIssued ? inMemReq?.material_issued_by : null),
      device_items: rec.job_type === 'Service' ? [] : enrichedDevices,
      required_device_items: rec.job_type === 'Service' ? [] : (rec.required_device_items || requiredDeviceItems),
      extra_device_items: (rec.job_type === 'Service' || isCourier) ? [] : (rec.extra_device_items || extraDeviceItems),
      extra_device_configurations: (rec.job_type === 'Service' || isCourier) ? [] : (rec.extra_device_configurations || extraConfigs),
      material_items: (rec.job_type === 'Service' || isCourier) ? [] : enrichedMaterials,
      service_items: rec.job_type === 'Service' ? enrichedServiceItems : [],
      backup_declaration: backupDecl || null,
      extra_installations: finalExtraInst,
      extra_installations_count: finalExtraInst.length,
      distinguished_quantities: {
        original_products_issued: origIssuedQty,
        extra_devices_declared: extraDeclQty,
        extra_devices_requested: extraReqQty,
        extra_devices_issued: extraIssuedQty,
        extra_devices_installed_primary: extraPrimaryInstalledQty,
        extra_devices_installed_other: extraOtherCustomerInstalledQty,
        extra_devices_returned_unused: extraReturnedQty,
        extra_devices_damaged_missing: extraDamagedOrMissingQty,
      },
      completion_report: compReport || rec.completion_report || null,
      has_shortage: liveHasShortage,
      shortage_count: liveShortageCount,
      shortage_details: liveShortageDetails,
      bom_availability_status: bomAvailabilityStatus,
      status: isCourier ? (isCourierIssued ? 'ISSUED' : liveStatus) : liveStatus,
    };
  }));

  // Store-wide summary counts across the entire requirements table
  let totalAll = 0;
  let installationCount = 0;
  let courierCount = 0;
  let serviceCount = 0;
  let pendingCount = 0;
  let shortageCounter = 0;
  let issuedCount = 0;

  try {
    let summaryQuery = supabase
      .from('store_material_requirements')
      .select('job_type, delivery_method, status, material_issuance_status, has_shortage');

    if (search && search.trim()) {
      const s = search.trim();
      summaryQuery = summaryQuery.or(
        `checklist_number.ilike.%${s}%,client_name.ilike.%${s}%,client_mobile.ilike.%${s}%,client_location.ilike.%${s}%`
      );
    }

    const { data: sumRows, error: sumErr } = await summaryQuery;
    if (!sumErr && Array.isArray(sumRows) && sumRows.length > 0) {
      totalAll = sumRows.length;
      sumRows.forEach((r) => {
        const isC = r.delivery_method === 'Product Couriered';
        if (isC) {
          courierCount++;
        } else if (r.job_type === 'Service') {
          serviceCount++;
        } else {
          installationCount++;
        }

        const isIssued = isC
          ? (r.status === 'ISSUED' || r.material_issuance_status === 'ISSUED')
          : (r.job_type === 'Service'
            ? (r.material_issuance_status === 'ISSUED' || r.status === 'ISSUED')
            : (r.material_issuance_status === 'ISSUED' && r.status === 'ISSUED'));

        if (isIssued) {
          issuedCount++;
        } else {
          pendingCount++;
        }
        if (r.has_shortage && !isIssued) shortageCounter++;
      });
    }
  } catch (e) {
    console.warn('Could not query store summary counts:', e.message);
  }

  // Fallback to counting over enrichedRecords if summary query returned 0 rows
  if (totalAll === 0 && enrichedRecords.length > 0) {
    totalAll = totalCount || enrichedRecords.length;
    enrichedRecords.forEach((r) => {
      const isC = r.delivery_method === 'Product Couriered';
      if (isC) courierCount++;
      else if (r.job_type === 'Service') serviceCount++;
      else installationCount++;

      const isIssued = isC
        ? (r.devices_issuance_status === 'ISSUED' || r.material_issuance_status === 'ISSUED' || Boolean(r.is_courier_dispatched))
        : (r.job_type === 'Service'
          ? (r.material_issuance_status === 'ISSUED' || r.status === 'ISSUED')
          : (r.material_issuance_status === 'ISSUED' && r.devices_issuance_status === 'ISSUED'));

      if (isIssued) issuedCount++;
      else pendingCount++;

      if (r.has_shortage && !isIssued) shortageCounter++;
    });
  }

  let filteredRequirements = enrichedRecords;
  if (issuance_status && issuance_status !== 'All') {
    if (issuance_status === 'PENDING') {
      filteredRequirements = enrichedRecords.filter((r) => {
        if (r.is_courier) {
          return r.stock_issuance_status !== 'Completed' && !r.is_issued && r.status !== 'ISSUED';
        }
        return r.material_issuance_status === 'PENDING';
      });
    } else if (issuance_status === 'ISSUED') {
      filteredRequirements = enrichedRecords.filter((r) => {
        if (r.is_courier) {
          return r.stock_issuance_status === 'Completed' || r.is_issued || r.status === 'ISSUED';
        }
        return r.material_issuance_status === 'ISSUED';
      });
    }
  }

  return {
    requirements: filteredRequirements,
    summary: {
      total: totalAll || totalCount,
      installationCount,
      courierCount,
      serviceCount,
      pendingCount,
      shortageCounter,
      issuedCount,
    },
    page: pageNum,
    totalPages: Math.ceil((totalCount || totalAll || 1) / limitNum) || 1,
  };
}

/**
 * Retrieve specific store requirement detail
 */
export async function getStoreMaterialRequirementById(id) {
  if (!id) throw new Error('Requirement ID is required');

  let baseRecord = null;

  try {
    const { data, error } = await supabase
      .from('store_material_requirements')
      .select('*')
      .or(`id.eq.${id},checklist_id.eq.${id}`)
      .maybeSingle();

    if (!error && data) {
      const enriched = await getStoreMaterialRequirements({ limit: 10, search: data.checklist_number });
      const matched = (enriched?.requirements || []).find((r) => r.checklist_id === data.checklist_id || r.id === data.id);
      baseRecord = matched || data;
    }
  } catch (err) {
    console.warn('Error fetching store requirement detail:', err.message);
  }

  if (!baseRecord) {
    const fallback = inMemoryStoreRequirements.get(id);
    if (fallback) {
      baseRecord = fallback;
    }
  }

  if (!baseRecord) {
    // Resilient fallback: look up installation_checklists directly by ID or checklist_number and sync
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let chkQuery = supabase.from('installation_checklists').select('*');
      if (isUuid) {
        chkQuery = chkQuery.eq('id', id);
      } else {
        chkQuery = chkQuery.eq('checklist_number', id);
      }
      const { data: chk, error: chkErr } = await chkQuery.maybeSingle();
      if (!chkErr && chk) {
        const synced = await syncStoreRequirementForChecklist(chk);
        baseRecord = synced;
      }
    } catch (chkFallbackErr) {
      console.warn('Checklist fallback lookup for requirement failed:', chkFallbackErr.message);
    }
  }

  if (!baseRecord) {
    throw new Error(`Requirement with ID "${id}" not found.`);
  }

  // Ensure extra_installations and completion_report are always enriched
  const chkId = baseRecord.checklist_id || baseRecord.id;
  const isC = baseRecord.delivery_method === 'Product Couriered' || Boolean(baseRecord.is_courier);
  const effectiveJobType = isC ? 'Courier' : (baseRecord.job_type || 'Installation');

  const [backupDecl, extraInstList, compReport] = await Promise.all([
    getBackupDeclaration(chkId).catch(() => null),
    getAdditionalCustomerInstallations({ checklist_id: chkId }).catch(() => []),
    getInstallationCompletionReport(chkId).catch(() => null),
  ]);

  const finalExtraInst = (Array.isArray(extraInstList) && extraInstList.length > 0)
    ? extraInstList
    : (Array.isArray(compReport?.extra_installations) ? compReport.extra_installations : (Array.isArray(baseRecord.extra_installations) ? baseRecord.extra_installations : []));

  const resolvedBackupDecl = backupDecl || baseRecord.backup_declaration || null;

  // Always ensure distinguished quantities are fresh and accurate on baseRecord
  let distinguishedQuantities = baseRecord.distinguished_quantities;
  const inMemReqDetail = inMemoryStoreRequirements.get(chkId);
  const isCourierIssued = isC && (
    baseRecord.status === 'ISSUED' ||
    baseRecord.material_issuance_status === 'ISSUED' ||
    baseRecord.is_courier_dispatched ||
    inMemReqDetail?.status === 'ISSUED' ||
    inMemReqDetail?.is_courier_dispatched ||
    processedChecklistDeviceIssuances.has(chkId)
  );
  const isOrigIssued = baseRecord.devices_issuance_status === 'ISSUED' ||
    baseRecord.status === 'ISSUED' ||
    isCourierIssued ||
    processedChecklistDeviceIssuances.has(chkId) ||
    Boolean(inMemReqDetail?.devices_issuance_status === 'ISSUED') ||
    Boolean(inMemReqDetail?.status === 'ISSUED') ||
    Boolean(inMemReqDetail?.is_courier_dispatched);

  const origIssuedQty = (baseRecord.job_type === 'Service')
    ? (Array.isArray(baseRecord.service_items) ? baseRecord.service_items.reduce((s, it) => s + (Number(it.quantity_issued) || 0), 0) : 0)
    : (isOrigIssued
      ? (Number(baseRecord.number_of_devices) || (Array.isArray(baseRecord.device_items) ? baseRecord.device_items.reduce((s, d) => s + (Number(d.quantity || d.required_quantity || d.number_of_devices) || 0), 0) : 0) || 1)
      : 0);

  if (!distinguishedQuantities || (origIssuedQty > 0 && distinguishedQuantities.original_products_issued === 0)) {

    const extraDeclQty = resolvedBackupDecl?.has_backup_items && Array.isArray(resolvedBackupDecl.items)
      ? resolvedBackupDecl.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
      : 0;

    const extraReqQty = extraDeclQty;

    const extraIssuedQty = resolvedBackupDecl?.has_backup_items && Array.isArray(resolvedBackupDecl.items)
      ? resolvedBackupDecl.items.reduce((sum, it) => sum + (Number(it.quantity_issued) || 0), 0)
      : (compReport?.extra_devices_issued ?? 0);

    const sameCustInst = finalExtraInst.filter((inst) =>
      inst.recipient_customer_type === 'SAME_CUSTOMER' ||
      inst.recipient_customer_type === 'ORIGINAL_CUSTOMER' ||
      !inst.recipient_customer_type
    );
    const extraPrimaryInstalledQty = sameCustInst.reduce((sum, inst) => {
      const compMap = inst.installed_components || inst.components || inst.components_used || {};
      const devTotal = Array.isArray(compMap)
        ? compMap.reduce((cSum, c) => cSum + (Number(c.quantity_installed ?? c.quantity) || 0), 0)
        : Object.values(compMap).reduce((cSum, q) => cSum + (Number(q) || 0), 0);
      return sum + (devTotal > 0 ? devTotal : (Number(inst.number_of_devices) || 1));
    }, 0);

    const otherCustInst = finalExtraInst.filter((inst) =>
      inst.recipient_customer_type === 'ANOTHER_CUSTOMER' ||
      inst.recipient_customer_type === 'NEW_CUSTOMER' ||
      inst.recipient_customer_type === 'OTHER'
    );
    const extraOtherCustomerInstalledQty = otherCustInst.reduce((sum, inst) => {
      const compMap = inst.installed_components || inst.components || inst.components_used || {};
      const devTotal = Array.isArray(compMap)
        ? compMap.reduce((cSum, c) => cSum + (Number(c.quantity_installed ?? c.quantity) || 0), 0)
        : Object.values(compMap).reduce((cSum, q) => cSum + (Number(q) || 0), 0);
      return sum + (devTotal > 0 ? devTotal : (Number(inst.number_of_devices) || 1));
    }, 0);

    const extraReturnedQty = resolvedBackupDecl?.has_backup_items && Array.isArray(resolvedBackupDecl.items)
      ? resolvedBackupDecl.items.reduce((sum, it) => sum + (Number(it.quantity_returned) || 0), 0)
      : (compReport?.extra_devices_returned ?? 0);

    const extraDamagedOrMissingQty = resolvedBackupDecl?.has_backup_items && Array.isArray(resolvedBackupDecl.items)
      ? resolvedBackupDecl.items.reduce((sum, it) => sum + (Number(it.quantity_damaged || 0) + Number(it.quantity_missing || 0)), 0)
      : ((compReport?.extra_devices_damaged ?? 0) + (compReport?.extra_devices_missing ?? 0));

    distinguishedQuantities = {
      original_products_issued: origIssuedQty,
      extra_devices_declared: extraDeclQty,
      extra_devices_requested: extraReqQty,
      extra_devices_issued: extraIssuedQty,
      extra_devices_installed_primary: extraPrimaryInstalledQty,
      extra_devices_installed_other: extraOtherCustomerInstalledQty,
      extra_devices_returned_unused: extraReturnedQty,
      extra_devices_damaged_missing: extraDamagedOrMissingQty,
    };
  }

  return {
    ...baseRecord,
    is_courier: isC,
    effective_job_type: effectiveJobType,
    job_type: isC ? 'Courier' : baseRecord.job_type,
    delivery_method: baseRecord.delivery_method || (isC ? 'Product Couriered' : 'Technician Carries'),
    backup_declaration: resolvedBackupDecl,
    extra_installations: finalExtraInst,
    extra_installations_count: finalExtraInst.length,
    distinguished_quantities: distinguishedQuantities,
    completion_report: compReport || baseRecord.completion_report || null,
  };
}

/**
 * Update requirement issuance status
 */
export async function updateRequirementIssuanceStatus(checklistId, { status, issued_at, issued_by }) {
  if (!checklistId) return;

  const currentReq = inMemoryStoreRequirements.get(checklistId);
  const devicesStatus = currentReq?.devices_issuance_status || 'PENDING';
  const overallStatus = (status === 'ISSUED' && devicesStatus === 'ISSUED')
    ? 'ISSUED'
    : (status === 'ISSUED' ? 'MATERIALS_ISSUED' : 'READY_FOR_ISSUANCE');

  try {
    await supabase
      .from('store_material_requirements')
      .update({
        material_issuance_status: status,
        material_issued_at: issued_at || new Date().toISOString(),
        material_issued_by: issued_by || null,
        status: overallStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('checklist_id', checklistId);
  } catch (err) {
    console.warn('Error updating requirement issuance status:', err.message);
  }

  if (currentReq) {
    currentReq.material_issuance_status = status;
    currentReq.material_issued_at = issued_at || new Date().toISOString();
    currentReq.status = overallStatus;
  }
}

/**
 * Server-side atomic unified issuance of BOTH camera devices AND installation materials for a job
 */
const inFlightJobIssuances = new Set();

export async function issueFullJobStock({
  checklist_id,
  issue_devices = true,
  issue_materials = true,
  issue_backup_items = false,
  remarks = '',
  user,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required.');
  }

  if (inFlightJobIssuances.has(checklist_id)) {
    throw new Error(`Stock issuance for checklist ${checklist_id} is already in progress. Please wait.`);
  }

  inFlightJobIssuances.add(checklist_id);

  try {
    const shouldIssueDevices = Boolean(issue_devices);
    const shouldIssueMaterials = Boolean(issue_materials);
    const shouldIssueBackup = Boolean(issue_backup_items);

    if (!shouldIssueDevices && !shouldIssueMaterials && !shouldIssueBackup) {
      throw new Error('Please select at least one component (Devices, Materials, or Backup Items) to issue.');
    }

    const req = await getStoreMaterialRequirementById(checklist_id);
    if (!req) {
      throw new Error(`Job requirement "${checklist_id}" not found.`);
    }

    if (req.job_type === 'Service') {
      inFlightJobIssuances.delete(checklist_id);
      return await issueServiceJobStock({
        checklist_id,
        items: req.service_items || [],
        remarks,
        user,
      });
    }

    const isCourierJob = req.delivery_method === 'Product Couriered' || req.is_courier || req.job_type === 'Courier';

    if (isCourierJob) {
      let alreadyIssued = Boolean(
        req.stock_issuance_status === 'Completed' ||
        req.is_issued === true ||
        req.status === 'ISSUED' ||
        req.material_issuance_status === 'ISSUED' ||
        req.devices_issuance_status === 'ISSUED' ||
        req.courier_dispatch_status === 'ISSUED' ||
        req.is_courier_dispatched ||
        processedChecklistDeviceIssuances.has(checklist_id)
      );

      if (!alreadyIssued) {
        try {
          const { data: existingMovs } = await supabase
            .from('stock_movements')
            .select('id')
            .eq('checklist_id', checklist_id)
            .eq('movement_type', 'OUT')
            .limit(1);
          if (Array.isArray(existingMovs) && existingMovs.length > 0) {
            alreadyIssued = true;
          }
        } catch (movErr) {
          // ignore error
        }
      }

      if (alreadyIssued) {
        const conflictErr = new Error(`Checklist ${req.checklist_number} courier stock has already been issued. Duplicate issuance is prevented.`);
        conflictErr.status = 409;
        conflictErr.code = 'ALREADY_ISSUED';
        conflictErr.already_issued = true;
        conflictErr.checklist_id = checklist_id;
        conflictErr.checklist_number = req.checklist_number;
        throw conflictErr;
      }
    }

    // Check existing issuance statuses to prevent double deductions
    const devicesAlreadyIssued = (
      processedChecklistDeviceIssuances.has(checklist_id) ||
      req.devices_issuance_status === 'ISSUED'
    );
    const materialsAlreadyIssued = (
      processedChecklistMaterialIssuances.has(checklist_id) ||
      req.material_issuance_status === 'ISSUED'
    );

    // Resolve devices to issue
    let deviceItemsToIssue = req.device_items;
    if (!deviceItemsToIssue || !Array.isArray(deviceItemsToIssue) || deviceItemsToIssue.length === 0) {
      const configs = Array.isArray(req.device_configurations) && req.device_configurations.length > 0
        ? req.device_configurations
        : [{ device_type: req.device_type || '2 Channel Live', number_of_devices: req.number_of_devices || 1 }];
      deviceItemsToIssue = configs.map((c) => ({
        device_type: c.device_type,
        required_quantity: Number(c.number_of_devices !== undefined ? c.number_of_devices : c.required_quantity) || 1,
        unit: 'Nos.',
      }));
    }

    // Resolve materials to issue
    let materialItemsToIssue = req.material_items;
    if (!materialItemsToIssue || !Array.isArray(materialItemsToIssue) || materialItemsToIssue.length === 0) {
      if (req.bom_snapshot?.items && Array.isArray(req.bom_snapshot.items)) {
        materialItemsToIssue = req.bom_snapshot.items.map((m) => ({
          material_name: m.material_name,
          total_required_quantity: Number(m.total_quantity !== undefined ? m.total_quantity : m.required_quantity) || 0,
          unit: m.unit || 'Nos.',
        }));
      }
    }

    // Resolve declared backup items
    let backupItemsToIssue = [];
    if (shouldIssueBackup) {
      try {
        const declaration = await getBackupDeclaration(checklist_id);
        if (declaration?.has_backup_items && Array.isArray(declaration.items)) {
          backupItemsToIssue = declaration.items;
        }
      } catch (bErr) {
        // Ignore declaration fetch error
      }
    }

    const willIssueDevices = shouldIssueDevices && !devicesAlreadyIssued && deviceItemsToIssue.length > 0;
    const willIssueMaterials = shouldIssueMaterials && !materialsAlreadyIssued && materialItemsToIssue.length > 0;
    const willIssueBackup = shouldIssueBackup && backupItemsToIssue.length > 0;

    // Check if everything requested was already completed
    if (shouldIssueDevices && !willIssueDevices && !willIssueMaterials && !willIssueBackup && devicesAlreadyIssued && !shouldIssueMaterials) {
      throw new Error(`Camera devices have already been issued for checklist ${req.checklist_number}. Duplicate issuance is prevented.`);
    }
    if (shouldIssueMaterials && !willIssueMaterials && !willIssueDevices && !willIssueBackup && materialsAlreadyIssued && !shouldIssueDevices) {
      throw new Error(`Materials have already been issued for checklist ${req.checklist_number}. Duplicate issuance is prevented.`);
    }
    if (!willIssueDevices && !willIssueMaterials && !willIssueBackup) {
      if (devicesAlreadyIssued && materialsAlreadyIssued) {
        throw new Error(`All stock items have already been issued for checklist ${req.checklist_number}. Duplicate issuance is prevented.`);
      }
      throw new Error('No pending stock items found to issue for this checklist.');
    }

    // ============================================================
    // ATOMIC PRE-VALIDATION ACROSS ALL SELECTED CATEGORIES
    // Strictly validate usable inventory BEFORE executing any deductions
    // ============================================================

    // 1. Validate Camera Devices stock
    if (willIssueDevices) {
      const allProducts = await getInventoryProducts();
      const prodMap = new Map(allProducts.map((p) => [p.device_type, p]));

      for (const item of deviceItemsToIssue) {
        const devType = (item.device_type || '').trim();
        const qty = parseInt(
          item.required_quantity !== undefined
            ? item.required_quantity
            : (item.number_of_devices !== undefined ? item.number_of_devices : item.quantity),
          10
        ) || 0;
        if (qty <= 0) continue;

        const prod = prodMap.get(devType);
        const available = prod ? Number(prod.usable_stock) || 0 : 0;

        if (qty > available) {
          throw new Error(
            `Insufficient usable stock for camera device "${devType}". Available: ${available} Nos., Required: ${qty} Nos. Negative stock is strictly prevented.`
          );
        }
      }
    }

    // 2. Validate Installation Materials stock
    if (willIssueMaterials) {
      const allMaterials = await getMaterialInventory();
      const matMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));

      for (const item of materialItemsToIssue) {
        const matName = (item.material_name || '').trim();
        const qtyRequired = parseFloat(
          item.total_quantity !== undefined
            ? item.total_quantity
            : (item.total_required_quantity !== undefined ? item.total_required_quantity : item.quantity)
        );
        if (isNaN(qtyRequired) || qtyRequired <= 0) continue;

        const existingMat = matMap.get(matName.toLowerCase());
        const available = existingMat ? Number(existingMat.current_stock) || 0 : 0;
        const unit = existingMat?.unit || item.unit || 'Nos.';

        if (qtyRequired > available) {
          throw new Error(
            `Insufficient stock for "${matName}". Available: ${available} ${unit}, Required: ${qtyRequired} ${unit}. Negative stock prevented. Please replenish stock before issuing.`
          );
        }
      }
    }

    // 3. Validate Declared Backup Items stock
    if (willIssueBackup) {
      const [allMats, allDevs] = await Promise.all([
        getMaterialInventory().catch(() => []),
        getInventoryProducts().catch(() => []),
      ]);
      const matMap = new Map(allMats.map((m) => [m.material_name.toLowerCase(), m]));
      const devMap = new Map(allDevs.map((d) => [d.device_type.toLowerCase(), d]));

      for (const it of backupItemsToIssue) {
        const name = (it.item_name || '').trim();
        const qty = Number(it.quantity) || 0;
        if (qty <= 0) continue;
        if (Number(it.quantity_issued) >= qty) continue;

        const mat = matMap.get(name.toLowerCase());
        const dev = devMap.get(name.toLowerCase());

        if (mat) {
          const cur = Number(mat.current_stock) || 0;
          if (qty > cur) {
            throw new Error(`Insufficient stock for backup material "${name}". In store: ${cur} ${mat.unit || 'Nos.'}, required: ${qty} ${mat.unit || 'Nos.'}.`);
          }
        } else if (dev) {
          const cur = Number(dev.usable_stock) || 0;
          if (qty > cur) {
            throw new Error(`Insufficient stock for backup device "${name}". In store: ${cur} Nos., required: ${qty} Nos.`);
          }
        }
      }
    }

    // ============================================================
    // EXECUTE DEDUCTIONS (Only reaches here if ALL items are available)
    // ============================================================
    const results = {};

    // 1. Issue Camera Devices
    if (willIssueDevices) {
      const devResults = await issueDevicesForChecklist({
        checklist_id,
        devices: deviceItemsToIssue,
        remarks: remarks || `Camera devices issued for job ${req.checklist_number}`,
        user,
      });
      results.devices = devResults;
    } else if (devicesAlreadyIssued && shouldIssueDevices) {
      results.devices = { status: 'ALREADY_ISSUED', message: 'Camera devices were already issued previously.' };
    }

    // 2. Issue Installation Materials
    if (willIssueMaterials) {
      const matResults = await issueMaterialsForChecklist({
        checklist_id,
        items: materialItemsToIssue.map((m) => ({
          material_name: m.material_name,
          total_quantity: m.total_quantity !== undefined ? m.total_quantity : m.total_required_quantity,
          unit: m.unit,
        })),
        remarks: remarks || `Materials issued for job ${req.checklist_number}`,
        user,
      });
      results.materials = matResults;
    } else if (materialsAlreadyIssued && shouldIssueMaterials) {
      results.materials = { status: 'ALREADY_ISSUED', message: 'Installation materials were already issued previously.' };
    }

    // 3. Issue Declared Loose Backup Items
    if (willIssueBackup) {
      try {
        const backupResults = await issueBackupItemsForChecklist({
          checklist_id,
          user,
          remarks: remarks || `Loose backup items issued for job ${req.checklist_number}`,
        });
        if (backupResults?.issued_items?.length > 0) {
          results.backup_items = backupResults;
        }
      } catch (bErr) {
        console.warn('Backup items issuance notice during job stock issuance:', bErr.message);
      }
    }

    // 4. Fulfill device allocations so component reservations are completed and not double-deducted
    try {
      const { fulfillDeviceAllocationsForChecklist } = await import('./deviceSetService.js');
      await fulfillDeviceAllocationsForChecklist({ checklist_id, user });
    } catch (allocErr) {
      console.warn('Could not fulfill device allocations on full job stock issuance:', allocErr.message);
    }

    // ============================================================
    // SYNCHRONIZE ISSUANCE STATUSES
    // ============================================================
    const finalDevicesIssued = willIssueDevices || devicesAlreadyIssued;
    const finalMaterialsIssued = willIssueMaterials || materialsAlreadyIssued;

    const devicesStatus = finalDevicesIssued ? 'ISSUED' : (req.devices_issuance_status || 'PENDING');
    const materialsStatus = finalMaterialsIssued ? 'ISSUED' : (req.material_issuance_status || 'PENDING');
    const overallStatus = (devicesStatus === 'ISSUED' && materialsStatus === 'ISSUED')
      ? 'ISSUED'
      : (materialsStatus === 'ISSUED'
        ? 'MATERIALS_ISSUED'
        : (devicesStatus === 'ISSUED' ? 'DEVICES_ISSUED' : 'READY_FOR_ISSUANCE'));

    // Persist to store_material_requirements in Supabase
    try {
      const updateData = {
        material_issuance_status: isCourierJob ? 'ISSUED' : materialsStatus,
        status: isCourierJob ? 'ISSUED' : overallStatus,
        material_issued_at: new Date().toISOString(),
        material_issued_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      if (isCourierJob) {
        updateData.is_courier_dispatched = true;
        updateData.courier_dispatch_status = 'ISSUED';
      }
      await supabase
        .from('store_material_requirements')
        .update(updateData)
        .eq('checklist_id', checklist_id);
    } catch (e) {
      console.warn('Could not update store_material_requirements after issuance:', e.message);
    }

    // Update inMemoryStoreRequirements
    const inMem = inMemoryStoreRequirements.get(checklist_id);
    if (inMem) {
      inMem.devices_issuance_status = devicesStatus;
      inMem.material_issuance_status = isCourierJob ? 'ISSUED' : materialsStatus;
      inMem.status = isCourierJob ? 'ISSUED' : overallStatus;
      if (isCourierJob) {
        inMem.is_courier_dispatched = true;
        inMem.courier_dispatch_status = 'ISSUED';
      }
      inMem.material_issued_at = new Date().toISOString();
      inMem.material_issued_by = user?.id || null;
      inMem.devices_issued_at = new Date().toISOString();
      inMem.devices_issued_by = user?.id || null;
    }

    // Update installation_checklists in Supabase
    try {
      const chkUpdate = {
        material_issuance_status: isCourierJob ? 'ISSUED' : materialsStatus,
        material_issued_at: new Date().toISOString(),
        material_issued_by: user?.id || null,
        updated_at: new Date().toISOString(),
      };
      if (isCourierJob) {
        chkUpdate.is_courier_dispatched = true;
        chkUpdate.courier_dispatch_status = 'ISSUED';
        // Note: installation_status is intentionally kept independent and unchanged!
      }
      await supabase
        .from('installation_checklists')
        .update(chkUpdate)
        .eq('id', checklist_id);
    } catch (chkErr) {
      console.warn('Could not update installation_checklists status:', chkErr.message);
    }

    return {
      success: true,
      checklist_id,
      checklist_number: req.checklist_number,
      stock_issuance_status: 'Completed',
      is_issued: true,
      devices_issuance_status: devicesStatus,
      material_issuance_status: materialsStatus,
      status: overallStatus,
      material_issued_at: new Date().toISOString(),
      material_issued_by: user?.id || null,
      results,
    };
  } finally {
    inFlightJobIssuances.delete(checklist_id);
  }
}

/**
 * Authorize and issue requested devices and materials for a Service job.
 * Server-side atomic validation preventing negative balances and over-issuance,
 * recording in stock ledger and updating checklist & requirement records.
 */
export async function issueServiceJobStock({ checklist_id, items, remarks = '', user }) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required to issue Service job stock.');
  }

  if (inFlightJobIssuances.has(checklist_id)) {
    throw new Error(`Stock issuance for checklist ${checklist_id} is already in progress. Duplicate request prevented.`);
  }

  inFlightJobIssuances.add(checklist_id);

  try {
    const { getChecklistById, inMemoryChecklistServiceItems, normalizeServiceItems } = await import('./installationService.js');
    const checklist = await getChecklistById(checklist_id);
    if (!checklist) {
      throw new Error(`Job checklist "${checklist_id}" not found.`);
    }

    const inMemList = inMemoryChecklistServiceItems.get(checklist.id) || [];
    const rawList = Array.isArray(checklist.service_items) && checklist.service_items.length > 0
      ? checklist.service_items
      : inMemList;
    const currentServiceItems = normalizeServiceItems(rawList);

    if (!currentServiceItems || currentServiceItems.length === 0) {
      throw new Error(`Service checklist ${checklist.checklist_number} has no requested devices or materials to issue.`);
    }

    // Check if everything requested was already completed
    const allRemainingZero = currentServiceItems.every((it) => it.quantity_remaining === 0);
    if (allRemainingZero) {
      throw new Error(`All requested items have already been issued for checklist ${checklist.checklist_number}. Duplicate issuance is prevented.`);
    }

    // Load live inventory maps
    const [allMats, allDevs] = await Promise.all([
      getMaterialInventory(),
      getInventoryProducts(),
    ]);
    const matMap = new Map(allMats.map((m) => [m.id || m.material_name.toLowerCase(), m]));
    const matByName = new Map(allMats.map((m) => [m.material_name.toLowerCase(), m]));
    const devMap = new Map(allDevs.map((d) => [d.id || d.device_type, d]));
    const devByName = new Map(allDevs.map((d) => [d.device_type, d]));

    // Determine items to process
    const itemsToProcess = Array.isArray(items) && items.length > 0
      ? items
      : currentServiceItems.map((it) => ({
          id: it.id,
          quantity_to_issue: it.quantity_remaining !== undefined ? it.quantity_remaining : Math.max(0, it.quantity_required - (it.quantity_issued || 0)),
        }));

    const issuancePlan = [];
    let totalQtyToIssue = 0;

    // ATOMIC PRE-VALIDATION: validate ALL items BEFORE executing deductions
    for (const reqItem of currentServiceItems) {
      const match = itemsToProcess.find((it) =>
        (it.id && it.id === reqItem.id) ||
        (it.item_id && reqItem.item_id && it.item_id === reqItem.item_id) ||
        (it.item_name && it.item_name.toLowerCase() === reqItem.item_name.toLowerCase())
      );
      if (!match) continue;

      const qtyToIssue = Math.max(
        0,
        parseInt(match.quantity_to_issue !== undefined ? match.quantity_to_issue : (match.quantity ?? reqItem.quantity_remaining), 10) || 0
      );
      if (qtyToIssue <= 0) continue;

      const remaining = reqItem.quantity_remaining !== undefined
        ? reqItem.quantity_remaining
        : Math.max(0, reqItem.quantity_required - (reqItem.quantity_issued || 0));

      if (qtyToIssue > remaining) {
        throw new Error(`Cannot issue ${qtyToIssue} for "${reqItem.item_name}". Only ${remaining} remaining to issue.`);
      }

      const isDev = reqItem.item_type === 'DEVICE';
      let prod = null;
      let mat = null;
      let available = 0;

      if (isDev) {
        prod = (reqItem.item_id && devMap.get(reqItem.item_id)) || devByName.get(reqItem.item_name);
        available = prod ? Number(prod.usable_stock) || 0 : 0;
        if (qtyToIssue > available) {
          throw new Error(
            `Insufficient usable stock for camera device "${reqItem.item_name}". Available: ${available} Nos., Requested: ${qtyToIssue} Nos. Negative stock is strictly prevented.`
          );
        }
      } else {
        mat = (reqItem.item_id && matMap.get(reqItem.item_id)) || matByName.get(reqItem.item_name.toLowerCase());
        available = mat ? Number(mat.current_stock) || 0 : 0;
        if (qtyToIssue > available) {
          throw new Error(
            `Insufficient stock for material "${reqItem.item_name}". Available: ${available} ${mat?.unit || 'Nos.'}, Requested: ${qtyToIssue} ${mat?.unit || 'Nos.'}. Negative stock is strictly prevented.`
          );
        }
      }

      issuancePlan.push({
        serviceItem: reqItem,
        qtyToIssue,
        isDev,
        prod,
        mat,
        available,
      });
      totalQtyToIssue += qtyToIssue;
    }

    if (totalQtyToIssue <= 0) {
      throw new Error('Please enter a quantity greater than 0 to issue.');
    }

    // ============================================================
    // EXECUTE DEDUCTIONS AND STOCK LEDGER ENTRIES
    // ============================================================
    const recipient = checklist.service_engineer || 'Technician';
    const issuingUserId = user?.id || null;
    const nowIso = new Date().toISOString();
    const results = [];

    for (const plan of issuancePlan) {
      const { serviceItem, qtyToIssue, isDev, prod, mat, available } = plan;

      if (isDev && prod) {
        const { data: dbCurrentProd } = await supabase
          .from('inventory_products')
          .select('usable_stock')
          .eq('id', prod.id)
          .single();
        const currentDbStock = Number(dbCurrentProd?.usable_stock ?? prod.usable_stock) || 0;
        const newStock = Math.max(0, currentDbStock - qtyToIssue);
        await supabase
          .from('inventory_products')
          .update({ usable_stock: newStock, updated_at: nowIso })
          .eq('id', prod.id);

        await recordStockMovement({
          product_id: prod.id,
          item_name: serviceItem.item_name,
          sku: prod.sku || null,
          category: 'Camera Device',
          movement_type: 'SERVICE_DEVICE_ISSUED',
          quantity: -qtyToIssue,
          unit: serviceItem.unit || 'Nos.',
          balance_before: currentDbStock,
          balance_after: newStock,
          checklist_id: checklist.id,
          performed_by: issuingUserId && String(issuingUserId).length === 36 ? issuingUserId : null,
          performer_name: user?.full_name || user?.name || 'Store Manager',
          performer_email: user?.email || null,
          reason_or_remarks: `Service Device Issued: ${qtyToIssue} Nos. to ${recipient} for checklist ${checklist.checklist_number}. ${remarks}`.trim(),
          created_at: nowIso,
        });

        results.push({ item_name: serviceItem.item_name, quantity_issued: qtyToIssue, new_stock: newStock });
      } else if (!isDev && mat) {
        const { data: dbCurrentMat } = await supabase
          .from('material_inventory')
          .select('current_stock')
          .eq('id', mat.id)
          .single();
        const currentDbStock = Number(dbCurrentMat?.current_stock ?? mat.current_stock) || 0;
        const newStock = Math.max(0, currentDbStock - qtyToIssue);
        await supabase
          .from('material_inventory')
          .update({ current_stock: newStock, updated_at: nowIso })
          .eq('id', mat.id);

        await recordStockMovement({
          item_id: String(mat.id),
          item_name: serviceItem.item_name,
          sku: mat.sku || null,
          category: 'Installation Material',
          movement_type: 'SERVICE_MATERIAL_ISSUED',
          quantity: -qtyToIssue,
          unit: serviceItem.unit || mat.unit || 'Nos.',
          balance_before: currentDbStock,
          balance_after: newStock,
          checklist_id: checklist.id,
          performed_by: issuingUserId && String(issuingUserId).length === 36 ? issuingUserId : null,
          performer_name: user?.full_name || user?.name || 'Store Manager',
          performer_email: user?.email || null,
          reason_or_remarks: `Service Material Issued: ${qtyToIssue} ${mat.unit || 'Nos.'} to ${recipient} for checklist ${checklist.checklist_number}. ${remarks}`.trim(),
          created_at: nowIso,
        });

        results.push({ item_name: serviceItem.item_name, quantity_issued: qtyToIssue, new_stock: newStock });
      }

      // Update in-memory item state
      serviceItem.quantity_issued = (serviceItem.quantity_issued || 0) + qtyToIssue;
      serviceItem.quantity_remaining = Math.max(0, serviceItem.quantity_required - serviceItem.quantity_issued);
      serviceItem.status = serviceItem.quantity_remaining === 0 ? 'ISSUED' : 'PARTIALLY_ISSUED';
    }

    const allIssued = currentServiceItems.every((it) => it.quantity_remaining === 0);
    const overallStatus = allIssued ? 'ISSUED' : 'PARTIALLY_ISSUED';

    // Persist to installation_checklists
    try {
      await supabase
        .from('installation_checklists')
        .update({
          service_items: currentServiceItems,
          material_issuance_status: overallStatus,
          material_issued_at: nowIso,
          material_issued_by: issuingUserId,
          updated_at: nowIso,
        })
        .eq('id', checklist.id);
    } catch (chkErr) {
      console.warn('Could not update installation_checklists after service issuance:', chkErr.message);
    }
    inMemoryChecklistServiceItems.set(checklist.id, currentServiceItems);

    // Persist to store_material_requirements
    try {
      await supabase
        .from('store_material_requirements')
        .update({
          service_items: currentServiceItems,
          material_issuance_status: overallStatus,
          devices_issuance_status: overallStatus,
          status: overallStatus,
          material_issued_at: nowIso,
          material_issued_by: issuingUserId,
          updated_at: nowIso,
        })
        .eq('checklist_id', checklist.id);
    } catch (storeErr) {
      console.warn('Could not update store_material_requirements after service issuance:', storeErr.message);
    }

    const inMemStore = inMemoryStoreRequirements.get(checklist.id);
    if (inMemStore) {
      inMemStore.service_items = currentServiceItems;
      inMemStore.material_issuance_status = overallStatus;
      inMemStore.devices_issuance_status = overallStatus;
      inMemStore.status = overallStatus;
      inMemStore.material_issued_at = nowIso;
      inMemStore.material_issued_by = issuingUserId;
    }

    return {
      success: true,
      checklist_id: checklist.id,
      checklist_number: checklist.checklist_number,
      service_items: currentServiceItems,
      status: overallStatus,
      issued_count: totalQtyToIssue,
      results,
    };
  } finally {
    inFlightJobIssuances.delete(checklist_id);
  }
}
