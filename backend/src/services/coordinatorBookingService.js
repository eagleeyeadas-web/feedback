import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { getChecklistById, getChecklists } from './installationService.js';
import { createNotification } from './appNotificationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/coordinator_bookings_storage.json');

// Legacy status constants
export const BOOKING_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'NOT_REQUIRED'];
export const TRAVEL_TYPES = ['Bus', 'Train', 'Flight', 'Other'];

// Travel and room booking method options
export const TRAVEL_METHODS = ['Government bus', 'Private travels'];
export const ROOM_BOOKING_METHODS = ['Online booking', 'Offline booking'];
export const RETURN_TASK_STATUSES = [
  'Not Required Yet',
  'Booking Required',
  'In Progress',
  'Booking Confirmed',
  'Booking Issue',
  'Cancelled',
];

// Requirement 5 separate statuses
export const OUTBOUND_STATUSES = ['Required', 'Pending', 'Confirmed', 'Cancelled'];
export const ACCOMMODATION_STATUSES = [
  'Required',
  'Pending',
  'Confirmed',
  'Extension Required',
  'Extension Pending',
  'Extended',
  'Cancelled',
];
export const RETURN_STATUSES = [
  'Not Required Yet',
  'Not Yet Required',
  'Booking Required',
  'In Progress',
  'Pending',
  'Booking Confirmed',
  'Confirmed',
  'Booking Issue',
  'Cancelled',
];

// In-memory fallback stores
export const inMemoryBookings = new Map(); // key = checklist_id
export const inMemoryAuditLogs = new Map(); // key = checklist_id, value = array of audit objects

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
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
    if (
      b.travel_datetime?.startsWith(year) ||
      b.check_in_date?.startsWith(year) ||
      b.outbound_departure_datetime?.startsWith(year) ||
      b.return_departure_datetime?.startsWith(year)
    ) {
      inMemoryBookings.delete(k);
    }
  });
  saveFallbackStorage();
}

/**
 * Permanently delete coordinator booking and audit logs for a deleted checklist
 */
export function deleteCoordinatorBookingForChecklist(checklistId) {
  let changed = false;
  if (inMemoryBookings.has(checklistId)) {
    inMemoryBookings.delete(checklistId);
    changed = true;
  }
  if (inMemoryAuditLogs.has(checklistId)) {
    inMemoryAuditLogs.delete(checklistId);
    changed = true;
  }
  if (changed) {
    saveFallbackStorage();
  }
}

/**
 * Validate that all required booking details are present before allowing COMPLETED status.
 * Prevent accidental completion when an arranged booking is still outstanding.
 */
export function validateBookingCompletion(bookingData) {
  const errors = [];

  const isOutboundConfirmed = bookingData.outbound_status === 'Confirmed';
  const isAccomConfirmed = bookingData.accommodation_status === 'Confirmed';
  const isReturnConfirmed = ['Booking Confirmed', 'Confirmed'].includes(bookingData.return_status);
  const isOverallCompleted = bookingData.booking_status === 'COMPLETED';

  if (isOutboundConfirmed || (isOverallCompleted && bookingData.travel_required)) {
    const depCity = bookingData.outbound_origin || bookingData.departure_city;
    const dest = bookingData.outbound_destination || bookingData.destination;
    const depTime = bookingData.outbound_departure_datetime || bookingData.travel_datetime;

    if (!depCity || !depCity.trim()) {
      errors.push('Departure city / origin is required for travel booking.');
    }
    if (!dest || !dest.trim()) {
      errors.push('Destination is required for travel booking.');
    }
    if (!depTime) {
      errors.push('Travel date and time are required for travel booking.');
    }

    // Must not mark confirmed without actual confirmation details
    if (isOutboundConfirmed) {
      const ref = bookingData.outbound_ticket_reference || bookingData.ticket_reference;
      const att = bookingData.outbound_attachment_url;
      if (!ref && !att) {
        errors.push('Cannot mark outbound travel as Confirmed without recording the ticket reference or receipt attachment.');
      }
    }
  }

  if (isAccomConfirmed || (isOverallCompleted && bookingData.accommodation_required)) {
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

    // Must not mark confirmed without actual confirmation details
    if (bookingData.accommodation_status === 'Confirmed') {
      const type = bookingData.accommodation_type || 'Online booking';
      if (type === 'Online booking') {
        const ref = bookingData.hotel_booking_reference;
        const att = bookingData.accommodation_attachment_url;
        if (!ref && !att) {
          errors.push('Cannot mark online room booking as Confirmed without recording the booking confirmation number.');
        }
      } else if (type === 'Offline booking') {
        const hasCost = Number(bookingData.total_cost) > 0 || Number(bookingData.price_per_night) > 0;
        const hasContact = Boolean(bookingData.offline_contact_person || bookingData.hotel_contact);
        const hasProof = Boolean(bookingData.accommodation_attachment_url);
        if (!hasCost && !hasContact && !hasProof) {
          errors.push('Cannot mark offline room booking as Confirmed without recording contact person, agreed cost, or proof.');
        }
      }
    }
  }

  // Return ticket confirmation validation
  if (['Booking Confirmed', 'Confirmed'].includes(bookingData.return_status)) {
    const ref = bookingData.return_ticket_reference;
    const att = bookingData.return_attachment_url;
    if (!ref && !att) {
      errors.push('Cannot mark return ticket as Booking Confirmed without recording the ticket reference or receipt attachment.');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Build default booking data for a checklist
 */
export function buildDefaultCoordinatorBooking(chk) {
  const start = chk.current_expected_arrival_date || chk.expected_arrival_date || null;
  const end = chk.current_booking_end_date || chk.booking_end_date || start;
  const isCompleted = chk.installation_status === 'Completed' || Boolean(chk.actual_completion_datetime);

  return {
    id: uuidv4(),
    checklist_id: chk.id,
    booking_status: 'PENDING',

    // Requirement 1 & 5: Outbound Ticket
    outbound_status: 'Required',
    outbound_mode: 'Bus',
    outbound_method: 'Government bus',
    outbound_operator: '',
    outbound_boarding_point: '',
    outbound_departure_time: '',
    outbound_departure_datetime: start ? `${start}T08:00:00.000Z` : null,
    outbound_origin: '',
    outbound_destination: chk.client_location || '',
    outbound_arrival_location: chk.client_location || '',
    outbound_estimated_arrival_time: '',
    outbound_fare: 0,
    outbound_currency: 'INR',
    outbound_ticket_reference: '',
    outbound_attachment_url: '',
    outbound_attachment_name: '',
    outbound_booked_by: null,
    outbound_booked_by_name: '',
    outbound_notes: '',

    // Legacy travel fields
    travel_required: true,
    travel_type: 'Bus',
    departure_city: '',
    destination: chk.client_location || '',
    travel_datetime: start ? `${start}T08:00:00.000Z` : null,
    ticket_reference: '',
    travel_notes: '',

    // Requirement 2 & 5: Accommodation
    accommodation_status: 'Required',
    accommodation_type: 'Online booking',
    hotel_name: '',
    hotel_platform: '',
    hotel_address: '',
    hotel_contact: '',
    check_in_date: start,
    check_out_date: end,
    initial_check_out_date: end,
    extra_nights: 0,
    number_of_rooms: 1,
    number_of_occupants: 1,
    price_per_night: 0,
    total_cost: 0,
    hotel_booking_reference: '',
    offline_contact_person: '',
    payment_status: 'Pending',
    payment_method: '',
    offline_notes: '',
    accommodation_attachment_url: '',
    accommodation_attachment_name: '',
    accommodation_notes: '',
    accommodation_history: [],
    accommodation_required: true,

    // Requirement 4 & 5: Return Ticket
    return_task_id: `RET-TASK-${chk.checklist_number || chk.id}`,
    return_status: isCompleted ? 'Booking Required' : 'Not Required Yet',
    return_mode: 'Bus',
    return_method: 'Government bus',
    return_operator: '',
    return_boarding_point: '',
    return_departure_time: '',
    return_departure_datetime: null,
    return_origin: chk.client_location || '',
    return_destination: '',
    return_arrival_location: '',
    return_estimated_arrival_time: '',
    return_fare: 0,
    return_currency: 'INR',
    return_ticket_reference: '',
    return_attachment_url: '',
    return_attachment_name: '',
    return_booked_by: null,
    return_booked_by_name: '',
    return_urgency: 'Normal',
    actual_completion_datetime: chk.actual_completion_datetime || null,
    report_submission_datetime: null,
    booking_issue_reason: '',
    return_notes: '',
    return_task_created: isCompleted,
    return_task_created_at: isCompleted ? (chk.actual_completion_datetime || new Date().toISOString()) : null,
    return_task_completed: false,

    assigned_engineer: chk.service_engineer || '',
    additional_personnel: '',
    coordinator_notes: '',
    completed_at: null,
    schedule_flagged_for_review: false,
    schedule_review_reason: null,
    schedule_flagged_at: null,
    return_travel_date_affected: false,
    accommodation_dates_affected: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Normalizes a booking record to ensure all new workflow fields exist
 */
export function normalizeBookingData(booking, chk) {
  if (!booking) return buildDefaultCoordinatorBooking(chk);

  const start = chk.current_expected_arrival_date || chk.expected_arrival_date || null;
  const end = chk.current_booking_end_date || chk.booking_end_date || start;
  const isCompleted = chk.installation_status === 'Completed' || Boolean(chk.actual_completion_datetime);

  const normalized = { ...booking };

  // Outbound
  if (normalized.travel_required === false) {
    normalized.outbound_status = normalized.outbound_status || 'Cancelled';
  } else if (!normalized.outbound_status) {
    if (normalized.ticket_reference || normalized.travel_datetime || normalized.outbound_ticket_reference) normalized.outbound_status = 'Confirmed';
    else if (normalized.travel_required) normalized.outbound_status = 'Pending';
    else normalized.outbound_status = 'Required';
  }
  normalized.travel_required = normalized.travel_required !== undefined
    ? Boolean(normalized.travel_required)
    : (normalized.outbound_status !== 'Cancelled');
  normalized.outbound_mode = normalized.outbound_mode || normalized.travel_type || 'Bus';
  normalized.outbound_method = normalized.outbound_method || 'Government bus';
  normalized.outbound_operator = normalized.outbound_operator || '';
  normalized.outbound_boarding_point = normalized.outbound_boarding_point || '';
  normalized.outbound_departure_time = normalized.outbound_departure_time || '';
  normalized.outbound_origin = normalized.outbound_origin || normalized.departure_city || '';
  normalized.outbound_destination = normalized.outbound_destination || normalized.destination || chk.client_location || '';
  normalized.outbound_arrival_location = normalized.outbound_arrival_location || normalized.outbound_destination || chk.client_location || '';
  normalized.outbound_estimated_arrival_time = normalized.outbound_estimated_arrival_time || '';
  normalized.outbound_fare = normalized.outbound_fare !== undefined ? Number(normalized.outbound_fare) : 0;
  normalized.outbound_currency = normalized.outbound_currency || 'INR';
  normalized.outbound_departure_datetime = normalized.outbound_departure_datetime || normalized.travel_datetime || null;
  normalized.outbound_ticket_reference = normalized.outbound_ticket_reference || normalized.ticket_reference || '';
  normalized.outbound_attachment_url = normalized.outbound_attachment_url || '';
  normalized.outbound_attachment_name = normalized.outbound_attachment_name || '';
  normalized.outbound_booked_by = normalized.outbound_booked_by || null;
  normalized.outbound_booked_by_name = normalized.outbound_booked_by_name || '';
  normalized.outbound_notes = normalized.outbound_notes || normalized.travel_notes || '';

  // Accommodation
  if (normalized.accommodation_required === false) {
    normalized.accommodation_status = normalized.accommodation_status || 'Cancelled';
  } else if (!normalized.accommodation_status) {
    if (normalized.hotel_booking_reference || (normalized.hotel_name && normalized.check_out_date)) {
      normalized.accommodation_status = 'Confirmed';
    } else if (normalized.accommodation_required) {
      normalized.accommodation_status = 'Pending';
    } else {
      normalized.accommodation_status = 'Required';
    }
  }
  normalized.accommodation_required = normalized.accommodation_required !== undefined
    ? Boolean(normalized.accommodation_required)
    : (normalized.accommodation_status !== 'Cancelled');
  normalized.accommodation_type = normalized.accommodation_type || 'Online booking';
  normalized.hotel_name = normalized.hotel_name || '';
  normalized.hotel_platform = normalized.hotel_platform || '';
  normalized.hotel_address = normalized.hotel_address || '';
  normalized.hotel_contact = normalized.hotel_contact || '';
  normalized.check_in_date = normalized.check_in_date || start;
  normalized.check_out_date = normalized.check_out_date || end;
  normalized.initial_check_out_date = normalized.initial_check_out_date || normalized.check_out_date || end;
  normalized.extra_nights = normalized.extra_nights !== undefined ? Number(normalized.extra_nights) : 0;
  normalized.number_of_rooms = normalized.number_of_rooms !== undefined ? Number(normalized.number_of_rooms) : 1;
  normalized.number_of_occupants = normalized.number_of_occupants !== undefined ? Number(normalized.number_of_occupants) : 1;
  normalized.price_per_night = normalized.price_per_night !== undefined ? Number(normalized.price_per_night) : 0;
  normalized.total_cost = normalized.total_cost !== undefined ? Number(normalized.total_cost) : 0;
  normalized.hotel_booking_reference = normalized.hotel_booking_reference || '';
  normalized.offline_contact_person = normalized.offline_contact_person || '';
  normalized.payment_status = normalized.payment_status || 'Pending';
  normalized.payment_method = normalized.payment_method || '';
  normalized.offline_notes = normalized.offline_notes || '';
  normalized.accommodation_attachment_url = normalized.accommodation_attachment_url || '';
  normalized.accommodation_attachment_name = normalized.accommodation_attachment_name || '';
  normalized.accommodation_notes = normalized.accommodation_notes || '';
  normalized.accommodation_history = Array.isArray(normalized.accommodation_history) ? normalized.accommodation_history : [];

  // Return Ticket
  let rawReturnSt = normalized.return_status;
  if (!rawReturnSt) {
    if (normalized.return_ticket_reference) {
      rawReturnSt = 'Booking Confirmed';
    } else if (isCompleted) {
      rawReturnSt = 'Booking Required';
    } else {
      rawReturnSt = 'Not Required Yet';
    }
  } else if (rawReturnSt === 'Not Yet Required') {
    rawReturnSt = isCompleted ? 'Booking Required' : 'Not Required Yet';
  } else if (rawReturnSt === 'Confirmed') {
    rawReturnSt = 'Booking Confirmed';
  } else if (rawReturnSt === 'Pending') {
    rawReturnSt = 'In Progress';
  } else if (isCompleted && rawReturnSt === 'Not Required Yet') {
    rawReturnSt = 'Booking Required';
  }
  normalized.return_status = rawReturnSt;

  normalized.return_task_id = normalized.return_task_id || `RET-TASK-${chk.checklist_number || chk.id}`;
  normalized.return_mode = normalized.return_mode || 'Bus';
  normalized.return_method = normalized.return_method || 'Government bus';
  normalized.return_operator = normalized.return_operator || '';
  normalized.return_boarding_point = normalized.return_boarding_point || '';
  normalized.return_departure_time = normalized.return_departure_time || '';
  normalized.return_origin = normalized.return_origin || chk.client_location || '';
  normalized.return_destination = normalized.return_destination || normalized.departure_city || '';
  normalized.return_arrival_location = normalized.return_arrival_location || normalized.return_destination || '';
  normalized.return_estimated_arrival_time = normalized.return_estimated_arrival_time || '';
  normalized.return_fare = normalized.return_fare !== undefined ? Number(normalized.return_fare) : 0;
  normalized.return_currency = normalized.return_currency || 'INR';
  normalized.return_departure_datetime = normalized.return_departure_datetime || null;
  normalized.return_ticket_reference = normalized.return_ticket_reference || '';
  normalized.return_attachment_url = normalized.return_attachment_url || '';
  normalized.return_attachment_name = normalized.return_attachment_name || '';
  normalized.return_booked_by = normalized.return_booked_by || null;
  normalized.return_booked_by_name = normalized.return_booked_by_name || '';
  normalized.return_urgency = normalized.return_urgency || 'Normal';
  normalized.actual_completion_datetime = normalized.actual_completion_datetime || chk.actual_completion_datetime || null;
  normalized.report_submission_datetime = normalized.report_submission_datetime || null;
  normalized.booking_issue_reason = normalized.booking_issue_reason || '';
  normalized.return_notes = normalized.return_notes || '';
  normalized.return_task_created = Boolean(normalized.return_task_created || (isCompleted && normalized.return_status !== 'Not Required Yet' && normalized.return_status !== 'Not Yet Required'));
  normalized.return_task_completed = Boolean(normalized.return_task_completed || normalized.return_status === 'Booking Confirmed' || normalized.return_status === 'Confirmed');

  return normalized;
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
      const existing = inMemoryBookings.get(checklistId) || {};
      const merged = { ...data, ...existing };
      inMemoryBookings.set(checklistId, merged);
      return merged;
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
export async function getCoordinatorChecklists(arg1 = {}, arg2 = {}) {
  const isArg1User = arg1 && (arg1.email || arg1.role) && !arg1.tab && !arg1.returnStatus && !arg1.search;
  const params = isArg1User ? { ...arg2 } : { ...arg1, ...arg2 };

  const {
    tab = (params.returnStatus || params.accommodationStatus || params.bookingStatus || params.outboundStatus ? 'all' : 'pending'),
    search = '',
    engineer = '',
    location = '',
    date = '',
    bookingStatus = '',
    outboundStatus = '',
    accommodationStatus = '',
    returnStatus = '',
    travelMethod = '',
    roomMethod = '',
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
  try {
    const { data, error } = await supabase.from('coordinator_bookings').select('*');
    if (!error && Array.isArray(data)) {
      data.forEach((b) => {
        const existing = inMemoryBookings.get(b.checklist_id) || {};
        inMemoryBookings.set(b.checklist_id, { ...b, ...existing });
      });
    }
  } catch (e) {
    // Use fallback map
  }

  // 3. Merge checklists with booking data
  const enriched = rawChecklists.map((chk) => {
    const rawBooking = inMemoryBookings.get(chk.id) || null;
    const normalizedBooking = normalizeBookingData(rawBooking, chk);

    return {
      ...chk,
      coordinator_booking: normalizedBooking,
      booking_status: normalizedBooking.booking_status || 'PENDING',
    };
  });

  // 4. Compute overall statistics for the Coordinator tabs
  const stats = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    not_required: 0,
    total: enriched.length,
    return_ticket_required: 0,
    extension_required: 0,
  };

  enriched.forEach((item) => {
    const st = item.booking_status;
    if (st === 'PENDING') stats.pending++;
    else if (st === 'IN_PROGRESS') stats.in_progress++;
    else if (st === 'COMPLETED') stats.completed++;
    else if (st === 'NOT_REQUIRED') stats.not_required++;

    const cb = item.coordinator_booking;
    if (cb?.return_status === 'Booking Required') stats.return_ticket_required++;
    if (cb?.accommodation_status === 'Extension Required') stats.extension_required++;
  });

  // 5. Apply Tab & Filters
  let filtered = enriched.filter((item) => {
    const st = item.booking_status;
    const cb = item.coordinator_booking;

    // Tab filter:
    if (tab === 'pending') {
      if (st !== 'PENDING' && st !== 'IN_PROGRESS') return false;
    } else if (tab === 'completed') {
      if (st !== 'COMPLETED' && st !== 'NOT_REQUIRED') return false;
    }

    // Specific legacy status filter
    if (bookingStatus && bookingStatus !== 'ALL') {
      if (st !== bookingStatus) return false;
    }

    // Specific workflow status filters
    if (outboundStatus && outboundStatus !== 'ALL') {
      if (cb.outbound_status !== outboundStatus) return false;
    }
    if (accommodationStatus && accommodationStatus !== 'ALL') {
      if (cb.accommodation_status !== accommodationStatus) return false;
    }
    if (returnStatus && returnStatus !== 'ALL') {
      if (cb.return_status !== returnStatus) return false;
    }
    if (travelMethod && travelMethod !== 'ALL') {
      if (cb.outbound_method !== travelMethod && cb.return_method !== travelMethod) return false;
    }
    if (roomMethod && roomMethod !== 'ALL') {
      if (cb.accommodation_type !== roomMethod) return false;
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

  const rawBooking = await getBookingRecord(checklistId);
  const booking = normalizeBookingData(rawBooking, checklist);
  const auditLogs = await getBookingAuditHistory(checklistId);

  return {
    checklist,
    booking,
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
  const previousRecord = existing ? normalizeBookingData(existing, checklist) : null;
  const previousStatus = previousRecord ? previousRecord.booking_status : 'PENDING';

  // Determine overall legacy status
  let newStatus = bookingData.booking_status || (existing ? existing.booking_status : 'IN_PROGRESS');
  if (!BOOKING_STATUSES.includes(newStatus)) {
    newStatus = 'IN_PROGRESS';
  }

  // Business rule: If marking as COMPLETED or CONFIRMED, validate required booking completion
  const mergedForValidation = {
    ...(existing || {}),
    ...bookingData,
  };
  const validation = validateBookingCompletion(mergedForValidation);
  if (!validation.isValid && (newStatus === 'COMPLETED' || bookingData.outbound_status === 'Confirmed' || bookingData.accommodation_status === 'Confirmed' || ['Booking Confirmed', 'Confirmed'].includes(bookingData.return_status))) {
    const err = new Error(`Cannot save booking: ${validation.errors.join(' ')}`);
    err.statusCode = 400;
    err.errors = validation.errors;
    throw err;
  }

  const now = new Date().toISOString();
  const completedAt = newStatus === 'COMPLETED' ? (existing?.completed_at || now) : null;

  // Resolve flags for travel and accommodation requirement
  const travelReq = bookingData.travel_required !== undefined
    ? Boolean(bookingData.travel_required)
    : (newStatus === 'NOT_REQUIRED' || bookingData.outbound_status === 'Cancelled' ? false : (existing?.travel_required !== undefined ? existing.travel_required : true));

  const accomReq = bookingData.accommodation_required !== undefined
    ? Boolean(bookingData.accommodation_required)
    : (newStatus === 'NOT_REQUIRED' || bookingData.accommodation_status === 'Cancelled' ? false : (existing?.accommodation_required !== undefined ? existing.accommodation_required : true));

  // Resolve Outbound fields
  const outboundStatus = bookingData.outbound_status || (!travelReq ? 'Cancelled' : (bookingData.travel_required ? 'Pending' : (existing?.outbound_status || 'Required')));
  const outboundMode = bookingData.outbound_mode || bookingData.travel_type || 'Bus';
  const outboundMethod = bookingData.outbound_method || existing?.outbound_method || 'Government bus';
  const outboundOperator = bookingData.outbound_operator !== undefined ? (bookingData.outbound_operator ? String(bookingData.outbound_operator).trim() : null) : (existing?.outbound_operator || null);
  const outboundBoardingPoint = bookingData.outbound_boarding_point !== undefined ? (bookingData.outbound_boarding_point ? String(bookingData.outbound_boarding_point).trim() : null) : (existing?.outbound_boarding_point || null);
  const outboundDepartureTime = bookingData.outbound_departure_time !== undefined ? (bookingData.outbound_departure_time ? String(bookingData.outbound_departure_time).trim() : null) : (existing?.outbound_departure_time || null);
  const outboundOrigin = bookingData.outbound_origin !== undefined ? bookingData.outbound_origin : (bookingData.departure_city || existing?.outbound_origin || '');
  const outboundDestination = bookingData.outbound_destination !== undefined ? bookingData.outbound_destination : (bookingData.destination || checklist.client_location || '');
  const outboundArrivalLocation = bookingData.outbound_arrival_location !== undefined ? (bookingData.outbound_arrival_location ? String(bookingData.outbound_arrival_location).trim() : null) : (existing?.outbound_arrival_location || outboundDestination || null);
  const outboundEstimatedArrivalTime = bookingData.outbound_estimated_arrival_time !== undefined ? (bookingData.outbound_estimated_arrival_time ? String(bookingData.outbound_estimated_arrival_time).trim() : null) : (existing?.outbound_estimated_arrival_time || null);
  const outboundFare = bookingData.outbound_fare !== undefined ? Number(bookingData.outbound_fare) : (existing?.outbound_fare || 0);
  const outboundCurrency = bookingData.outbound_currency || existing?.outbound_currency || 'INR';
  const outboundDepTime = bookingData.outbound_departure_datetime || bookingData.travel_datetime || existing?.outbound_departure_datetime || null;
  const outboundTicketRef = bookingData.outbound_ticket_reference !== undefined ? bookingData.outbound_ticket_reference : (bookingData.ticket_reference || existing?.outbound_ticket_reference || '');
  const outboundAttachmentUrl = bookingData.outbound_attachment_url !== undefined ? bookingData.outbound_attachment_url : (existing?.outbound_attachment_url || '');
  const outboundAttachmentName = bookingData.outbound_attachment_name !== undefined ? bookingData.outbound_attachment_name : (existing?.outbound_attachment_name || '');
  const outboundBookedBy = bookingData.outbound_booked_by || (outboundStatus === 'Confirmed' ? (user.id || null) : (existing?.outbound_booked_by || null));
  const outboundBookedByName = bookingData.outbound_booked_by_name || (outboundStatus === 'Confirmed' ? (user.full_name || user.email || 'Coordinator') : (existing?.outbound_booked_by_name || ''));
  const outboundNotes = bookingData.outbound_notes !== undefined ? (bookingData.outbound_notes ? String(bookingData.outbound_notes).trim() : null) : (existing?.outbound_notes || bookingData.travel_notes || null);

  // Resolve Accommodation fields
  const accomStatus = bookingData.accommodation_status || (!accomReq ? 'Cancelled' : (existing?.accommodation_status || 'Required'));
  const accomType = bookingData.accommodation_type || existing?.accommodation_type || 'Online booking';
  const hotelName = bookingData.hotel_name !== undefined ? bookingData.hotel_name : (existing?.hotel_name || '');
  const hotelPlatform = bookingData.hotel_platform !== undefined ? (bookingData.hotel_platform ? String(bookingData.hotel_platform).trim() : null) : (existing?.hotel_platform || null);
  const hotelAddress = bookingData.hotel_address !== undefined ? (bookingData.hotel_address ? String(bookingData.hotel_address).trim() : null) : (existing?.hotel_address || null);
  const hotelContact = bookingData.hotel_contact !== undefined ? (bookingData.hotel_contact ? String(bookingData.hotel_contact).trim() : null) : (existing?.hotel_contact || null);
  const checkInDate = bookingData.check_in_date || existing?.check_in_date || checklist.current_expected_arrival_date || checklist.expected_arrival_date || null;
  const checkOutDate = bookingData.check_out_date || existing?.check_out_date || checklist.current_booking_end_date || checklist.booking_end_date || checkInDate;
  const initialCheckOutDate = existing?.initial_check_out_date || checkOutDate;
  const extraNights = bookingData.extra_nights !== undefined ? Math.max(0, parseInt(bookingData.extra_nights, 10)) : (existing?.extra_nights || 0);
  const numRooms = bookingData.number_of_rooms ? Math.max(1, parseInt(bookingData.number_of_rooms, 10)) : (existing?.number_of_rooms || 1);
  const numOccupants = bookingData.number_of_occupants ? Math.max(1, parseInt(bookingData.number_of_occupants, 10)) : (existing?.number_of_occupants || 1);
  const pricePerNight = bookingData.price_per_night !== undefined ? Number(bookingData.price_per_night) : (existing?.price_per_night || 0);
  const totalCost = bookingData.total_cost !== undefined ? Number(bookingData.total_cost) : (existing?.total_cost || 0);
  const hotelRef = bookingData.hotel_booking_reference !== undefined ? bookingData.hotel_booking_reference : (existing?.hotel_booking_reference || '');
  const offlineContactPerson = bookingData.offline_contact_person !== undefined ? (bookingData.offline_contact_person ? String(bookingData.offline_contact_person).trim() : null) : (existing?.offline_contact_person || null);
  const paymentStatus = bookingData.payment_status || existing?.payment_status || 'Pending';
  const paymentMethod = bookingData.payment_method !== undefined ? (bookingData.payment_method ? String(bookingData.payment_method).trim() : null) : (existing?.payment_method || null);
  const offlineNotes = bookingData.offline_notes !== undefined ? (bookingData.offline_notes ? String(bookingData.offline_notes).trim() : null) : (existing?.offline_notes || null);
  const accomAttachmentUrl = bookingData.accommodation_attachment_url !== undefined ? bookingData.accommodation_attachment_url : (existing?.accommodation_attachment_url || '');
  const accomAttachmentName = bookingData.accommodation_attachment_name !== undefined ? bookingData.accommodation_attachment_name : (existing?.accommodation_attachment_name || '');
  const accomHistory = Array.isArray(bookingData.accommodation_history) ? bookingData.accommodation_history : (existing?.accommodation_history || []);

  // Resolve Return fields
  let returnStatus = bookingData.return_status || (existing?.return_status || 'Not Required Yet');
  if (returnStatus === 'Not Yet Required') returnStatus = 'Not Required Yet';
  if (returnStatus === 'Confirmed') returnStatus = 'Booking Confirmed';
  if (returnStatus === 'Pending') returnStatus = 'In Progress';

  const returnTaskId = bookingData.return_task_id || existing?.return_task_id || (bookingData.return_task_created ? `RET-TASK-${checklist.checklist_number || checklistId}` : null);
  const returnMethod = bookingData.return_method || existing?.return_method || 'Government bus';
  const returnMode = bookingData.return_mode || existing?.return_mode || 'Bus';
  const returnOperator = bookingData.return_operator !== undefined ? (bookingData.return_operator ? String(bookingData.return_operator).trim() : null) : (existing?.return_operator || null);
  const returnBoardingPoint = bookingData.return_boarding_point !== undefined ? (bookingData.return_boarding_point ? String(bookingData.return_boarding_point).trim() : null) : (existing?.return_boarding_point || null);
  const returnDepartureTime = bookingData.return_departure_time !== undefined ? (bookingData.return_departure_time ? String(bookingData.return_departure_time).trim() : null) : (existing?.return_departure_time || null);
  const returnDepTime = bookingData.return_departure_datetime || existing?.return_departure_datetime || null;
  const returnOrigin = bookingData.return_origin !== undefined ? bookingData.return_origin : (existing?.return_origin || checklist.client_location || '');
  const returnDestination = bookingData.return_destination !== undefined ? bookingData.return_destination : (existing?.return_destination || outboundOrigin || '');
  const returnArrivalLocation = bookingData.return_arrival_location !== undefined ? (bookingData.return_arrival_location ? String(bookingData.return_arrival_location).trim() : null) : (existing?.return_arrival_location || returnDestination || null);
  const returnEstimatedArrivalTime = bookingData.return_estimated_arrival_time !== undefined ? (bookingData.return_estimated_arrival_time ? String(bookingData.return_estimated_arrival_time).trim() : null) : (existing?.return_estimated_arrival_time || null);
  const returnFare = bookingData.return_fare !== undefined ? Number(bookingData.return_fare) : (existing?.return_fare || 0);
  const returnCurrency = bookingData.return_currency || existing?.return_currency || 'INR';
  const returnTicketRef = bookingData.return_ticket_reference !== undefined ? bookingData.return_ticket_reference : (existing?.return_ticket_reference || '');
  const returnAttachmentUrl = bookingData.return_attachment_url !== undefined ? bookingData.return_attachment_url : (existing?.return_attachment_url || '');
  const returnAttachmentName = bookingData.return_attachment_name !== undefined ? bookingData.return_attachment_name : (existing?.return_attachment_name || '');
  const returnBookedBy = bookingData.return_booked_by || (['Booking Confirmed', 'Confirmed'].includes(returnStatus) ? (user.id || null) : (existing?.return_booked_by || null));
  const returnBookedByName = bookingData.return_booked_by_name || (['Booking Confirmed', 'Confirmed'].includes(returnStatus) ? (user.full_name || user.email || 'Coordinator') : (existing?.return_booked_by_name || ''));
  const returnUrgency = bookingData.return_urgency || existing?.return_urgency || 'Normal';
  const actualCompTime = bookingData.actual_completion_datetime || existing?.actual_completion_datetime || checklist.actual_completion_datetime || null;
  const reportSubTime = bookingData.report_submission_datetime || existing?.report_submission_datetime || null;
  const bookingIssueReason = bookingData.booking_issue_reason !== undefined ? (bookingData.booking_issue_reason ? String(bookingData.booking_issue_reason).trim() : null) : (existing?.booking_issue_reason || null);
  const returnNotes = bookingData.return_notes !== undefined ? (bookingData.return_notes ? String(bookingData.return_notes).trim() : null) : (existing?.return_notes || null);
  const returnTaskCreated = Boolean(bookingData.return_task_created || existing?.return_task_created);
  const returnTaskCompleted = Boolean(bookingData.return_task_completed || returnStatus === 'Booking Confirmed' || returnStatus === 'Confirmed');

  const payload = {
    id: existing ? existing.id : uuidv4(),
    checklist_id: checklistId,
    booking_status: newStatus,

    // Outbound
    outbound_status: outboundStatus,
    outbound_mode: outboundMode,
    outbound_method: outboundMethod,
    outbound_operator: outboundOperator,
    outbound_boarding_point: outboundBoardingPoint,
    outbound_departure_time: outboundDepartureTime,
    outbound_departure_datetime: outboundDepTime,
    outbound_origin: outboundOrigin ? String(outboundOrigin).trim() : null,
    outbound_destination: outboundDestination ? String(outboundDestination).trim() : null,
    outbound_arrival_location: outboundArrivalLocation ? String(outboundArrivalLocation).trim() : null,
    outbound_estimated_arrival_time: outboundEstimatedArrivalTime,
    outbound_fare: outboundFare,
    outbound_currency: outboundCurrency,
    outbound_ticket_reference: outboundTicketRef ? String(outboundTicketRef).trim() : null,
    outbound_attachment_url: outboundAttachmentUrl || null,
    outbound_attachment_name: outboundAttachmentName || null,
    outbound_booked_by: outboundBookedBy,
    outbound_booked_by_name: outboundBookedByName,
    outbound_notes: outboundNotes,

    // Legacy travel fields
    travel_required: travelReq,
    travel_type: outboundMode === 'Other' ? 'Other' : 'Bus',
    departure_city: outboundOrigin ? String(outboundOrigin).trim() : null,
    destination: outboundDestination ? String(outboundDestination).trim() : null,
    travel_datetime: outboundDepTime,
    ticket_reference: outboundTicketRef ? String(outboundTicketRef).trim() : null,
    travel_notes: outboundNotes || (bookingData.travel_notes ? String(bookingData.travel_notes).trim() : (existing?.travel_notes || null)),

    // Accommodation
    accommodation_status: accomStatus,
    accommodation_type: accomType,
    hotel_name: hotelName ? String(hotelName).trim() : null,
    hotel_platform: hotelPlatform,
    hotel_address: hotelAddress,
    hotel_contact: hotelContact,
    check_in_date: checkInDate,
    check_out_date: checkOutDate,
    initial_check_out_date: initialCheckOutDate,
    extra_nights: extraNights,
    number_of_rooms: numRooms,
    number_of_occupants: numOccupants,
    price_per_night: pricePerNight,
    total_cost: totalCost,
    hotel_booking_reference: hotelRef ? String(hotelRef).trim() : null,
    offline_contact_person: offlineContactPerson,
    payment_status: paymentStatus,
    payment_method: paymentMethod,
    offline_notes: offlineNotes,
    accommodation_attachment_url: accomAttachmentUrl || null,
    accommodation_attachment_name: accomAttachmentName || null,
    accommodation_notes: bookingData.accommodation_notes ? String(bookingData.accommodation_notes).trim() : (existing?.accommodation_notes || null),
    accommodation_history: accomHistory,
    accommodation_required: accomReq,

    // Return Ticket & Task
    return_task_id: returnTaskId,
    return_status: returnStatus,
    return_mode: returnMode,
    return_method: returnMethod,
    return_operator: returnOperator,
    return_boarding_point: returnBoardingPoint,
    return_departure_time: returnDepartureTime,
    return_departure_datetime: returnDepTime,
    return_origin: returnOrigin ? String(returnOrigin).trim() : null,
    return_destination: returnDestination ? String(returnDestination).trim() : null,
    return_arrival_location: returnArrivalLocation ? String(returnArrivalLocation).trim() : null,
    return_estimated_arrival_time: returnEstimatedArrivalTime,
    return_fare: returnFare,
    return_currency: returnCurrency,
    return_ticket_reference: returnTicketRef ? String(returnTicketRef).trim() : null,
    return_attachment_url: returnAttachmentUrl || null,
    return_attachment_name: returnAttachmentName || null,
    return_booked_by: returnBookedBy,
    return_booked_by_name: returnBookedByName,
    return_urgency: returnUrgency,
    actual_completion_datetime: actualCompTime,
    report_submission_datetime: reportSubTime,
    booking_issue_reason: bookingIssueReason,
    return_notes: returnNotes,
    return_task_created: returnTaskCreated,
    return_task_created_at: existing?.return_task_created_at || (returnTaskCreated ? now : null),
    return_task_completed: returnTaskCompleted,

    assigned_engineer: checklist.service_engineer || bookingData.assigned_engineer || null,
    additional_personnel: bookingData.additional_personnel ? String(bookingData.additional_personnel).trim() : (existing?.additional_personnel || null),
    coordinator_notes: bookingData.coordinator_notes ? String(bookingData.coordinator_notes).trim() : (existing?.coordinator_notes || null),
    created_by: existing ? existing.created_by : (user.id || null),
    updated_by: user.id || null,
    completed_at: completedAt,
    schedule_flagged_for_review: bookingData.schedule_flagged_for_review !== undefined ? Boolean(bookingData.schedule_flagged_for_review) : Boolean(existing?.schedule_flagged_for_review),
    schedule_review_reason: bookingData.schedule_review_reason !== undefined ? bookingData.schedule_review_reason : (existing?.schedule_review_reason || null),
    return_travel_date_affected: Boolean(bookingData.return_travel_date_affected ?? existing?.return_travel_date_affected),
    accommodation_dates_affected: Boolean(bookingData.accommodation_dates_affected ?? existing?.accommodation_dates_affected),
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };

  let savedRecord = null;

  try {
    const { data: dbData, error: dbError } = await supabase
      .from('coordinator_bookings')
      .upsert(payload, { onConflict: 'checklist_id' })
      .select()
      .single();

    if (!dbError && dbData) {
      savedRecord = dbData;
    } else if (dbError) {
      // 1. If foreign key constraint on auth user ID failed, retry with created_by = null
      let currentPayload = { ...payload };
      if (dbError.message?.includes('foreign key constraint') || dbError.message?.includes('fkey')) {
        currentPayload.created_by = null;
        currentPayload.updated_by = null;
        currentPayload.outbound_booked_by = null;
        currentPayload.return_booked_by = null;
      }

      // 2. Loop to strip any column not found in schema cache
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: retryData, error: retryErr } = await supabase
          .from('coordinator_bookings')
          .upsert(currentPayload, { onConflict: 'checklist_id' })
          .select()
          .single();

        if (!retryErr && retryData) {
          savedRecord = { ...currentPayload, ...retryData };
          break;
        }

        if (retryErr) {
          if (retryErr.message?.includes('foreign key constraint') || retryErr.message?.includes('fkey')) {
            currentPayload.created_by = null;
            currentPayload.updated_by = null;
            currentPayload.outbound_booked_by = null;
            currentPayload.return_booked_by = null;
            continue;
          }
          const colMatch = retryErr.message?.match(/Could not find the '([^']+)' column/);
          if (colMatch && colMatch[1] && currentPayload[colMatch[1]] !== undefined) {
            delete currentPayload[colMatch[1]];
            continue;
          }
          break;
        }
      }
    }
  } catch (err) {
    console.warn('DB coordinator_bookings exception, using dual-layer fallback:', err.message);
  }

  if (!savedRecord) {
    savedRecord = { ...payload };
  } else {
    savedRecord = { ...payload, ...savedRecord };
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
    beforeState: existing || null,
    diff: {
      before: existing || null,
      after: savedRecord,
    },
  });

  return savedRecord;
}

/**
 * Extend room booking for a checklist following an approved extension
 * Preserves original room dates, initial checkout date, and appends to audit trail
 */
export async function extendRoomBooking({
  checklistId,
  newCheckOutDate,
  new_check_out_date,
  extraNights = null,
  extra_nights = null,
  referenceDetails = '',
  reference_details = '',
  notes = '',
  attachmentUrl = '',
  attachment_url = '',
  attachmentName = '',
  attachment_name = '',
  extensionData = null,
  user = {},
}) {
  if (!checklistId) throw new Error('Checklist ID is required to extend room booking.');
  const finalNewDate = newCheckOutDate || new_check_out_date || extensionData?.new_check_out_date || extensionData?.newCheckOutDate;
  if (!finalNewDate) throw new Error('New checkout date is required.');

  const finalExtraNights = extraNights !== null ? extraNights : (extra_nights !== null ? extra_nights : (extensionData?.extra_nights ?? extensionData?.extraNights ?? null));
  const finalRef = referenceDetails || reference_details || extensionData?.reference_details || extensionData?.referenceDetails || '';
  const finalNotes = notes || extensionData?.notes || '';
  const finalUrl = attachmentUrl || attachment_url || extensionData?.attachment_url || extensionData?.attachmentUrl || '';
  const finalName = attachmentName || attachment_name || extensionData?.attachment_name || extensionData?.attachmentName || '';

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found.');
    err.statusCode = 404;
    throw err;
  }

  const existingRaw = await getBookingRecord(checklistId);
  const existing = normalizeBookingData(existingRaw, checklist);

  const prevCheckOutDate = existing.check_out_date || existing.initial_check_out_date || checklist.current_booking_end_date;
  const initialCheckOutDate = existing.initial_check_out_date || prevCheckOutDate;

  // Calculate extra nights if not provided
  let calculatedExtra = finalExtraNights;
  if (calculatedExtra === null || calculatedExtra === undefined) {
    const prevObj = new Date(prevCheckOutDate);
    const newObj = new Date(finalNewDate);
    const diff = Math.round((newObj - prevObj) / (1000 * 60 * 60 * 24));
    calculatedExtra = Math.max(1, diff);
  }

  const historyEntry = {
    id: uuidv4(),
    previous_check_out_date: prevCheckOutDate,
    new_check_out_date: finalNewDate,
    extra_nights: calculatedExtra,
    reference_details: finalRef,
    notes: finalNotes,
    attachment_url: finalUrl,
    attachment_name: finalName,
    extended_by: user.id || user.email || 'Coordinator',
    extended_by_email: user.email || 'coordinator@eagleeyesafdrive.com',
    extended_at: new Date().toISOString(),
  };

  const currentHistory = Array.isArray(existing.accommodation_history) ? [...existing.accommodation_history] : [];
  currentHistory.push(historyEntry);

  const updatedBookingData = {
    ...existing,
    accommodation_status: 'Extended',
    check_out_date: finalNewDate,
    initial_check_out_date: initialCheckOutDate,
    extra_nights: (existing.extra_nights || 0) + calculatedExtra,
    hotel_booking_reference: finalRef || existing.hotel_booking_reference,
    accommodation_notes: finalNotes ? `${existing.accommodation_notes ? existing.accommodation_notes + ' | ' : ''}Extended: ${finalNotes}` : existing.accommodation_notes,
    accommodation_attachment_url: finalUrl || existing.accommodation_attachment_url,
    accommodation_attachment_name: finalName || existing.accommodation_attachment_name,
    accommodation_history: currentHistory,
    schedule_flagged_for_review: false,
    accommodation_dates_affected: false,
  };

  const saved = await saveCoordinatorBooking({
    checklistId,
    bookingData: updatedBookingData,
    user,
  });

  await recordBookingAudit({
    bookingId: saved.id,
    checklistId,
    action: 'ROOM_BOOKING_EXTENDED',
    previousStatus: existing.accommodation_status,
    newStatus: 'Extended',
    user,
    notes: `Room checkout date extended from ${prevCheckOutDate} to ${newCheckOutDate} (+${calculatedExtra} night(s)). Ref: ${referenceDetails || 'N/A'}${notes ? ' - ' + notes : ''}`,
    snapshot: saved,
  });

  return saved;
}

/**
 * Trigger Return Ticket Booking Task for Coordinator
 * Requirement 4: ONLY triggered after technician successfully submits Post-Installation Form
 * Notification text: “Installation completed — return ticket booking required.”
 * Strictly deduplicated: creates task only ONCE per successfully completed checklist.
 */
/**
 * Trigger Return Ticket Booking Task for Coordinator
 * Requirement 4: ONLY triggered after technician successfully submits Post-Installation Form
 * Notification text: “Installation completed — return ticket booking required.”
 * Strictly deduplicated: creates task only ONCE per successfully completed checklist.
 * Never depends on the Coordinator being logged in, online, or within working hours.
 */
export async function triggerReturnTicketBookingTask(arg1, arg2) {
  let checklist = null;
  let user = null;
  let actualCompletionDatetime = null;
  let submissionDatetime = null;

  if (typeof arg1 === 'string') {
    checklist = await getChecklistById(arg1);
    actualCompletionDatetime = arg2?.actualCompletionDatetime;
    submissionDatetime = arg2?.submissionDatetime;
    user = arg2?.user;
  } else if (arg1 && arg1.checklist) {
    checklist = arg1.checklist;
    user = arg1.user;
    actualCompletionDatetime = arg1.actualCompletionDatetime;
    submissionDatetime = arg1.submissionDatetime;
  } else if (arg1 && arg1.id) {
    checklist = arg1;
    user = arg2?.user;
    actualCompletionDatetime = arg2?.actualCompletionDatetime;
    submissionDatetime = arg2?.submissionDatetime;
  }

  if (!checklist?.id) return null;
  const checklistId = checklist.id;

  const existingRaw = await getBookingRecord(checklistId);
  const existing = normalizeBookingData(existingRaw, checklist);

  // Strictly prevent duplicate notifications/tasks on refreshes, retries, or repeated triggers
  if (existing.return_task_created && existing.return_status && !['Not Required Yet', 'Not Yet Required'].includes(existing.return_status)) {
    return existing;
  }

  const completionTime = actualCompletionDatetime || checklist.actual_completion_datetime || new Date().toISOString();
  const submissionTime = submissionDatetime || new Date().toISOString();
  const techName = checklist.service_engineer || user?.name || user?.email || 'Technician';
  const location = checklist.client_location || 'Customer Site';

  // Calculate urgency based on scheduled end date vs actual completion
  let urgency = 'Normal';
  const scheduledEndDate = checklist.current_booking_end_date || checklist.booking_end_date || checklist.expected_arrival_date;
  if (scheduledEndDate) {
    const compDateOnly = completionTime.split('T')[0];
    if (compDateOnly > scheduledEndDate) {
      urgency = 'Overdue';
    } else if (compDateOnly === scheduledEndDate) {
      urgency = 'Urgent';
    }
  }

  const taskId = existing.return_task_id || `RET-TASK-${checklist.checklist_number || checklistId.slice(0, 8)}`;

  // 1. Update booking record FIRST to guarantee task creation in database/storage
  const updatedData = {
    ...existing,
    return_task_id: taskId,
    return_status: 'Booking Required',
    return_urgency: urgency,
    return_task_created: true,
    return_task_created_at: submissionTime,
    actual_completion_datetime: completionTime,
    report_submission_datetime: submissionTime,
    return_origin: location,
    return_destination: existing.outbound_origin || existing.departure_city || 'Base Office',
    scheduled_start_date: checklist.expected_arrival_date || null,
    scheduled_end_date: scheduledEndDate,
  };

  const saved = await saveCoordinatorBooking({
    checklistId,
    bookingData: updatedData,
    user: user || { id: 'system', email: 'system@eagleeye.com', role: 'TECHNICAL' },
  });

  await recordBookingAudit({
    bookingId: saved.id,
    checklistId,
    action: 'RETURN_TICKET_TASK_CREATED',
    previousStatus: existing.return_status,
    newStatus: 'Booking Required',
    user: user || { id: 'system', email: 'system@eagleeye.com', role: 'TECHNICAL' },
    notes: `Installation completed — return ticket booking required. Actual completion: ${completionTime}, Submitted: ${submissionTime}, Urgency: ${urgency}`,
    snapshot: saved,
  });

  // 2. Create Coordinator Notification (decoupled: failure does NOT rollback or lose task)
  try {
    await createNotification({
      targetRole: 'COORDINATOR',
      title: 'Installation completed — return ticket booking required.',
      message: `Installation completed — return ticket booking required. Checklist: ${checklist.checklist_number}, Customer: ${checklist.client_name}, Location: ${location}, Technician: ${techName}, Completed: ${completionTime}`,
      type: 'RETURN_TICKET_REQUIRED',
      checklistId,
      checklistNumber: checklist.checklist_number,
      metadata: {
        task_id: taskId,
        checklist_id: checklistId,
        checklist_number: checklist.checklist_number,
        client_name: checklist.client_name,
        location,
        technician_name: techName,
        actual_completion_datetime: completionTime,
        report_submission_datetime: submissionTime,
        urgency,
        booking_link: `/coordinator?view=${checklistId}&action=return_ticket`,
      },
    });
  } catch (notifErr) {
    console.warn('Notification delivery failed for return ticket task (task safely saved):', notifErr.message);
  }

  return saved;
}

/**
 * Record or update Return Ticket Booking details by Coordinator
 */
export async function updateReturnTicketBooking({ checklistId, returnData = {}, user = {} }) {
  if (!checklistId) throw new Error('Checklist ID is required to update return ticket.');

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found.');
    err.statusCode = 404;
    throw err;
  }

  const existingRaw = await getBookingRecord(checklistId);
  const existing = normalizeBookingData(existingRaw, checklist);

  const prevReturnStatus = existing.return_status;
  let targetReturnStatus = returnData.return_status || (returnData.return_ticket_reference ? 'Booking Confirmed' : 'In Progress');
  if (targetReturnStatus === 'Confirmed') targetReturnStatus = 'Booking Confirmed';
  if (targetReturnStatus === 'Pending') targetReturnStatus = 'In Progress';

  const isConfirmed = targetReturnStatus === 'Booking Confirmed';

  // Cannot mark confirmed without actual confirmation details
  if (isConfirmed) {
    const ref = returnData.return_ticket_reference || existing.return_ticket_reference;
    const att = returnData.return_attachment_url || existing.return_attachment_url;
    if (!ref && !att) {
      const err = new Error('Cannot mark return ticket as Booking Confirmed without recording the ticket or reservation reference.');
      err.statusCode = 400;
      throw err;
    }
  }

  const updatedData = {
    ...existing,
    return_status: targetReturnStatus,
    return_mode: returnData.return_mode || existing.return_mode || 'Bus',
    return_method: returnData.return_method || existing.return_method || 'Government bus',
    return_operator: returnData.return_operator !== undefined ? (returnData.return_operator ? String(returnData.return_operator).trim() : null) : existing.return_operator,
    return_boarding_point: returnData.return_boarding_point !== undefined ? (returnData.return_boarding_point ? String(returnData.return_boarding_point).trim() : null) : existing.return_boarding_point,
    return_departure_time: returnData.return_departure_time !== undefined ? (returnData.return_departure_time ? String(returnData.return_departure_time).trim() : null) : existing.return_departure_time,
    return_departure_datetime: returnData.return_departure_datetime || existing.return_departure_datetime,
    return_origin: returnData.return_origin !== undefined ? returnData.return_origin : existing.return_origin,
    return_destination: returnData.return_destination !== undefined ? returnData.return_destination : existing.return_destination,
    return_arrival_location: returnData.return_arrival_location !== undefined ? (returnData.return_arrival_location ? String(returnData.return_arrival_location).trim() : null) : (existing.return_arrival_location || existing.return_destination || null),
    return_estimated_arrival_time: returnData.return_estimated_arrival_time !== undefined ? (returnData.return_estimated_arrival_time ? String(returnData.return_estimated_arrival_time).trim() : null) : existing.return_estimated_arrival_time,
    return_fare: returnData.return_fare !== undefined ? Number(returnData.return_fare) : existing.return_fare,
    return_currency: returnData.return_currency || existing.return_currency || 'INR',
    return_ticket_reference: returnData.return_ticket_reference !== undefined ? returnData.return_ticket_reference : existing.return_ticket_reference,
    return_attachment_url: returnData.return_attachment_url !== undefined ? returnData.return_attachment_url : existing.return_attachment_url,
    return_attachment_name: returnData.return_attachment_name !== undefined ? returnData.return_attachment_name : existing.return_attachment_name,
    return_booked_by: user.id || existing.return_booked_by || null,
    return_booked_by_name: user.full_name || user.email || existing.return_booked_by_name || 'Coordinator',
    return_notes: returnData.return_notes !== undefined ? (returnData.return_notes ? String(returnData.return_notes).trim() : null) : existing.return_notes,
    booking_issue_reason: returnData.booking_issue_reason !== undefined ? (returnData.booking_issue_reason ? String(returnData.booking_issue_reason).trim() : null) : existing.booking_issue_reason,
    return_task_completed: isConfirmed,
  };

  const saved = await saveCoordinatorBooking({
    checklistId,
    bookingData: updatedData,
    user,
  });

  await recordBookingAudit({
    bookingId: saved.id,
    checklistId,
    action: isConfirmed ? 'RETURN_TICKET_CONFIRMED' : 'RETURN_TICKET_UPDATED',
    previousStatus: prevReturnStatus,
    newStatus: targetReturnStatus,
    user,
    notes: isConfirmed
      ? `Return ticket confirmed by Coordinator. Ref: ${updatedData.return_ticket_reference || 'N/A'}, Operator: ${updatedData.return_operator || 'N/A'}, Method: ${updatedData.return_method || 'Bus'}, Departure: ${updatedData.return_departure_datetime || updatedData.return_departure_time || 'TBD'}`
      : `Return ticket updated by Coordinator. Status: ${targetReturnStatus}${updatedData.booking_issue_reason ? ' | Issue: ' + updatedData.booking_issue_reason : ''}`,
    snapshot: saved,
    beforeState: existing || null,
    diff: {
      before: existing || null,
      after: saved,
    },
  });

  return saved;
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
  beforeState = null,
  before_state = null,
  diff = null,
}) {
  const bState = beforeState || before_state || null;
  const auditEntry = {
    id: uuidv4(),
    booking_id: bookingId,
    checklist_id: checklistId,
    action,
    previous_status: previousStatus || null,
    new_status: newStatus,
    changed_by: (user.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) ? user.id : null,
    changed_by_email: user.email || null,
    notes: notes || null,
    snapshot: snapshot ? JSON.parse(JSON.stringify(snapshot)) : null,
    before_state: bState ? JSON.parse(JSON.stringify(bState)) : null,
    diff: diff ? JSON.parse(JSON.stringify(diff)) : (bState ? { before: bState, after: snapshot } : null),
    created_at: new Date().toISOString(),
  };

  try {
    const { error: insErr } = await supabase.from('coordinator_booking_audit_logs').insert([auditEntry]);
    if (insErr && (insErr.message?.includes('foreign key constraint') || insErr.message?.includes('invalid input syntax'))) {
      const sanitized = { ...auditEntry, changed_by: null };
      await supabase.from('coordinator_booking_audit_logs').insert([sanitized]);
    }
  } catch (err) {
    // DB fallback
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

  const memoryLogs = inMemoryAuditLogs.get(checklistId) || [];

  try {
    const { data, error } = await supabase
      .from('coordinator_booking_audit_logs')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const map = new Map();
      data.forEach((item) => map.set(item.id, item));
      memoryLogs.forEach((item) => map.set(item.id, item));
      const merged = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      inMemoryAuditLogs.set(checklistId, merged);
      return merged;
    }
  } catch (err) {
    // fallback
  }

  return memoryLogs;
}

/**
 * Flag a booking for review when a schedule extension or change occurs
 */
export async function flagBookingForReview({
  checklistId,
  reason,
  returnTravelAffected = false,
  accommodationAffected = false,
  accommodationStatus = 'Extension Required',
}) {
  if (!checklistId) return;
  const nowIso = new Date().toISOString();

  const updateFields = {
    schedule_flagged_for_review: true,
    schedule_review_reason: reason,
    schedule_flagged_at: nowIso,
    return_travel_date_affected: Boolean(returnTravelAffected),
    accommodation_dates_affected: Boolean(accommodationAffected),
    updated_at: nowIso,
  };

  if (accommodationAffected && accommodationStatus) {
    updateFields.accommodation_status = accommodationStatus;
  }

  try {
    await supabase
      .from('coordinator_bookings')
      .update(updateFields)
      .eq('checklist_id', checklistId);
  } catch (e) {}

  let mem = inMemoryBookings.get(checklistId);
  if (!mem) {
    mem = {
      id: uuidv4(),
      checklist_id: checklistId,
      booking_status: 'IN_PROGRESS',
      created_at: nowIso,
    };
  }
  mem.schedule_flagged_for_review = true;
  mem.schedule_review_reason = reason;
  mem.schedule_flagged_at = nowIso;
  mem.return_travel_date_affected = Boolean(returnTravelAffected);
  mem.accommodation_dates_affected = Boolean(accommodationAffected);
  if (accommodationAffected && accommodationStatus) {
    mem.accommodation_status = accommodationStatus;
  }
  mem.updated_at = nowIso;
  inMemoryBookings.set(checklistId, mem);
  saveFallbackStorage();
}
