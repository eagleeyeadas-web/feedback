import supabase from './supabase.js';
import {
  getAllServiceEngineers,
  calculateBookingEndDate,
  resolveEngineer,
  reserveEngineerAtomic,
  releaseEngineerBooking,
} from './engineerBookingService.js';

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

    // Concurrency-safe atomic reservation (throws 409 conflict if already booked)
    await reserveEngineerAtomic({
      engineerIdOrName: resolvedEng ? resolvedEng.id : engineerName,
      checklistId: null,
      checklistNumber,
      startDate,
      endDate: bookingEndDate,
      duration,
      user: { id: adminUserId },
      status: data.installation_status || 'Assigned',
    });
  }

  const payload = {
    checklist_number: checklistNumber,
    created_by: adminUserId,
    client_name: data.client_name.trim(),
    client_mobile: data.client_mobile.trim(),
    client_location: data.client_location ? data.client_location.trim() : '',
    google_maps_location: data.google_maps_location ? data.google_maps_location.trim() : null,
    device_type: data.device_type,
    number_of_devices: Number(data.number_of_devices),
    number_of_vehicles: Number(data.number_of_vehicles),
    extra_devices: Boolean(data.extra_devices),
    extra_device_type: data.extra_devices ? data.extra_device_type : null,
    extra_device_count: data.extra_devices ? (Number(data.extra_device_count) || null) : null,
    confirmed_price: confirmedPrice,
    payment_method: data.payment_method || 'UPI',
    advance_received: Boolean(data.advance_received),
    advance_amount: advanceAmount,
    pending_payment: Boolean(data.pending_payment),
    pending_amount: pendingAmount,
    installation_duration: duration,
    vehicle_type: data.vehicle_type === 'Other' && data.custom_vehicle_type ? data.custom_vehicle_type.trim() : (data.vehicle_type || 'Truck'),
    expected_arrival_date: startDate,
    expected_arrival_time: data.expected_arrival_time || null,
    installation_or_service: data.installation_or_service,
    service_engineer: engineerName,
    service_engineer_id: resolvedEng ? resolvedEng.id : null,
    booking_end_date: bookingEndDate,
    service_assistant: data.service_assistant ? data.service_assistant.trim() : '',
    installation_status: data.installation_status || 'Assigned',
    payment_status: paymentStatus,
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
    inserted = res;
  } catch (error) {
    // If service_engineer_id / booking_end_date columns are not migrated yet in PostgreSQL, retry without optional columns
    if (error.code === 'PGRST204' || error.message?.includes('service_engineer_id') || error.message?.includes('booking_end_date')) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.service_engineer_id;
      delete fallbackPayload.booking_end_date;
      const { data: res2, error: err2 } = await supabase
        .from('installation_checklists')
        .insert(fallbackPayload)
        .select()
        .single();
      if (err2) throw err2;
      inserted = res2;
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

  return inserted;
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
    checklists: data || [],
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
export async function getChecklistById(id) {
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

  return data;
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

  const payload = {
    client_name: data.client_name ? data.client_name.trim() : existing.client_name,
    client_mobile: data.client_mobile ? data.client_mobile.trim() : existing.client_mobile,
    client_location: data.client_location !== undefined ? data.client_location.trim() : existing.client_location,
    google_maps_location: data.google_maps_location !== undefined ? (data.google_maps_location ? data.google_maps_location.trim() : null) : existing.google_maps_location,
    device_type: data.device_type || existing.device_type,
    number_of_devices: Number(data.number_of_devices) || existing.number_of_devices,
    number_of_vehicles: Number(data.number_of_vehicles) || existing.number_of_vehicles,
    extra_devices: data.extra_devices !== undefined ? Boolean(data.extra_devices) : existing.extra_devices,
    extra_device_type: data.extra_devices ? data.extra_device_type : null,
    extra_device_count: data.extra_devices ? (Number(data.extra_device_count) || null) : null,
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
    installation_or_service: data.installation_or_service || existing.installation_or_service,
    service_engineer: newEngName,
    service_engineer_id: resolvedEng ? resolvedEng.id : null,
    booking_end_date: newBookingEndDate,
    service_assistant: data.service_assistant ? data.service_assistant.trim() : existing.service_assistant,
    installation_status: ((existing.installation_status === 'Completed' || existing.installation_status === 'Site Work Completed') && (data.installation_status !== 'Completed'))
      ? 'Completed'
      : (data.installation_status || existing.installation_status),
    payment_status: paymentStatus,
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
    updated = res;
  } catch (error) {
    if (error.code === 'PGRST204' || error.message?.includes('service_engineer_id') || error.message?.includes('booking_end_date')) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.service_engineer_id;
      delete fallbackPayload.booking_end_date;
      const { data: res2, error: err2 } = await supabase
        .from('installation_checklists')
        .update(fallbackPayload)
        .eq('id', existing.id)
        .select()
        .single();
      if (err2) throw err2;
      updated = res2;
    } else {
      console.error('Database update error for checklist:', error);
      throw new Error(error.message || 'Failed to update installation checklist');
    }
  }

  return updated;
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
