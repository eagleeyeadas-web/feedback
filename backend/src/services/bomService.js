import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { STANDARD_MATERIALS, getMaterialInventory } from './materialStockService.js';

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
  { material_id: 'mat-001', material_name: 'Insulation Tape', quantity_per_device: 2, unit: 'Nos.', sort_order: 1 },
  { material_id: 'mat-002', material_name: 'Cable Tie – 200 mm', quantity_per_device: 1, unit: 'Packet', sort_order: 2 },
  { material_id: 'mat-003', material_name: 'Cable Tie – 300 mm', quantity_per_device: 1, unit: 'Packet', sort_order: 3 },
  { material_id: 'mat-004', material_name: 'Long Screw', quantity_per_device: 12, unit: 'Nos.', sort_order: 4 },
  { material_id: 'mat-005', material_name: 'Small Screw', quantity_per_device: 12, unit: 'Nos.', sort_order: 5 },
  { material_id: 'mat-006', material_name: 'Memory Card', quantity_per_device: 1, unit: 'No.', sort_order: 6 },
  { material_id: 'mat-007', material_name: '0.5 mm Wire', quantity_per_device: 20, unit: 'Metres', sort_order: 7 },
  { material_id: 'mat-008', material_name: '5-metre Cable', quantity_per_device: 3, unit: 'Nos.', sort_order: 8 },
  { material_id: 'mat-009', material_name: '15-metre Cable', quantity_per_device: 1, unit: 'No.', sort_order: 9 },
];

export const COMMON_UNITS = [
  'Nos.',
  'Packet',
  'Packets',
  'No.',
  'Metres',
  'Roll',
  'Box',
  'Kg',
  'Set',
  'Piece',
];

/**
 * Normalizes units to check compatibility (e.g. 'Packets' vs 'Packet', 'Nos.' vs 'No.')
 * Prevents converting packets into pieces or metres into pieces!
 */
export function areUnitsCompatible(unit1, unit2) {
  if (!unit1 || !unit2) return false;
  const u1 = unit1.trim().toLowerCase();
  const u2 = unit2.trim().toLowerCase();
  if (u1 === u2) return true;
  if ((u1 === 'packet' || u1 === 'packets') && (u2 === 'packet' || u2 === 'packets')) return true;
  if ((u1 === 'no.' || u1 === 'nos.' || u1 === 'no' || u1 === 'nos') && (u2 === 'no.' || u2 === 'nos.' || u2 === 'no' || u2 === 'nos')) return true;
  if ((u1 === 'piece' || u1 === 'pieces') && (u2 === 'piece' || u2 === 'pieces')) return true;
  return false;
}

/**
 * Resilient in-memory fallback store
 * Initialized with material_id references to STANDARD_MATERIALS
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
        material_id: item.material_id,
        material_name: item.material_name,
        quantity_per_device: item.quantity_per_device,
        unit: item.unit,
        sort_order: item.sort_order,
      })),
    },
  ])
);

let bomsDbSeeded = false;

/**
 * Seed BOM templates into Supabase if not already present
 */
async function ensureDbBomsSeeded() {
  if (bomsDbSeeded) return;
  try {
    const { data: dbBoms, error } = await supabase
      .from('device_boms')
      .select('id, device_type');

    if (!error && Array.isArray(dbBoms)) {
      const existingTypes = new Set(dbBoms.map((b) => b.device_type));
      const missingTypes = STANDARD_DEVICE_TYPES.filter((t) => !existingTypes.has(t));

      if (missingTypes.length > 0) {
        // Fetch materials to map material_id
        const { data: dbMats } = await supabase.from('material_inventory').select('id, material_name, unit');
        const matMap = new Map((dbMats || []).map((m) => [m.material_name.toLowerCase(), m]));

        for (const mType of missingTypes) {
          const { data: newBom } = await supabase
            .from('device_boms')
            .insert({
              device_type: mType,
              version: 1,
              is_configured: true,
              notes: 'Initial business-confirmed BOM configuration',
            })
            .select()
            .single();

          if (newBom) {
            const bomItemsToInsert = INITIAL_BOM_TEMPLATE.map((item) => {
              const matchedMat = matMap.get(item.material_name.toLowerCase());
              return {
                bom_id: newBom.id,
                material_id: matchedMat?.id || null,
                material_name: item.material_name,
                quantity_per_device: item.quantity_per_device,
                unit: item.unit,
                sort_order: item.sort_order,
              };
            });
            await supabase.from('bom_items').insert(bomItemsToInsert);
          }
        }
      }
      bomsDbSeeded = true;
    }
  } catch (err) {
    // Database table might not be migrated yet
  }
}

/**
 * Get all BOMs grouped with their items and inventory product IDs
 */
export async function getAllBoms() {
  await ensureDbBomsSeeded();

  try {
    const { data: dbBoms, error: bomsError } = await supabase
      .from('device_boms')
      .select('*, items:bom_items(*)')
      .order('device_type', { ascending: true });

    if (!bomsError && dbBoms && dbBoms.length > 0) {
      // Also fetch materials map to guarantee material_id is enriched
      const materials = await getMaterialInventory().catch(() => []);
      const matNameMap = new Map(materials.map((m) => [m.material_name.toLowerCase(), m]));

      dbBoms.forEach((b) => {
        const sortedItems = (b.items || [])
          .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0))
          .map((item) => {
            const matched = matNameMap.get((item.material_name || '').toLowerCase());
            return {
              ...item,
              material_id: item.material_id || matched?.id || null,
              material_sku: matched?.sku || null,
              inventory_stock: matched ? Number(matched.current_stock) || 0 : 0,
            };
          });

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
      const materials = await getMaterialInventory().catch(() => []);
      const matNameMap = new Map(materials.map((m) => [m.material_name.toLowerCase(), m]));

      const sortedItems = (dbBom.items || [])
        .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0))
        .map((item) => {
          const matched = matNameMap.get((item.material_name || '').toLowerCase());
          return {
            ...item,
            material_id: item.material_id || matched?.id || null,
            material_sku: matched?.sku || null,
            inventory_stock: matched ? Number(matched.current_stock) || 0 : 0,
          };
        });

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
 * Combines shared material requirements for multiple camera device types in the same job.
 * Uses inventory product IDs (`material_id`) and validates units without conversion.
 */
export async function calculateBomRequirements(param1, param2) {
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

  // Load authoritative materials to verify product IDs and units
  const materials = await getMaterialInventory();
  const matNameMap = new Map(materials.map((m) => [m.material_name.toLowerCase(), m]));
  const matIdMap = new Map(materials.map((m) => [m.id, m]));

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
      const matchedMat = (it.material_id && matIdMap.get(it.material_id)) || matNameMap.get((it.material_name || '').toLowerCase());
      const effectiveMatId = it.material_id || matchedMat?.id || null;

      // Validate unit matches inventory unit
      const inventoryUnit = matchedMat?.unit || it.unit;
      if (!areUnitsCompatible(it.unit, inventoryUnit)) {
        console.warn(`Unit warning: BOM item "${it.material_name}" uses "${it.unit}" but inventory specifies "${inventoryUnit}".`);
      }

      return {
        id: it.id,
        material_id: effectiveMatId,
        material_sku: matchedMat?.sku || null,
        material_name: it.material_name,
        quantity_per_device: perDevice,
        number_of_devices: qty,
        total_quantity: subtotal,
        unit: it.unit,
        inventory_unit: inventoryUnit,
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

    // Merge into combined materials by material_id (or normalized name as fallback)
    for (const item of deviceItems) {
      const key = item.material_id
        ? `id:${item.material_id}`
        : `name:${item.material_name.toLowerCase().trim()}`;

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
          material_id: item.material_id,
          material_sku: item.material_sku,
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

  // If ANY device type is unconfigured, show warning and do not display incomplete calculation as final
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
 * Validates materials, enforces unit matching with inventory, links product IDs,
 * increments version, saves persistently in Supabase, and logs audit record.
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

  // Load active material inventory to validate product IDs and units
  const inventoryMaterials = await getMaterialInventory();
  const matNameMap = new Map(inventoryMaterials.map((m) => [m.material_name.toLowerCase(), m]));
  const matIdMap = new Map(inventoryMaterials.map((m) => [m.id, m]));

  const seenIdsOrNames = new Set();
  const cleanedItems = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const name = (it.material_name || '').trim();
    const qtyPerDevice = parseFloat(it.quantity_per_device);
    let unit = (it.unit || '').trim();
    let matId = it.material_id || null;

    if (!name) {
      throw new Error(`Material at row #${i + 1} has an empty name.`);
    }

    if (isNaN(qtyPerDevice) || qtyPerDevice <= 0) {
      throw new Error(`Material "${name}" must have a positive minimum quantity per device (greater than 0).`);
    }

    // Match inventory product ID
    let invMat = null;
    if (matId && matIdMap.has(matId)) {
      invMat = matIdMap.get(matId);
    } else if (matNameMap.has(name.toLowerCase())) {
      invMat = matNameMap.get(name.toLowerCase());
      matId = invMat.id;
    }

    // Unit validation: BOM unit must match inventory unit
    if (invMat) {
      if (!unit) {
        unit = invMat.unit;
      } else if (!areUnitsCompatible(unit, invMat.unit)) {
        throw new Error(
          `Unit mismatch for material "${name}". Inventory unit is "${invMat.unit}", but BOM specified "${unit}". Units must match without conversion.`
        );
      }
    } else if (!unit) {
      throw new Error(`Material "${name}" must have a unit of measurement.`);
    }

    const uniqueKey = matId ? `id:${matId}` : `name:${name.toLowerCase()}`;
    if (seenIdsOrNames.has(uniqueKey)) {
      throw new Error(`Duplicate material "${name}" in BOM. Each material item must be unique.`);
    }
    seenIdsOrNames.add(uniqueKey);

    cleanedItems.push({
      material_id: matId,
      material_name: invMat?.material_name || name,
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

  // Supabase DB update
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
        material_id: item.material_id && !item.material_id.startsWith('mat-') ? item.material_id : null,
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
        is_configured,
        items_count: cleanedItems.length,
        notes,
      },
    }).catch(() => null);
  }

  return memoryBom;
}

/**
 * Reset a device BOM back to the initial standard template
 */
export async function resetBomToTemplate(deviceType, user) {
  if (!deviceType || !deviceType.trim()) {
    throw new Error('Device type is required.');
  }

  const normalized = deviceType.trim();
  const inventoryMaterials = await getMaterialInventory().catch(() => []);
  const matNameMap = new Map(inventoryMaterials.map((m) => [m.material_name.toLowerCase(), m]));

  const templateWithIds = INITIAL_BOM_TEMPLATE.map((it) => {
    const matched = matNameMap.get(it.material_name.toLowerCase());
    return {
      ...it,
      material_id: matched?.id || it.material_id,
      unit: matched?.unit || it.unit,
    };
  });

  return updateDeviceBom(normalized, {
    items: templateWithIds,
    notes: 'Reset to standard business template',
    is_configured: true,
    user,
  });
}

/**
 * Review BOM snapshots used in past checklists
 */
export async function getChecklistBomHistory(params = {}) {
  const { page = 1, limit = 20, search = '', device_type = '' } = params;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = supabase
      .from('installation_checklists')
      .select('id, checklist_number, client_name, device_type, number_of_devices, installation_or_service, bom_snapshot, material_issuance_status, created_at', { count: 'exact' })
      .eq('installation_or_service', 'Installation')
      .not('bom_snapshot', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (device_type) {
      query = query.ilike('device_type', `%${device_type}%`);
    }

    if (search && search.trim()) {
      query = query.or(`checklist_number.ilike.%${search}%,client_name.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (!error && data) {
      return {
        history: data,
        totalCount: count || data.length,
        page: pageNum,
        totalPages: Math.ceil((count || data.length) / limitNum) || 1,
      };
    }
  } catch (err) {
    console.warn('DB bom history fetch failed:', err.message);
  }

  return {
    history: [],
    totalCount: 0,
    page: pageNum,
    totalPages: 1,
  };
}
