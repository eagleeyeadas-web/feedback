import supabase from './supabase.js';

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
    installation_duration: data.installation_duration ? data.installation_duration.trim() : '1 Day',
    vehicle_type: data.vehicle_type === 'Other' && data.custom_vehicle_type ? data.custom_vehicle_type.trim() : (data.vehicle_type || 'Truck'),
    expected_arrival_date: data.expected_arrival_date || null,
    expected_arrival_time: data.expected_arrival_time || null,
    installation_or_service: data.installation_or_service,
    service_engineer: data.service_engineer ? data.service_engineer.trim() : '',
    service_assistant: data.service_assistant ? data.service_assistant.trim() : '',
    installation_status: data.installation_status || 'Pending',
    payment_status: paymentStatus,
    remarks: data.remarks ? data.remarks.trim() : null,
    client_confirmation: data.client_confirmation || 'Confirmed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: inserted, error } = await supabase
    .from('installation_checklists')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('Database insert error for checklist:', error);
    if (error.code === 'PGRST205' || error.message?.includes("Could not find the table 'public.installation_checklists'")) {
      throw new Error("Table 'installation_checklists' does not exist in Supabase database yet. Please execute the SQL migration script (supabase/migrations/008_installation_checklists_schema.sql) in the Supabase SQL Editor.");
    }
    throw new Error(error.message || 'Failed to insert installation checklist');
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
    query = query.eq('installation_status', installationStatus);
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
  const map = new Map();

  // 1. Fetch from admin_users (TECHNICAL, ADMIN roles)
  try {
    const { data: users, error } = await supabase
      .from('admin_users')
      .select('id, full_name, email, role')
      .in('role', ['TECHNICAL', 'ADMIN', 'admin', 'super_admin']);

    if (!error && users) {
      users.forEach((u) => {
        const name = u.full_name || u.email || 'Unnamed Engineer';
        map.set(u.id, {
          id: u.id,
          name,
          role: u.role,
          email: u.email,
        });
      });
    }
  } catch (err) {
    console.warn('Error fetching engineers from admin_users:', err.message);
  }

  // 2. Fetch distinct service_engineer names from installation_checklists
  try {
    const { data: checklists, error } = await supabase
      .from('installation_checklists')
      .select('service_engineer')
      .not('service_engineer', 'is', null);

    if (!error && checklists) {
      checklists.forEach((c) => {
        if (c.service_engineer && c.service_engineer.trim()) {
          const engName = c.service_engineer.trim();
          const exists = Array.from(map.values()).some(
            (e) => e.name.toLowerCase() === engName.toLowerCase() || e.id === engName
          );
          if (!exists) {
            map.set(engName, {
              id: engName,
              name: engName,
              role: 'TECHNICAL',
              email: '',
            });
          }
        }
      });
    }
  } catch (err) {
    console.warn('Error fetching distinct service_engineer from checklists:', err.message);
  }

  return Array.from(map.values());
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
    installation_duration: data.installation_duration ? data.installation_duration.trim() : existing.installation_duration,
    vehicle_type: data.vehicle_type === 'Other' && data.custom_vehicle_type ? data.custom_vehicle_type.trim() : (data.vehicle_type || existing.vehicle_type),
    expected_arrival_date: data.expected_arrival_date || existing.expected_arrival_date,
    expected_arrival_time: data.expected_arrival_time || existing.expected_arrival_time,
    installation_or_service: data.installation_or_service || existing.installation_or_service,
    service_engineer: data.service_engineer ? data.service_engineer.trim() : existing.service_engineer,
    service_assistant: data.service_assistant ? data.service_assistant.trim() : existing.service_assistant,
    installation_status: data.installation_status || existing.installation_status,
    payment_status: paymentStatus,
    remarks: data.remarks !== undefined ? (data.remarks ? data.remarks.trim() : null) : existing.remarks,
    client_confirmation: data.client_confirmation || existing.client_confirmation,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error } = await supabase
    .from('installation_checklists')
    .update(payload)
    .eq('id', existing.id)
    .select()
    .single();

  if (error) {
    console.error('Database update error for checklist:', error);
    throw new Error(error.message || 'Failed to update installation checklist');
  }

  return updated;
}

/**
 * Delete an installation checklist by ID
 */
export async function deleteChecklist(id) {
  const existing = await getChecklistById(id);

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
  const { count: total } = await supabase
    .from('installation_checklists')
    .select('*', { count: 'exact', head: true });

  const { count: pending } = await supabase
    .from('installation_checklists')
    .select('*', { count: 'exact', head: true })
    .eq('installation_status', 'Pending');

  const { count: inProgress } = await supabase
    .from('installation_checklists')
    .select('*', { count: 'exact', head: true })
    .eq('installation_status', 'In Progress');

  const { count: completed } = await supabase
    .from('installation_checklists')
    .select('*', { count: 'exact', head: true })
    .eq('installation_status', 'Completed');

  return {
    total: total || 0,
    pending: pending || 0,
    inProgress: inProgress || 0,
    completed: completed || 0,
  };
}
