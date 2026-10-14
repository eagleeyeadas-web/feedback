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
  { material_id: 'mat-002', material_name: 'Cable Tie – 200 mm', quantity_per_device: 1, unit: 'Packets', sort_order: 2 },
  { material_id: 'mat-003', material_name: 'Cable Tie – 300 mm', quantity_per_device: 1, unit: 'Packets', sort_order: 3 },
  { material_id: 'mat-004', material_name: 'Long Screw', quantity_per_device: 12, unit: 'Nos.', sort_order: 4 },
  { material_id: 'mat-005', material_name: 'Small Screw', quantity_per_device: 12, unit: 'Nos.', sort_order: 5 },
  { material_id: 'mat-006', material_name: 'Memory Card', quantity_per_device: 1, unit: 'Nos.', sort_order: 6 },
  { material_id: 'mat-007', material_name: '0.5 mm Wire', quantity_per_device: 20, unit: 'Metres', sort_order: 7 },
  { material_id: 'mat-008', material_name: '5-metre Cable', quantity_per_device: 3, unit: 'Nos.', sort_order: 8 },
  { material_id: 'mat-009', material_name: '15-metre Cable', quantity_per_device: 1, unit: 'Nos.', sort_order: 9 },
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
 * Normalizes device type name to canonical standard name (case-insensitive)
 */
export function normalizeDeviceTypeName(name) {
  if (!name || typeof name !== 'string') return '';
  const clean = name.trim();
  const matched = STANDARD_DEVICE_TYPES.find(
    (t) => t.toLowerCase() === clean.toLowerCase()
  );
  return matched || clean;
}

/**
 * Robustly parses and normalizes device configurations from:
 * - Array of configuration objects
 * - Single checklist or requirement object
 * - Summary strings like "4 Channel Live (2), 8 Channel Live (1)"
 * - Single device type strings
 * Normalizes device names, extracts counts, and aggregates duplicates.
 */
export function parseDeviceConfigurations(input, defaultQty = 1, defaultVehicles = 1) {
  if (!input) return [];

  let rawList = [];
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'object') {
    if (Array.isArray(input.device_configurations) && input.device_configurations.length > 0) {
      rawList = input.device_configurations;
    } else if (Array.isArray(input.devices_carried) && input.devices_carried.length > 0) {
      rawList = input.devices_carried;
    } else if (Array.isArray(input.device_items) && input.device_items.length > 0) {
      rawList = input.device_items.map((d) => ({
        device_type: d.device_type,
        quantity_carried: d.quantity_carried || d.required_quantity || d.number_of_devices || defaultQty,
        number_of_devices: d.required_quantity || d.quantity_carried || d.number_of_devices || defaultQty,
        number_of_vehicles: d.number_of_vehicles || defaultVehicles,
      }));
    } else if (input.device_type) {
      const q = input.quantity_carried || input.number_of_devices || defaultQty;
      rawList = [{
        device_type: input.device_type,
        quantity_carried: q,
        number_of_devices: q,
        number_of_vehicles: input.number_of_vehicles || defaultVehicles,
      }];
    }
  } else if (typeof input === 'string') {
    rawList = [{
      device_type: input,
      quantity_carried: defaultQty,
      number_of_devices: defaultQty,
      number_of_vehicles: defaultVehicles,
    }];
  }

  const parsedItems = [];

  for (const item of rawList) {
    const rawType = (typeof item === 'string' ? item : (item.device_type || '')).trim();
    if (!rawType) continue;

    const itemQty = Number(item.quantity_carried) || Number(item.number_of_devices) || defaultQty || 1;
    const itemVeh = Number(item.number_of_vehicles) || defaultVehicles || itemQty;

    // Check if rawType is a composite string containing multiple device types separated by comma or semicolon
    const parts = rawType.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);

    if (parts.length > 1) {
      for (const p of parts) {
        // e.g. "4 Channel Live (2)" or "4 Channel Live x 2" or "4 Channel Live - 2"
        const qtyMatch = p.match(/\((\d+)(?:\s*devices?)?\)/i) || p.match(/(?:x|[:\-])\s*(\d+)/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        const nameClean = p.replace(/\(.*?\)/g, '').replace(/(?:x|[:\-])\s*\d+/gi, '').trim();
        if (nameClean) {
          const finalQty = Math.max(1, isNaN(qty) ? 1 : qty);
          parsedItems.push({
            device_type: normalizeDeviceTypeName(nameClean),
            quantity_carried: finalQty,
            number_of_devices: finalQty,
            number_of_vehicles: finalQty,
          });
        }
      }
    } else if (parts.length === 1) {
      const p = parts[0];
      const qtyMatch = p.match(/\((\d+)(?:\s*devices?)?\)/i) || p.match(/(?:x|[:\-])\s*(\d+)/i);
      const nameClean = p.replace(/\(.*?\)/g, '').replace(/(?:x|[:\-])\s*\d+/gi, '').trim();
      const extractedQty = qtyMatch ? parseInt(qtyMatch[1], 10) : itemQty;
      const finalQty = Math.max(1, isNaN(extractedQty) ? 1 : extractedQty);

      parsedItems.push({
        device_type: normalizeDeviceTypeName(nameClean || p),
        quantity_carried: finalQty,
        number_of_devices: finalQty,
        number_of_vehicles: Math.max(1, isNaN(itemVeh) ? 1 : itemVeh),
      });
    }
  }

  // Combine duplicate device types into single aggregated rows
  const combined = new Map();
  for (const item of parsedItems) {
    const dt = normalizeDeviceTypeName(item.device_type);
    if (!dt) continue;

    if (combined.has(dt)) {
      const ex = combined.get(dt);
      ex.quantity_carried += item.number_of_devices;
      ex.number_of_devices += item.number_of_devices;
      ex.number_of_vehicles += item.number_of_vehicles;
    } else {
      combined.set(dt, {
        device_type: dt,
        quantity_carried: item.number_of_devices,
        number_of_devices: item.number_of_devices,
        number_of_vehicles: item.number_of_vehicles,
      });
    }
  }

  return Array.from(combined.values());
}

/**
 * Robustly parses and normalizes extra devices carried from:
 * - Array of extra device configuration objects [{ device_type, extra_quantity }]
 * - Object with extra_device_configurations
 * - Object with extra_device_type string and extra_device_count number
 * - Composite extra device string e.g. "4 Channel Live (2), 8 Channel Live (1)"
 */
export function parseExtraDeviceConfigurations(input) {
  if (!input) return [];

  let rawList = [];
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'object') {
    if (Array.isArray(input.extra_device_configurations) && input.extra_device_configurations.length > 0) {
      rawList = input.extra_device_configurations;
    } else if (input.extra_devices && input.extra_device_type) {
      rawList = [{
        device_type: input.extra_device_type,
        extra_quantity: Number(input.extra_device_count) || 1,
      }];
    }
  } else if (typeof input === 'string') {
    rawList = [{ device_type: input, extra_quantity: 1 }];
  }

  const parsedItems = [];
  for (const item of rawList) {
    const rawType = (typeof item === 'string' ? item : (item.device_type || '')).trim();
    if (!rawType) continue;

    const itemQty = Number(item.extra_quantity) || Number(item.quantity) || Number(item.count) || Number(item.number_of_devices) || 1;
    const parts = rawType.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);

    if (parts.length > 1) {
      for (const p of parts) {
        const qtyMatch = p.match(/\((\d+)(?:\s*devices?)?\)/i) || p.match(/(?:x|[:\-])\s*(\d+)/i);
        const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
        const nameClean = p.replace(/\(.*?\)/g, '').replace(/(?:x|[:\-])\s*\d+/gi, '').trim();
        if (nameClean) {
          const finalQty = Math.max(1, isNaN(qty) ? 1 : qty);
          parsedItems.push({
            device_type: normalizeDeviceTypeName(nameClean),
            extra_quantity: finalQty,
          });
        }
      }
    } else if (parts.length === 1) {
      const p = parts[0];
      const qtyMatch = p.match(/\((\d+)(?:\s*devices?)?\)/i) || p.match(/(?:x|[:\-])\s*(\d+)/i);
      const nameClean = p.replace(/\(.*?\)/g, '').replace(/(?:x|[:\-])\s*\d+/gi, '').trim();
      const extractedQty = qtyMatch ? parseInt(qtyMatch[1], 10) : itemQty;
      const finalQty = Math.max(1, isNaN(extractedQty) ? 1 : extractedQty);

      parsedItems.push({
        device_type: normalizeDeviceTypeName(nameClean || p),
        extra_quantity: finalQty,
      });
    }
  }

  // Combine duplicate extra device types into single aggregated rows
  const combined = new Map();
  for (const item of parsedItems) {
    const dt = normalizeDeviceTypeName(item.device_type);
    if (!dt) continue;

    if (combined.has(dt)) {
      const ex = combined.get(dt);
      ex.extra_quantity += item.extra_quantity;
    } else {
      combined.set(dt, {
        device_type: dt,
        extra_quantity: item.extra_quantity,
      });
    }
  }

  return Array.from(combined.values());
}

/**
 * Combines required installation devices and extra backup devices into an authoritative allocation list
 * Calculates required_quantity, extra_quantity, and total quantity_carried for each device type without double-counting.
 */
export function combineCarriedDevicesAllocation(requiredConfigs = [], extraConfigs = []) {
  const map = new Map();

  for (const r of requiredConfigs) {
    const dt = normalizeDeviceTypeName(r.device_type);
    if (!dt) continue;
    const reqQty = Number(r.number_of_devices) || Number(r.quantity_carried) || 1;
    if (map.has(dt)) {
      const item = map.get(dt);
      item.required_quantity += reqQty;
      item.quantity_carried += reqQty;
    } else {
      map.set(dt, {
        device_type: dt,
        required_quantity: reqQty,
        extra_quantity: 0,
        quantity_carried: reqQty,
      });
    }
  }

  for (const e of extraConfigs) {
    const dt = normalizeDeviceTypeName(e.device_type);
    if (!dt) continue;
    const extraQty = Number(e.extra_quantity) || Number(e.quantity) || 1;
    if (map.has(dt)) {
      const item = map.get(dt);
      item.extra_quantity += extraQty;
      item.quantity_carried += extraQty;
    } else {
      map.set(dt, {
        device_type: dt,
        required_quantity: 0,
        extra_quantity: extraQty,
        quantity_carried: extraQty,
      });
    }
  }

  return Array.from(map.values());
}

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
 * Returns default BOM template items for a device type.
 * Requirement: 8 Channel Live does not require a Memory Card for installation.
 */
export function getInitialBomTemplateForDevice(deviceType) {
  const is8ChannelLive = (deviceType || '').trim().toLowerCase() === '8 channel live';
  if (is8ChannelLive) {
    return INITIAL_BOM_TEMPLATE.filter(
      (item) => (item.material_name || '').toLowerCase() !== 'memory card'
    );
  }
  return INITIAL_BOM_TEMPLATE;
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
      items: getInitialBomTemplateForDevice(type).map((item, itemIdx) => ({
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
 * Idempotent: Does not duplicate products, preserves customizations.
 */
async function ensureDbBomsSeeded() {
  if (bomsDbSeeded) return;
  try {
    const { data: dbBoms, error } = await supabase
      .from('device_boms')
      .select('id, device_type, items:bom_items(id, material_name)');

    if (!error && Array.isArray(dbBoms)) {
      // Fetch materials to map material_id
      const { data: dbMats } = await supabase.from('material_inventory').select('id, material_name, unit');
      const matMap = new Map((dbMats || []).map((m) => [m.material_name.toLowerCase(), m]));

      const existingMap = new Map(dbBoms.map((b) => [b.device_type.toLowerCase(), b]));

      for (const mType of STANDARD_DEVICE_TYPES) {
        let bomRec = existingMap.get(mType.toLowerCase());

        if (!bomRec) {
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
          bomRec = newBom;
        }

        if (bomRec && (!bomRec.items || bomRec.items.length === 0)) {
          const bomItemsToInsert = getInitialBomTemplateForDevice(mType).map((item) => {
            const matchedMat = matMap.get(item.material_name.toLowerCase());
            return {
              bom_id: bomRec.id,
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

      // Ensure 8 Channel Live in DB does not contain Memory Card
      const eightLiveBom = dbBoms.find((b) => (b.device_type || '').toLowerCase() === '8 channel live');
      if (eightLiveBom) {
        await supabase
          .from('bom_items')
          .delete()
          .eq('bom_id', eightLiveBom.id)
          .ilike('material_name', '%memory card%')
          .catch(() => null);
      }

      bomsDbSeeded = true;
    }
  } catch (err) {
    // Database table might not be migrated yet - inMemoryBoms is used
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
      const materials = await getMaterialInventory().catch(() => []);
      const matNameMap = new Map(materials.map((m) => [m.material_name.toLowerCase(), m]));

      dbBoms.forEach((b) => {
        const is8Channel = (b.device_type || '').trim().toLowerCase() === '8 channel live';
        const sortedItems = (b.items || [])
          .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0))
          .filter((item) => {
            if (is8Channel && (item.material_name || '').toLowerCase().includes('memory card')) {
              return false;
            }
            return true;
          })
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
 * Get a single BOM by device type (case-insensitive, trimmed)
 */
export async function getBomByDeviceType(deviceType) {
  if (!deviceType) return null;
  const normalized = normalizeDeviceTypeName(deviceType);
  const is8Channel = normalized.toLowerCase() === '8 channel live';

  try {
    const { data: dbBom, error } = await supabase
      .from('device_boms')
      .select('*, items:bom_items(*)')
      .ilike('device_type', normalized)
      .maybeSingle();

    if (!error && dbBom && Array.isArray(dbBom.items) && dbBom.items.length > 0) {
      const materials = await getMaterialInventory().catch(() => []);
      const matNameMap = new Map(materials.map((m) => [m.material_name.toLowerCase(), m]));

      const sortedItems = (dbBom.items || [])
        .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0))
        .filter((item) => {
          if (is8Channel && (item.material_name || '').toLowerCase().includes('memory card')) {
            return false;
          }
          return true;
        })
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

  // Lookup in inMemoryBoms case-insensitively
  for (const [key, memBom] of inMemoryBoms.entries()) {
    if (key.toLowerCase() === normalized.toLowerCase()) {
      if (is8Channel) {
        return {
          ...memBom,
          items: (memBom.items || []).filter((item) => !(item.material_name || '').toLowerCase().includes('memory card')),
        };
      }
      return memBom;
    }
  }

  return null;
}

/**
 * Live BOM calculation:
 * Total required quantity = configured BOM quantity per device * number of devices
 * Combines shared material requirements for multiple camera device types in the same job.
 * Uses inventory product IDs (`material_id`) and validates units without conversion.
 * Excludes Memory Card entirely for 8 Channel Live.
 */
export async function calculateBomRequirements(param1, param2) {
  const normalizedConfigs = parseDeviceConfigurations(param1, param2, param2);

  if (normalizedConfigs.length === 0) {
    return {
      configured: false,
      warning: 'At least one valid device configuration is required.',
      device_configurations: [],
      items: [],
      total_devices: 0,
      total_vehicles: 0,
    };
  }

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

    const is8Channel = (c.device_type || '').trim().toLowerCase() === '8 channel live';

    const deviceItems = (bom.items || [])
      .filter((it) => {
        // Requirement: 8 Channel Live does not require a Memory Card for installation
        if (is8Channel && (it.material_name || '').toLowerCase().includes('memory card')) {
          return false;
        }
        return true;
      })
      .map((it) => {
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

  const combinedItems = Array.from(combinedMaterialsMap.values())
    .filter((it) => it.total_quantity > 0)
    .sort((a, b) => {
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
 * Priority 2: Calculate Preliminary BOM for All Devices Carried
 * Calculates:
 * 1. BOM for required devices
 * 2. BOM for extra devices
 * 3. Combined preliminary BOM for all devices carried (required + extra)
 * Preserves 8 Channel Live Memory Card exclusion.
 * Extra devices are included in the combined material planning.
 */
export async function calculateJobPreliminaryBom({ requiredConfigs = [], extraConfigs = [] }) {
  const parsedRequired = parseDeviceConfigurations(requiredConfigs);
  const parsedExtra = parseExtraDeviceConfigurations(extraConfigs);

  // 1. Calculate Required Devices BOM (Strict Sales Preliminary BOM)
  let requiredBom = null;
  if (parsedRequired.length > 0) {
    try {
      requiredBom = await calculateBomRequirements(parsedRequired);
    } catch (e) {
      console.warn('Could not calculate required BOM:', e.message);
    }
  }

  // 2. Extra items do not increase Sales BOM
  let extraBom = null;
  if (parsedExtra.length > 0) {
    try {
      const extraAsDeviceConfigs = parsedExtra.map((e) => ({
        device_type: e.device_type,
        number_of_devices: Number(e.extra_quantity) || 1,
        number_of_vehicles: Number(e.extra_quantity) || 1,
      }));
      extraBom = await calculateBomRequirements(extraAsDeviceConfigs);
    } catch (e) {
      console.warn('Could not calculate extra BOM:', e.message);
    }
  }

  const combinedAllocations = combineCarriedDevicesAllocation(parsedRequired, parsedExtra);

  const totalRequired = parsedRequired.reduce((sum, c) => sum + (Number(c.number_of_devices) || 0), 0);
  const totalExtra = parsedExtra.reduce((sum, c) => sum + (Number(c.extra_quantity) || 0), 0);
  const totalCarried = totalRequired + totalExtra;

  // Preliminary BOM is strictly derived from required installation devices
  const baseResult = requiredBom || {
    configured: false,
    warning: 'No BOM calculation available',
    items: [],
  };

  return {
    ...baseResult,
    configured: baseResult.configured,
    total_devices_required: totalRequired,
    total_extra_devices: totalExtra,
    total_devices_carried: totalCarried,
    required_devices_count: totalRequired,
    extra_devices_count: totalExtra,
    required_device_configurations: parsedRequired,
    extra_device_configurations: parsedExtra,
    combined_allocations: combinedAllocations,
    required_bom: requiredBom,
    extra_bom: extraBom,
    combined_preliminary_bom: requiredBom,
    // Sales preliminary BOM items strictly derived from required installation devices only
    items: requiredBom?.items || [],
    calculated_at: new Date().toISOString(),
  };
}

/**
 * Priority 2: Calculate Final BOM for Devices Actually Installed
 * Formula: Final BOM = Sum of (actual installed quantity for each device type × configured BOM quantity per device type)
 * Includes extra devices that were installed.
 * Excludes unused extra devices.
 * Compares Preliminary BOM vs Final BOM requirements, plus actual materials issued, used, and returned.
 */
export async function calculateJobFinalBom({
  installedDeviceConfigs = [],
  preliminaryBomSnapshot = null,
  actualMaterialsIssued = [],
  actualMaterialsUsed = [],
  actualMaterialsReturned = [],
}) {
  const parsedInstalled = parseDeviceConfigurations(installedDeviceConfigs);

  let finalBom = null;
  if (parsedInstalled.length > 0) {
    finalBom = await calculateBomRequirements(parsedInstalled);
  } else {
    finalBom = {
      configured: true,
      items: [],
      total_devices: 0,
      total_materials_count: 0,
      device_configurations: [],
    };
  }

  // Build comparison between preliminary BOM and final BOM
  const comparisonMap = new Map();

  const getMatKey = (item) => {
    return (item.material_name || '').toLowerCase().trim();
  };

  // 1. Add preliminary BOM items (baseline for all carried devices)
  const prelimItems = preliminaryBomSnapshot?.items || [];
  for (const it of prelimItems) {
    const key = getMatKey(it);
    comparisonMap.set(key, {
      material_id: it.material_id || null,
      material_sku: it.material_sku || null,
      material_name: it.material_name,
      unit: it.unit || 'Nos.',
      preliminary_quantity: Number(it.total_quantity) || 0,
      final_quantity: 0,
      difference: 0,
      actual_issued: 0,
      actual_used: 0,
      actual_returned: 0,
      status: 'MATCHED',
    });
  }

  // 2. Add final BOM items (for installed devices)
  const finalItems = finalBom?.items || [];
  for (const it of finalItems) {
    const key = getMatKey(it);
    const finalQty = Number(it.total_quantity) || 0;
    if (comparisonMap.has(key)) {
      const entry = comparisonMap.get(key);
      entry.final_quantity = finalQty;
      if (!entry.material_id && it.material_id) entry.material_id = it.material_id;
      if (!entry.material_sku && it.material_sku) entry.material_sku = it.material_sku;
    } else {
      comparisonMap.set(key, {
        material_id: it.material_id || null,
        material_sku: it.material_sku || null,
        material_name: it.material_name,
        unit: it.unit || 'Nos.',
        preliminary_quantity: 0,
        final_quantity: finalQty,
        difference: 0,
        actual_issued: 0,
        actual_used: 0,
        actual_returned: 0,
        status: 'NEW_IN_FINAL',
      });
    }
  }

  // 3. Map actual materials issued
  for (const m of (actualMaterialsIssued || [])) {
    const key = getMatKey(m);
    const issuedQty = Number(m.issued_quantity ?? m.quantity_issued ?? m.quantity) || 0;
    if (comparisonMap.has(key)) {
      comparisonMap.get(key).actual_issued = issuedQty;
    } else if (issuedQty > 0) {
      comparisonMap.set(key, {
        material_id: m.material_id || null,
        material_sku: m.material_sku || null,
        material_name: m.material_name,
        unit: m.unit || 'Nos.',
        preliminary_quantity: 0,
        final_quantity: 0,
        difference: 0,
        actual_issued: issuedQty,
        actual_used: 0,
        actual_returned: 0,
        status: 'ISSUED_ONLY',
      });
    }
  }

  // 4. Map actual materials used
  for (const m of (actualMaterialsUsed || [])) {
    const key = getMatKey(m);
    const usedQty = Number(m.quantity_used ?? m.used_quantity ?? m.quantity) || 0;
    if (comparisonMap.has(key)) {
      comparisonMap.get(key).actual_used = usedQty;
    } else if (usedQty > 0) {
      comparisonMap.set(key, {
        material_id: m.material_id || null,
        material_sku: m.material_sku || null,
        material_name: m.material_name,
        unit: m.unit || 'Nos.',
        preliminary_quantity: 0,
        final_quantity: 0,
        difference: 0,
        actual_issued: 0,
        actual_used: usedQty,
        actual_returned: 0,
        status: 'USED_EXTRA',
      });
    }
  }

  // 5. Map actual materials returned
  for (const m of (actualMaterialsReturned || [])) {
    const key = getMatKey(m);
    const retQty = Number(m.quantity_returned ?? m.returned_quantity ?? m.declared_return_qty ?? m.quantity) || 0;
    if (comparisonMap.has(key)) {
      comparisonMap.get(key).actual_returned = retQty;
    } else if (retQty > 0) {
      comparisonMap.set(key, {
        material_id: m.material_id || null,
        material_sku: m.material_sku || null,
        material_name: m.material_name,
        unit: m.unit || 'Nos.',
        preliminary_quantity: 0,
        final_quantity: 0,
        difference: 0,
        actual_issued: 0,
        actual_used: 0,
        actual_returned: retQty,
        status: 'RETURNED_EXTRA',
      });
    }
  }

  // 6. Compute difference for each row: final_quantity - preliminary_quantity
  const comparisonList = Array.from(comparisonMap.values()).map((row) => {
    const diff = Math.round((row.final_quantity - row.preliminary_quantity) * 100) / 100;
    return {
      ...row,
      difference: diff,
      variance_label: diff === 0 ? 'Equal' : (diff > 0 ? `+${diff}` : `${diff}`),
    };
  });

  const totalInstalled = parsedInstalled.reduce((sum, c) => sum + (Number(c.number_of_devices) || 0), 0);

  return {
    configured: finalBom?.configured !== false,
    installed_device_configurations: parsedInstalled,
    total_devices_installed: totalInstalled,
    final_bom: finalBom,
    items: finalBom?.items || [],
    comparison: comparisonList,
    calculated_at: new Date().toISOString(),
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

    // Requirement: 8 Channel Live does not require a Memory Card for installation
    if (normalizedType.toLowerCase() === '8 channel live' && name.toLowerCase().includes('memory card')) {
      continue;
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

  const template = getInitialBomTemplateForDevice(normalized);
  const templateWithIds = template.map((it) => {
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
