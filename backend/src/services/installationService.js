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
import { notifyChecklistCreated } from './pushNotificationService.js';
import { getPendingExtensionForChecklist } from './scheduleExtensionService.js';
import { logAudit } from './auditService.js';

import config from '../config.js';

// In-memory structured extra configurations cache for active runtime sessions
export const inMemoryChecklistExtraConfigs = new Map();
export const inMemoryChecklistBomSnapshots = new Map();
export const inMemoryChecklistSchedules = new Map();

/**
 * Calculate tomorrow date string YYYY-MM-DD based on configured business timezone
 */
export function getBusinessTomorrow(timeZone = config?.timezone || 'Asia/Kolkata', date = new Date()) {
  const todayStr = (date instanceof Date ? date : new Date(date)).toLocaleDateString('en-CA', { timeZone });
  const [y, m, d] = todayStr.split('-').map(Number);
  const tomorrowDate = new Date(Date.UTC(y, m - 1, d + 1));
  return tomorrowDate.toISOString().split('T')[0];
}

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
export async function createChecklist(adminUserId, data, options = {}) {
  // Strict next-day-only work-start booking rule
  // Sales can create and submit a new installation or service checklist only when its work starting date is exactly tomorrow
  if (options?.enforceNextDayBooking || data?.enforceNextDayBooking) {
    const businessTomorrow = getBusinessTomorrow(config?.timezone);
    if (data.expected_arrival_date !== businessTomorrow) {
      const err = new Error('Jobs can only be scheduled to start tomorrow. Advance pre-booking is not allowed.');
      err.statusCode = 400;
      throw err;
    }
  }

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
  const isCouriered = data.delivery_method === 'Product Couriered';
  let initialStatus = data.installation_status;
  if (!initialStatus) {
    initialStatus = (data.service_engineer && data.expected_arrival_date) ? 'Assigned' : (isCouriered ? 'Assign Later' : 'Assigned');
  }

  // Technician Carries cannot be created directly as Completed
  if (!isCouriered && initialStatus === 'Completed') {
    const err = new Error('Technician Carries installations cannot be created as Completed directly. They must be completed through the Post-Installation Form.');
    err.statusCode = 400;
    throw err;
  }

  const isAssignLater = initialStatus === 'Assign Later';
  const engineerName = data.service_engineer ? data.service_engineer.trim() : null;
  const startDate = data.expected_arrival_date || null;
  const duration = data.installation_duration ? data.installation_duration.trim() : (isCouriered || isAssignLater ? null : '1 Day');
  let bookingEndDate = null;
  let resolvedEng = null;

  // For Technician Carries jobs: strictly require arrival date, duration and service engineer UNLESS Assign Later
  if (!isCouriered && !isAssignLater) {
    if (!startDate) {
      const err = new Error('Expected Date of Arrival is required for Technician Carries');
      err.statusCode = 400;
      throw err;
    }
    if (!engineerName) {
      const err = new Error('Service Engineer is required for Technician Carries');
      err.statusCode = 400;
      throw err;
    }
  }

  // If Product Couriered and no engineer/startDate provided, ensure status is Assign Later
  if (isCouriered && (!engineerName || !startDate) && initialStatus !== 'Completed') {
    initialStatus = 'Assign Later';
  }

  if (engineerName && startDate) {
    resolvedEng = resolveEngineer(engineerName);
    bookingEndDate = calculateBookingEndDate(startDate, duration || '1 Day');

    // Validate availability before creating checklist (throws 409 conflict if already booked)
    const availCheck = await checkEngineerAvailability({
      engineerIdOrName: resolvedEng ? resolvedEng.id : engineerName,
      startDate,
      endDate: bookingEndDate,
      duration: duration || '1 Day',
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
    expected_arrival_time: data.expected_arrival_time ? data.expected_arrival_time.trim() : (isCouriered || isAssignLater ? null : '10:00 AM'),
    original_expected_arrival_date: startDate,
    original_expected_arrival_time: data.expected_arrival_time ? data.expected_arrival_time.trim() : (isCouriered || isAssignLater ? null : '10:00 AM'),
    original_installation_duration: duration,
    original_booking_end_date: bookingEndDate,
    current_expected_arrival_date: startDate,
    current_expected_arrival_time: data.expected_arrival_time ? data.expected_arrival_time.trim() : (isCouriered || isAssignLater ? null : '10:00 AM'),
    current_installation_duration: duration,
    current_booking_end_date: bookingEndDate,
    schedule_revision_number: 0,
    schedule_last_updated_at: new Date().toISOString(),
    installation_or_service: data.installation_or_service || 'Installation',
    salesperson_name: data.salesperson_name ? data.salesperson_name.trim() : null,
    service_engineer: engineerName,
    service_engineer_id: resolvedEng ? resolvedEng.id : null,
    booking_end_date: bookingEndDate,
    service_assistant: data.service_assistant ? data.service_assistant.trim() : null,
    delivery_method: data.delivery_method || 'Technician Carries',
    courier_dispatch_status: data.delivery_method === 'Product Couriered' ? 'NOT_DISPATCHED' : 'NOT_APPLICABLE',
    is_courier_dispatched: false,
    installation_status: initialStatus,
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
      error.message?.includes('Could not find') ||
      error.message?.includes('device_configurations') ||
      error.message?.includes('extra_device_configurations') ||
      error.message?.includes('service_engineer_id') ||
      error.message?.includes('booking_end_date') ||
      error.message?.includes('bom_snapshot') ||
      error.message?.includes('material_issuance_status') ||
      error.message?.includes('salesperson_name')
    ) {
      let fallbackPayload = { ...payload };
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

      let lastErr = error;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: res2, error: err2 } = await supabase
          .from('installation_checklists')
          .insert(fallbackPayload)
          .select()
          .single();
        if (!err2) {
          inserted = {
            ...payload,
            ...res2,
            courier_dispatch_status: payload.delivery_method === 'Product Couriered'
              ? (res2.courier_dispatch_status && res2.courier_dispatch_status !== 'NOT_APPLICABLE' ? res2.courier_dispatch_status : 'NOT_DISPATCHED')
              : (res2.courier_dispatch_status || payload.courier_dispatch_status),
            is_courier_dispatched: res2.is_courier_dispatched ?? payload.is_courier_dispatched,
            booking_end_date: payload.booking_end_date,
            original_booking_end_date: payload.original_booking_end_date,
            current_booking_end_date: payload.current_booking_end_date,
            id: res2.id,
          };
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
          lastErr = null;
          break;
        }
        lastErr = err2;
        const colMatch = err2.message?.match(/Could not find the '([^']+)' column/);
        if (colMatch && colMatch[1] && fallbackPayload[colMatch[1]] !== undefined) {
          delete fallbackPayload[colMatch[1]];
        } else {
          break;
        }
      }
      if (lastErr) throw lastErr;
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
      status: (data.installation_status === 'Completed' || data.installation_status === 'Site Work Completed') ? 'COMPLETED' : 'ASSIGNED',
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

    // Trigger Mobile Web Push notifications to all subscribed active team members (fault-tolerant)
    try {
      await notifyChecklistCreated(inserted).catch((pushErr) => {
        console.warn('[PUSH_NOTIF_WARN] Could not dispatch mobile push notification:', pushErr.message);
      });
    } catch (pushErr) {
      console.warn('[PUSH_NOTIF_ERROR] Failed to invoke push notification service:', pushErr.message);
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

  const { data, error } = await query.maybeSingle();

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

  const effectiveDeliveryMethod = data.delivery_method !== undefined ? data.delivery_method : (existing.delivery_method || 'Technician Carries');
  const isCouriered = effectiveDeliveryMethod === 'Product Couriered';

  const newEngName = data.service_engineer !== undefined ? (data.service_engineer ? data.service_engineer.trim() : null) : (existing.service_engineer || null);
  const newStartDate = data.expected_arrival_date !== undefined ? (data.expected_arrival_date || null) : (existing.expected_arrival_date || null);
  const newDuration = data.installation_duration !== undefined
    ? (data.installation_duration ? data.installation_duration.trim() : null)
    : (existing.installation_duration || (isCouriered ? null : '1 Day'));
  let newStatus = data.installation_status !== undefined ? data.installation_status : existing.installation_status;

  // Completed check:
  if (newStatus === 'Completed' && existing.installation_status !== 'Completed') {
    if (!isCouriered) {
      const err = new Error('Technician Carries checklists must become Completed through the Post-Installation Form submission workflow. Manual completion is not permitted.');
      err.statusCode = 400;
      throw err;
    } else {
      const hasTech = Boolean(newEngName || existing.service_engineer);
      if (hasTech) {
        const err = new Error('When a technician is assigned to a couriered order, installation must be completed via the Post-Installation Form submitted by the technician.');
        err.statusCode = 400;
        throw err;
      }
      const confirmNotes = (data.remarks || data.completion_notes || '').trim();
      if (!confirmNotes) {
        const err = new Error('Customer confirmation note is required to mark independent customer installation as Completed.');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // For Technician Carries: strictly require date and engineer UNLESS Assign Later
  if (!isCouriered && newStatus !== 'Assign Later' && newStatus !== 'Completed') {
    if (!newStartDate) {
      const err = new Error('Expected Date of Arrival is required for Technician Carries');
      err.statusCode = 400;
      throw err;
    }
    if (!newEngName) {
      const err = new Error('Service Engineer is required for Technician Carries');
      err.statusCode = 400;
      throw err;
    }
  }

  // If work starting date is being scheduled or changed, enforce strict next-day-only work-start booking rule
  if (newStartDate && newStartDate !== existing.expected_arrival_date && newStatus !== 'Assign Later') {
    const businessTomorrow = getBusinessTomorrow(config?.timezone);
    if (newStartDate !== businessTomorrow) {
      const err = new Error('Jobs can only be scheduled to start tomorrow. Advance pre-booking is not allowed.');
      err.statusCode = 400;
      throw err;
    }
  }

  // If previously Assign Later or unscheduled and now both engineer and date are provided, ensure status is Assigned
  if (newEngName && newStartDate && newStatus !== 'Completed') {
    newStatus = 'Assigned';
  } else if (!newEngName && !newStartDate && newStatus !== 'Completed') {
    newStatus = 'Assign Later';
  }

  let newBookingEndDate = existing.booking_end_date;
  let resolvedEng = existing.service_engineer_id ? { id: existing.service_engineer_id, name: existing.service_engineer } : resolveEngineer(newEngName);

  if (newStatus === 'Cancelled' || newStatus === 'Assign Later') {
    // Release booking if cancelled or postponed to Assign Later
    if (existing.service_engineer) {
      await releaseEngineerBooking({ checklistId: existing.id });
    }
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
    delivery_method: data.delivery_method !== undefined ? data.delivery_method : (existing.delivery_method || 'Technician Carries'),
    courier_dispatch_status: data.courier_dispatch_status !== undefined ? data.courier_dispatch_status : (existing.courier_dispatch_status || 'NOT_APPLICABLE'),
    installation_status: (existing.installation_status === 'Completed' || newStatus === 'Completed')
      ? 'Completed'
      : (newStatus === 'Assign Later' ? 'Assign Later' : 'Assigned'),
    payment_status: paymentStatus,
    bom_snapshot: updatedBomSnapshot,
    material_issuance_status: isInstallation
      ? (data.material_issuance_status || existing.material_issuance_status || 'PENDING')
      : 'NOT_APPLICABLE',
    remarks: data.remarks !== undefined ? (data.remarks ? data.remarks.trim() : null) : existing.remarks,
    client_confirmation: data.client_confirmation || existing.client_confirmation,
    updated_at: new Date().toISOString(),
  };

  // If customer self-installation is marked Completed, record completion metadata
  const isTechnicianJob = effectiveDeliveryMethod === 'Technician Carries' || Boolean(newEngName || existing.service_engineer);
  const isCustomerSelfInstallCompletion = isCouriered && !isTechnicianJob && newStatus === 'Completed' && existing.installation_status !== 'Completed';

  if (isCustomerSelfInstallCompletion) {
    const completionTimestamp = new Date().toISOString();
    payload.completion_type = 'CUSTOMER_INSTALLED';
    payload.actual_completion_at = completionTimestamp;
    payload.actual_completion_datetime = completionTimestamp;
    payload.completed_by_name = data.salesperson_name || existing.salesperson_name || 'Sales';
    payload.completion_notes = data.remarks || 'Confirmed customer independent installation';
  }

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
      error.message?.includes('Could not find') ||
      error.message?.includes('device_configurations') ||
      error.message?.includes('extra_device_configurations') ||
      error.message?.includes('service_engineer_id') ||
      error.message?.includes('booking_end_date') ||
      error.message?.includes('bom_snapshot') ||
      error.message?.includes('material_issuance_status') ||
      error.message?.includes('salesperson_name')
    ) {
      let fallbackPayload = { ...payload };
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

      let lastErr = error;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: res2, error: err2 } = await supabase
          .from('installation_checklists')
          .update(fallbackPayload)
          .eq('id', existing.id)
          .select()
          .single();
        if (!err2) {
          updated = {
            ...existing,
            ...payload,
            ...res2,
            courier_dispatch_status: (res2.courier_dispatch_status && res2.courier_dispatch_status !== 'NOT_APPLICABLE')
              ? res2.courier_dispatch_status
              : (payload.courier_dispatch_status || existing.courier_dispatch_status),
            id: existing.id,
          };
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
          lastErr = null;
          break;
        }
        lastErr = err2;
        const colMatch = err2.message?.match(/Could not find the '([^']+)' column/);
        if (colMatch && colMatch[1] && fallbackPayload[colMatch[1]] !== undefined) {
          delete fallbackPayload[colMatch[1]];
        } else {
          break;
        }
      }
      if (lastErr) throw lastErr;
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

  // Critical Rule 1: When an installation date is extended or changed, the affected room booking must automatically change to Pending Review
  const datesChanged = Boolean(
    (newStartDate && existing.expected_arrival_date && newStartDate !== existing.expected_arrival_date) ||
    (newBookingEndDate && existing.booking_end_date && newBookingEndDate !== existing.booking_end_date) ||
    (newDuration && existing.installation_duration && newDuration !== existing.installation_duration)
  );

  if (datesChanged && updated?.id) {
    try {
      const { handleInstallationDateChange } = await import('./coordinatorBookingService.js');
      await handleInstallationDateChange({
        checklistId: updated.id,
        oldStartDate: existing.expected_arrival_date,
        newStartDate: newStartDate,
        oldEndDate: existing.booking_end_date,
        newEndDate: newBookingEndDate,
        reason: `Installation schedule updated to start: ${newStartDate || existing.expected_arrival_date}, end: ${newBookingEndDate || existing.booking_end_date}`,
      });
    } catch (dateErr) {
      console.warn('Could not update coordinator room booking on date change:', dateErr.message);
    }
  }

  return normalizeChecklistDeviceConfigs(updated);
}

/**
 * Computes deletion impact and counts all dependent records across the workflow
 * created specifically from a checklist.
 */
export async function getChecklistDeletionImpact(checklistIdOrObj) {
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

  // Query counts of all dependent records tied specifically to this checklist
  const [
    { count: storeBomCount },
    { count: engineerBookingCount },
    { count: coordBookingCount },
    { count: coordAuditCount },
    { count: techReportsCount },
    { count: techExpensesCount },
    { count: devReturnsCount },
    { count: matReturnsCount },
    { count: backupDeclCount },
    { count: carryRecordsCount },
    { count: extensionsCount },
    { count: notifCount },
  ] = await Promise.all([
    supabase.from('store_material_requirements').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('engineer_bookings').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('coordinator_bookings').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('coordinator_booking_audit_logs').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('technical_installation_reports').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('job_expenses').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('job_device_returns').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('job_material_returns').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('pre_installation_backup_declarations').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('job_device_carry_records').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('schedule_extension_requests').select('*', { count: 'exact', head: true }).eq('checklist_id', checklistId),
    supabase.from('app_notifications').select('*', { count: 'exact', head: true }).or(`checklist_id.eq.${checklistId},metadata->>checklist_id.eq.${checklistId}`),
  ]);

  const impact = {
    checklist: 1,
    storeBoms: storeBomCount || 0,
    engineerBookings: engineerBookingCount || 0,
    coordinatorBookings: coordBookingCount || 0,
    coordinatorAuditLogs: coordAuditCount || 0,
    technicianReports: techReportsCount || 0,
    technicianExpenses: techExpensesCount || 0,
    deviceReturns: devReturnsCount || 0,
    materialReturns: matReturnsCount || 0,
    backupDeclarations: backupDeclCount || 0,
    carryRecords: carryRecordsCount || 0,
    scheduleExtensions: extensionsCount || 0,
    notifications: notifCount || 0,
  };

  const totalDependentRecords =
    impact.storeBoms +
    impact.engineerBookings +
    impact.coordinatorBookings +
    impact.coordinatorAuditLogs +
    impact.technicianReports +
    impact.technicianExpenses +
    impact.deviceReturns +
    impact.materialReturns +
    impact.backupDeclarations +
    impact.carryRecords +
    impact.scheduleExtensions +
    impact.notifications;

  const dependentRecordsBreakdown = [
    { label: 'Store BOM Material Requirements', count: impact.storeBoms },
    { label: 'Engineer Appointment / Booking Schedule', count: impact.engineerBookings },
    { label: 'Coordinator Travel / Room Bookings', count: impact.coordinatorBookings },
    { label: 'Coordinator Workflow Audit Entries', count: impact.coordinatorAuditLogs },
    { label: 'Technician Completion Reports & Tasks', count: impact.technicianReports },
    { label: 'Technician Job Expenses', count: impact.technicianExpenses },
    { label: 'Device & Material Return Records', count: impact.deviceReturns + impact.materialReturns },
    { label: 'Pre-Installation Backup Declarations', count: impact.backupDeclarations },
    { label: 'Device Carry Audit Records', count: impact.carryRecords },
    { label: 'Schedule Revision Requests', count: impact.scheduleExtensions },
    { label: 'Checklist-Generated Notifications', count: impact.notifications },
  ].filter((item) => item.count > 0);

  return {
    checklistId: checklist.id,
    checklistNumber: checklist.checklist_number,
    clientName: checklist.client_name,
    clientMobile: checklist.client_mobile,
    installationStatus: checklist.installation_status,
    isEligible: true,
    eligible: true,
    canPermanentDelete: true,
    reasons: [],
    impact: { ...impact, totalDependentRecords },
    dependentRecordsBreakdown,
    message: totalDependentRecords > 0
      ? `Deleting this checklist will permanently delete the original checklist and ${totalDependentRecords} dependent workflow record(s) across Store, Coordinator, and Technician modules.`
      : 'This checklist has no dependent workflow records. Only the original checklist will be deleted.',
    checklist,
  };
}

/**
 * Check if a checklist is eligible for permanent deletion and calculate workflow dependencies.
 * Fully allows authorized Sales, Coordinator, and Admin users to delete checklists.
 */
export async function checkChecklistDeletionEligibility(checklistIdOrObj) {
  return await getChecklistDeletionImpact(checklistIdOrObj);
}

/**
 * Safely and permanently deletes an installation checklist and its entire workflow.
 * Propagates through all dependent records (BOM, bookings, technician assignments,
 * reports, expenses, returns, declarations, notifications, and local storage caches)
 * so that no orphaned records remain.
 */
export async function safeDeleteChecklist(id, user = null) {
  const existing = await getChecklistById(id, { enrich: false });
  if (!existing) {
    const err = new Error(`Checklist with ID "${id}" not found.`);
    err.statusCode = 404;
    throw err;
  }

  const checklistId = existing.id;
  const checklistNumber = existing.checklist_number;

  // 1. Evaluate impact prior to deletion for reporting and audit
  let impactData = null;
  try {
    impactData = await getChecklistDeletionImpact(checklistId);
  } catch (e) {
    impactData = { impact: { totalDependentRecords: 0 }, dependentRecordsBreakdown: [] };
  }

  // 2. Cascade delete dependent child records in strict reverse dependency order:

  // a. Technical report items and reports
  try {
    const { data: techReports } = await supabase
      .from('technical_installation_reports')
      .select('id')
      .eq('checklist_id', checklistId);
    if (techReports && techReports.length > 0) {
      const repIds = techReports.map((r) => r.id);
      await supabase.from('technical_installation_report_items').delete().in('report_id', repIds);
    }
    await supabase.from('technical_installation_reports').delete().eq('checklist_id', checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning technical reports: ${err.message}`);
  }

  // b. Pre-installation backup items and declarations
  try {
    const { data: backupDecls } = await supabase
      .from('pre_installation_backup_declarations')
      .select('id')
      .eq('checklist_id', checklistId);
    if (backupDecls && backupDecls.length > 0) {
      const declIds = backupDecls.map((d) => d.id);
      await supabase.from('pre_installation_backup_items').delete().in('declaration_id', declIds);
    }
    await supabase.from('pre_installation_backup_declarations').delete().eq('checklist_id', checklistId);
    const { deleteBackupDeclarationForChecklist } = await import('./backupItemService.js');
    deleteBackupDeclarationForChecklist(checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning backup items: ${err.message}`);
  }

  // c. Device carry items and carry records
  try {
    const { data: carryRecs } = await supabase
      .from('job_device_carry_records')
      .select('id')
      .eq('checklist_id', checklistId);
    if (carryRecs && carryRecs.length > 0) {
      const carryIds = carryRecs.map((c) => c.id);
      await supabase.from('job_device_carry_items').delete().in('carry_record_id', carryIds);
    }
    await supabase.from('job_device_carry_records').delete().eq('checklist_id', checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning carry records: ${err.message}`);
  }

  // d. Job expenses
  try {
    await supabase.from('job_expenses').delete().eq('checklist_id', checklistId);
    const { deleteJobExpensesForChecklist } = await import('./expenseService.js');
    deleteJobExpensesForChecklist(checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning job expenses: ${err.message}`);
  }

  // e. Device and material returns
  try {
    await supabase.from('job_device_returns').delete().eq('checklist_id', checklistId);
    await supabase.from('job_material_returns').delete().eq('checklist_id', checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning returns: ${err.message}`);
  }

  // f. Store material requirements (BOM)
  try {
    await supabase.from('store_material_requirements').delete().eq('checklist_id', checklistId);
    const { inMemoryStoreRequirements } = await import('./storeRequirementService.js');
    inMemoryStoreRequirements.delete(checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning store requirements: ${err.message}`);
  }

  // g. Engineer bookings (Appointment schedule)
  try {
    const { deleteEngineerBookingForChecklist } = await import('./engineerBookingService.js');
    await deleteEngineerBookingForChecklist(checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning engineer booking: ${err.message}`);
  }

  // h. Coordinator bookings and audit logs
  try {
    await supabase.from('coordinator_booking_audit_logs').delete().eq('checklist_id', checklistId);
    await supabase.from('coordinator_bookings').delete().eq('checklist_id', checklistId);
    const { deleteCoordinatorBookingForChecklist } = await import('./coordinatorBookingService.js');
    deleteCoordinatorBookingForChecklist(checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning coordinator bookings: ${err.message}`);
  }

  // i. Schedule extension requests
  try {
    await supabase.from('schedule_extension_requests').delete().eq('checklist_id', checklistId);
    const { deleteScheduleExtensionsForChecklist } = await import('./scheduleExtensionService.js');
    deleteScheduleExtensionsForChecklist(checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning schedule extensions: ${err.message}`);
  }

  // j. Checklist notifications
  try {
    await supabase.from('app_notifications').delete().or(`checklist_id.eq.${checklistId},metadata->>checklist_id.eq.${checklistId}`);
    const { deleteNotificationsForChecklist } = await import('./appNotificationService.js');
    deleteNotificationsForChecklist(checklistId, checklistNumber);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning notifications: ${err.message}`);
  }

  // k. Release any reserved device stock allocations
  try {
    const { releaseDeviceAllocation, getDeviceStockAllocations } = await import('./deviceSetService.js');
    const allocations = await getDeviceStockAllocations();
    const active = allocations.filter((a) => a.checklist_id === checklistId && a.status === 'ALLOCATED');
    for (const alloc of active) {
      await releaseDeviceAllocation({
        allocation_id: alloc.id,
        reason: `Released due to checklist ${checklistNumber} deletion`,
        user,
      });
    }
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice releasing allocations: ${err.message}`);
  }

  // l. Clean workflow storage in-memory maps & file backing
  try {
    const { deleteWorkflowRecordsForChecklist } = await import('./workflowService.js');
    deleteWorkflowRecordsForChecklist(checklistId);
  } catch (err) {
    console.warn(`[ChecklistDeletion] Notice cleaning workflow storage: ${err.message}`);
  }

  // m. Clean in-memory caches in installationService
  inMemoryChecklistExtraConfigs.delete(checklistId);
  inMemoryChecklistBomSnapshots.delete(checklistId);
  inMemoryChecklistSchedules.delete(checklistId);

  // n. Permanently delete the checklist row from installation_checklists
  const { error: delErr } = await supabase
    .from('installation_checklists')
    .delete()
    .eq('id', checklistId);

  if (delErr) {
    console.error('Database delete error for checklist:', delErr);
    throw new Error(delErr.message || 'Failed to delete checklist from database');
  }

  // o. Record audit entry
  const userRole = (user?.role || 'SALES').toUpperCase();
  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: userRole,
      action: 'DELETE_CHECKLIST_WORKFLOW',
      target_table: 'installation_checklists',
      target_id: checklistId,
      details: {
        checklist_number: checklistNumber,
        client_name: existing.client_name,
        service_engineer: existing.service_engineer,
        installation_status: existing.installation_status,
        dependentRecordsRemoved: impactData?.impact?.totalDependentRecords || 0,
        breakdown: impactData?.dependentRecordsBreakdown || [],
      },
    });
  } catch (auditErr) {
    console.warn('Could not record checklist deletion audit:', auditErr.message);
  }

  const removedCount = impactData?.impact?.totalDependentRecords || 0;
  return {
    success: true,
    deletedId: checklistId,
    checklistNumber,
    clientName: existing.client_name,
    impact: impactData?.impact,
    dependentRecordsBreakdown: impactData?.dependentRecordsBreakdown || [],
    message: removedCount > 0
      ? `Checklist ${checklistNumber} (${existing.client_name}) and ${removedCount} associated workflow record(s) were permanently deleted.`
      : `Checklist ${checklistNumber} (${existing.client_name}) was permanently deleted.`,
  };
}

/**
 * Preview checklist deletion across records.
 * Evaluates impact and eligible checklists for deletion.
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
        const impact = await getChecklistDeletionImpact(chk);
        return { chk, impact, error: null };
      } catch (e) {
        return { chk, impact: null, error: e.message };
      }
    })
  );

  for (const { chk, impact, error } of evaluated) {
    if (!error && impact) {
      eligibleChecklists.push({
        id: chk.id,
        checklist_number: chk.checklist_number,
        client_name: chk.client_name,
        client_mobile: chk.client_mobile,
        installation_status: chk.installation_status,
        service_engineer: chk.service_engineer,
        created_at: chk.created_at,
        impact: impact.impact,
        dependentRecordsBreakdown: impact.dependentRecordsBreakdown,
      });
    } else {
      protectedChecklists.push({
        id: chk.id,
        checklist_number: chk.checklist_number,
        client_name: chk.client_name,
        reasons: [error || 'Unexpected error calculating deletion impact'],
      });
    }
  }

  return {
    totalCount: rawList.length,
    eligibleCount: eligibleChecklists.length,
    protectedCount: protectedChecklists.length,
    eligibleChecklists,
    protectedChecklists,
    explanation: 'Checklists and all of their generated workflow records (BOM, bookings, technician assignments, reports) will be permanently deleted.',
  };
}

/**
 * Delete all eligible checklists safely.
 * Requires confirmation of the actual eligible count before executing.
 */
export async function safeDeleteAllEligibleChecklists({ user, confirmedCount, params = {} }) {
  const preview = await previewChecklistsDeletion(params);

  if (confirmedCount === undefined || confirmedCount === null) {
    const err = new Error('Explicit confirmation of the checklist count is required before proceeding.');
    err.statusCode = 400;
    err.preview = preview;
    throw err;
  }

  const isExplicitToken =
    confirmedCount === 'CONFIRM_ALL_ELIGIBLE' ||
    confirmedCount === 'CONFIRM' ||
    confirmedCount === true;

  const parsedConfirmed = Number(confirmedCount);
  if (!isExplicitToken && parsedConfirmed !== preview.eligibleCount) {
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
      skippedCount: 0,
      failedCount: 0,
      deletedChecklists: [],
      skippedChecklists: [],
      failures: [],
      message: 'No checklists were found to delete.',
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
      console.error(`Failed to delete checklist ${item.checklist_number}:`, err.message);
      failures.push({
        id: item.id,
        checklist_number: item.checklist_number,
        client_name: item.client_name,
        error: err.message,
      });
    }
  }

  const userRole = (user?.role || 'SALES').toUpperCase();
  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: userRole,
      action: 'BULK_DELETE_CHECKLISTS',
      target_table: 'installation_checklists',
      target_id: 'bulk',
      details: {
        totalEvaluated: preview.totalCount,
        eligibleCount: preview.eligibleCount,
        deletedCount: deletedChecklists.length,
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
        ? `Successfully deleted ${deletedChecklists.length} checklist(s) and all associated workflow records.`
        : `Deleted ${deletedChecklists.length} checklist(s). ${failures.length} failed.`,
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
    { count: assignLater },
    { count: completed },
  ] = await Promise.all([
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }),
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }).eq('installation_status', 'Assigned'),
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }).eq('installation_status', 'Assign Later'),
    supabase.from('installation_checklists').select('*', { count: 'exact', head: true }).eq('installation_status', 'Completed'),
  ]);

  return {
    total: total || 0,
    assigned: assigned || 0,
    assignLater: assignLater || 0,
    completed: completed || 0,
    pending: assignLater || 0, // backward compatibility
  };
}
