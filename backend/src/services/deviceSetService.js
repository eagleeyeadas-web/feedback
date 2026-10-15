import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { getMaterialInventory } from './materialStockService.js';
import { recordStockMovement } from './stockMovementService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/inventory_storage.json');

/**
 * Authoritative Component Requirements for Standard Camera Device Configurations:
 * - 2 Channel Live: 2 cameras and 1 live display.
 * - 2 Channel Recording: 2 cameras and 1 recording display.
 * - 4 Channel Live: 4 cameras and 1 live display.
 * - 4 Channel Recording: 4 cameras and 1 recording display.
 * - 6 Channel Live: 6 cameras and 1 live display.
 * - 6 Channel Recording: 6 cameras and 1 recording display.
 * - 8 Channel Live: 8 cameras and 1 live display.
 */
export const STANDARD_DEVICE_CONFIGURATIONS = [
  {
    device_type: '2 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 2, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '2 Channel Recording',
    components: [
      { component_name: 'Camera', quantity_required: 2, unit: 'Nos.' },
      { component_name: 'Recording Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '4 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 4, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '4 Channel Recording',
    components: [
      { component_name: 'Camera', quantity_required: 4, unit: 'Nos.' },
      { component_name: 'Recording Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '6 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 6, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '6 Channel Recording',
    components: [
      { component_name: 'Camera', quantity_required: 6, unit: 'Nos.' },
      { component_name: 'Recording Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
  {
    device_type: '8 Channel Live',
    components: [
      { component_name: 'Camera', quantity_required: 8, unit: 'Nos.' },
      { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
    ],
  },
];

/**
 * Resilient in-memory store for device allocations with file-backed persistence
 */
const inMemoryAllocations = [];

/**
 * Load allocations from local JSON fallback storage
 */
export function loadAllocationsStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.deviceStockAllocations)) {
        inMemoryAllocations.length = 0;
        inMemoryAllocations.push(...data.deviceStockAllocations);
      }
    }
  } catch (err) {
    console.warn('Could not load device allocations fallback storage:', err.message);
  }
}

/**
 * Save allocations to local JSON fallback storage
 */
export function saveAllocationsStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let data = {};
    if (fs.existsSync(STORAGE_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf-8')) || {};
      } catch (e) {
        data = {};
      }
    }
    data.deviceStockAllocations = inMemoryAllocations;
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save device allocations fallback storage:', err.message);
  }
}

// Initialize on module load
loadAllocationsStorage();

/**
 * Dynamically resolves component requirements for any device type, supporting
 * the standard configurations plus any custom {N} Channel Live / Recording models.
 */
export function getComponentRequirementsForDevice(deviceType) {
  if (!deviceType || typeof deviceType !== 'string') return [];
  const cleanType = deviceType.trim();

  // 1. Direct match in standard configuration list
  const standard = STANDARD_DEVICE_CONFIGURATIONS.find(
    (c) => c.device_type.toLowerCase() === cleanType.toLowerCase()
  );
  if (standard) {
    return standard.components;
  }

  // 2. Pattern match for custom "{N} Channel Live" or "{N} Channel Recording"
  const channelMatch = cleanType.match(/^(\d+)\s*channel\s*(live|recording)/i);
  if (channelMatch) {
    const numChannels = parseInt(channelMatch[1], 10);
    const isLive = channelMatch[2].toLowerCase() === 'live';
    const displayItem = isLive ? 'Live Display' : 'Recording Display';

    return [
      { component_name: 'Camera', quantity_required: numChannels, unit: 'Nos.' },
      { component_name: displayItem, quantity_required: 1, unit: 'Nos.' },
    ];
  }

  // Fallback: Default to 2 cameras and 1 live display if undefined
  return [
    { component_name: 'Camera', quantity_required: 2, unit: 'Nos.' },
    { component_name: 'Live Display', quantity_required: 1, unit: 'Nos.' },
  ];
}

/**
 * Fetch all device stock allocations from Supabase with local memory fallback
 */
export async function getDeviceStockAllocations() {
  try {
    const { data, error } = await supabase
      .from('device_stock_allocations')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      // Synchronize in-memory cache
      inMemoryAllocations.length = 0;
      inMemoryAllocations.push(...data);
      saveAllocationsStorage();
      return data;
    }
  } catch (err) {
    // Database table might not be migrated yet; fallback to persistent local cache
  }

  return [...inMemoryAllocations];
}

/**
 * Fetch active allocations currently reserving component inventory
 */
export async function getActiveDeviceAllocations() {
  const all = await getDeviceStockAllocations();
  return all.filter((a) => a.status === 'ALLOCATED');
}

/**
 * Core Algorithm: Calculate Device Set Availability from Loose Stock
 *
 * Rules:
 * 1. Physical usable stock is derived strictly from loose components (material_inventory).
 * 2. Active allocations reserve specific component quantities.
 * 3. Unallocated stock = max(0, usable_stock - allocated_stock).
 * 4. For any configuration:
 *    max_possible_sets = min(floor(unallocated_stock[c] / required[c])) for each required component.
 * 5. Maximum estimates are independent and explicitly not simultaneously available.
 */
export async function getCalculatedDeviceAvailability() {
  // 1. Load authoritative loose inventory components
  const materials = await getMaterialInventory();
  const matMap = new Map();
  materials.forEach((m) => {
    matMap.set(m.material_name.toLowerCase(), m);
  });

  // 2. Load active allocations to calculate reserved component stock
  const activeAllocations = await getActiveDeviceAllocations();
  const reservedByComponent = new Map();

  for (const alloc of activeAllocations) {
    const components = Array.isArray(alloc.components_reserved) ? alloc.components_reserved : [];
    for (const comp of components) {
      const cName = (comp.component_name || '').toLowerCase();
      const cur = reservedByComponent.get(cName) || 0;
      reservedByComponent.set(cName, cur + (Number(comp.quantity) || 0));
    }
  }

  // 3. Helper to look up component stock with intelligent generic fallback
  const getComponentStock = (compName) => {
    const key = compName.toLowerCase();
    const item = matMap.get(key);
    let totalUsable = item ? Number(item.current_stock) || 0 : 0;
    const unit = item?.unit || 'Nos.';
    const id = item?.id || null;

    // Backward-compatibility: If Live Display or Recording Display is completely missing from catalogue,
    // check if legacy generic 'Display' exists
    if (!item && (key === 'live display' || key === 'recording display')) {
      const genericDisplay = matMap.get('display');
      if (genericDisplay && Number(genericDisplay.current_stock) > 0) {
        totalUsable = Number(genericDisplay.current_stock) || 0;
      }
    }

    const allocated = reservedByComponent.get(key) || 0;
    const unallocated = Math.max(0, totalUsable - allocated);

    return {
      id,
      name: compName,
      unit,
      total_stock: totalUsable,
      allocated_stock: allocated,
      unallocated_stock: unallocated,
    };
  };

  // Compile core loose components status
  const trackedComponents = ['Camera', 'Live Display', 'Recording Display'];
  const looseComponentsStatus = trackedComponents.map((name) => getComponentStock(name));

  // 4. Calculate for every standard device configuration
  const configurations = STANDARD_DEVICE_CONFIGURATIONS.map((config) => {
    const { device_type, components } = config;
    let maxSets = Infinity;
    let limitingComponent = null;

    const componentBreakdown = components.map((req) => {
      const stock = getComponentStock(req.component_name);
      const reqPerSet = req.quantity_required;
      const setsSupported = Math.floor(stock.unallocated_stock / reqPerSet);

      if (setsSupported < maxSets) {
        maxSets = setsSupported;
        limitingComponent = req.component_name;
      }

      return {
        component_id: stock.id,
        component_name: req.component_name,
        quantity_required_per_set: reqPerSet,
        unit: req.unit || stock.unit,
        total_usable_stock: stock.total_stock,
        allocated_stock: stock.allocated_stock,
        unallocated_available_stock: stock.unallocated_stock,
        sets_supported: setsSupported,
      };
    });

    if (maxSets === Infinity) maxSets = 0;

    // Check current allocations for this specific device type
    const deviceAllocations = activeAllocations.filter(
      (a) => a.device_type.toLowerCase() === device_type.toLowerCase()
    );
    const allocatedSets = deviceAllocations.reduce(
      (sum, a) => sum + (Number(a.allocated_sets) || 0),
      0
    );

    return {
      device_type,
      max_possible_sets: maxSets,
      currently_allocated_sets: allocatedSets,
      allocation_status: allocatedSets > 0 ? 'ALLOCATED' : 'NOT_ALLOCATED',
      limiting_component: maxSets === 0 || limitingComponent ? limitingComponent : null,
      is_available: maxSets > 0,
      components_required: componentBreakdown,
      active_allocations: deviceAllocations,
      notes: 'Independent maximum estimate assuming all available unallocated components are allocated to this model.',
    };
  });

  return {
    configurations,
    loose_components: looseComponentsStatus,
    active_allocations: activeAllocations,
    calculated_at: new Date().toISOString(),
  };
}

// Sequential Promise FIFO Mutex for safe atomic server-side allocation locking
let allocationMutexPromise = Promise.resolve();

function acquireAllocationMutex() {
  let unlock;
  const currentLock = allocationMutexPromise;
  allocationMutexPromise = new Promise((resolve) => {
    unlock = resolve;
  });
  return currentLock.then(() => unlock);
}

/**
 * Controlled Stock Allocation:
 * Reserves loose stock for N sets of a given camera device configuration.
 *
 * Requirements:
 * - Atomic validation: Prevents negative stock and verifies all components.
 * - Prevents concurrent overallocation.
 * - Records full audit and stock movement trail.
 */
export async function allocateDeviceSets({
  device_type,
  sets_to_allocate,
  notes = '',
  checklist_id = null,
  user,
}) {
  const unlock = await acquireAllocationMutex();
  try {
    if (!device_type || typeof device_type !== 'string') {
    throw new Error('Device model / configuration type is required.');
  }

  const numSets = parseInt(sets_to_allocate, 10);
  if (isNaN(numSets) || numSets <= 0) {
    throw new Error('Number of sets to allocate must be a whole number greater than 0.');
  }

  const requirements = getComponentRequirementsForDevice(device_type);
  if (!requirements || requirements.length === 0) {
    throw new Error(`No component configuration rules found for "${device_type}".`);
  }

  // 1. Fetch current availability to validate unallocated component stock
  const currentAvailability = await getCalculatedDeviceAvailability();
  const looseCompMap = new Map(
    currentAvailability.loose_components.map((c) => [c.name.toLowerCase(), c])
  );

  const componentsToReserve = [];

  for (const req of requirements) {
    const compName = req.component_name;
    const requiredTotal = req.quantity_required * numSets;
    const stock = looseCompMap.get(compName.toLowerCase());
    const available = stock ? stock.unallocated_stock : 0;

    if (requiredTotal > available) {
      throw new Error(
        `Insufficient stock: ${numSets} sets of "${device_type}" require ${requiredTotal} ${compName}s, but only ${available} are currently available in unallocated stock.`
      );
    }

    componentsToReserve.push({
      component_name: compName,
      quantity_required_per_set: req.quantity_required,
      quantity: requiredTotal,
      unit: req.unit || 'Nos.',
      component_id: stock?.id || null,
    });
  }

  // 2. Create allocation record
  const allocationId = `alloc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const allocationRecord = {
    id: allocationId,
    device_type: device_type.trim(),
    allocated_sets: numSets,
    components_reserved: componentsToReserve,
    status: 'ALLOCATED',
    checklist_id: checklist_id || null,
    allocated_by: user?.id || null,
    allocator_name: user?.full_name || user?.email || 'Store Manager',
    notes: (notes || '').trim(),
    created_at: new Date().toISOString(),
  };

  // 3. Persist to Supabase with local memory fallback
  try {
    const { data: dbCreated, error } = await supabase
      .from('device_stock_allocations')
      .insert([allocationRecord])
      .select()
      .maybeSingle();

    if (!error && dbCreated) {
      allocationRecord.id = dbCreated.id;
    }
  } catch (err) {
    console.warn('DB device_stock_allocations insert notice, using local cache:', err.message);
  }

  inMemoryAllocations.unshift(allocationRecord);
  saveAllocationsStorage();

  // 4. Record stock movement audit trail for each reserved component
  for (const comp of componentsToReserve) {
    const stock = looseCompMap.get(comp.component_name.toLowerCase());
    await recordStockMovement({
      item_id: comp.component_id,
      item_name: comp.component_name,
      category: 'Camera Device',
      movement_type: 'STOCK_ADJUSTMENT',
      quantity: comp.quantity,
      unit: comp.unit || 'Nos.',
      balance_before: stock?.unallocated_stock,
      balance_after: Math.max(0, (stock?.unallocated_stock || 0) - comp.quantity),
      performed_by: user?.id,
      performer_name: user?.full_name || user?.email || 'Store Manager',
      performer_email: user?.email,
      reason_or_remarks: `[Stock Allocation] Reserved ${comp.quantity} ${comp.component_name}s for ${numSets} sets of "${device_type}". ${notes ? `(${notes})` : ''}`,
    }).catch(() => {});
  }

  // 5. Log audit
  if (user) {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role,
      action: 'DEVICE_STOCK_ALLOCATED',
      target_table: 'device_stock_allocations',
      target_id: allocationRecord.id,
      details: {
        device_type,
        allocated_sets: numSets,
        components_reserved: componentsToReserve,
        notes,
      },
    }).catch(() => {});
  }

    // 6. Return updated availability
    const updatedAvailability = await getCalculatedDeviceAvailability();
    return {
      success: true,
      allocation: allocationRecord,
      availability: updatedAvailability,
    };
  } finally {
    unlock();
  }
}

/**
 * Release an Active Stock Allocation:
 * Cancels the reservation and returns components to the unallocated stock pool.
 */
export async function releaseDeviceAllocation({
  allocation_id,
  reason = '',
  user,
}) {
  const unlock = await acquireAllocationMutex();
  try {
    if (!allocation_id) {
      throw new Error('Allocation ID is required to release an allocation.');
    }

    const allAllocations = await getDeviceStockAllocations();
    const allocation = allAllocations.find((a) => String(a.id) === String(allocation_id));

    if (!allocation) {
      throw new Error(`Allocation record "${allocation_id}" not found.`);
    }

    if (allocation.status !== 'ALLOCATED') {
      throw new Error(`Allocation is already in "${allocation.status}" status and cannot be released.`);
    }

    const releasedAt = new Date().toISOString();
    const releaseReason = (reason || 'Manual release by Store Manager').trim();

    // 1. Update status
    allocation.status = 'RELEASED';
    allocation.released_at = releasedAt;
    allocation.released_by = user?.id || null;
    allocation.release_reason = releaseReason;
    allocation.updated_at = releasedAt;

    // 2. Persist to DB and memory
    try {
      await supabase
        .from('device_stock_allocations')
        .update({
          status: 'RELEASED',
          released_at: releasedAt,
          released_by: user?.id || null,
          release_reason: releaseReason,
          updated_at: releasedAt,
        })
        .eq('id', allocation.id);
    } catch (err) {
      console.warn('DB releaseDeviceAllocation notice, using local cache:', err.message);
    }

    saveAllocationsStorage();

    // 3. Record stock movement audit trail for releasing the components
    const components = Array.isArray(allocation.components_reserved) ? allocation.components_reserved : [];
    for (const comp of components) {
      await recordStockMovement({
        item_name: comp.component_name,
        category: 'Camera Device',
        movement_type: 'STOCK_ADJUSTMENT',
        quantity: comp.quantity,
        unit: comp.unit || 'Nos.',
        performed_by: user?.id,
        performer_name: user?.full_name || user?.email || 'Store Manager',
        performer_email: user?.email,
        reason_or_remarks: `[Allocation Released] Released ${comp.quantity} ${comp.component_name}s from ${allocation.allocated_sets} sets of "${allocation.device_type}". Reason: ${releaseReason}`,
      }).catch(() => {});
    }

    // 4. Log audit
    if (user) {
      await logAudit({
        actor_id: user?.id,
        actor_email: user?.email,
        actor_role: user?.role,
        action: 'DEVICE_STOCK_ALLOCATION_RELEASED',
        target_table: 'device_stock_allocations',
        target_id: allocation.id,
        details: {
          device_type: allocation.device_type,
          allocated_sets: allocation.allocated_sets,
          components_released: components,
          reason: releaseReason,
        },
      }).catch(() => {});
    }

    const updatedAvailability = await getCalculatedDeviceAvailability();
    return {
      success: true,
      allocation,
      availability: updatedAvailability,
    };
  } finally {
    unlock();
  }
}

/**
 * Fulfill an Active Allocation upon physical issuance
 */
export async function fulfillDeviceAllocation({
  allocation_id,
  checklist_id = null,
  user,
}) {
  if (!allocation_id) return null;
  const allAllocations = await getDeviceStockAllocations();
  const allocation = allAllocations.find((a) => String(a.id) === String(allocation_id));
  if (!allocation || allocation.status !== 'ALLOCATED') return null;

  allocation.status = 'FULFILLED';
  allocation.updated_at = new Date().toISOString();
  if (checklist_id) allocation.checklist_id = checklist_id;

  try {
    await supabase
      .from('device_stock_allocations')
      .update({
        status: 'FULFILLED',
        checklist_id: checklist_id || allocation.checklist_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', allocation.id);
  } catch (e) {
    // Ignore
  }

  saveAllocationsStorage();
  return allocation;
}
