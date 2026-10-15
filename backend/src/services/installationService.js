import supabase from './supabase.js';
import {
  getAllServiceEngineers,
  calculateBookingEndDate,
  resolveEngineer,
  reserveEngineerAtomic,
  releaseEngineerBooking,
  checkEngineerAvailability,
} from './engineerBookingService.js';
import {
  calculateBomRequirements,
  calculateJobPreliminaryBom,
  parseDeviceConfigurations,
  parseExtraDeviceConfigurations,
  combineCarriedDevicesAllocation,
} from './bomService.js';
import { syncStoreRequirementForChecklist } from './storeRequirementService.js';
import { notifyStoreManagerOnInstallationChecklist } from './notificationService.js';
import { getPendingExtensionForChecklist } from './scheduleExtensionService.js';

// In-memory structured extra configurations cache for active runtime sessions
export const inMemoryChecklistExtraConfigs = new Map();
export const inMemoryChecklistBomSnapshots = new Map();
export const inMemoryChecklistSchedules = new Map();

const DEVICE_TYPES = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '6 Channel Live',
  '6 Channel Recording',
  '8 Channel Live',
];

/**
 * Generate unique Checklist Number in format: EE-INST-YYYYMMDD-XXXX
 */
export async function generateInstallationChecklistNumber() {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '');
  const prefix = `EE-INST-${todayStr}-`;

  try {
    // 1. Try PostgreSQL atomic RPC function
    const { data: rpcData, error: rpcError } = await supabase.rpc('generate_next_installation_checklist_number');
    if (!rpcError && rpcData) {
      return rpcData;
    }
  } catch (err) {
    console.warn('RPC generate_next_installation_checklist_number unavailable, falling back to database query sequence:', err.message);
  }

  // 2. Fallback: Query installation_checklist_sequence table or installation_checklists max sequence
  try {
    const { data: seqRow, error: seqError } = await supabase
      .from('installation_checklist_sequence')
      .select('last_value')
      .eq('date_key', todayStr)
      .maybeSingle();

    let nextVal = 1;
    if (!seqError && seqRow) {
      nextVal = seqRow.last_value + 1;
      await supabase
        .from('installation_checklist_sequence')
        .update({ last_value: nextVal, updated_at: new Date().toISOString() })
        .eq('date_key', todayStr);
    } else {
      // Upsert date row
      await supabase
        .from('installation_checklist_sequence')
        .upsert({ date_key: todayStr, last_value: 1, updated_at: new Date().toISOString() });
    }

    return `${prefix}${String(nextVal).padStart(4, '0')}`;
  } catch (fallbackErr) {
    console.warn('Sequence table fallback failed, checking max checklist number:', fallbackErr.message);
  }

  // 3. Ultimate Fallback: Query max checklist_number for today in installation_checklists table
  const { data: existingRows } = await supabase
    .from('installation_checklists')
    .select('checklist_number')
    .like('checklist_number', `${prefix}%`)
    .order('checklist_number', { ascending: false })
    .limit(1);

  if (existingRows && existingRows.length > 0) {
    const lastNumStr = existingRows[0].checklist_number.replace(prefix, '');
    const lastNum = parseInt(lastNumStr, 10);
    if (!isNaN(lastNum)) {
      return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
    }
  }

  return `${prefix}0001`;
}

/**
 * Create a new Installation Checklist
 */
export async function createChecklist(adminUserId, data) {
  const checklistNumber = await generateInstallationChecklistNumber();

  const confirmedPrice = Number(data.confirmed_price) || 0;
  const advanceAmount = data.advance_received ? (Number(data.advance_amount) || 0) : 0;
  const pendingAmount = data.pending_payment ? (Number(data.pending_amount) || 0) : 0;

  // Payment status calculation if not manually provided
  let paymentStatus = data.payment_status || 'Pending';
  if (confirmedPrice > 0 && advanceAmount + pendingAmount >= confirmedPrice && pendingAmount === 0) {
    paymentStatus = 'Paid';
  } else if (advanceAmount > 0 && advanceAmount < confirmedPrice) {
    paymentStatus = 'Partially Paid';
  }

  // Calculate inclusive booking end date and validate engineer availability atomically
  const engineerName = data.service_engineer ? data.service_engineer.trim() : '';
  const startDate = data.expected_arrival_date || null;
  const duration = data.installation_duration ? data.installation_duration.trim() : '1 Day';
  let bookingEndDate = null;
  let resolvedEng = null;

  if (engineerName && startDate) {
    resolvedEng = resolveEngineer(engineerName);
    bookingEndDate = calculateBookingEndDate(startDate, duration);

    // Validate availability before creating checklist (throws 409 conflict if already booked)
    const availCheck = await checkEngineerAvailability({
      engineerIdOrName: resolvedEng ? resolvedEng.id : engineerName,
      startDate,
      endDate: bookingEndDate,
      duration,
    });
    if (!availCheck.available) {
      const c = availCheck.conflict;
      const errorMsg = `Booking Conflict: ${c?.reason || `Engineer ${engineerName} is already committed from ${c?.booking_start_date} to ${c?.booking_end_date}.`}`;
      const err = new Error(errorMsg);
      err.statusCode = 409;
      err.conflict = c;
      err.suggestedEngineers = availCheck.suggested_engineers;
      throw err;
    }
  }

  // Normalize device configurations using robust parser
  let deviceConfigs = parseDeviceConfigurations(data);
  if (deviceConfigs.length === 0 && data.device_type) {
    const dQty = Math.max(1, parseInt(data.number_of_devices, 10) || 1);
    const vQty = Math.max(1, parseInt(data.number_of_vehicles, 10) || dQty);
    deviceConfigs = [{
      device_type: data.device_type.trim(),
      number_of_devices: dQty,
      number_of_vehicles: vQty,
    }];
  }

  const totalDevices = deviceConfigs.reduce((sum, c) => sum + c.number_of_devices, 0) || Math.max(1, parseInt(data.number_of_devices, 10) || 1);
  const totalVehicles = deviceConfigs.reduce((sum, c) => sum + c.number_of_vehicles, 0) || Math.max(1, parseInt(data.number_of_vehicles, 10) || totalDevices);
  const summaryDeviceType = deviceConfigs.length === 1
    ? deviceConfigs[0].device_type
    : (deviceConfigs.length > 0
        ? deviceConfigs.map((c) => `${c.device_type} (${c.number_of_devices})`).join(', ')
        : (data.device_type || '2 Channel Live'));

  // Sales declaration: Will technician carry extra backup items? (Yes/No)
  const carryBackupItems = Boolean(data.carry_extra_backup_items ?? data.extra_devices);

  // Calculate preliminary BOM strictly for REQUIRED installation devices (ONLY for Installation jobs)
  // Extra loose backup items do NOT increase Sales preliminary BOM
  const isInstallationJob = (data.installation_or_service || 'Installation') === 'Installation';
  let bomSnapshot = null;
  if (isInstallationJob && deviceConfigs.length > 0) {
    try {
      const prelimCalc = await calculateJobPreliminaryBom({
        requiredConfigs: deviceConfigs,
        extraConfigs: [], // strictly empty: extra backup items never increase Sales preliminary BOM
      });
      if (prelimCalc && prelimCalc.configured) {
        bomSnapshot = prelimCalc;
      }
    } catch (e) {
      console.warn('Could not auto-calculate preliminary BOM snapshot:', e.message);
    }
    if (!bomSnapshot && data.bom_snapshot?.items) {
      bomSnapshot = data.bom_snapshot;
    }
  } else {
    bomSnapshot = null;
  }

  const extraConfigs = [];

  const payload = {
    checklist_number: checklistNumber,
    created_by: adminUserId,
    client_name: data.client_name.trim(),
    client_mobile: data.client_mobile.trim(),
    client_location: data.client_location ? data.client_location.trim() : '',
    google_maps_location: data.google_maps_location ? data.google_maps_location.trim() : null,
    device_type: summaryDeviceType,
    number_of_devices: totalDevices,
    number_of_vehicles: totalVehicles,
    device_configurations: deviceConfigs,
    carry_extra_backup_items: carryBackupItems,
    extra_devices: carryBackupItems, // backward-compatible flag
    extra_device_type: null,
    extra_device_count: null,
    extra_device_configurations: [],
    confirmed_price: confirmedPrice,
    payment_method: data.payment_method || 'UPI',
    advance_received: Boolean(data.advance_received),
    advance_amount: advanceAmount,
    pending_payment: Boolean(data.pending_payment),
    pending_amount: pendingAmount,
    installation_duration: duration,
    vehicle_type: data.vehicle_type === 'Other' && data.custom_vehicle_type ? data.custom_vehicle_type.trim() : (data.vehicle_type || 'Truck'),
    expected_arrival_date: startDate,
    expected_arrival_time: data.expected_arrival_time || '10:00 AM',
    original_expected_arrival_date: startDate,
    original_expected_arrival_time: data.expected_arrival_time || '10:00 AM',
    original_installation_duration: duration,
    original_booking_end_date: bookingEndDate,
    current_expected_arrival_date: startDate,
    current_expected_arrival_time: data.expected_arrival_time || '10:00 AM',
    current_installation_duration: duration,
    current_booking_end_date: bookingEndDate,
    schedule_revision_number: 0,
    schedule_last_updated_at: new Date().toISOString(),
    installation_or_service: data.installation_or_service || 'Installation',
    salesperson_name: data.salesperson_name ? data.salesperson_name.trim() : null,
    service_engineer: engineerName,
    service_engineer_id: resolvedEng ? resolvedEng.id : null,
    booking_end_date: bookingEndDate,
    service_assistant: data.service_assistant ? data.service_assistant.trim() : '',
    installation_status: data.installation_status || 'Assigned',
    payment_status: paymentStatus,
    bom_snapshot: bomSnapshot,
    material_issuance_status: isInstallationJob ? (data.material_issuance_status || 'PENDING') : 'NOT_APPLICABLE',
    remarks: data.remarks ? data.remarks.trim() : null,
    client_confirmation: data.client_confirmation || 'Confirmed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let inserted;
  try {
    const { data: res, error } = await supabase
      .from('installation_checklists')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    inserted = { ...payload, ...res, id: res.id, carry_status: res.carry_status || 'NOT_RECORDED' };
  } catch (error) {
    // If device_configurations / extra_device_configurations / service_engineer_id / booking_end_date / bom_snapshot / material_issuance_status / salesperson_name columns are not migrated yet in PostgreSQL, retry without optional columns
    if (
      error.code === 'PGRST204' ||
      error.message?.includes('device_configurations') ||
      error.message?.includes('extra_device_configurations') ||
      error.message?.includes('service_engineer_id') ||
      error.message?.includes('booking_end_date') ||
      error.message?.includes('bom_snapshot') ||
      error.message?.includes('material_issuance_status') ||
      error.message?.includes('salesperson_name')
    ) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.device_configurations;
      delete fallbackPayload.extra_device_configurations;
      delete fallbackPayload.service_engineer_id;
      delete fallbackPayload.booking_end_date;
      delete fallbackPayload.bom_snapshot;
      delete fallbackPayload.material_issuance_status;
      delete fallbackPayload.salesperson_name;
      delete fallbackPayload.original_expected_arrival_date;
      delete fallbackPayload.original_expected_arrival_time;
      delete fallbackPayload.original_installation_duration;
      delete fallbackPayload.original_booking_end_date;
      delete fallbackPayload.current_expected_arrival_date;
      delete fallbackPayload.current_expected_arrival_time;
      delete fallbackPayload.current_installation_duration;
      delete fallbackPayload.current_booking_end_date;
      delete fallbackPayload.schedule_revision_number;
      delete fallbackPayload.schedule_last_updated_at;
      const { data: res2, error: err2 } = await supabase
        .from('installation_checklists')
        .insert(fallbackPayload)
        .select()
        .single();
      if (err2) throw err2;
      inserted = { ...payload, ...res2, id: res2.id };
      inMemoryChecklistSchedules.set(res2.id, {
        original_expected_arrival_date: payload.original_expected_arrival_date,
        original_expected_arrival_time: payload.original_expected_arrival_time,
        original_installation_duration: payload.original_installation_duration,
        original_booking_end_date: payload.original_booking_end_date,
        current_expected_arrival_date: payload.current_expected_arrival_date,
        current_expected_arrival_time: payload.current_expected_arrival_time,
        current_installation_duration: payload.current_installation_duration,
        current_booking_end_date: payload.current_booking_end_date,
        schedule_revision_number: payload.schedule_revision_number,
        schedule_last_updated_at: payload.schedule_last_updated_at,
      });
    } else {
      console.error('Database insert error for checklist:', error);
      if (error.code === 'PGRST205' || error.message?.includes("Could not find the table 'public.installation_checklists'")) {
        throw new Error("Table 'installation_checklists' does not exist in Supabase database yet. Please execute the SQL migration script (supabase/migrations/008_installation_checklists_schema.sql) in the Supabase SQL Editor.");
      }
      throw new Error(error.message || 'Failed to insert installation checklist');
    }
  }

  // Associate created checklist ID with the booking
  if (engineerName && startDate && inserted?.id) {
    await reserveEngineerAtomic({
      engineerIdOrName: resolvedEng ? resolvedEng.id : engineerName,
      checklistId: inserted.id,
      checklistNumber,
      startDate,
      endDate: bookingEndDate,
      duration,
      user: { id: adminUserId },
      status: data.installation_status || 'Assigned',
    }).catch((e) => console.warn('Could not associate checklist_id with booking:', e.message));
  }

  // Automatically create or update the associated Store Manager material-requirement record
  if (inserted?.id) {
    if (extraConfigs && extraConfigs.length > 0) {
      inMemoryChecklistExtraConfigs.set(inserted.id, extraConfigs);
    }
    if (bomSnapshot) {
      inMemoryChecklistBomSnapshots.set(inserted.id, bomSnapshot);
    }
    try {
      const req = await syncStoreRequirementForChecklist(inserted);
      notifyStoreManagerOnInstallationChecklist({ checklist: inserted, requirement: req }).catch((e) =>
        console.warn('Could not dispatch Store Manager notification:', e.message)
      );
    } catch (reqErr) {
      console.warn('Could not sync store requirement for checklist:', reqErr.message);
    }
  }

  inserted = normalizeChecklistDeviceConfigs(inserted);
  return inserted;
}

/**
 * Helper to ensure checklist has device_configurations and extra_device_configurations populated
 */
export function normalizeChecklistDeviceConfigs(checklist) {
  if (!checklist) return checklist;
  const reqConfigs = parseDeviceConfigurations(
    checklist,
    checklist.number_of_devices || 1,
    checklist.number_of_vehicles || 1
  );

  const inMemExtra = checklist.id ? inMemoryChecklistExtraConfigs.get(checklist.id) : null;
  const rawExtra = (Array.isArray(checklist.extra_device_configurations) && checklist.extra_device_configurations.length > 0)
    ? checklist.extra_device_configurations
    : (inMemExtra || (checklist.extra_devices ? checklist : null));

  const extraConfigs = parseExtraDeviceConfigurations(rawExtra);
  const hasExtra = Boolean(checklist.extra_devices) && extraConfigs.length > 0;

  checklist.device_configurations = reqConfigs;
  checklist.extra_device_configurations = hasExtra ? extraConfigs : [];
  checklist.extra_devices = hasExtra;
  checklist.has_extra_devices = hasExtra;
  checklist.devices_carried = combineCarriedDevicesAllocation(reqConfigs, hasExtra ? extraConfigs : []);

  checklist.total_devices_required = reqConfigs.reduce((sum, c) => sum + (Number(c.number_of_devices) || 0), 0);
  checklist.total_extra_devices = hasExtra ? extraConfigs.reduce((sum, c) => sum + (Number(c.extra_quantity) || 0), 0) : 0;
  checklist.total_devices_carried = checklist.total_devices_required + checklist.total_extra_devices;

  if (!checklist.bom_snapshot && checklist.id) {
    checklist.bom_snapshot = inMemoryChecklistBomSnapshots.get(checklist.id) || null;
  }
  if (checklist.bom_snapshot) {
    checklist.bom_snapshot.total_devices_required = checklist.bom_snapshot.total_devices_required ?? checklist.total_devices_required;
    checklist.bom_snapshot.total_extra_devices = checklist.bom_snapshot.total_extra_devices ?? checklist.total_extra_devices;
    checklist.bom_snapshot.total_devices_carried = checklist.bom_snapshot.total_devices_carried ?? checklist.total_devices_carried;
  }

  const inMemSchedule = checklist.id ? inMemoryChecklistSchedules.get(checklist.id) : null;
  if (inMemSchedule) {
    Object.assign(checklist, inMemSchedule);
  } else {
    if (!checklist.original_expected_arrival_date) {
      checklist.original_expected_arrival_date = checklist.expected_arrival_date;
      checklist.original_expected_arrival_time = checklist.expected_arrival_time;
      checklist.original_installation_duration = checklist.installation_duration;
      checklist.original_booking_end_date = checklist.booking_end_date || checklist.expected_arrival_date;
    }
    if (!checklist.current_expected_arrival_date) {
      checklist.current_expected_arrival_date = checklist.expected_arrival_date;
      checklist.current_expected_arrival_time = checklist.expected_arrival_time;
      checklist.current_installation_duration = checklist.installation_duration;
      checklist.current_booking_end_date = checklist.booking_end_date || checklist.expected_arrival_date;
    }
    if (checklist.schedule_revision_number === undefined) {
      checklist.schedule_revision_number = 0;
    }
  }

  // Attach pending extension if one is awaiting review
  const pendingExt = getPendingExtensionForChecklist(checklist.id);
  checklist.pending_extension = pendingExt || null;
  checklist.has_pending_extension = Boolean(pendingExt);

  return checklist;
}

/**
 * Fetch installation checklists with search, filtering, and pagination
 */
export async function getChecklists(params = {}) {
  const {
    page = 1,
    limit = 100,
    search = '',
    serviceEngineer = '',
    installationStatus = '',
    paymentStatus = '',
    installationOrService = '',
    vehicleType = '',
    dateFrom = '',
    dateTo = '',
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = params;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  let query = supabase
    .from('installation_checklists')
    .select('*', { count: 'exact' });

  // Search filter (Checklist Number, Client Name, Client Mobile, Client Location, Technician)
  if (search && search.trim()) {
    const s = search.trim();
    query = query.or(`checklist_number.ilike.%${s}%,client_name.ilike.%${s}%,client_mobile.ilike.%${s}%,client_location.ilike.%${s}%,service_engineer.ilike.%${s}%`);
  }

  // Service Engineer Filter (Primary filter on service_engineer)
  if (serviceEngineer && serviceEngineer.trim() && serviceEngineer !== 'all') {
    const eng = serviceEngineer.trim();
    query = query.ilike('service_engineer', `%${eng}%`);
  }

  // Filters
  if (installationStatus) {
    if (installationStatus === 'Assigned') {
      query = query.in('installation_status', ['Assigned', 'Pending', 'In Progress']);
    } else if (installationStatus === 'Completed') {
      query = query.in('installation_status', ['Completed', 'Site Work Completed']);
    } else {
      query = query.eq('installation_status', installationStatus);
    }
  }
  if (paymentStatus) {
    query = query.eq('payment_status', paymentStatus);
  }
  if (installationOrService) {
    query = query.eq('installation_or_service', installationOrService);
  }
  if (vehicleType) {
    query = query.ilike('vehicle_type', `%${vehicleType}%`);
  }
  if (dateFrom) {
    query = query.gte('expected_arrival_date', dateFrom);
  }
  if (dateTo) {
    query = query.lte('expected_arrival_date', dateTo);
  }

  // Ordering & Range
  const isAscending = sortOrder.toLowerCase() === 'asc';
  query = query.order(sortBy, { ascending: isAscending }).range(offset, offset + limitNum - 1);

  const { data, count, error } = await query;

  if (error) {
    console.error('Error fetching installation checklists:', error);
    if (error.code === 'PGRST205' || error.message?.includes("Could not find the table 'public.installation_checklists'")) {
      return {
        checklists: [],
        totalCount: 0,
        page: pageNum,
        limit: limitNum,
        totalPages: 1,
        warning: "Table 'installation_checklists' does not exist in Supabase yet. Please run migration 008_installation_checklists_schema.sql in Supabase SQL Editor.",
      };
    }
    throw new Error(error.message || 'Failed to fetch installation checklists');
  }

  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / limitNum) || 1;

  return {
    checklists: (data || []).map(normalizeChecklistDeviceConfigs),
    totalCount,
    page: pageNum,
    limit: limitNum,
    totalPages,
  };
}

/**
 * Fetch unique list of Service Engineers from database
 */
export async function getServiceEngineers() {
  return await getAllServiceEngineers();
}

/**
 * Fetch a single installation checklist by ID
 */
export async function getChecklistById(id, { enrich = true } = {}) {
  let query = supabase.from('installation_checklists').select('*');

  // If UUID vs string checklist number
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (isUuid) {
    query = query.eq('id', id);
  } else {
    query = query.eq('checklist_number', id);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    throw new Error('Installation checklist not found');
  }

  const normalized = normalizeChecklistDeviceConfigs(data);

  if (enrich) {
    try {
      const { enrichChecklistsWithWorkflowStatus } = await import('./workflowService.js');
      const enriched = await enrichChecklistsWithWorkflowStatus([normalized]);
      return enriched[0] || normalized;
    } catch (e) {
      // Non-blocking fallback
    }
  }

  return normalized;
}

/**
 * Update an existing installation checklist
 */
export async function updateChecklist(id, data) {
  const existing = await getChecklistById(id);

  const confirmedPrice = Number(data.confirmed_price) || 0;
  const advanceAmount = data.advance_received ? (Number(data.advance_amount) || 0) : 0;
  const pendingAmount = data.pending_payment ? (Number(data.pending_amount) || 0) : 0;

  let paymentStatus = data.payment_status || existing.payment_status;
  if (confirmedPrice > 0 && advanceAmount + pendingAmount >= confirmedPrice && pendingAmount === 0) {
    paymentStatus = 'Paid';
  } else if (advanceAmount > 0 && advanceAmount < confirmedPrice) {
    paymentStatus = 'Partially Paid';
  }

  const newEngName = data.service_engineer !== undefined ? (data.service_engineer ? data.service_engineer.trim() : '') : existing.service_engineer;
  const newStartDate = data.expected_arrival_date !== undefined ? data.expected_arrival_date : existing.expected_arrival_date;
  const newDuration = data.installation_duration !== undefined ? data.installation_duration : (existing.installation_duration || '1 Day');
  const newStatus = data.installation_status !== undefined ? data.installation_status : existing.installation_status;

  let newBookingEndDate = existing.booking_end_date;
  let resolvedEng = existing.service_engineer_id ? { id: existing.service_engineer_id, name: existing.service_engineer } : resolveEngineer(newEngName);

  if (newStatus === 'Cancelled') {
    // Release booking if cancelled
    await releaseEngineerBooking({ checklistId: existing.id });
  } else if (newEngName && newStartDate) {
    resolvedEng = resolveEngineer(newEngName);
    newBookingEndDate = calculateBookingEndDate(newStartDate, newDuration);

    // Atomically reserve the engineer (releasing previous booking for this checklist)
    await reserveEngineerAtomic({
      engineerIdOrName: resolvedEng ? resolvedEng.id : newEngName,
      checklistId: existing.id,
      checklistNumber: existing.checklist_number,
      startDate: newStartDate,
      endDate: newBookingEndDate,
      duration: newDuration,
      user: null,
      status: (newStatus === 'Completed' || newStatus === 'Site Work Completed') ? 'COMPLETED' : 'ASSIGNED',
    });
  }

  // Handle device configuration updates using robust parser
  let deviceConfigs = parseDeviceConfigurations(
    (data.device_configurations && data.device_configurations.length > 0) || data.device_type ? data : existing
  );
  if (deviceConfigs.length === 0) {
    deviceConfigs = parseDeviceConfigurations(existing);
  }

  const totalDevices = deviceConfigs.length > 0
    ? deviceConfigs.reduce((sum, c) => sum + c.number_of_devices, 0)
    : (Number(data.number_of_devices) || existing.number_of_devices || 1);
  const totalVehicles = deviceConfigs.length > 0
    ? deviceConfigs.reduce((sum, c) => sum + c.number_of_vehicles, 0)
    : (Number(data.number_of_vehicles) || existing.number_of_vehicles || totalDevices);
  const summaryDeviceType = deviceConfigs.length === 1
    ? deviceConfigs[0].device_type
    : (deviceConfigs.length > 0
        ? deviceConfigs.map((c) => `${c.device_type} (${c.number_of_devices})`).join(', ')
        : (data.device_type || existing.device_type));

  const effectiveJobType = data.installation_or_service || existing.installation_or_service || 'Installation';
  const isInstallation = effectiveJobType === 'Installation';

  // Historical accuracy & Service job enforcement:
  // If job type is Installation: maintain or calculate snapshot
  // If job type is Service: ensure no installation BOM snapshot is saved or attached
  let updatedBomSnapshot = null;
  const carryBackupItems = data.carry_extra_backup_items !== undefined
    ? Boolean(data.carry_extra_backup_items)
    : (data.extra_devices !== undefined ? Boolean(data.extra_devices) : Boolean(existing.carry_extra_backup_items ?? existing.extra_devices));

  if (isInstallation) {
    const configsChanged = JSON.stringify(deviceConfigs) !== JSON.stringify(existing.device_configurations);
    updatedBomSnapshot = existing.bom_snapshot;
    if (data.bom_snapshot !== undefined) {
      updatedBomSnapshot = data.bom_snapshot;
    } else if (configsChanged && deviceConfigs.length > 0) {
      try {
        const prelimCalc = await calculateJobPreliminaryBom({
          requiredConfigs: deviceConfigs,
          extraConfigs: [], // strictly empty: extra backup items never increase Sales preliminary BOM
        });
        if (prelimCalc && prelimCalc.configured) {
          updatedBomSnapshot = prelimCalc;
        }
      } catch (e) {
        console.warn('Could not recalculate preliminary BOM snapshot:', e.message);
      }
    }
  } else {
    // Service job: clear active BOM snapshot so stale BOM is not attached to Service
    updatedBomSnapshot = null;
  }

  const extraConfigs = [];

  const payload = {
    client_name: data.client_name ? data.client_name.trim() : existing.client_name,
    client_mobile: data.client_mobile ? data.client_mobile.trim() : existing.client_mobile,
    client_location: data.client_location !== undefined ? data.client_location.trim() : existing.client_location,
    google_maps_location: data.google_maps_location !== undefined ? (data.google_maps_location ? data.google_maps_location.trim() : null) : existing.google_maps_location,
    device_type: summaryDeviceType,
    number_of_devices: totalDevices,
    number_of_vehicles: totalVehicles,
    device_configurations: deviceConfigs.length > 0 ? deviceConfigs : (existing.device_configurations || null),
    carry_extra_backup_items: carryBackupItems,
    extra_devices: carryBackupItems, // backward-compatible flag
    extra_device_type: null,
    extra_device_count: null,
    extra_device_configurations: [],
    confirmed_price: confirmedPrice,
    payment_method: data.payment_method || existing.payment_method,
    advance_received: Boolean(data.advance_received),
    advance_amount: advanceAmount,
    pending_payment: Boolean(data.pending_payment),
    pending_amount: pendingAmount,
    installation_duration: newDuration,
    vehicle_type: data.vehicle_type === 'Other' && data.custom_vehicle_type ? data.custom_vehicle_type.trim() : (data.vehicle_type || existing.vehicle_type),
    expected_arrival_date: newStartDate,
    expected_arrival_time: data.expected_arrival_time || existing.expected_arrival_time,
    original_expected_arrival_date: existing.original_expected_arrival_date || existing.expected_arrival_date,
    original_expected_arrival_time: existing.original_expected_arrival_time || existing.expected_arrival_time,
    original_installation_duration: existing.original_installation_duration || existing.installation_duration,
    original_booking_end_date: existing.original_booking_end_date || existing.booking_end_date,
    current_expected_arrival_date: newStartDate,
    current_expected_arrival_time: data.expected_arrival_time || existing.current_expected_arrival_time || existing.expected_arrival_time,
    current_installation_duration: newDuration,
    current_booking_end_date: newBookingEndDate,
    schedule_revision_number: (newStartDate !== existing.expected_arrival_date || newDuration !== existing.installation_duration)
      ? ((existing.schedule_revision_number || 0) + 1)
      : (existing.schedule_revision_number || 0),
    schedule_last_updated_at: new Date().toISOString(),
    installation_or_service: effectiveJobType,
    salesperson_name: data.salesperson_name !== undefined ? (data.salesperson_name ? data.salesperson_name.trim() : existing.salesperson_name) : existing.salesperson_name,
    service_engineer: newEngName,
    service_engineer_id: resolvedEng ? resolvedEng.id : null,
    booking_end_date: newBookingEndDate,
    service_assistant: data.service_assistant ? data.service_assistant.trim() : existing.service_assistant,
    installation_status: ((existing.installation_status === 'Completed' || existing.installation_status === 'Site Work Completed') && (data.installation_status !== 'Completed'))
      ? 'Completed'
      : (data.installation_status || existing.installation_status),
    payment_status: paymentStatus,
    bom_snapshot: updatedBomSnapshot,
    material_issuance_status: isInstallation
      ? (data.material_issuance_status || existing.material_issuance_status || 'PENDING')
      : 'NOT_APPLICABLE',
    remarks: data.remarks !== undefined ? (data.remarks ? data.remarks.trim() : null) : existing.remarks,
    client_confirmation: data.client_confirmation || existing.client_confirmation,
    updated_at: new Date().toISOString(),
  };

  let updated;
  try {
    const { data: res, error } = await supabase
      .from('installation_checklists')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    updated = { ...existing, ...payload, ...res, id: existing.id };
    if (extraConfigs && extraConfigs.length > 0) {
      inMemoryChecklistExtraConfigs.set(existing.id, extraConfigs);
    }
  } catch (error) {
    if (
      error.code === 'PGRST204' ||
      error.message?.includes('device_configurations') ||
      error.message?.includes('extra_device_configurations') ||
      error.message?.includes('service_engineer_id') ||
      error.message?.includes('booking_end_date') ||
      error.message?.includes('bom_snapshot') ||
      error.message?.includes('material_issuance_status') ||
      error.message?.includes('salesperson_name')
    ) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.device_configurations;
      delete fallbackPayload.extra_device_configurations;
      delete fallbackPayload.service_engineer_id;
      delete fallbackPayload.booking_end_date;
      delete fallbackPayload.bom_snapshot;
      delete fallbackPayload.material_issuance_status;
      delete fallbackPayload.salesperson_name;
      delete fallbackPayload.original_expected_arrival_date;
      delete fallbackPayload.original_expected_arrival_time;
      delete fallbackPayload.original_installation_duration;
      delete fallbackPayload.original_booking_end_date;
      delete fallbackPayload.current_expected_arrival_date;
      delete fallbackPayload.current_expected_arrival_time;
      delete fallbackPayload.current_installation_duration;
      delete fallbackPayload.current_booking_end_date;
      delete fallbackPayload.schedule_revision_number;
      delete fallbackPayload.schedule_last_updated_at;
      const { data: res2, error: err2 } = await supabase
        .from('installation_checklists')
        .update(fallbackPayload)
        .eq('id', existing.id)
        .select()
        .single();
      if (err2) throw err2;
      updated = { ...existing, ...payload, ...res2, id: existing.id };
      inMemoryChecklistSchedules.set(existing.id, {
        original_expected_arrival_date: payload.original_expected_arrival_date,
        original_expected_arrival_time: payload.original_expected_arrival_time,
        original_installation_duration: payload.original_installation_duration,
        original_booking_end_date: payload.original_booking_end_date,
        current_expected_arrival_date: payload.current_expected_arrival_date,
        current_expected_arrival_time: payload.current_expected_arrival_time,
        current_installation_duration: payload.current_installation_duration,
        current_booking_end_date: payload.current_booking_end_date,
        schedule_revision_number: payload.schedule_revision_number,
        schedule_last_updated_at: payload.schedule_last_updated_at,
      });
      if (extraConfigs && extraConfigs.length > 0) {
        inMemoryChecklistExtraConfigs.set(existing.id, extraConfigs);
      }
    } else {
      console.error('Database update error for checklist:', error);
      throw new Error(error.message || 'Failed to update installation checklist');
    }
  }

  // Automatically update the associated Store Manager material-requirement record
  if (updated?.id) {
    try {
      await syncStoreRequirementForChecklist(updated);
    } catch (reqErr) {
      console.warn('Could not sync store requirement on checklist update:', reqErr.message);
    }
  }

  return normalizeChecklistDeviceConfigs(updated);
}

/**
 * Delete an installation checklist by ID
 */
export async function deleteChecklist(id) {
  const existing = await getChecklistById(id);

  await releaseEngineerBooking({ checklistId: existing.id });

  const { error } = await supabase
    .from('installation_checklists')
    .delete()
    .eq('id', existing.id);

  if (error) {
    console.error('Database delete error for checklist:', error);
    throw new Error(error.message || 'Failed to delete installation checklist');
  }

  return { success: true };
}

/**
 * Get installation checklist statistics for Admin Dashboard
 */
export async function getInstallationStats() {
  const [
    { count: total },
    { count: assigned },
    { count: completed },
    { count: pending },
    { count: inProgress },
  ] = await Promise.all([
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }),
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }).in('installation_status', ['Assigned', 'Pending', 'In Progress']),
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }).in('installation_status', ['Completed', 'Site Work Completed']),
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }).eq('installation_status', 'Pending'),
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }).eq('installation_status', 'In Progress'),
  ]);

  return {
    total: total || 0,
    assigned: assigned || 0,
    completed: completed || 0,
    pending: pending || 0,
    inProgress: inProgress || 0,
  };
}
