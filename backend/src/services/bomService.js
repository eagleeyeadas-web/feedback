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

export const INITIAL_BOM_TEMPLATE = [
  { material_name: 'Insulation Tape', quantity_per_device: 2, unit: 'Nos.', sort_order: 1 },
  { material_name: 'Cable Tie – 200 mm', quantity_per_device: 1, unit: 'Packet', sort_order: 2 },
  { material_name: 'Cable Tie – 300 mm', quantity_per_device: 1, unit: 'Packet', sort_order: 3 },
  { material_name: 'Screw (Long)', quantity_per_device: 12, unit: 'Nos.', sort_order: 4 },
  { material_name: 'Screw (Small)', quantity_per_device: 12, unit: 'Nos.', sort_order: 5 },
  { material_name: 'Memory Card', quantity_per_device: 1, unit: 'No.', sort_order: 6 },
  { material_name: '0.5 mm wire', quantity_per_device: 20, unit: 'Metres', sort_order: 7 },
  { material_name: '5-metre Cable', quantity_per_device: 3, unit: 'Nos.', sort_order: 8 },
  { material_name: '15-metre Cable', quantity_per_device: 1, unit: 'No.', sort_order: 9 },
];

export const COMMON_UNITS = [
  'Nos.',
  'Packet',
  'No.',
  'Metres',
  'Roll',
  'Box',
  'Kg',
  'Set',
  'Piece',
];

/**
 * Resilient in-memory fallback store matching business confirmation
 * All 7 standard device types initialized with the business confirmed initial BOM
 */
const inMemoryBoms = new Map(
  STANDARD_DEVICE_TYPES.map((type, idx) => [
    type,
    {
      id: `bom-${idx + 1}`,
      device_type: type,
      version: 1,
      is_configured: true,
      notes: 'Initial business-confirmed BOM configuration',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: INITIAL_BOM_TEMPLATE.map((item, itemIdx) => ({
        id: `bom-item-${idx + 1}-${itemIdx + 1}`,
        bom_id: `bom-${idx + 1}`,
        material_name: item.material_name,
        quantity_per_device: item.quantity_per_device,
        unit: item.unit,
        sort_order: item.sort_order,
      })),
    },
  ])
);

/**
 * Get all BOMs grouped with their items
 */
export async function getAllBoms() {
  try {
    const { data: dbBoms, error: bomsError } = await supabase
      .from('device_boms')
      .select('*, items:bom_items(*)')
      .order('device_type', { ascending: true });

    if (!bomsError && dbBoms && dbBoms.length > 0) {
      // Sync in-memory map
      dbBoms.forEach((b) => {
        const sortedItems = (b.items || []).sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0));
        inMemoryBoms.set(b.device_type, {
          ...b,
          items: sortedItems,
        });
      });

      return Array.from(inMemoryBoms.values()).sort((a, b) => a.device_type.localeCompare(b.device_type));
    }
  } catch (err) {
    console.warn('DB device_boms fetch failed, using in-memory store:', err.message);
  }

  return Array.from(inMemoryBoms.values()).sort((a, b) => a.device_type.localeCompare(b.device_type));
}

/**
 * Get a single BOM by device type
 */
export async function getBomByDeviceType(deviceType) {
  if (!deviceType) return null;
  const normalized = deviceType.trim();

  try {
    const { data: dbBom, error } = await supabase
      .from('device_boms')
      .select('*, items:bom_items(*)')
      .eq('device_type', normalized)
      .maybeSingle();

    if (!error && dbBom) {
      const sortedItems = (dbBom.items || []).sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0));
      const completeBom = { ...dbBom, items: sortedItems };
      inMemoryBoms.set(normalized, completeBom);
      return completeBom;
    }
  } catch (err) {
    console.warn(`DB fetch for BOM "${normalized}" failed:`, err.message);
  }

  return inMemoryBoms.get(normalized) || null;
}

/**
 * Live BOM calculation:
 * Total required quantity = configured BOM quantity per device * number of devices
 */
/**
 * Live BOM calculation:
 * Supports single device type OR multiple device configurations.
 * Calculates material requirements for each selected device type using its own configured BOM.
 * Combines shared material requirements for the overall installation.
 * If any selected device type has no configured BOM, shows a warning and does not display an incomplete calculation as final.
 */
export async function calculateBomRequirements(param1, param2) {
  // Normalize input into an array of device configurations
  let rawConfigs = [];
  if (Array.isArray(param1)) {
    rawConfigs = param1;
  } else if (param1 && typeof param1 === 'object' && Array.isArray(param1.device_configurations)) {
    rawConfigs = param1.device_configurations;
  } else if (typeof param1 === 'string') {
    rawConfigs = [{ device_type: param1, number_of_devices: param2, number_of_vehicles: param2 }];
  } else if (param1 && typeof param1 === 'object' && param1.device_type) {
    rawConfigs = [param1];
  }

  if (rawConfigs.length === 0) {
    return {
      configured: false,
      warning: 'At least one device configuration is required.',
      device_configurations: [],
      items: [],
      total_devices: 0,
      total_vehicles: 0,
    };
  }

  // Combine duplicate device types automatically
  const combinedMap = new Map();
  for (const c of rawConfigs) {
    const dType = (c.device_type || '').trim();
    if (!dType) continue;
    const dQty = parseInt(c.number_of_devices, 10);
    const vQty = parseInt(c.number_of_vehicles, 10);

    if (combinedMap.has(dType)) {
      const existing = combinedMap.get(dType);
      existing.number_of_devices += (isNaN(dQty) ? 0 : dQty);
      existing.number_of_vehicles += (isNaN(vQty) ? (isNaN(dQty) ? 0 : dQty) : vQty);
    } else {
      combinedMap.set(dType, {
        device_type: dType,
        number_of_devices: isNaN(dQty) ? 0 : dQty,
        number_of_vehicles: isNaN(vQty) ? (isNaN(dQty) ? 0 : dQty) : vQty,
      });
    }
  }

  const normalizedConfigs = Array.from(combinedMap.values());

  // Validate positive whole numbers (> 0)
  for (const c of normalizedConfigs) {
    if (isNaN(c.number_of_devices) || c.number_of_devices <= 0) {
      return {
        configured: false,
        warning: `Device quantity for "${c.device_type}" must be a positive whole number greater than 0.`,
        device_configurations: normalizedConfigs,
        items: [],
        total_devices: 0,
        total_vehicles: 0,
      };
    }
  }

  let totalDevices = 0;
  let totalVehicles = 0;
  const unconfiguredTypes = [];
  const perDeviceBreakdowns = [];
  const combinedMaterialsMap = new Map();

  for (const c of normalizedConfigs) {
    const qty = c.number_of_devices;
    const vehicles = c.number_of_vehicles > 0 ? c.number_of_vehicles : qty;
    totalDevices += qty;
    totalVehicles += vehicles;

    const bom = await getBomByDeviceType(c.device_type);

    if (!bom || !bom.is_configured || !Array.isArray(bom.items) || bom.items.length === 0) {
      unconfiguredTypes.push(c.device_type);
      perDeviceBreakdowns.push({
        device_type: c.device_type,
        number_of_devices: qty,
        number_of_vehicles: vehicles,
        bom_version: bom?.version || null,
        configured: false,
        items: [],
      });
      continue;
    }

    const deviceItems = bom.items.map((it) => {
      const perDevice = Number(it.quantity_per_device) || 0;
      const subtotal = Math.round((perDevice * qty) * 100) / 100;
      return {
        id: it.id,
        material_name: it.material_name,
        quantity_per_device: perDevice,
        number_of_devices: qty,
        total_quantity: subtotal,
        unit: it.unit,
        sort_order: it.sort_order || 0,
      };
    });

    perDeviceBreakdowns.push({
      bom_id: bom.id,
      device_type: c.device_type,
      number_of_devices: qty,
      number_of_vehicles: vehicles,
      bom_version: bom.version || 1,
      configured: true,
      items: deviceItems,
    });

    // Merge into combined materials
    for (const item of deviceItems) {
      const key = `${item.material_name.toLowerCase().trim()}:::${item.unit.toLowerCase().trim()}`;
      if (combinedMaterialsMap.has(key)) {
        const existing = combinedMaterialsMap.get(key);
        existing.total_quantity = Math.round((existing.total_quantity + item.total_quantity) * 100) / 100;
        if (existing.quantity_per_device !== item.quantity_per_device) {
          existing.quantity_per_device = undefined;
        }
        existing.breakdown.push({
          device_type: c.device_type,
          quantity_per_device: item.quantity_per_device,
          number_of_devices: qty,
          subtotal: item.total_quantity,
        });
      } else {
        combinedMaterialsMap.set(key, {
          material_name: item.material_name,
          unit: item.unit,
          quantity_per_device: item.quantity_per_device,
          total_quantity: item.total_quantity,
          sort_order: item.sort_order || 0,
          breakdown: [
            {
              device_type: c.device_type,
              quantity_per_device: item.quantity_per_device,
              number_of_devices: qty,
              subtotal: item.total_quantity,
            },
          ],
        });
      }
    }
  }

  // If ANY device type is unconfigured, show warning and DO NOT display an incomplete calculation as final
  if (unconfiguredTypes.length > 0) {
    return {
      configured: false,
      warning: `No Bill of Materials (BOM) is configured for ${unconfiguredTypes.map((t) => `"${t}"`).join(', ')}. Material requirements cannot be displayed as final until all selected device types have configured BOMs.`,
      unconfigured_device_types: unconfiguredTypes,
      device_configurations: perDeviceBreakdowns,
      total_devices: totalDevices,
      total_vehicles: totalVehicles,
      items: [],
    };
  }

  // Sort combined items by sort_order then name
  const combinedItems = Array.from(combinedMaterialsMap.values()).sort((a, b) => {
    if (a.sort_order !== b.sort_order) return (a.sort_order || 0) - (b.sort_order || 0);
    return a.material_name.localeCompare(b.material_name);
  });

  const summaryDeviceType =
    normalizedConfigs.length === 1
      ? normalizedConfigs[0].device_type
      : normalizedConfigs.map((c) => `${c.device_type} (${c.number_of_devices})`).join(', ');

  return {
    configured: true,
    device_type: summaryDeviceType,
    bom_version: normalizedConfigs.length === 1 ? (perDeviceBreakdowns[0]?.bom_version || 1) : null,
    number_of_devices: totalDevices,
    total_devices: totalDevices,
    total_vehicles: totalVehicles,
    device_configurations: perDeviceBreakdowns,
    total_materials_count: combinedItems.length,
    calculated_at: new Date().toISOString(),
    items: combinedItems.map((it) => ({
      ...it,
      number_of_devices: totalDevices,
    })),
  };
}

/**
 * Store Manager updates the BOM configuration for a device type.
 * Validates materials, increments version, saves persistently in Supabase, and logs audit record.
 */
export async function updateDeviceBom(deviceType, { items, notes = '', is_configured = true, user }) {
  if (!deviceType || !deviceType.trim()) {
    throw new Error('Device type is required.');
  }

  const normalizedType = deviceType.trim();

  if (!Array.isArray(items)) {
    throw new Error('Materials items list must be an array.');
  }

  if (is_configured && items.length === 0) {
    throw new Error('A configured BOM must contain at least one material.');
  }

  // Validate items
  const seenNames = new Set();
  const cleanedItems = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = (it.material_name || '').trim();
    const unit = (it.unit || '').trim();
    const qtyPerDevice = parseFloat(it.quantity_per_device);

    if (!name) {
      throw new Error(`Material at row #${i + 1} has an empty name.`);
    }

    if (!unit) {
      throw new Error(`Material "${name}" must have a unit of measurement.`);
    }

    if (isNaN(qtyPerDevice) || qtyPerDevice <= 0) {
      throw new Error(`Material "${name}" must have a positive minimum quantity per device (greater than 0).`);
    }

    const lowerName = name.toLowerCase();
    if (seenNames.has(lowerName)) {
      throw new Error(`Duplicate material "${name}" in BOM. Each material name must be unique.`);
    }
    seenNames.add(lowerName);

    cleanedItems.push({
      material_name: name,
      quantity_per_device: qtyPerDevice,
      unit,
      sort_order: it.sort_order !== undefined ? Number(it.sort_order) : i + 1,
    });
  }

  const existing = await getBomByDeviceType(normalizedType);
  const nextVersion = existing ? (existing.version || 1) + 1 : 1;
  const bomId = existing?.id || `bom-${Date.now()}`;

  const bomPayload = {
    device_type: normalizedType,
    version: nextVersion,
    is_configured: Boolean(is_configured),
    notes: notes ? notes.trim() : `Updated to version ${nextVersion} by ${user?.email || 'Store Manager'}`,
    updated_by: user?.id || null,
    updated_at: new Date().toISOString(),
  };

  let savedBomId = bomId;

  // Supabase DB transaction / upsert
  try {
    let dbBom;
    if (existing?.id && !existing.id.startsWith('bom-')) {
      const { data, error } = await supabase
        .from('device_boms')
        .update(bomPayload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      dbBom = data;
      savedBomId = dbBom.id;
    } else {
      const { data, error } = await supabase
        .from('device_boms')
        .upsert({ ...bomPayload, created_by: user?.id || null }, { onConflict: 'device_type' })
        .select()
        .single();
      if (error) throw error;
      dbBom = data;
      savedBomId = dbBom.id;
    }

    // Replace items
    await supabase.from('bom_items').delete().eq('bom_id', savedBomId);

    if (cleanedItems.length > 0) {
      const itemsToInsert = cleanedItems.map((item) => ({
        bom_id: savedBomId,
        material_name: item.material_name,
        quantity_per_device: item.quantity_per_device,
        unit: item.unit,
        sort_order: item.sort_order,
      }));

      const { error: itemsError } = await supabase.from('bom_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;
    }
  } catch (dbErr) {
    console.warn(`Supabase update error for BOM (${normalizedType}), falling back to in-memory store:`, dbErr.message);
  }

  // Update in-memory fallback
  const memoryBom = {
    id: savedBomId,
    device_type: normalizedType,
    version: nextVersion,
    is_configured: Boolean(is_configured),
    notes: bomPayload.notes,
    updated_at: new Date().toISOString(),
    items: cleanedItems.map((item, idx) => ({
      id: `bom-item-${savedBomId}-${idx + 1}`,
      bom_id: savedBomId,
      ...item,
    })),
  };

  inMemoryBoms.set(normalizedType, memoryBom);

  // Also ensure new materials are added to material_inventory if not already present
  try {
    for (const item of cleanedItems) {
      await supabase
        .from('material_inventory')
        .insert({
          material_name: item.material_name,
          unit: item.unit,
          current_stock: 500,
          min_stock_level: 20,
        })
        .select()
        .maybeSingle()
        .catch(() => null);
    }
  } catch (matErr) {
    // Ignore duplicate conflict
  }

  // Audit log
  if (user) {
    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'UPDATE_DEVICE_BOM',
      target_table: 'device_boms',
      target_id: savedBomId,
      details: {
        device_type: normalizedType,
        version: nextVersion,
        materials_count: cleanedItems.length,
        items: cleanedItems,
      },
    }).catch((e) => console.warn('Audit log failed for BOM update:', e.message));
  }

  return memoryBom;
}

/**
 * Reset a device type's BOM to the standard initial template
 */
export async function resetBomToTemplate(deviceType, user) {
  return await updateDeviceBom(deviceType, {
    items: INITIAL_BOM_TEMPLATE,
    notes: 'Reset to standard initial BOM configuration',
    is_configured: true,
    user,
  });
}

/**
 * Review which BOM version was used for installation checklists
 */
export async function getChecklistBomHistory(params = {}) {
  const { deviceType = '', search = '', limit = 50, page = 1 } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('installation_checklists')
      .select('id, checklist_number, client_name, client_mobile, client_location, device_type, number_of_devices, number_of_vehicles, device_configurations, bom_snapshot, material_issuance_status, material_issued_at, created_at, installation_status, installation_or_service', { count: 'exact' })
      .eq('installation_or_service', 'Installation')
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (deviceType) {
      query = query.eq('device_type', deviceType);
    }

    if (search && search.trim()) {
      const s = search.trim();
      query = query.or(`checklist_number.ilike.%${s}%,client_name.ilike.%${s}%`);
    }

    const { data, count, error } = await query;
    if (!error && data) {
      return {
        checklists: data.map((c) => ({
          ...c,
          bom_version_used: c.bom_snapshot?.bom_version || (c.bom_snapshot?.device_configurations?.[0]?.bom_version ? 'v' + c.bom_snapshot.device_configurations[0].bom_version : 'N/A'),
          bom_items_count: Array.isArray(c.bom_snapshot?.items) ? c.bom_snapshot.items.length : 0,
        })),
        totalCount: count || data.length,
        page: pageNum,
        totalPages: Math.ceil((count || data.length) / limitNum) || 1,
      };
    }
  } catch (err) {
    console.warn('DB checklist BOM history query failed:', err.message);
  }

  return {
    checklists: [],
    totalCount: 0,
    page: 1,
    totalPages: 1,
  };
}
