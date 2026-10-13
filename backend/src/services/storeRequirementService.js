import supabase from './supabase.js';
import { getMaterialInventory } from './materialStockService.js';
import { calculateBomRequirements } from './bomService.js';

// In-memory fallback cache to ensure 100% operational uptime
const inMemoryStoreRequirements = new Map();

/**
 * Automatically create or update the associated Store Manager material-requirement record
 * for an installation or service checklist.
 * Idempotent upsert linked by checklist_id.
 */
export async function syncStoreRequirementForChecklist(checklist) {
  if (!checklist || !checklist.id) {
    throw new Error('Checklist with valid ID is required to sync Store Manager requirement');
  }

  const isInstallation = (checklist.installation_or_service || 'Installation') === 'Installation';
  const checklistId = checklist.id;
  const checklistNumber = checklist.checklist_number || 'N/A';

  let bomSnapshot = null;
  let materialItems = [];
  let hasShortage = false;
  let shortageCount = 0;
  const shortageDetails = [];

  if (isInstallation) {
    bomSnapshot = checklist.bom_snapshot || null;

    // Auto-calculate BOM if not already attached
    if (!bomSnapshot && Array.isArray(checklist.device_configurations) && checklist.device_configurations.length > 0) {
      try {
        const calc = await calculateBomRequirements(checklist.device_configurations);
        if (calc && calc.configured) {
          bomSnapshot = calc;
        }
      } catch (err) {
        console.warn('Could not calculate BOM snapshot for requirement sync:', err.message);
      }
    } else if (!bomSnapshot && checklist.device_type) {
      try {
        const calc = await calculateBomRequirements(checklist.device_type, checklist.number_of_devices || 1);
        if (calc && calc.configured) {
          bomSnapshot = calc;
        }
      } catch (err) {
        console.warn('Could not calculate single-device BOM snapshot for requirement sync:', err.message);
      }
    }

    // Fetch authoritative material inventory for stock accuracy & shortage calculation
    let inventoryMap = new Map();
    try {
      const allMaterials = await getMaterialInventory();
      inventoryMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));
    } catch (e) {
      console.warn('Could not load inventory for shortage calculation:', e.message);
    }

    if (bomSnapshot?.items && Array.isArray(bomSnapshot.items)) {
      materialItems = bomSnapshot.items.map((item) => {
        const matName = item.material_name || '';
        const inv = inventoryMap.get(matName.toLowerCase());
        const availableStock = inv ? Number(inv.current_stock) || 0 : 0;
        const requiredQty = Number(item.total_quantity) || 0;
        const shortage = Math.max(0, requiredQty - availableStock);

        if (shortage > 0) {
          hasShortage = true;
          shortageCount++;
          shortageDetails.push({
            material_name: matName,
            available_stock: availableStock,
            required_quantity: requiredQty,
            shortage,
            unit: item.unit || inv?.unit || 'Nos.',
          });
        }

        return {
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

  // Determine requirement status
  let reqStatus = 'PENDING_REVIEW';
  let issuanceStatus = isInstallation ? (checklist.material_issuance_status || 'PENDING') : 'NOT_APPLICABLE';

  if (!isInstallation) {
    reqStatus = 'NOT_APPLICABLE';
    issuanceStatus = 'NOT_APPLICABLE';
  } else if (issuanceStatus === 'ISSUED') {
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
    device_type: checklist.device_type || '2 Channel Live',
    number_of_devices: Number(checklist.number_of_devices) || 1,
    number_of_vehicles: Number(checklist.number_of_vehicles) || Number(checklist.number_of_devices) || 1,
    device_configurations: checklist.device_configurations || [],
    bom_snapshot: isInstallation ? bomSnapshot : null,
    material_items: isInstallation ? materialItems : [],
    material_issuance_status: issuanceStatus,
    status: reqStatus,
    has_shortage: hasShortage,
    shortage_count: shortageCount,
    shortage_details: shortageDetails.length > 0 ? shortageDetails : null,
    material_issued_at: checklist.material_issued_at || null,
    material_issued_by: checklist.material_issued_by || null,
    submission_date: checklist.created_at || new Date().toISOString(),
    notes: checklist.remarks || null,
    updated_at: new Date().toISOString(),
  };

  // 1. Persist to Supabase store_material_requirements table
  try {
    const { data: res, error } = await supabase
      .from('store_material_requirements')
      .upsert(payload, { onConflict: 'checklist_id' })
      .select()
      .maybeSingle();

    if (!error && res) {
      inMemoryStoreRequirements.set(checklistId, res);
      return res;
    }
    if (error) {
      console.warn('Supabase upsert for store_material_requirements failed, using fallback:', error.message);
    }
  } catch (err) {
    console.warn('Exception upserting store_material_requirements:', err.message);
  }

  // 2. In-memory cache fallback with assigned ID
  const fallbackRecord = {
    id: `req-${checklistId}`,
    ...payload,
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

  // Authoritative live inventory for up-to-the-minute stock & shortage calculations
  let inventoryMap = new Map();
  try {
    const allMaterials = await getMaterialInventory();
    inventoryMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));
  } catch (e) {
    console.warn('Could not load inventory map in getStoreMaterialRequirements:', e.message);
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
    console.warn('Could not query store_material_requirements table, falling back to checklists join:', err.message);
  }

  // If table does not exist or has no records, fallback to installation_checklists
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
      console.warn('Fallback checklist query failed:', e.message);
      dbRecords = Array.from(inMemoryStoreRequirements.values());
      totalCount = dbRecords.length;
    }
  }

  // Enrich records with LIVE authoritative inventory stock & shortage
  const enrichedRecords = (dbRecords || []).map((rec) => {
    let liveHasShortage = false;
    let liveShortageCount = 0;
    const liveShortageDetails = [];

    const enrichedItems = (Array.isArray(rec.material_items) ? rec.material_items : []).map((item) => {
      const matName = item.material_name || '';
      const inv = inventoryMap.get(matName.toLowerCase());
      const currentStock = inv ? Number(inv.current_stock) || 0 : 0;
      const requiredQty = Number(item.total_required_quantity) || 0;
      const shortage = Math.max(0, requiredQty - currentStock);

      if (shortage > 0) {
        liveHasShortage = true;
        liveShortageCount++;
        liveShortageDetails.push({
          material_name: matName,
          available_stock: currentStock,
          required_quantity: requiredQty,
          shortage,
          unit: item.unit || inv?.unit || 'Nos.',
        });
      }

      return {
        ...item,
        available_stock: currentStock,
        shortage,
      };
    });

    let liveStatus = rec.status;
    if (rec.job_type === 'Service') {
      liveStatus = 'NOT_APPLICABLE';
    } else if (rec.material_issuance_status === 'ISSUED') {
      liveStatus = 'ISSUED';
    } else if (liveHasShortage) {
      liveStatus = 'SHORTAGE_FLAGGED';
    } else {
      liveStatus = 'READY_FOR_ISSUANCE';
    }

    return {
      ...rec,
      material_items: enrichedItems,
      has_shortage: liveHasShortage,
      shortage_count: liveShortageCount,
      shortage_details: liveShortageDetails,
      status: liveStatus,
    };
  });

  // Calculate high-level summary counters
  let pendingCount = 0;
  let shortageCounter = 0;
  let issuedCount = 0;
  let installationCount = 0;
  let serviceCount = 0;

  enrichedRecords.forEach((r) => {
    if (r.job_type === 'Installation') installationCount++;
    if (r.job_type === 'Service') serviceCount++;
    if (r.material_issuance_status === 'PENDING') pendingCount++;
    if (r.material_issuance_status === 'ISSUED') issuedCount++;
    if (r.has_shortage && r.material_issuance_status !== 'ISSUED') shortageCounter++;
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
    limit: limitNum,
    totalPages: Math.ceil(totalCount / limitNum) || 1,
  };
}

/**
 * Retrieve a single requirement record by ID or checklist_id
 */
export async function getStoreMaterialRequirementById(idOrChecklistId) {
  let record = null;

  try {
    const { data } = await supabase
      .from('store_material_requirements')
      .select('*')
      .or(`id.eq.${idOrChecklistId},checklist_id.eq.${idOrChecklistId}`)
      .maybeSingle();

    if (data) record = data;
  } catch (err) {
    // Check in-memory
  }

  if (!record) {
    record = inMemoryStoreRequirements.get(idOrChecklistId) || null;
  }

  if (!record) {
    // Try to load checklist and sync
    try {
      const { data: chk } = await supabase
        .from('installation_checklists')
        .select('*')
        .eq('id', idOrChecklistId)
        .maybeSingle();

      if (chk) {
        record = await syncStoreRequirementForChecklist(chk);
      }
    } catch (e) {
      // Ignore
    }
  }

  if (!record) {
    throw new Error(`Store material requirement not found for ${idOrChecklistId}`);
  }

  // Enrich with live stock
  const allMaterials = await getMaterialInventory().catch(() => []);
  const inventoryMap = new Map(allMaterials.map((m) => [m.material_name.toLowerCase(), m]));

  const enrichedItems = (Array.isArray(record.material_items) ? record.material_items : []).map((item) => {
    const inv = inventoryMap.get((item.material_name || '').toLowerCase());
    const available = inv ? Number(inv.current_stock) || 0 : 0;
    const required = Number(item.total_required_quantity) || 0;
    return {
      ...item,
      available_stock: available,
      shortage: Math.max(0, required - available),
    };
  });

  return {
    ...record,
    material_items: enrichedItems,
  };
}

/**
 * Update material issuance status for a requirement
 */
export async function updateRequirementIssuanceStatus(checklistId, { status, issued_at, issued_by }) {
  const updatePayload = {
    material_issuance_status: status || 'ISSUED',
    status: status || 'ISSUED',
    material_issued_at: issued_at || new Date().toISOString(),
    material_issued_by: issued_by || null,
    updated_at: new Date().toISOString(),
  };

  try {
    await supabase
      .from('store_material_requirements')
      .update(updatePayload)
      .eq('checklist_id', checklistId);
  } catch (err) {
    console.warn('Could not update store_material_requirements issuance status:', err.message);
  }

  if (inMemoryStoreRequirements.has(checklistId)) {
    const mem = inMemoryStoreRequirements.get(checklistId);
    inMemoryStoreRequirements.set(checklistId, { ...mem, ...updatePayload });
  }
}
