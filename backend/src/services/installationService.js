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
import { logAudit } from './auditService.js';

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
 * Check if a checklist is eligible for permanent deletion.
 * Protects operational history, completed jobs, active work, stock ledgers,
 * reports, expenses, returns, and coordinator bookings.
 */
export async function checkChecklistDeletionEligibility(checklistIdOrObj) {
  let checklist = checklistIdOrObj;
  if (typeof checklistIdOrObj === 'string') {
    checklist = await getChecklistById(checklistIdOrObj, { enrich: false });
  }

  if (!checklist || !checklist.id) {
    const err = new Error('Checklist not found');
    err.statusCode = 404;
    throw err;
  }

  const checklistId = checklist.id;
  const reasons = [];

  // 1. Status checks: In-Progress, Completed, or Site Work Completed checklists must not be deleted
  const protectedStatuses = ['In Progress', 'Completed', 'Site Work Completed'];
  if (protectedStatuses.includes(checklist.installation_status)) {
    reasons.push(`Job has active operational status '${checklist.installation_status}'`);
  }

  // 2. Material/Device issuance flag on checklist
  if (
    checklist.material_issuance_status === 'ISSUED' ||
    checklist.devices_issuance_status === 'ISSUED' ||
    checklist.material_issued_at ||
    checklist.material_issued_by
  ) {
    reasons.push('Devices or installation materials have already been issued for this job');
  }

  // 3. Technical installation reports check (Site work completion reports)
  try {
    const { inMemoryCompletionReports } = await import('./workflowService.js');
    const inMemReport = inMemoryCompletionReports.get(checklistId);
    if (inMemReport) {
      reasons.push('Technical installation / site work completion report exists in system');
    } else {
      const { data: dbReports } = await supabase
        .from('technical_installation_reports')
        .select('id, completion_status')
        .eq('checklist_id', checklistId)
        .limit(1);
      if (dbReports && dbReports.length > 0) {
        reasons.push('Technical installation / site work completion report is recorded in database');
      }
    }
  } catch (e) {}

  // 4. Device carry records check
  try {
    const { inMemoryCarryRecords } = await import('./workflowService.js');
    const inMemCarry = inMemoryCarryRecords.get(checklistId);
    if (inMemCarry && inMemCarry.items && inMemCarry.items.length > 0) {
      reasons.push('Technician device carry record has been registered for this job');
    } else {
      const { data: dbCarry } = await supabase
        .from('job_device_carry_records')
        .select('id')
        .eq('checklist_id', checklistId)
        .limit(1);
      if (dbCarry && dbCarry.length > 0) {
        reasons.push('Technician device carry record exists in database');
      }
    }
  } catch (e) {}

  // 5. Store material requirement & stock issuance check
  try {
    const { inMemoryStoreRequirements } = await import('./storeRequirementService.js');
    const inMemReq = inMemoryStoreRequirements.get(checklistId);
    if (
      inMemReq &&
      (inMemReq.status === 'ISSUED' ||
        inMemReq.status === 'PARTIALLY_ISSUED' ||
        inMemReq.material_issuance_status === 'ISSUED' ||
        inMemReq.devices_issuance_status === 'ISSUED' ||
        (inMemReq.devices_issued && inMemReq.devices_issued > 0) ||
        (inMemReq.materials_issued && inMemReq.materials_issued > 0))
    ) {
      reasons.push('Store Manager has issued inventory devices/materials for this requirement');
    } else {
      const { data: dbReq } = await supabase
        .from('store_material_requirements')
        .select('id, status, material_issuance_status')
        .eq('checklist_id', checklistId)
        .maybeSingle();
      if (
        dbReq &&
        (dbReq.status === 'ISSUED' ||
          dbReq.status === 'PARTIALLY_ISSUED' ||
          dbReq.material_issuance_status === 'ISSUED')
      ) {
        reasons.push('Store Manager has issued inventory devices/materials for this requirement');
      }
    }
  } catch (e) {}

  // 6. Stock movements / Inventory transactions check
  try {
    const { inMemoryStockMovements } = await import('./stockMovementService.js');
    const inMemMovements = inMemoryStockMovements.filter((m) => m.checklist_id === checklistId);
    if (inMemMovements.length > 0) {
      reasons.push(`${inMemMovements.length} inventory stock movement transaction(s) recorded in stock ledger`);
    } else {
      const { data: dbMovements } = await supabase
        .from('stock_movements')
        .select('id')
        .eq('checklist_id', checklistId)
        .limit(1);
      if (dbMovements && dbMovements.length > 0) {
        reasons.push('Inventory stock movement transactions are recorded in stock ledger');
      }
    }
  } catch (e) {}

  // 7. Device & Material Returns check
  try {
    const { inMemoryReturns, inMemoryMaterialReturns } = await import('./workflowService.js');
    const devReturns = Array.from(inMemoryReturns.values()).filter((r) => r.checklist_id === checklistId);
    const matReturns = Array.from(inMemoryMaterialReturns.values()).filter((r) => r.checklist_id === checklistId);
    if (devReturns.length > 0 || matReturns.length > 0) {
      reasons.push('Device or material return / verification records are attached');
    } else {
      const { data: dbDevRet } = await supabase
        .from('store_device_returns')
        .select('id')
        .eq('checklist_id', checklistId)
        .limit(1);
      if (dbDevRet && dbDevRet.length > 0) {
        reasons.push('Device return verification records are recorded in database');
      }
    }
  } catch (e) {}

  // 8. Technician job expenses check
  try {
    const { inMemoryJobExpenses } = await import('./expenseService.js');
    const inMemExpenses = Array.from(inMemoryJobExpenses.values()).filter(
      (e) => e.checklist_id === checklistId && (e.status === 'Recorded' || e.amount > 0)
    );
    if (inMemExpenses.length > 0) {
      reasons.push(`${inMemExpenses.length} technician expense claim(s) recorded`);
    } else {
      const { data: dbExpenses } = await supabase
        .from('job_expenses')
        .select('id')
        .eq('checklist_id', checklistId)
        .limit(1);
      if (dbExpenses && dbExpenses.length > 0) {
        reasons.push('Technician job expense claims recorded in database');
      }
    }
  } catch (e) {}

  // 9. Schedule extension & revision requests check
  try {
    const { inMemoryExtensions } = await import('./scheduleExtensionService.js');
    const activeExtensions = Array.from(inMemoryExtensions.values()).filter(
      (ext) => ext.checklist_id === checklistId && (ext.status === 'APPROVED' || ext.status === 'PENDING')
    );
    if (activeExtensions.length > 0) {
      reasons.push('Active or approved schedule extension request exists');
    } else {
      const { data: dbExt } = await supabase
        .from('schedule_extension_requests')
        .select('id, status')
        .eq('checklist_id', checklistId)
        .in('status', ['APPROVED', 'PENDING'])
        .limit(1);
      if (dbExt && dbExt.length > 0) {
        reasons.push('Active or approved schedule extension request exists in database');
      }
    }
  } catch (e) {}

  // 10. Coordinator bookings check (arranged travel or hotel accommodation)
  try {
    const { inMemoryBookings } = await import('./coordinatorBookingService.js');
    const booking = inMemoryBookings.get(checklistId);
    if (
      booking &&
      (booking.booking_status === 'COMPLETED' ||
        booking.booking_status === 'IN_PROGRESS' ||
        (booking.travel_required && (booking.ticket_reference || booking.travel_datetime)) ||
        (booking.accommodation_required && (booking.hotel_booking_reference || booking.hotel_name)))
    ) {
      reasons.push(`Travel or hotel accommodation has been arranged (Booking status: ${booking.booking_status || 'ARRANGED'})`);
    } else {
      const { data: dbBooking } = await supabase
        .from('coordinator_bookings')
        .select('*')
        .eq('checklist_id', checklistId)
        .maybeSingle();
      if (
        dbBooking &&
        (dbBooking.booking_status === 'COMPLETED' ||
          dbBooking.booking_status === 'IN_PROGRESS' ||
          (dbBooking.travel_required && (dbBooking.ticket_reference || dbBooking.travel_datetime)) ||
          (dbBooking.accommodation_required && (dbBooking.hotel_booking_reference || dbBooking.hotel_name)))
      ) {
        reasons.push(`Travel or hotel accommodation has been arranged (Booking status: ${dbBooking.booking_status || 'ARRANGED'})`);
      }
    }
  } catch (e) {}

  const isEligible = reasons.length === 0;

  return {
    checklistId,
    checklistNumber: checklist.checklist_number,
    clientName: checklist.client_name,
    installationStatus: checklist.installation_status,
    isEligible,
    canPermanentDelete: isEligible,
    reasons,
    canCancel: checklist.installation_status !== 'Cancelled',
    checklist,
  };
}

/**
 * Safely delete an installation checklist.
 * Only unprocessed drafts with no dependent records can be deleted.
 * Rejects with 409 if dependencies or status protect the record.
 */
export async function safeDeleteChecklist(id, user = null) {
  const existing = await getChecklistById(id, { enrich: false });
  const eligibility = await checkChecklistDeletionEligibility(existing);

  if (!eligibility.isEligible) {
    const error = new Error(
      `Cannot permanently delete checklist ${existing.checklist_number}: ${eligibility.reasons.join('; ')}`
    );
    error.statusCode = 409;
    error.reasons = eligibility.reasons;
    error.canCancel = eligibility.canCancel;
    error.checklist = {
      id: existing.id,
      checklist_number: existing.checklist_number,
      client_name: existing.client_name,
      installation_status: existing.installation_status,
    };
    throw error;
  }

  // 1. Release engineer booking if an engineer was reserved for this draft
  await releaseEngineerBooking({ checklistId: existing.id });

  // 2. Safely remove unissued draft store requirement (if any)
  try {
    await supabase.from('store_material_requirements').delete().eq('checklist_id', existing.id);
    const { inMemoryStoreRequirements } = await import('./storeRequirementService.js');
    inMemoryStoreRequirements.delete(existing.id);
  } catch (e) {}

  // 3. Safely remove unarranged draft coordinator booking (if any)
  try {
    await supabase.from('coordinator_bookings').delete().eq('checklist_id', existing.id);
    const { inMemoryBookings, inMemoryAuditLogs } = await import('./coordinatorBookingService.js');
    inMemoryBookings.delete(existing.id);
    inMemoryAuditLogs.delete(existing.id);
  } catch (e) {}

  // 4. Delete the checklist record from installation_checklists
  const { error } = await supabase
    .from('installation_checklists')
    .delete()
    .eq('id', existing.id);

  if (error) {
    console.error('Database delete error for checklist:', error);
    throw new Error(error.message || 'Failed to delete installation checklist from database');
  }

  // 5. Clean runtime in-memory caches
  inMemoryChecklistExtraConfigs.delete(existing.id);
  inMemoryChecklistBomSnapshots.delete(existing.id);
  inMemoryChecklistSchedules.delete(existing.id);

  // 6. Record audit entry
  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'COORDINATOR',
      action: 'DELETE_CHECKLIST',
      target_table: 'installation_checklists',
      target_id: existing.id,
      details: {
        checklist_number: existing.checklist_number,
        client_name: existing.client_name,
        service_engineer: existing.service_engineer,
        installation_status: existing.installation_status,
        safe_delete: true,
      },
    });
  } catch (auditErr) {
    console.warn('Could not record checklist deletion audit:', auditErr.message);
  }

  return {
    success: true,
    deletedId: existing.id,
    checklistNumber: existing.checklist_number,
    message: `Checklist ${existing.checklist_number} (${existing.client_name}) was permanently deleted.`,
  };
}

/**
 * Preview bulk checklist deletion eligibility across records.
 * Identifies eligible drafts vs protected operational records.
 */
export async function previewChecklistsDeletion(params = {}) {
  const checklistResult = await getChecklists({
    limit: 1000,
    search: params.search ? params.search.trim() : '',
    serviceEngineer: params.engineer && params.engineer !== 'ALL' ? params.engineer : '',
    status: params.status && params.status !== 'ALL' ? params.status : '',
  });

  const rawList = checklistResult?.checklists || [];

  const eligibleChecklists = [];
  const protectedChecklists = [];

  const evaluated = await Promise.all(
    rawList.map(async (chk) => {
      try {
        const el = await checkChecklistDeletionEligibility(chk);
        return { chk, el };
      } catch (e) {
        return {
          chk,
          el: {
            isEligible: false,
            reasons: [`Error evaluating eligibility: ${e.message}`],
            canCancel: false,
          },
        };
      }
    })
  );

  for (const { chk, el } of evaluated) {
    if (el.isEligible) {
      eligibleChecklists.push({
        id: chk.id,
        checklist_number: chk.checklist_number,
        client_name: chk.client_name,
        installation_status: chk.installation_status,
        service_engineer: chk.service_engineer,
        created_at: chk.created_at,
      });
    } else {
      protectedChecklists.push({
        id: chk.id,
        checklist_number: chk.checklist_number,
        client_name: chk.client_name,
        installation_status: chk.installation_status,
        service_engineer: chk.service_engineer,
        reasons: el.reasons,
        canCancel: el.canCancel,
      });
    }
  }

  return {
    totalCount: rawList.length,
    eligibleCount: eligibleChecklists.length,
    protectedCount: protectedChecklists.length,
    eligibleChecklists,
    protectedChecklists,
    explanation:
      'Active assignments, completed reports, inventory transactions, and related business records prevent permanent deletion to preserve operational history and stock accountability.',
  };
}

/**
 * Delete all eligible draft checklists safely.
 * Requires confirmation of the actual eligible count before executing.
 * Never truncates tables or resets IDs.
 */
export async function safeDeleteAllEligibleChecklists({ user, confirmedCount, params = {} }) {
  const preview = await previewChecklistsDeletion(params);

  if (confirmedCount === undefined || confirmedCount === null) {
    const err = new Error('Explicit confirmation of the eligible checklist count is required before proceeding.');
    err.statusCode = 400;
    err.preview = preview;
    throw err;
  }

  const parsedConfirmed = Number(confirmedCount);
  if (parsedConfirmed !== preview.eligibleCount) {
    const err = new Error(
      `Confirmation count mismatch: Confirmed count (${parsedConfirmed}) does not match current eligible count (${preview.eligibleCount}). Checklist records may have changed. Please refresh and review before confirming.`
    );
    err.statusCode = 400;
    err.preview = preview;
    throw err;
  }

  if (preview.eligibleCount === 0) {
    return {
      success: true,
      totalProcessed: preview.totalCount,
      deletedCount: 0,
      skippedCount: preview.protectedCount,
      failedCount: 0,
      deletedChecklists: [],
      skippedChecklists: preview.protectedChecklists,
      failures: [],
      message: 'No eligible draft checklists were found to delete. All checklists are protected.',
    };
  }

  const deletedChecklists = [];
  const failures = [];

  for (const item of preview.eligibleChecklists) {
    try {
      await safeDeleteChecklist(item.id, user);
      deletedChecklists.push({
        id: item.id,
        checklist_number: item.checklist_number,
        client_name: item.client_name,
      });
    } catch (err) {
      console.error(`Failed to delete eligible checklist ${item.checklist_number}:`, err.message);
      failures.push({
        id: item.id,
        checklist_number: item.checklist_number,
        client_name: item.client_name,
        error: err.message,
      });
    }
  }

  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'COORDINATOR',
      action: 'BULK_DELETE_CHECKLISTS',
      target_table: 'installation_checklists',
      target_id: 'bulk',
      details: {
        totalEvaluated: preview.totalCount,
        eligibleCount: preview.eligibleCount,
        deletedCount: deletedChecklists.length,
        skippedProtectedCount: preview.protectedCount,
        failedCount: failures.length,
      },
    });
  } catch (auditErr) {
    console.warn('Could not record bulk deletion audit:', auditErr.message);
  }

  return {
    success: failures.length === 0,
    totalProcessed: preview.totalCount,
    deletedCount: deletedChecklists.length,
    skippedCount: preview.protectedCount,
    failedCount: failures.length,
    deletedChecklists,
    skippedChecklists: preview.protectedChecklists,
    failures,
    message:
      failures.length === 0
        ? `Successfully deleted ${deletedChecklists.length} eligible draft checklist(s). ${preview.protectedCount} protected checklist(s) were preserved.`
        : `Deleted ${deletedChecklists.length} checklist(s). ${failures.length} failed. ${preview.protectedCount} protected checklist(s) were preserved.`,
  };
}

/**
 * Cancel a checklist when permanent deletion is unsafe.
 * Releases engineer booking while preserving all reports, inventory, expenses, and history.
 */
export async function cancelChecklist({ checklistId, user, reason = 'Cancelled by Coordinator' }) {
  const existing = await getChecklistById(checklistId, { enrich: false });

  if (existing.installation_status === 'Cancelled') {
    return {
      success: true,
      message: `Checklist ${existing.checklist_number} is already cancelled.`,
      checklist: existing,
    };
  }

  const updatedRemarks = existing.remarks
    ? `${existing.remarks} [CANCELLED: ${reason}]`
    : `[CANCELLED: ${reason}]`;

  const updated = await updateChecklist(existing.id, {
    installation_status: 'Cancelled',
    remarks: updatedRemarks,
  });

  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'COORDINATOR',
      action: 'CANCEL_CHECKLIST',
      target_table: 'installation_checklists',
      target_id: existing.id,
      details: {
        checklist_number: existing.checklist_number,
        client_name: existing.client_name,
        reason,
        previous_status: existing.installation_status,
      },
    });
  } catch (e) {}

  return {
    success: true,
    message: `Checklist ${existing.checklist_number} has been cancelled. All operational reports, inventory records, and audit history are safely preserved.`,
    checklist: updated,
  };
}

/**
 * Backward-compatible deleteChecklist that delegates to safeDeleteChecklist
 */
export async function deleteChecklist(id, user = null) {
  return await safeDeleteChecklist(id, user);
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
