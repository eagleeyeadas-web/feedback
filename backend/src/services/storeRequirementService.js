import supabase from './supabase.js';
import { getMaterialInventory, issueMaterialsForChecklist } from './materialStockService.js';
import { getInventoryProducts } from './inventoryService.js';
import {
  calculateBomRequirements,
  parseDeviceConfigurations,
  parseExtraDeviceConfigurations,
  combineCarriedDevicesAllocation,
} from './bomService.js';
import { enrichChecklistsWithWorkflowStatus } from './workflowService.js';

// In-memory fallback cache
const inMemoryStoreRequirements = new Map();

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

    if (isInstallation && shortage > 0) {
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
      shortage: isInstallation ? shortage : 0,
    };
  });

  // 2. Authoritative Installation Materials stock availability check (ONLY for Installation jobs!)
  if (isInstallation) {
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

  // Determine requirement statuses
  let reqStatus = 'PENDING_REVIEW';
  let materialIssuanceStatus = isInstallation ? (checklist.material_issuance_status || 'PENDING') : 'NOT_APPLICABLE';
  let devicesIssuanceStatus = isInstallation ? (checklist.devices_issuance_status || 'PENDING') : 'NOT_APPLICABLE';

  if (!isInstallation) {
    reqStatus = 'NOT_APPLICABLE';
    materialIssuanceStatus = 'NOT_APPLICABLE';
    devicesIssuanceStatus = 'NOT_APPLICABLE';
  } else if (materialIssuanceStatus === 'ISSUED' && devicesIssuanceStatus === 'ISSUED') {
    reqStatus = 'ISSUED';
  } else if (hasShortage) {
    reqStatus = 'SHORTAGE_FLAGGED';
  } else {
    reqStatus = 'READY_FOR_ISSUANCE';
  }

  const payload = {
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
    extra_device_configurations: extraConfigs,
    device_items: deviceItems,
    required_device_items: requiredDeviceItems,
    extra_device_items: extraDeviceItems,
    bom_snapshot: isInstallation ? bomSnapshot : null,
    material_items: isInstallation ? materialItems : [],
    material_issuance_status: materialIssuanceStatus,
    devices_issuance_status: devicesIssuanceStatus,
    status: reqStatus,
    has_shortage: hasShortage,
    shortage_count: shortageCount,
    shortage_details: shortageDetails.length > 0 ? shortageDetails : null,
    material_issued_at: checklist.material_issued_at || null,
    material_issued_by: checklist.material_issued_by || null,
    salesperson_name: checklist.salesperson_name || null,
    service_engineer: checklist.service_engineer || null,
    service_assistant: checklist.service_assistant || null,
    expected_arrival_date: checklist.expected_arrival_date || null,
    expected_arrival_time: checklist.expected_arrival_time || null,
    installation_duration: checklist.installation_duration || null,
    submission_date: checklist.created_at || new Date().toISOString(),
    notes: checklist.remarks || null,
    updated_at: new Date().toISOString(),
  };

  // Upsert to Supabase
  try {
    const { data: res, error } = await supabase
      .from('store_material_requirements')
      .upsert(payload, { onConflict: 'checklist_id' })
      .select()
      .maybeSingle();

    const totalCarried = combinedAllocation.reduce((s, c) => s + (Number(c.quantity_carried) || 0), 0) || Number(payload.number_of_devices) || 1;
    const totalReq = deviceConfigs.reduce((s, c) => s + (Number(c.number_of_devices) || 1), 0);
    const totalExtra = extraConfigs.reduce((s, c) => s + (Number(c.extra_quantity) || 1), 0);

    if (!error && res) {
      const full = {
        ...res,
        total_devices_carried: totalCarried,
        total_devices_required: totalReq,
        total_extra_devices: totalExtra,
        required_device_items: requiredDeviceItems,
        extra_device_items: extraDeviceItems,
        extra_device_configurations: extraConfigs,
      };
      inMemoryStoreRequirements.set(checklistId, full);
      return full;
    }

    if (
      error &&
      (error.code === 'PGRST204' ||
        error.message?.includes('salesperson_name') ||
        error.message?.includes('service_engineer') ||
        error.message?.includes('service_assistant') ||
        error.message?.includes('expected_arrival_date') ||
        error.message?.includes('expected_arrival_time') ||
        error.message?.includes('installation_duration') ||
        error.message?.includes('required_device_items') ||
        error.message?.includes('extra_device_items') ||
        error.message?.includes('extra_device_configurations'))
    ) {
      const strippedPayload = { ...payload };
      delete strippedPayload.salesperson_name;
      delete strippedPayload.service_engineer;
      delete strippedPayload.service_assistant;
      delete strippedPayload.expected_arrival_date;
      delete strippedPayload.expected_arrival_time;
      delete strippedPayload.installation_duration;
      delete strippedPayload.required_device_items;
      delete strippedPayload.extra_device_items;
      delete strippedPayload.extra_device_configurations;
      const { data: res2, error: err2 } = await supabase
        .from('store_material_requirements')
        .upsert(strippedPayload, { onConflict: 'checklist_id' })
        .select()
        .maybeSingle();
      if (!err2 && res2) {
        const merged = {
          ...res2,
          ...payload,
          total_devices_carried: totalCarried,
          total_devices_required: totalReq,
          total_extra_devices: totalExtra,
        };
        inMemoryStoreRequirements.set(checklistId, merged);
        return merged;
      }
    }
  } catch (err) {
    console.warn('Upsert store_material_requirements exception:', err.message);
  }

  const totalCarried = combinedAllocation.reduce((s, c) => s + (Number(c.quantity_carried) || 0), 0) || Number(payload.number_of_devices) || 1;
  const totalReq = deviceConfigs.reduce((s, c) => s + (Number(c.number_of_devices) || 1), 0);
  const totalExtra = extraConfigs.reduce((s, c) => s + (Number(c.extra_quantity) || 1), 0);

  const fallbackRecord = {
    id: `req-${checklistId}`,
    ...payload,
    total_devices_carried: totalCarried,
    total_devices_required: totalReq,
    total_extra_devices: totalExtra,
    created_at: payload.submission_date,
  };
  inMemoryStoreRequirements.set(checklistId, fallbackRecord);
  return fallbackRecord;
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

  let dbRecords = null;
  let totalCount = 0;

  try {
    let query = supabase
      .from('store_material_requirements')
      .select('*', { count: 'exact' })
      .order('submission_date', { ascending: false });

    if (job_type && job_type !== 'All') {
      query = query.eq('job_type', job_type);
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
      totalCount = count || data.length;
    }
  } catch (err) {
    console.warn('Could not query store_material_requirements table:', err.message);
  }

  if (!dbRecords) {
    try {
      const { data: chkList, count: chkCount } = await supabase
        .from('installation_checklists')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limitNum - 1);

      if (Array.isArray(chkList)) {
        dbRecords = await Promise.all(chkList.map((c) => syncStoreRequirementForChecklist(c)));
        totalCount = chkCount || chkList.length;
      }
    } catch (e) {
      dbRecords = Array.from(inMemoryStoreRequirements.values());
      totalCount = dbRecords.length;
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
          .select('id, checklist_number, salesperson_name, service_engineer, service_assistant, expected_arrival_date, expected_arrival_time, installation_duration, installation_status, final_bom_snapshot, actual_materials_used, actual_materials_returned, material_return_status')
          .in('id', allChecklistIds);
        if (!error && Array.isArray(data)) chkRows = data;
      } catch (colErr) {
        const { data } = await supabase
          .from('installation_checklists')
          .select('id, checklist_number, salesperson_name, service_engineer, service_assistant, expected_arrival_date, expected_arrival_time, installation_duration, installation_status')
          .in('id', allChecklistIds);
        if (Array.isArray(data)) chkRows = data;
      }

      if (Array.isArray(chkRows)) {
        const enrichedChk = enrichChecklistsWithWorkflowStatus(chkRows);
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
    const enrichedDevices = (parsedDevices.length > 0 ? parsedDevices : (Array.isArray(rec.device_items) && rec.device_items.length > 0 ? rec.device_items : [])).map((dItem) => {
      const dType = dItem.device_type || '';
      const dev = deviceMap.get(dType);
      const currentStock = dev ? Number(dev.usable_stock) || 0 : 0;
      const requiredQty = Number(dItem.required_quantity ?? dItem.number_of_devices) || 1;
      const shortage = rec.job_type === 'Installation' ? Math.max(0, requiredQty - currentStock) : 0;
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

    // Self-heal and enrich material items (Only for Installation)
    let rawMats = Array.isArray(rec.material_items) ? rec.material_items : [];
    if (rawMats.length === 0 && rec.job_type === 'Installation' && parsedDevices.length > 0) {
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

    const enrichedMaterials = rawMats.map((item) => {
      const matName = item.material_name || '';
      const inv = materialMap.get(matName.toLowerCase());
      const currentStock = inv ? Number(inv.current_stock) || 0 : 0;
      const requiredQty = Number(item.total_required_quantity !== undefined ? item.total_required_quantity : (item.total_quantity !== undefined ? item.total_quantity : item.required_quantity)) || 0;
      const shortage = rec.job_type === 'Installation' ? Math.max(0, requiredQty - currentStock) : 0;
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

    // Calculate BOM availability status
    let bomAvailabilityStatus = 'Available';
    if (rec.job_type === 'Service') {
      bomAvailabilityStatus = 'Not Applicable';
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

    let liveStatus = rec.status;
    if (rec.job_type === 'Service') {
      liveStatus = 'NOT_APPLICABLE';
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

    return {
      ...rec,
      device_items: enrichedDevices,
      material_items: enrichedMaterials,
      has_shortage: liveHasShortage,
      shortage_count: liveShortageCount,
      shortage_details: liveShortageDetails,
      bom_availability_status: bomAvailabilityStatus,
      status: liveStatus,
    };
  }));

  // Calculate counters
  let pendingCount = 0;
  let shortageCounter = 0;
  let issuedCount = 0;
  let installationCount = 0;
  let serviceCount = 0;

  enrichedRecords.forEach((r) => {
    if (r.job_type === 'Installation') installationCount++;
    if (r.job_type === 'Service') serviceCount++;
    if (r.material_issuance_status === 'ISSUED') issuedCount++;
    else if (r.job_type === 'Installation') pendingCount++;
    if (r.has_shortage) shortageCounter++;
  });

  return {
    requirements: enrichedRecords,
    summary: {
      total: totalCount,
      installationCount,
      serviceCount,
      pendingCount,
      shortageCounter,
      issuedCount,
    },
    page: pageNum,
    totalPages: Math.ceil(totalCount / limitNum) || 1,
  };
}

/**
 * Retrieve specific store requirement detail
 */
export async function getStoreMaterialRequirementById(id) {
  if (!id) throw new Error('Requirement ID is required');

  try {
    const { data, error } = await supabase
      .from('store_material_requirements')
      .select('*')
      .or(`id.eq.${id},checklist_id.eq.${id}`)
      .maybeSingle();

    if (!error && data) {
      const enriched = await getStoreMaterialRequirements({ limit: 1, search: data.checklist_number });
      return enriched.requirements[0] || data;
    }
  } catch (err) {
    console.warn('Error fetching store requirement detail:', err.message);
  }

  const fallback = inMemoryStoreRequirements.get(id);
  if (fallback) {
    if (fallback.job_type === 'Installation' && (!fallback.material_items || fallback.material_items.length === 0)) {
      const enriched = await getStoreMaterialRequirements({ limit: 1, search: fallback.checklist_number });
      if (enriched?.requirements?.[0]) return enriched.requirements[0];
    }
    return fallback;
  }

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
      const enriched = await getStoreMaterialRequirements({ limit: 1, search: chk.checklist_number });
      return enriched.requirements[0] || synced;
    }
  } catch (chkFallbackErr) {
    console.warn('Checklist fallback lookup for requirement failed:', chkFallbackErr.message);
  }

  throw new Error(`Requirement with ID "${id}" not found.`);
}

/**
 * Update requirement issuance status
 */
export async function updateRequirementIssuanceStatus(checklistId, { status, issued_at, issued_by }) {
  if (!checklistId) return;

  try {
    await supabase
      .from('store_material_requirements')
      .update({
        material_issuance_status: status,
        material_issued_at: issued_at || new Date().toISOString(),
        material_issued_by: issued_by || null,
        status: status === 'ISSUED' ? 'ISSUED' : 'READY_FOR_ISSUANCE',
        updated_at: new Date().toISOString(),
      })
      .eq('checklist_id', checklistId);
  } catch (err) {
    console.warn('Error updating requirement issuance status:', err.message);
  }

  const inMem = inMemoryStoreRequirements.get(checklistId);
  if (inMem) {
    inMem.material_issuance_status = status;
    inMem.material_issued_at = issued_at || new Date().toISOString();
    inMem.status = status === 'ISSUED' ? 'ISSUED' : 'READY_FOR_ISSUANCE';
  }
}

/**
 * Server-side atomic unified issuance of BOTH camera devices AND installation materials for a job
 */
export async function issueFullJobStock({
  checklist_id,
  issue_devices = true,
  issue_materials = true,
  remarks = '',
  user,
}) {
  if (!checklist_id) {
    throw new Error('Checklist ID is required.');
  }

  const req = await getStoreMaterialRequirementById(checklist_id);
  if (!req) {
    throw new Error(`Job requirement "${checklist_id}" not found.`);
  }

  if (req.job_type === 'Service') {
    throw new Error(`Job ${req.checklist_number} is a Service job. Installation BOM issuance does not apply.`);
  }

  const results = {};

  // 1. Issue Camera Devices if requested
  if (issue_devices && req.device_items?.length > 0) {
    const devResults = await issueDevicesForChecklist({
      checklist_id,
      devices: req.device_items,
      remarks: remarks || `Camera devices issued for job ${req.checklist_number}`,
      user,
    });
    results.devices = devResults;

    try {
      await supabase
        .from('store_material_requirements')
        .update({
          devices_issuance_status: 'ISSUED',
          updated_at: new Date().toISOString(),
        })
        .eq('checklist_id', checklist_id);
    } catch (e) {
      // Ignore
    }
  }

  // 2. Issue Installation Materials if requested
  if (issue_materials && req.material_items?.length > 0) {
    const matResults = await issueMaterialsForChecklist({
      checklist_id,
      items: req.material_items.map((m) => ({
        material_name: m.material_name,
        total_quantity: m.total_required_quantity,
        unit: m.unit,
      })),
      remarks: remarks || `Materials issued for job ${req.checklist_number}`,
      user,
    });
    results.materials = matResults;
  }

  return {
    success: true,
    checklist_id,
    checklist_number: req.checklist_number,
    results,
  };
}
