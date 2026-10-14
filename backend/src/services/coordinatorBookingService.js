import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { getChecklistById, getChecklists } from './installationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/coordinator_bookings_storage.json');

export const BOOKING_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'NOT_REQUIRED'];
export const TRAVEL_TYPES = ['Bus', 'Other'];

// In-memory fallback stores
const inMemoryBookings = new Map(); // key = checklist_id
const inMemoryAuditLogs = new Map(); // key = checklist_id, value = array of audit objects

function loadFallbackStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data.bookings && typeof data.bookings === 'object') {
        Object.entries(data.bookings).forEach(([k, v]) => inMemoryBookings.set(k, v));
      }
      if (data.auditLogs && typeof data.auditLogs === 'object') {
        Object.entries(data.auditLogs).forEach(([k, v]) => inMemoryAuditLogs.set(k, v));
      }
    }
  } catch (err) {
    console.warn('Could not load coordinator bookings fallback storage:', err.message);
  }
}

function saveFallbackStorage() {
  try {
    const data = {
      bookings: Object.fromEntries(inMemoryBookings),
      auditLogs: Object.fromEntries(inMemoryAuditLogs),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save coordinator bookings fallback storage:', err.message);
  }
}

// Load storage on module initialization
loadFallbackStorage();

export function cleanupTestCoordinatorBookingsForYear(year = '2028') {
  inMemoryBookings.forEach((b, k) => {
    if (b.travel_datetime?.startsWith(year) || b.check_in_date?.startsWith(year)) {
      inMemoryBookings.delete(k);
    }
  });
  saveFallbackStorage();
}


/**
 * Validate that all required booking details are present before allowing COMPLETED status.
 * Prevent accidental completion when an arranged booking is still outstanding.
 */
export function validateBookingCompletion(bookingData) {
  const errors = [];

  const travelReq = Boolean(bookingData.travel_required);
  const accomReq = Boolean(bookingData.accommodation_required);

  if (travelReq) {
    if (!bookingData.departure_city || !bookingData.departure_city.trim()) {
      errors.push('Departure city is required for travel booking.');
    }
    if (!bookingData.destination || !bookingData.destination.trim()) {
      errors.push('Destination is required for travel booking.');
    }
    if (!bookingData.travel_datetime) {
      errors.push('Travel date and time are required for travel booking.');
    }
  }

  if (accomReq) {
    if (!bookingData.hotel_name || !bookingData.hotel_name.trim()) {
      errors.push('Hotel / room booking name is required for accommodation booking.');
    }
    if (!bookingData.check_in_date) {
      errors.push('Check-in date is required for accommodation booking.');
    }
    if (!bookingData.check_out_date) {
      errors.push('Check-out date is required for accommodation booking.');
    }
    if (bookingData.number_of_rooms !== undefined && Number(bookingData.number_of_rooms) < 1) {
      errors.push('Number of rooms must be at least 1.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Helper to get active booking record for a checklist from DB or fallback
 */
export async function getBookingRecord(checklistId) {
  if (!checklistId) return null;

  try {
    const { data, error } = await supabase
      .from('coordinator_bookings')
      .select('*')
      .eq('checklist_id', checklistId)
      .maybeSingle();

    if (!error && data) {
      inMemoryBookings.set(checklistId, data);
      return data;
    }
  } catch (err) {
    // Schema cache warning or table not found
  }

  return inMemoryBookings.get(checklistId) || null;
}

/**
 * Fetch all checklists formatted for the Coordinator Workspace
 * Joins checklists with coordinator_bookings records.
 */
export async function getCoordinatorChecklists(params = {}) {
  const {
    tab = 'pending', // 'pending' | 'completed' | 'all'
    search = '',
    engineer = '',
    location = '',
    date = '',
    bookingStatus = '',
    page = 1,
    limit = 50,
  } = params;

  // 1. Fetch raw checklists from installation service
  const checklistResult = await getChecklists({
    limit: 500, // Fetch broad pool to allow accurate in-memory booking join and tab counts
    search: search ? search.trim() : '',
    serviceEngineer: engineer && engineer !== 'ALL' ? engineer : '',
  });

  const rawChecklists = checklistResult?.checklists || [];

  // 2. Fetch all coordinator bookings from DB
  let allDbBookings = [];
  try {
    const { data, error } = await supabase.from('coordinator_bookings').select('*');
    if (!error && Array.isArray(data)) {
      allDbBookings = data;
      // Sync into memory
      data.forEach((b) => inMemoryBookings.set(b.checklist_id, b));
    }
  } catch (e) {
    // Use fallback map
  }

  // 3. Merge checklists with booking data
  const enriched = rawChecklists.map((chk) => {
    const booking = inMemoryBookings.get(chk.id) || null;
    const currentStatus = booking ? booking.booking_status : 'PENDING';

    return {
      ...chk,
      coordinator_booking: booking || {
        checklist_id: chk.id,
        booking_status: 'PENDING',
        travel_required: false,
        travel_type: 'Bus',
        departure_city: '',
        destination: chk.client_location || '',
        travel_datetime: null,
        ticket_reference: '',
        travel_notes: '',
        accommodation_required: false,
        hotel_name: '',
        check_in_date: null,
        check_out_date: null,
        number_of_rooms: 1,
        hotel_booking_reference: '',
        accommodation_notes: '',
        assigned_engineer: chk.service_engineer || '',
        additional_personnel: '',
        coordinator_notes: '',
        completed_at: null,
      },
      booking_status: currentStatus,
    };
  });

  // 4. Compute overall statistics for the Coordinator tabs
  const stats = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    not_required: 0,
    total: enriched.length,
  };

  enriched.forEach((item) => {
    const st = item.booking_status;
    if (st === 'PENDING') stats.pending++;
    else if (st === 'IN_PROGRESS') stats.in_progress++;
    else if (st === 'COMPLETED') stats.completed++;
    else if (st === 'NOT_REQUIRED') stats.not_required++;
  });

  // 5. Apply Tab & Filters
  let filtered = enriched.filter((item) => {
    const st = item.booking_status;

    // Tab filter:
    // Pending tab includes PENDING and IN_PROGRESS
    // Completed tab includes COMPLETED and NOT_REQUIRED
    if (tab === 'pending') {
      if (st !== 'PENDING' && st !== 'IN_PROGRESS') return false;
    } else if (tab === 'completed') {
      if (st !== 'COMPLETED' && st !== 'NOT_REQUIRED') return false;
    }

    // Specific status dropdown filter
    if (bookingStatus && bookingStatus !== 'ALL') {
      if (st !== bookingStatus) return false;
    }

    // Location filter
    if (location && location.trim()) {
      const locNeedle = location.trim().toLowerCase();
      const locHaystack = (item.client_location || '').toLowerCase();
      if (!locHaystack.includes(locNeedle)) return false;
    }

    // Date filter (compares expected_arrival_date or travel date)
    if (date && date.trim()) {
      const targetDate = date.trim();
      const itemArrival = item.expected_arrival_date ? String(item.expected_arrival_date).split('T')[0] : '';
      if (itemArrival !== targetDate) return false;
    }

    return true;
  });

  // Sort by arrival date ascending for pending, or completed_at / updated_at descending for completed
  filtered.sort((a, b) => {
    if (tab === 'completed') {
      const aDate = new Date(a.coordinator_booking?.completed_at || a.coordinator_booking?.updated_at || a.created_at).getTime();
      const bDate = new Date(b.coordinator_booking?.completed_at || b.coordinator_booking?.updated_at || b.created_at).getTime();
      return bDate - aDate;
    }
    const aDate = new Date(a.expected_arrival_date || a.created_at).getTime();
    const bDate = new Date(b.expected_arrival_date || b.created_at).getTime();
    return aDate - bDate;
  });

  // Pagination
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.max(1, parseInt(limit, 10));
  const totalCount = filtered.length;
  const paginated = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  return {
    checklists: paginated,
    totalCount,
    page: pageNum,
    totalPages: Math.ceil(totalCount / limitNum) || 1,
    stats,
  };
}

/**
 * Get detailed booking information for a single checklist, including checklist details and audit history
 */
export async function getBookingDetails(checklistId) {
  if (!checklistId) {
    const err = new Error('Checklist ID is required');
    err.statusCode = 400;
    throw err;
  }

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found');
    err.statusCode = 404;
    throw err;
  }

  const booking = await getBookingRecord(checklistId);
  const auditLogs = await getBookingAuditHistory(checklistId);

  return {
    checklist,
    booking: booking || {
      checklist_id: checklist.id,
      booking_status: 'PENDING',
      travel_required: false,
      travel_type: 'Bus',
      departure_city: '',
      destination: checklist.client_location || '',
      travel_datetime: null,
      ticket_reference: '',
      travel_notes: '',
      accommodation_required: false,
      hotel_name: '',
      check_in_date: null,
      check_out_date: null,
      number_of_rooms: 1,
      hotel_booking_reference: '',
      accommodation_notes: '',
      assigned_engineer: checklist.service_engineer || '',
      additional_personnel: '',
      coordinator_notes: '',
      completed_at: null,
    },
    auditLogs,
  };
}

/**
 * Save or update booking details for a checklist
 */
export async function saveCoordinatorBooking({ checklistId, bookingData = {}, user = {} }) {
  if (!checklistId) {
    const err = new Error('Checklist ID is required');
    err.statusCode = 400;
    throw err;
  }

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found');
    err.statusCode = 404;
    throw err;
  }

  const existing = await getBookingRecord(checklistId);
  const previousStatus = existing ? existing.booking_status : 'PENDING';

  // Determine target status
  let newStatus = bookingData.booking_status || (existing ? existing.booking_status : 'IN_PROGRESS');
  if (!BOOKING_STATUSES.includes(newStatus)) {
    newStatus = 'IN_PROGRESS';
  }

  // Business rule 5: If marking as COMPLETED, every applicable required booking must be filled
  if (newStatus === 'COMPLETED') {
    const validation = validateBookingCompletion(bookingData);
    if (!validation.isValid) {
      const err = new Error(
        `Cannot complete booking: ${validation.errors.join(' ')}`
      );
      err.statusCode = 400;
      err.errors = validation.errors;
      throw err;
    }
  }

  // Business rule 4: If travel & accommodation marked NOT_REQUIRED
  if (newStatus === 'NOT_REQUIRED') {
    bookingData.travel_required = false;
    bookingData.accommodation_required = false;
  }

  const now = new Date().toISOString();
  const completedAt = newStatus === 'COMPLETED' ? (existing?.completed_at || now) : null;

  const payload = {
    id: existing ? existing.id : uuidv4(),
    checklist_id: checklistId,
    booking_status: newStatus,
    travel_required: Boolean(bookingData.travel_required),
    travel_type: bookingData.travel_type === 'Other' ? 'Other' : 'Bus',
    departure_city: bookingData.departure_city ? String(bookingData.departure_city).trim() : null,
    destination: bookingData.destination ? String(bookingData.destination).trim() : (checklist.client_location || null),
    travel_datetime: bookingData.travel_datetime || null,
    ticket_reference: bookingData.ticket_reference ? String(bookingData.ticket_reference).trim() : null,
    travel_notes: bookingData.travel_notes ? String(bookingData.travel_notes).trim() : null,
    accommodation_required: Boolean(bookingData.accommodation_required),
    hotel_name: bookingData.hotel_name ? String(bookingData.hotel_name).trim() : null,
    check_in_date: bookingData.check_in_date || null,
    check_out_date: bookingData.check_out_date || null,
    number_of_rooms: bookingData.number_of_rooms ? Math.max(1, parseInt(bookingData.number_of_rooms, 10)) : 1,
    hotel_booking_reference: bookingData.hotel_booking_reference ? String(bookingData.hotel_booking_reference).trim() : null,
    accommodation_notes: bookingData.accommodation_notes ? String(bookingData.accommodation_notes).trim() : null,
    assigned_engineer: checklist.service_engineer || bookingData.assigned_engineer || null,
    additional_personnel: bookingData.additional_personnel ? String(bookingData.additional_personnel).trim() : null,
    coordinator_notes: bookingData.coordinator_notes ? String(bookingData.coordinator_notes).trim() : null,
    created_by: existing ? existing.created_by : (user.id || null),
    updated_by: user.id || null,
    completed_at: completedAt,
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };

  let savedRecord = null;

  // Try DB upsert
  try {
    const { data: dbData, error: dbError } = await supabase
      .from('coordinator_bookings')
      .upsert(payload, { onConflict: 'checklist_id' })
      .select()
      .single();

    if (!dbError && dbData) {
      savedRecord = dbData;
    } else if (dbError) {
      console.warn('DB upsert coordinator_bookings error, using dual-layer fallback:', dbError.message);
    }
  } catch (err) {
    console.warn('DB coordinator_bookings exception, using fallback:', err.message);
  }

  if (!savedRecord) {
    savedRecord = { ...payload };
  }

  // Update in-memory and persistent fallback storage
  inMemoryBookings.set(checklistId, savedRecord);
  saveFallbackStorage();

  // Create audit log record
  const actionType = !existing
    ? 'CREATED'
    : previousStatus !== newStatus
    ? 'STATUS_CHANGED'
    : 'UPDATED';

  await recordBookingAudit({
    bookingId: savedRecord.id,
    checklistId,
    action: actionType,
    previousStatus,
    newStatus,
    user,
    notes: bookingData.coordinator_notes || `Booking ${actionType.toLowerCase()} by Coordinator.`,
    snapshot: savedRecord,
  });

  return savedRecord;
}

/**
 * Record an entry into coordinator_booking_audit_logs
 */
export async function recordBookingAudit({
  bookingId,
  checklistId,
  action,
  previousStatus,
  newStatus,
  user = {},
  notes = '',
  snapshot = null,
}) {
  const auditEntry = {
    id: uuidv4(),
    booking_id: bookingId,
    checklist_id: checklistId,
    action,
    previous_status: previousStatus || null,
    new_status: newStatus,
    changed_by: user.id || null,
    changed_by_email: user.email || null,
    notes: notes || null,
    snapshot: snapshot ? JSON.parse(JSON.stringify(snapshot)) : null,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('coordinator_booking_audit_logs').insert([auditEntry]);
  } catch (err) {
    console.warn('DB insert coordinator_booking_audit_logs fallback:', err.message);
  }

  const logs = inMemoryAuditLogs.get(checklistId) || [];
  logs.unshift(auditEntry);
  inMemoryAuditLogs.set(checklistId, logs);
  saveFallbackStorage();

  return auditEntry;
}

/**
 * Retrieve audit history for a checklist's bookings
 */
export async function getBookingAuditHistory(checklistId) {
  if (!checklistId) return [];

  try {
    const { data, error } = await supabase
      .from('coordinator_booking_audit_logs')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data) && data.length > 0) {
      inMemoryAuditLogs.set(checklistId, data);
      return data;
    }
  } catch (err) {
    // fallback
  }

  return inMemoryAuditLogs.get(checklistId) || [];
}

/**
 * Flag a booking for review when a schedule extension or change occurs
 */
export async function flagBookingForReview({
  checklistId,
  reason,
  returnTravelAffected = false,
  accommodationAffected = false,
}) {
  if (!checklistId) return;
  const nowIso = new Date().toISOString();

  try {
    await supabase
      .from('coordinator_bookings')
      .update({
        schedule_flagged_for_review: true,
        schedule_review_reason: reason,
        schedule_flagged_at: nowIso,
        return_travel_date_affected: Boolean(returnTravelAffected),
        accommodation_dates_affected: Boolean(accommodationAffected),
        updated_at: nowIso,
      })
      .eq('checklist_id', checklistId);
  } catch (e) {}

  const mem = inMemoryBookings.get(checklistId);
  if (mem) {
    mem.schedule_flagged_for_review = true;
    mem.schedule_review_reason = reason;
    mem.schedule_flagged_at = nowIso;
    mem.return_travel_date_affected = Boolean(returnTravelAffected);
    mem.accommodation_dates_affected = Boolean(accommodationAffected);
    mem.updated_at = nowIso;
    inMemoryBookings.set(checklistId, mem);
    saveFallbackStorage();
  }
}

