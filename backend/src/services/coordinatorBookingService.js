import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { getChecklistById, getChecklists } from './installationService.js';
import { createNotification } from './appNotificationService.js';
import { isChecklistTechnicianDependent, isPreInstallationSubmitted, inMemoryDeclarations } from './backupItemService.js';
import { inMemoryCarryRecords } from './workflowService.js';

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
  'Awaiting Technician Booking',
  'Submitted for Verification',
  'Needs Correction',
  'Verified/Completed',
  'Booking Required',
  'In Progress',
  'Booking Confirmed',
  'Booking Issue',
  'Cancelled',
];

export const RETURN_WORKFLOW_STATUSES = {
  NOT_REQUIRED: 'Not Required Yet',
  AWAITING_BOOKING: 'Awaiting Technician Booking',
  SUBMITTED_FOR_VERIFICATION: 'Submitted for Verification',
  NEEDS_CORRECTION: 'Needs Correction',
  VERIFIED_COMPLETED: 'Verified/Completed',
};

// Standardized Coordinator Status Options
export const OUTBOUND_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Cancelled'];
export const ACCOMMODATION_STATUSES = [
  'Pending',
  'Pending Review',
  'Booked',
  'Confirmed',
  'Cancelled',
];
export const RETURN_STATUSES = [
  'Pending',
  'Booked',
  'Confirmed',
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
 * Determine if a travel record has confirmed tickets or independent travel commitment
 */
export function isIndependentConfirmedTravel(booking, travelType = 'ANY') {
  if (!booking) return false;

  const isOutboundConfirmed =
    ['Booked', 'Confirmed'].includes(booking.outbound_status) ||
    Boolean(booking.outbound_ticket_reference || booking.ticket_reference) ||
    (Boolean(booking.outbound_operator) && Number(booking.outbound_fare) > 0);

  const isReturnConfirmed =
    ['Booked', 'Confirmed', 'Booking Confirmed'].includes(booking.return_status) ||
    Boolean(booking.return_ticket_reference) ||
    (Boolean(booking.return_operator) && Number(booking.return_fare) > 0);

  if (travelType === 'OUTBOUND') return isOutboundConfirmed;
  if (travelType === 'RETURN') return isReturnConfirmed;
  return isOutboundConfirmed || isReturnConfirmed;
}

/**
 * Permanently delete coordinator booking and audit logs for a deleted checklist
 * Preserves independent confirmed travel records by unlinking them from the deleted checklist.
 */
export function deleteCoordinatorBookingForChecklist(checklistId) {
  if (!checklistId) return;
  const idStr = String(checklistId).trim().toLowerCase();

  try {
    supabase.from('coordinator_booking_audit_logs').delete().eq('checklist_id', checklistId).catch(() => {});
    supabase.from('coordinator_bookings').delete().eq('checklist_id', checklistId).catch(() => {});
  } catch (err) {}

  let changed = false;
  for (const [k, b] of inMemoryBookings.entries()) {
    if (
      String(k).toLowerCase() === idStr ||
      (b?.checklist_id && String(b.checklist_id).toLowerCase() === idStr) ||
      (b?.id && String(b.id).toLowerCase() === idStr)
    ) {
      if (isIndependentConfirmedTravel(b)) {
        b.checklist_id = null;
        b.notes = (b.notes ? b.notes + ' ' : '') + `[Preserved independent travel from deleted checklist ${checklistId}]`;
        changed = true;
      } else {
        inMemoryBookings.delete(k);
        changed = true;
      }
    }
  }

  for (const [k] of inMemoryAuditLogs.entries()) {
    if (String(k).toLowerCase() === idStr) {
      inMemoryAuditLogs.delete(k);
      changed = true;
    }
  }

  if (changed) {
    saveFallbackStorage();
  }
}

/**
 * Cancel dependent unbooked travel for a cancelled checklist
 */
export function cancelDependentTravelForChecklist(checklistId) {
  if (!checklistId) return;
  const idStr = String(checklistId).trim().toLowerCase();
  let changed = false;

  for (const [k, b] of inMemoryBookings.entries()) {
    if (
      String(k).toLowerCase() === idStr ||
      (b?.checklist_id && String(b.checklist_id).toLowerCase() === idStr)
    ) {
      if (!isIndependentConfirmedTravel(b, 'OUTBOUND') && b.outbound_status !== 'Cancelled') {
        b.outbound_status = 'Cancelled';
        changed = true;
      }
      if (!isIndependentConfirmedTravel(b, 'RETURN') && b.return_status !== 'Cancelled') {
        b.return_status = 'Cancelled';
        changed = true;
      }
    }
  }

  if (changed) {
    saveFallbackStorage();
  }
}

/**
 * Reconcile coordinator bookings against database checklists
 * Prunes orphaned pending travel bookings for deleted checklists while preserving
 * valid independent confirmed travel records.
 */
export async function reconcileCoordinatorBookings() {
  let changed = false;
  try {
    const { data: dbChecklists, error } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, installation_status');

    if (error || !Array.isArray(dbChecklists)) {
      return false;
    }

    const checklistMap = new Map();
    dbChecklists.forEach((c) => checklistMap.set(String(c.id).toLowerCase(), c));

    const now = Date.now();
    for (const [k, b] of inMemoryBookings.entries()) {
      if (!b || !b.checklist_id) continue;

      const chkId = String(b.checklist_id).toLowerCase();
      const existingChecklist = checklistMap.get(chkId);

      // Grace period for brand-new bookings (30 seconds)
      const ageMs = b.created_at ? (now - new Date(b.created_at).getTime()) : Infinity;
      if (ageMs < 30000) continue;

      if (!existingChecklist) {
        if (isIndependentConfirmedTravel(b)) {
          if (b.checklist_id) {
            b.checklist_id = null;
            b.notes = (b.notes ? b.notes + ' ' : '') + `[Preserved independent travel from deleted checklist ${chkId}]`;
            changed = true;
          }
        } else {
          inMemoryBookings.delete(k);
          inMemoryAuditLogs.delete(k);
          changed = true;
        }
      } else if (existingChecklist.installation_status === 'Cancelled') {
        if (!isIndependentConfirmedTravel(b, 'OUTBOUND') && b.outbound_status !== 'Cancelled') {
          b.outbound_status = 'Cancelled';
          changed = true;
        }
        if (!isIndependentConfirmedTravel(b, 'RETURN') && b.return_status !== 'Cancelled') {
          b.return_status = 'Cancelled';
          changed = true;
        }
      }
    }

    if (changed) {
      saveFallbackStorage();
    }
  } catch (err) {
    console.warn('Coordinator bookings reconciliation error:', err.message);
  }
  return changed;
}

// Trigger initial async reconciliation
setTimeout(() => {
  reconcileCoordinatorBookings().catch(() => {});
}, 500);

/**
 * Validate booking status updates.
 * The coordinator's primary responsibility is to manage booking statuses without entering
 * bus names, hotel names, room numbers, ticket numbers, booking references, or unnecessary details.
 */
export function validateBookingCompletion(bookingData) {
  const errors = [];
  const validOutbound = ['Pending', 'Booked', 'Confirmed', 'Cancelled', 'Required'];
  const validAccom = ['Pending', 'Pending Review', 'Booked', 'Confirmed', 'Cancelled', 'Required', 'Extension Required', 'Extension Pending', 'Extended'];
  const validReturn = ['Pending', 'Booked', 'Confirmed', 'Cancelled', 'Not Required Yet', 'Not Yet Required', 'Awaiting Technician Booking', 'Submitted for Verification', 'Needs Correction', 'Verified/Completed', 'Booking Required', 'In Progress', 'Booking Confirmed'];

  if (bookingData.outbound_status && !validOutbound.includes(bookingData.outbound_status)) {
    errors.push(`Invalid outbound status: ${bookingData.outbound_status}. Must be one of: Pending, Booked, Confirmed, Cancelled.`);
  }
  if (bookingData.accommodation_status && !validAccom.includes(bookingData.accommodation_status)) {
    errors.push(`Invalid room booking status: ${bookingData.accommodation_status}. Must be one of: Pending, Pending Review, Booked, Confirmed, Cancelled.`);
  }
  if (bookingData.return_status && !validReturn.includes(bookingData.return_status)) {
    errors.push(`Invalid return ticket status: ${bookingData.return_status}. Must be one of: Pending, Booked, Confirmed, Cancelled.`);
  }

  // Validate that confirmed statuses have actual confirmation details (ticket reference or attachment)
  if (bookingData.outbound_status === 'Confirmed') {
    const hasTicketRef = Boolean(bookingData.outbound_ticket_reference && String(bookingData.outbound_ticket_reference).trim());
    const hasTicketUrl = Boolean(bookingData.outbound_attachment_url && String(bookingData.outbound_attachment_url).trim());
    if (!hasTicketRef && !hasTicketUrl) {
      errors.push('Confirmed outbound booking requires a valid ticket reference or ticket attachment.');
    }
  }

  if (bookingData.accommodation_status === 'Confirmed') {
    const isOffline = bookingData.accommodation_type === 'Offline booking';
    const hasHotelRef = Boolean(bookingData.hotel_booking_reference && String(bookingData.hotel_booking_reference).trim());
    const hasHotelUrl = Boolean(bookingData.accommodation_attachment_url && String(bookingData.accommodation_attachment_url).trim());
    const hasHotelName = Boolean(bookingData.hotel_name && String(bookingData.hotel_name).trim());
    if (!isOffline && !hasHotelRef && !hasHotelUrl) {
      errors.push('Confirmed online accommodation requires a booking reference or confirmation attachment.');
    } else if (isOffline && !hasHotelName) {
      errors.push('Confirmed offline accommodation requires a hotel/lodge name.');
    }
  }

  if (['Booking Confirmed', 'Confirmed'].includes(bookingData.return_status)) {
    const hasReturnRef = Boolean(bookingData.return_ticket_reference && String(bookingData.return_ticket_reference).trim());
    const hasReturnUrl = Boolean(bookingData.return_attachment_url && String(bookingData.return_attachment_url).trim());
    if (!hasReturnRef && !hasReturnUrl) {
      errors.push('Confirmed return ticket booking requires a valid ticket reference or ticket attachment.');
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
  const isCourieredNoTech = chk.delivery_method === 'Product Couriered' && (!chk.service_engineer || chk.service_engineer.trim() === '' || chk.service_engineer === 'Unassigned');

  return {
    id: uuidv4(),
    checklist_id: chk.id,
    booking_status: isCourieredNoTech ? 'NOT_REQUIRED' : 'PENDING',

    // Requirement 1 & 5: Outbound Ticket
    outbound_status: isCourieredNoTech ? 'Cancelled' : 'Required',
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
    travel_required: !isCourieredNoTech,
    travel_type: 'Bus',
    departure_city: '',
    destination: chk.client_location || '',
    travel_datetime: start ? `${start}T08:00:00.000Z` : null,
    ticket_reference: '',
    travel_notes: '',

    // Requirement 2 & 5: Accommodation
    accommodation_status: isCourieredNoTech ? 'Cancelled' : 'Required',
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
    accommodation_required: !isCourieredNoTech,

    // Requirement 4 & 5: Return Ticket
    return_task_id: `RET-TASK-${chk.checklist_number || chk.id}`,
    return_status: 'Not Required Yet',
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
    return_booking_date: null,
    return_submitted_at: null,
    return_submitted_by: null,
    return_submitted_by_name: '',
    return_correction_reason: '',
    return_correction_requested_at: null,
    return_correction_requested_by: null,
    return_correction_requested_by_name: '',
    return_verified_at: null,
    return_verified_by: null,
    return_verified_by_name: '',
    return_urgency: 'Normal',
    actual_completion_datetime: chk.actual_completion_datetime || null,
    report_submission_datetime: null,
    booking_issue_reason: '',
    return_notes: '',
    return_task_created: false,
    return_task_created_at: null,
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
  const isPostInstalled = chk.installation_status === 'Completed' && (chk.completion_type === 'TECHNICIAN_INSTALLED' || Boolean(chk.actual_completion_datetime));
  const isCourieredNoTech = chk.delivery_method === 'Product Couriered' && (!chk.service_engineer || chk.service_engineer.trim() === '' || chk.service_engineer === 'Unassigned');

  const normalized = { ...booking };

  if (isCourieredNoTech) {
    normalized.booking_status = 'NOT_REQUIRED';
  }

  // Outbound: Map to Pending, Booked, Confirmed, Cancelled
  let outSt = normalized.outbound_status;
  if (isCourieredNoTech || normalized.travel_required === false || outSt === 'Cancelled' || outSt === 'NOT_REQUIRED') {
    outSt = 'Cancelled';
  } else if (['Confirmed', 'COMPLETED', 'Completed'].includes(outSt)) {
    outSt = 'Confirmed';
  } else if (outSt === 'Booked') {
    outSt = 'Booked';
  } else {
    outSt = 'Pending';
  }
  normalized.outbound_status = outSt;
  normalized.travel_required = (outSt !== 'Cancelled');
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

  // Accommodation: Map to Pending, Pending Review, Booked, Confirmed, Cancelled
  let accSt = normalized.accommodation_status;
  if (isCourieredNoTech || normalized.accommodation_required === false || accSt === 'Cancelled' || accSt === 'NOT_REQUIRED') {
    accSt = 'Cancelled';
  } else if (['Pending Review', 'Extension Required', 'Extension Pending'].includes(accSt) || normalized.accommodation_dates_affected) {
    accSt = 'Pending Review';
  } else if (['Confirmed', 'COMPLETED', 'Completed'].includes(accSt)) {
    accSt = 'Confirmed';
  } else if (['Booked', 'Extended'].includes(accSt)) {
    accSt = 'Booked';
  } else {
    accSt = 'Pending';
  }
  normalized.accommodation_status = accSt;
  normalized.accommodation_required = (accSt !== 'Cancelled');
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

  // Track original and revised installation dates for Room Bookings
  const origDate = normalized.original_installation_date || chk.original_expected_arrival_date || chk.expected_arrival_date || start;
  normalized.original_installation_date = origDate;

  const hasExtension = Boolean(
    (chk.schedule_revision_number && chk.schedule_revision_number > 0) ||
    (chk.current_booking_end_date && chk.original_booking_end_date && chk.current_booking_end_date !== chk.original_booking_end_date) ||
    normalized.revised_installation_date ||
    accSt === 'Pending Review'
  );
  normalized.revised_installation_date = hasExtension ? (normalized.revised_installation_date || chk.current_booking_end_date || end) : null;

  // Return Ticket: ONLY exists if post-installation form submitted or return_task_created
  const returnTaskExists = Boolean(normalized.return_task_created || isPostInstalled);
  let retSt = normalized.return_status;
  if (!returnTaskExists) {
    retSt = 'Not Required Yet';
  } else {
    if (['Verified/Completed', 'Booking Confirmed'].includes(retSt)) {
      retSt = 'Verified/Completed';
    } else if (retSt === 'Submitted for Verification') {
      retSt = 'Submitted for Verification';
    } else if (retSt === 'Needs Correction') {
      retSt = 'Needs Correction';
    } else if (['Awaiting Technician Booking', 'Booking Required', 'Pending'].includes(retSt)) {
      retSt = 'Awaiting Technician Booking';
    } else if (['Confirmed', 'Completed'].includes(retSt)) {
      retSt = 'Confirmed';
    } else if (['Booked'].includes(retSt)) {
      retSt = 'Booked';
    } else if (['Cancelled'].includes(retSt)) {
      retSt = 'Cancelled';
    } else {
      retSt = 'Awaiting Technician Booking';
    }
  }
  normalized.return_status = retSt;
  normalized.return_task_created = returnTaskExists;
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
  normalized.return_booking_date = normalized.return_booking_date || null;
  normalized.return_submitted_at = normalized.return_submitted_at || null;
  normalized.return_submitted_by = normalized.return_submitted_by || null;
  normalized.return_submitted_by_name = normalized.return_submitted_by_name || '';
  normalized.return_correction_reason = normalized.return_correction_reason || '';
  normalized.return_correction_requested_at = normalized.return_correction_requested_at || null;
  normalized.return_correction_requested_by = normalized.return_correction_requested_by || null;
  normalized.return_correction_requested_by_name = normalized.return_correction_requested_by_name || '';
  normalized.return_verified_at = normalized.return_verified_at || null;
  normalized.return_verified_by = normalized.return_verified_by || null;
  normalized.return_verified_by_name = normalized.return_verified_by_name || '';
  normalized.return_urgency = normalized.return_urgency || 'Normal';
  normalized.actual_completion_datetime = normalized.actual_completion_datetime || chk.actual_completion_datetime || null;
  normalized.report_submission_datetime = normalized.report_submission_datetime || normalized.actual_completion_datetime || null;
  normalized.booking_issue_reason = normalized.booking_issue_reason || '';
  normalized.return_notes = normalized.return_notes || '';
  normalized.return_task_completed = Boolean(
    retSt === 'Confirmed' ||
    retSt === 'Verified/Completed' ||
    booking?.return_task_completed
  );

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

    const isTechDep = isChecklistTechnicianDependent(chk);
    const memDecl = inMemoryDeclarations.get(chk.id);
    const memCarry = inMemoryCarryRecords.get(chk.id);
    const isSubmitted = Boolean(
      ['DECLARED', 'CORRECTED', 'VERIFIED'].includes(memDecl?.status) ||
      ['SUBMITTED', 'AUDITED'].includes(memCarry?.status)
    );

    return {
      ...chk,
      coordinator_booking: normalizedBooking,
      booking_status: normalizedBooking.booking_status || 'PENDING',
      is_technician_dependent: isTechDep,
      has_pre_installation_submitted: isSubmitted,
      pre_installation_status: isSubmitted ? 'Submitted' : 'Pending',
      pre_installation_submitted_at: memDecl?.declaration_timestamp || memCarry?.submitted_at || null,
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

    // Outbound Travel stats
    outbound_pending: 0,
    outbound_booked: 0,
    outbound_confirmed: 0,
    outbound_cancelled: 0,
    outbound_total: enriched.length,

    // Room Bookings stats
    room_pending: 0,
    room_pending_review: 0,
    room_booked: 0,
    room_confirmed: 0,
    room_cancelled: 0,
    room_total: enriched.length,

    // Return Tickets stats (only created return ticket requests)
    return_pending: 0,
    return_booked: 0,
    return_confirmed: 0,
    return_cancelled: 0,
    return_total: 0,

    // Extension Reviews count (records genuinely awaiting review)
    extension_reviews: 0,
  };

  enriched.forEach((item) => {
    const st = item.booking_status;
    const isActionable = !item.is_technician_dependent || item.has_pre_installation_submitted;

    if (st === 'PENDING') {
      if (isActionable) stats.pending++;
    } else if (st === 'IN_PROGRESS') {
      if (isActionable) stats.in_progress++;
    } else if (st === 'COMPLETED') {
      stats.completed++;
    } else if (st === 'NOT_REQUIRED') {
      stats.not_required++;
    }

    const cb = item.coordinator_booking;
    if (!cb) return;

    // Outbound
    if (cb.outbound_status === 'Pending') {
      if (isActionable) stats.outbound_pending++;
    } else if (cb.outbound_status === 'Booked') stats.outbound_booked++;
    else if (cb.outbound_status === 'Confirmed') stats.outbound_confirmed++;
    else if (cb.outbound_status === 'Cancelled') stats.outbound_cancelled++;

    // Room Bookings
    if (cb.accommodation_status === 'Pending') {
      if (isActionable) stats.room_pending++;
    } else if (cb.accommodation_status === 'Pending Review') {
      stats.room_pending_review++;
      stats.extension_reviews++;
    } else if (cb.accommodation_status === 'Booked') stats.room_booked++;
    else if (cb.accommodation_status === 'Confirmed') stats.room_confirmed++;
    else if (cb.accommodation_status === 'Cancelled') stats.room_cancelled++;

    // Return Tickets (only created return tickets)
    if (cb.return_task_created && cb.return_status && cb.return_status !== 'Not Required Yet') {
      stats.return_total++;
      if (['Pending', 'Awaiting Technician Booking', 'Submitted for Verification', 'Needs Correction', 'Booking Required'].includes(cb.return_status)) stats.return_pending++;
      else if (cb.return_status === 'Booked') stats.return_booked++;
      else if (['Confirmed', 'Verified/Completed'].includes(cb.return_status)) stats.return_confirmed++;
      else if (cb.return_status === 'Cancelled') stats.return_cancelled++;
    }
  });

  stats.return_ticket_required = stats.return_pending;
  stats.extension_required = stats.room_pending_review;

  // 5. Apply Tab & Filters
  let filtered = enriched.filter((item) => {
    const st = item.booking_status;
    const cb = item.coordinator_booking;

    // Tab filter:
    if (tab === 'pending') {
      // Routing Gate: For technician-dependent checklists, they must NOT appear as actionable
      // booking tasks in Coordinator's pending operational queue until the Pre-Installation Form is submitted.
      if (item.is_technician_dependent && !item.has_pre_installation_submitted) return false;
      if (st !== 'PENDING' && st !== 'IN_PROGRESS') return false;
    } else if (tab === 'completed') {
      if (st !== 'COMPLETED' && st !== 'NOT_REQUIRED') return false;
    } else if (tab === 'return' || tab === 'returns' || tab === 'pending_returns') {
      // Return Tickets view: ONLY show jobs where return-ticket request was actually created
      if (!cb?.return_task_created || cb?.return_status === 'Not Required Yet') return false;
    } else if (tab === 'extension_reviews' || tab === 'pending_reviews') {
      // Extension Reviews view: ONLY show jobs requiring review
      if (cb?.accommodation_status !== 'Pending Review') return false;
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
  let outboundStatus = bookingData.outbound_status || (!travelReq ? 'Cancelled' : (existing?.outbound_status || 'Pending'));
  if (outboundStatus === 'Required') outboundStatus = 'Pending';
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
  let accomStatus = bookingData.accommodation_status || (!accomReq ? 'Cancelled' : (existing?.accommodation_status || 'Pending'));
  if (accomStatus === 'Required') accomStatus = 'Pending';
  if (['Extension Required', 'Extension Pending'].includes(accomStatus)) accomStatus = 'Pending Review';
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
  if (returnStatus === 'Booking Confirmed') returnStatus = 'Verified/Completed';
  if (returnStatus === 'Booking Required') returnStatus = 'Awaiting Technician Booking';

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
  const isCompletedVerified = returnStatus === 'Verified/Completed' || returnStatus === 'Booking Confirmed' || returnStatus === 'Confirmed';
  const returnTaskCompleted = Boolean(bookingData.return_task_completed || isCompletedVerified);

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
    return_booking_date: bookingData.return_booking_date !== undefined ? bookingData.return_booking_date : (existing?.return_booking_date || null),
    return_submitted_at: bookingData.return_submitted_at !== undefined ? bookingData.return_submitted_at : (existing?.return_submitted_at || null),
    return_submitted_by: bookingData.return_submitted_by !== undefined ? bookingData.return_submitted_by : (existing?.return_submitted_by || null),
    return_submitted_by_name: bookingData.return_submitted_by_name !== undefined ? bookingData.return_submitted_by_name : (existing?.return_submitted_by_name || null),
    return_correction_reason: bookingData.return_correction_reason !== undefined ? bookingData.return_correction_reason : (existing?.return_correction_reason || null),
    return_correction_requested_at: bookingData.return_correction_requested_at !== undefined ? bookingData.return_correction_requested_at : (existing?.return_correction_requested_at || null),
    return_correction_requested_by: bookingData.return_correction_requested_by !== undefined ? bookingData.return_correction_requested_by : (existing?.return_correction_requested_by || null),
    return_correction_requested_by_name: bookingData.return_correction_requested_by_name !== undefined ? bookingData.return_correction_requested_by_name : (existing?.return_correction_requested_by_name || null),
    return_verified_at: bookingData.return_verified_at !== undefined ? bookingData.return_verified_at : (existing?.return_verified_at || null),
    return_verified_by: bookingData.return_verified_by !== undefined ? bookingData.return_verified_by : (existing?.return_verified_by || null),
    return_verified_by_name: bookingData.return_verified_by_name !== undefined ? bookingData.return_verified_by_name : (existing?.return_verified_by_name || null),
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
    schedule_flagged_for_review: bookingData.schedule_flagged_for_review !== undefined
      ? Boolean(bookingData.schedule_flagged_for_review)
      : (accomStatus === 'Pending Review' ? true : (bookingData.accommodation_status ? false : Boolean(existing?.schedule_flagged_for_review))),
    schedule_review_reason: bookingData.schedule_review_reason !== undefined ? bookingData.schedule_review_reason : (existing?.schedule_review_reason || null),
    return_travel_date_affected: Boolean(bookingData.return_travel_date_affected ?? existing?.return_travel_date_affected),
    accommodation_dates_affected: bookingData.accommodation_dates_affected !== undefined
      ? Boolean(bookingData.accommodation_dates_affected)
      : (accomStatus === 'Pending Review' ? true : (bookingData.accommodation_status ? false : Boolean(existing?.accommodation_dates_affected))),
    original_installation_date: bookingData.original_installation_date || existing?.original_installation_date || checklist.original_expected_arrival_date || checklist.expected_arrival_date || null,
    revised_installation_date: bookingData.revised_installation_date || existing?.revised_installation_date || (accomStatus === 'Pending Review' ? (checklist.current_booking_end_date || checklist.expected_arrival_date) : null),
    created_at: existing ? existing.created_at : now,
    updated_at: now,
  };

  const isUuid = (val) => Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));
  if (!isUuid(payload.created_by)) payload.created_by = null;
  if (!isUuid(payload.updated_by)) payload.updated_by = null;
  if (!isUuid(payload.outbound_booked_by)) payload.outbound_booked_by = null;
  if (!isUuid(payload.return_booked_by)) payload.return_booked_by = null;
  if (!isUuid(payload.return_submitted_by)) payload.return_submitted_by = null;
  if (!isUuid(payload.return_correction_requested_by)) payload.return_correction_requested_by = null;
  if (!isUuid(payload.return_verified_by)) payload.return_verified_by = null;

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
        currentPayload.return_submitted_by = null;
        currentPayload.return_correction_requested_by = null;
        currentPayload.return_verified_by = null;
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
  const hasAlreadyTriggered = Boolean(existingRaw && existingRaw.return_task_created);
  if (hasAlreadyTriggered && existing.return_status && !['Not Required Yet', 'Not Yet Required'].includes(existing.return_status)) {
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
    return_status: 'Awaiting Technician Booking',
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
    newStatus: 'Awaiting Technician Booking',
    user: user || { id: 'system', email: 'system@eagleeye.com', role: 'TECHNICAL' },
    notes: `Installation completed — return ticket booking task created. Actual completion: ${completionTime}, Submitted: ${submissionTime}, Urgency: ${urgency}`,
    snapshot: saved,
  });

  // 2. Create Coordinator Notification (decoupled: failure does NOT rollback or lose task)
  try {
    await createNotification({
      targetRole: 'COORDINATOR',
      title: 'Return ticket task created — awaiting technician booking',
      message: `Installation completed for checklist ${checklist.checklist_number} (${checklist.client_name}). Return-ticket booking task created and awaiting technician booking & verification. Completed: ${completionTime}`,
      type: 'RETURN_TICKET_AWAITING_BOOKING',
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
    console.warn('Coordinator notification delivery failed for return ticket task (task safely saved):', notifErr.message);
  }

  // 3. Create Technician Notification
  try {
    const targetTechId = checklist.assigned_technician_id || checklist.service_engineer_id || (user?.role === 'TECHNICAL' ? user?.id : null);
    await createNotification({
      targetRole: 'TECHNICAL',
      targetUserId: targetTechId,
      title: 'Return ticket booking required',
      message: `Installation completed for checklist ${checklist.checklist_number} (${checklist.client_name}). Please book your return ticket and submit details for coordinator verification.`,
      type: 'RETURN_TICKET_BOOKING_REQUIRED',
      checklistId,
      checklistNumber: checklist.checklist_number,
      metadata: {
        task_id: taskId,
        checklist_id: checklistId,
        checklist_number: checklist.checklist_number,
        client_name: checklist.client_name,
        location,
        actual_completion_datetime: completionTime,
      },
    });
  } catch (techNotifErr) {
    console.warn('Technician notification delivery failed for return ticket task (task safely saved):', techNotifErr.message);
  }

  return saved;
}

/**
 * Technician submits return journey booking details for Coordinator verification
 */
export async function submitTechnicianReturnTicket({ checklistId, bookingData = {}, user = {} }) {
  if (!checklistId) {
    const err = new Error('Checklist ID is required.');
    err.statusCode = 400;
    throw err;
  }

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found.');
    err.statusCode = 404;
    throw err;
  }

  // Strict RBAC: if caller is a technician, ensure they are assigned to this job
  const userRole = (user?.role || '').toUpperCase();
  if (userRole === 'TECHNICAL') {
    const isAssigned =
      checklist.assigned_technician_id === user.id ||
      checklist.service_engineer_id === user.id ||
      (checklist.service_engineer && user.full_name && checklist.service_engineer.toLowerCase() === user.full_name.toLowerCase()) ||
      (checklist.service_engineer && user.name && checklist.service_engineer.toLowerCase() === user.name.toLowerCase()) ||
      (checklist.service_engineer_email && user.email && checklist.service_engineer_email.toLowerCase() === user.email.toLowerCase()) ||
      !checklist.service_engineer;
    if (!isAssigned) {
      const err = new Error('Unauthorized: You can only submit return ticket bookings for jobs assigned to you.');
      err.statusCode = 403;
      throw err;
    }
  }

  const existingRaw = await getBookingRecord(checklistId);
  const existing = normalizeBookingData(existingRaw, checklist);

  if (existing.return_status === 'Verified/Completed' && userRole === 'TECHNICAL') {
    const err = new Error('Cannot modify a return ticket that has already been verified and completed.');
    err.statusCode = 400;
    throw err;
  }

  // Validate travel method
  const method = bookingData.return_method || existing.return_method || 'Government bus';
  if (!['Government bus', 'Private travels'].includes(method)) {
    const err = new Error('Return travel method must be either "Government bus" or "Private travels".');
    err.statusCode = 400;
    throw err;
  }

  // Validate required booking fields
  const bookingDate = bookingData.return_booking_date || new Date().toISOString().split('T')[0];
  const travelDatetime = bookingData.return_departure_datetime || bookingData.return_travel_datetime;
  if (!travelDatetime) {
    const err = new Error('Travel date and time are required.');
    err.statusCode = 400;
    throw err;
  }

  const boardingPoint = (bookingData.return_boarding_point || bookingData.return_origin || '').trim();
  if (!boardingPoint) {
    const err = new Error('Boarding point is required.');
    err.statusCode = 400;
    throw err;
  }

  const destination = (bookingData.return_destination || '').trim();
  if (!destination) {
    const err = new Error('Destination is required.');
    err.statusCode = 400;
    throw err;
  }

  const operator = (bookingData.return_operator || '').trim();
  if (!operator) {
    const err = new Error('Operator or service name is required.');
    err.statusCode = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  const prevStatus = existing.return_status;
  const isResubmission = prevStatus === 'Needs Correction';

  const updatedData = {
    ...existing,
    return_status: 'Submitted for Verification',
    return_method: method,
    return_booking_date: bookingDate,
    return_departure_datetime: travelDatetime,
    return_departure_time: bookingData.return_departure_time || (travelDatetime.includes('T') ? travelDatetime.split('T')[1]?.slice(0, 5) : null),
    return_boarding_point: boardingPoint,
    return_origin: boardingPoint,
    return_destination: destination,
    return_operator: operator,
    return_ticket_reference: (bookingData.return_ticket_reference || '').trim() || null,
    return_attachment_url: bookingData.return_attachment_url || existing.return_attachment_url || null,
    return_attachment_name: bookingData.return_attachment_name || existing.return_attachment_name || null,
    return_notes: (bookingData.return_notes || '').trim() || null,
    return_submitted_at: nowIso,
    return_submitted_by: user.id || null,
    return_submitted_by_name: user.full_name || user.name || user.email || 'Technician',
    return_task_completed: false,
    return_task_created: true,
  };

  const saved = await saveCoordinatorBooking({
    checklistId,
    bookingData: updatedData,
    user,
  });

  const auditAction = isResubmission ? 'RETURN_TICKET_RESUBMITTED' : 'RETURN_TICKET_SUBMITTED';
  await recordBookingAudit({
    bookingId: saved.id,
    checklistId,
    action: auditAction,
    previousStatus: prevStatus,
    newStatus: 'Submitted for Verification',
    user,
    notes: `${isResubmission ? 'Resubmitted corrected' : 'Submitted'} return ticket by Technician: ${operator} (${method}), Departure: ${travelDatetime}, Ref: ${updatedData.return_ticket_reference || 'N/A'}${updatedData.return_notes ? ' | Notes: ' + updatedData.return_notes : ''}`,
    snapshot: saved,
    beforeState: existing || null,
  });

  // Notify Coordinator
  try {
    await createNotification({
      targetRole: 'COORDINATOR',
      title: isResubmission
        ? 'Technician resubmitted corrected return-ticket details'
        : 'Technician submitted return-ticket details for verification',
      message: `Technician ${user.full_name || user.email || 'Technician'} ${isResubmission ? 'resubmitted corrected' : 'submitted'} return-ticket booking details for checklist ${checklist.checklist_number} (${checklist.client_name}). Please review and verify.`,
      type: 'RETURN_TICKET_SUBMITTED_FOR_VERIFICATION',
      checklistId,
      checklistNumber: checklist.checklist_number,
      metadata: {
        checklist_id: checklistId,
        checklist_number: checklist.checklist_number,
        technician_name: user.full_name || user.email || 'Technician',
        operator,
        travel_datetime: travelDatetime,
        ticket_reference: updatedData.return_ticket_reference,
        booking_link: `/coordinator?view=${checklistId}&action=return_ticket`,
      },
    });
  } catch (notifErr) {
    console.warn('Coordinator notification delivery failed for return ticket submission:', notifErr.message);
  }

  return { checklist, booking: saved };
}

/**
 * Coordinator reviews and marks Return Ticket Task as Verified / Completed
 */
export async function verifyReturnTicketBooking({ checklistId, user = {} }) {
  if (!checklistId) {
    const err = new Error('Checklist ID is required.');
    err.statusCode = 400;
    throw err;
  }

  // Strict RBAC: Only Coordinator or Admin can verify
  const role = (user?.role || '').toUpperCase();
  if (role !== 'COORDINATOR' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    const err = new Error('Forbidden: Only an authorized Coordinator or Admin can verify and mark a return ticket task complete.');
    err.statusCode = 403;
    throw err;
  }

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found.');
    err.statusCode = 404;
    throw err;
  }

  const existingRaw = await getBookingRecord(checklistId);
  const existing = normalizeBookingData(existingRaw, checklist);

  const nowIso = new Date().toISOString();
  const prevStatus = existing.return_status;

  const updatedData = {
    ...existing,
    return_status: 'Verified/Completed',
    return_verified_at: nowIso,
    return_verified_by: user.id || null,
    return_verified_by_name: user.full_name || user.name || user.email || 'Coordinator',
    return_task_completed: true,
  };

  const saved = await saveCoordinatorBooking({
    checklistId,
    bookingData: updatedData,
    user,
  });

  await recordBookingAudit({
    bookingId: saved.id,
    checklistId,
    action: 'RETURN_TICKET_VERIFIED_COMPLETED',
    previousStatus: prevStatus,
    newStatus: 'Verified/Completed',
    user,
    notes: `Return ticket verified and completed by Coordinator (${user.full_name || user.email || 'Coordinator'}). Operator: ${saved.return_operator || 'N/A'}, Method: ${saved.return_method || 'Bus'}, Ref: ${saved.return_ticket_reference || 'N/A'}`,
    snapshot: saved,
    beforeState: existing || null,
  });

  // Notify Technician
  try {
    const targetTechId = checklist.assigned_technician_id || checklist.service_engineer_id || null;
    await createNotification({
      targetRole: 'TECHNICAL',
      targetUserId: targetTechId,
      title: 'Return ticket verified & completed',
      message: `Coordinator has verified and completed your return ticket task for checklist ${checklist.checklist_number} (${checklist.client_name}).`,
      type: 'RETURN_TICKET_VERIFIED',
      checklistId,
      checklistNumber: checklist.checklist_number,
      metadata: {
        checklist_id: checklistId,
        checklist_number: checklist.checklist_number,
        verified_by: user.full_name || user.email || 'Coordinator',
        verified_at: nowIso,
      },
    });
  } catch (notifErr) {
    console.warn('Technician notification delivery failed for return ticket verification:', notifErr.message);
  }

  return { checklist, booking: saved };
}

/**
 * Coordinator requests correction on submitted return ticket details
 */
export async function requestReturnTicketCorrection({ checklistId, reason, user = {} }) {
  if (!checklistId) {
    const err = new Error('Checklist ID is required.');
    err.statusCode = 400;
    throw err;
  }

  // Strict RBAC: Only Coordinator or Admin can request correction
  const role = (user?.role || '').toUpperCase();
  if (role !== 'COORDINATOR' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    const err = new Error('Forbidden: Only an authorized Coordinator or Admin can request corrections on return ticket bookings.');
    err.statusCode = 403;
    throw err;
  }

  const trimmedReason = (reason || '').trim();
  if (!trimmedReason) {
    const err = new Error('Correction reason is required.');
    err.statusCode = 400;
    throw err;
  }

  const checklist = await getChecklistById(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found.');
    err.statusCode = 404;
    throw err;
  }

  const existingRaw = await getBookingRecord(checklistId);
  const existing = normalizeBookingData(existingRaw, checklist);

  const nowIso = new Date().toISOString();
  const prevStatus = existing.return_status;

  const updatedData = {
    ...existing,
    return_status: 'Needs Correction',
    return_correction_reason: trimmedReason,
    return_correction_requested_at: nowIso,
    return_correction_requested_by: user.id || null,
    return_correction_requested_by_name: user.full_name || user.name || user.email || 'Coordinator',
    return_task_completed: false,
  };

  const saved = await saveCoordinatorBooking({
    checklistId,
    bookingData: updatedData,
    user,
  });

  await recordBookingAudit({
    bookingId: saved.id,
    checklistId,
    action: 'RETURN_TICKET_CORRECTION_REQUESTED',
    previousStatus: prevStatus,
    newStatus: 'Needs Correction',
    user,
    notes: `Coordinator requested correction for return ticket: "${trimmedReason}"`,
    snapshot: saved,
    beforeState: existing || null,
  });

  // Notify Technician
  try {
    const targetTechId = checklist.assigned_technician_id || checklist.service_engineer_id || null;
    await createNotification({
      targetRole: 'TECHNICAL',
      targetUserId: targetTechId,
      title: 'Return ticket details need correction',
      message: `Coordinator requested corrections for return ticket on checklist ${checklist.checklist_number} (${checklist.client_name}): "${trimmedReason}". Please update and resubmit.`,
      type: 'RETURN_TICKET_CORRECTION_REQUESTED',
      checklistId,
      checklistNumber: checklist.checklist_number,
      metadata: {
        checklist_id: checklistId,
        checklist_number: checklist.checklist_number,
        correction_reason: trimmedReason,
        requested_by: user.full_name || user.email || 'Coordinator',
        requested_at: nowIso,
      },
    });
  } catch (notifErr) {
    console.warn('Technician notification delivery failed for return ticket correction request:', notifErr.message);
  }

  return { checklist, booking: saved };
}

/**
 * Fetch Return Ticket Tasks with RBAC filtering (Technicians see only assigned jobs, Coordinators see all)
 */
export async function getReturnTicketTasks({ user = {}, status = null, search = '' }) {
  const checklistResult = await getChecklists({
    limit: 500,
    search: search ? search.trim() : '',
  });

  const rawChecklists = checklistResult?.checklists || [];

  try {
    const { data, error } = await supabase.from('coordinator_bookings').select('*');
    if (!error && Array.isArray(data)) {
      data.forEach((b) => {
        const existing = inMemoryBookings.get(b.checklist_id) || {};
        inMemoryBookings.set(b.checklist_id, { ...b, ...existing });
      });
    }
  } catch (e) {}

  const tasks = [];
  const searchLower = (search || '').trim().toLowerCase();
  const userRole = (user?.role || '').toUpperCase();

  for (const chk of rawChecklists) {
    const rawBooking = inMemoryBookings.get(chk.id) || null;
    const b = normalizeBookingData(rawBooking, chk);

    const hasReturnTask = b.return_task_created || chk.installation_status === 'Completed' || Boolean(chk.actual_completion_datetime);
    if (!hasReturnTask) continue;

    // RBAC: Technicians can only view tasks assigned to them
    if (userRole === 'TECHNICAL') {
      const isAssigned =
        chk.assigned_technician_id === user.id ||
        chk.service_engineer_id === user.id ||
        (chk.service_engineer && user.full_name && chk.service_engineer.toLowerCase() === user.full_name.toLowerCase()) ||
        (chk.service_engineer && user.name && chk.service_engineer.toLowerCase() === user.name.toLowerCase()) ||
        (chk.service_engineer_email && user.email && chk.service_engineer_email.toLowerCase() === user.email.toLowerCase()) ||
        !chk.service_engineer;
      if (!isAssigned) continue;
    }

    if (status && status !== 'ALL') {
      if (b.return_status !== status) continue;
    }

    if (searchLower) {
      const match =
        (chk.checklist_number || '').toLowerCase().includes(searchLower) ||
        (chk.client_name || '').toLowerCase().includes(searchLower) ||
        (chk.client_location || '').toLowerCase().includes(searchLower) ||
        (chk.service_engineer || '').toLowerCase().includes(searchLower) ||
        (b.return_operator || '').toLowerCase().includes(searchLower) ||
        (b.return_ticket_reference || '').toLowerCase().includes(searchLower);
      if (!match) continue;
    }

    tasks.push({
      id: chk.id,
      task_id: b.return_task_id || `RET-TASK-${chk.checklist_number || chk.id}`,
      checklist_id: chk.id,
      checklist_number: chk.checklist_number,
      client_name: chk.client_name,
      client_location: chk.client_location,
      service_engineer: chk.service_engineer,
      assigned_technician_id: chk.assigned_technician_id,
      actual_completion_datetime: chk.actual_completion_datetime || b.actual_completion_datetime,
      installation_status: chk.installation_status,
      return_task_id: b.return_task_id,
      return_status: b.return_status,
      return_method: b.return_method,
      return_booking_date: b.return_booking_date,
      return_departure_datetime: b.return_departure_datetime,
      return_departure_time: b.return_departure_time,
      return_boarding_point: b.return_boarding_point,
      return_destination: b.return_destination,
      return_operator: b.return_operator,
      return_ticket_reference: b.return_ticket_reference,
      return_attachment_url: b.return_attachment_url,
      return_attachment_name: b.return_attachment_name,
      return_notes: b.return_notes,
      return_submitted_at: b.return_submitted_at,
      return_submitted_by: b.return_submitted_by,
      return_submitted_by_name: b.return_submitted_by_name,
      return_correction_reason: b.return_correction_reason,
      return_correction_requested_at: b.return_correction_requested_at,
      return_correction_requested_by: b.return_correction_requested_by,
      return_correction_requested_by_name: b.return_correction_requested_by_name,
      return_verified_at: b.return_verified_at,
      return_verified_by: b.return_verified_by,
      return_verified_by_name: b.return_verified_by_name,
      return_urgency: b.return_urgency,
      return_task_completed: b.return_task_completed,
      created_at: b.return_task_created_at || b.created_at || chk.created_at,
      coordinator_booking: b,
      checklist: chk,
    });
  }

  const statusPriority = {
    'Submitted for Verification': 4,
    'Needs Correction': 3,
    'Awaiting Technician Booking': 2,
    'Verified/Completed': 1,
  };

  tasks.sort((a, b) => {
    const pA = statusPriority[a.return_status] || 0;
    const pB = statusPriority[b.return_status] || 0;
    if (pB !== pA) return pB - pA;
    const tA = new Date(a.return_submitted_at || a.actual_completion_datetime || a.created_at || 0).getTime();
    const tB = new Date(b.return_submitted_at || b.actual_completion_datetime || b.created_at || 0).getTime();
    return tB - tA;
  });

  return tasks;
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
/**
 * Flag a booking for review when a schedule extension or change occurs
 */
export async function flagBookingForReview({
  checklistId,
  reason,
  returnTravelAffected = false,
  accommodationAffected = false,
  accommodationStatus = 'Pending Review',
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

/**
 * Critical Business Rule 1 & Safeguards:
 * When an installation date is extended or changed, the affected room booking must automatically change to Pending Review.
 * Preserves previous and revised dates in history/audit.
 * Safeguards:
 * - Does not change unrelated room bookings.
 * - Does not create duplicate room bookings.
 * - Does not automatically mark as Booked or Confirmed.
 * - Does not reset room booking when date has not actually changed.
 * - If room booking does not exist, does not silently create one unless workflow requires it.
 * - Does not create a return-ticket request.
 */
export async function handleInstallationDateChange({
  checklistId,
  oldStartDate = null,
  newStartDate = null,
  oldEndDate = null,
  newEndDate = null,
  reason = '',
  user = {},
}) {
  if (!checklistId) return;

  const startChanged = Boolean(newStartDate && oldStartDate && newStartDate !== oldStartDate);
  const endChanged = Boolean(newEndDate && oldEndDate && newEndDate !== oldEndDate);
  const isExtension = String(reason).toLowerCase().includes('extension');

  if (!startChanged && !endChanged && !isExtension) {
    // Dates did not actually change: do not touch room booking!
    return;
  }

  const existingRaw = await getBookingRecord(checklistId);
  if (!existingRaw && !inMemoryBookings.has(checklistId)) {
    // Safeguard: If a room booking does not exist, do not silently create one
    return;
  }

  const checklist = await getChecklistById(checklistId);
  if (!checklist) return;

  const existing = normalizeBookingData(existingRaw, checklist);

  const prevOriginalDate = existing.original_installation_date || oldEndDate || oldStartDate || checklist.original_booking_end_date || checklist.expected_arrival_date;
  const revisedDate = newEndDate || newStartDate || checklist.current_booking_end_date || checklist.expected_arrival_date;

  const historyEntry = {
    id: uuidv4(),
    previous_date: prevOriginalDate,
    revised_date: revisedDate,
    reason: reason || `Installation date changed to ${revisedDate}`,
    changed_at: new Date().toISOString(),
    changed_by: user?.email || user?.id || 'System',
  };

  const currentHistory = Array.isArray(existing.accommodation_history) ? [...existing.accommodation_history] : [];
  currentHistory.push(historyEntry);

  const updatedData = {
    ...existing,
    accommodation_status: 'Pending Review',
    original_installation_date: prevOriginalDate,
    revised_installation_date: revisedDate,
    accommodation_dates_affected: true,
    schedule_flagged_for_review: true,
    schedule_review_reason: reason || `Installation date changed/extended to ${revisedDate}`,
    accommodation_history: currentHistory,
  };

  const saved = await saveCoordinatorBooking({
    checklistId,
    bookingData: updatedData,
    user: user || { id: 'system', email: 'system@eagleeyesafdrive.com', role: 'ADMIN' },
  });

  return saved;
}

/**
 * Upload ticket or receipt image/PDF for return travel
 */
export async function uploadTicketReceiptService({ file, checklistId = 'return' }) {
  if (!file) throw new Error('No receipt or ticket file uploaded.');
  const { originalname, mimetype, buffer } = file;
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(mimetype)) {
    const err = new Error('Invalid file format. Only JPEG, PNG, WebP, and PDF receipts are accepted.');
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > 10 * 1024 * 1024) {
    const err = new Error('File exceeds the 10MB maximum receipt file size limit.');
    err.statusCode = 400;
    throw err;
  }

  const ext = path.extname(originalname) || (mimetype === 'application/pdf' ? '.pdf' : '.jpg');
  const filename = `ticket_${checklistId || 'job'}_${Date.now()}_${uuidv4().slice(0, 8)}${ext}`;
  const filePath = `tickets/${filename}`;

  try {
    const { data, error } = await supabase.storage
      .from('receipts')
      .upload(filePath, buffer, {
        contentType: mimetype,
        upsert: true,
      });

    if (!error && data) {
      const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(filePath);
      return {
        attachment_url: urlData?.publicUrl || filePath,
        attachment_name: originalname,
      };
    }
  } catch (err) {
    console.warn('Could not upload ticket receipt to Supabase storage, falling back to data URL:', err.message);
  }

  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimetype};base64,${base64}`;
  return {
    attachment_url: dataUrl,
    attachment_name: originalname,
  };
}

/**
 * Notify Coordinator immediately when a technician submits the Post-Installation Completion Form.
 * - Only triggered after form validation and report save succeed in database/fallback
 * - Creates persistent in-app notification for Coordinator role (idempotent, durable)
 * - Dispatches Web Push notification to registered Coordinator devices (non-blocking)
 * - Keeps return-ticket workflow intact as a separate coordinated action
 */
export async function notifyCoordinatorOnPostInstallationReport({
  checklist,
  report = null,
  technicianName = null,
  user = null,
  submissionTime = null,
  actualCompletionDatetime = null,
}) {
  if (!checklist?.id) return null;
  const checklistId = checklist.id;
  const checklistNumber = checklist.checklist_number || `INST-${checklistId.slice(0, 8)}`;
  const techName = technicianName || checklist.service_engineer || user?.full_name || user?.name || user?.email || 'Technician';
  const clientName = checklist.client_name || '';
  const now = submissionTime || new Date().toISOString();
  const compTime = actualCompletionDatetime || checklist.actual_completion_datetime || now;

  const title = 'Post-Installation Report Submitted';
  const message = `Technician ${techName} has submitted the post-installation report for checklist ${checklistNumber}. Please review the report and return-ticket details.`;

  // 1. Create Persistent In-App Notification (Idempotent)
  let notificationRecord = null;
  try {
    notificationRecord = await createNotification({
      targetRole: 'COORDINATOR',
      title,
      message,
      type: 'POST_INSTALLATION_REPORT_SUBMITTED',
      checklistId,
      checklistNumber,
      metadata: {
        task_type: 'POST_INSTALLATION_REPORT',
        checklist_id: checklistId,
        checklist_number: checklistNumber,
        client_name: clientName,
        technician_name: techName,
        submitted_at: now,
        actual_completion_datetime: compTime,
        action_label: 'Review Report',
        action_url: `/coordinator?tab=return&checklist=${checklistId}&openReport=true`,
        idempotency_key: `post-install-report-${checklistId}`,
      },
    });
  } catch (notifErr) {
    console.warn('[COORDINATOR_NOTIF] In-app notification creation warning (report saved):', notifErr.message);
  }

  // 2. Deliver Web Push Notification (non-blocking: failure will never rollback or fail report)
  let pushResult = null;
  try {
    const { notifyCoordinatorReportSubmitted } = await import('./pushNotificationService.js');
    pushResult = await notifyCoordinatorReportSubmitted({
      checklist,
      report,
      technicianName: techName,
      submissionTime: now,
    });
  } catch (pushErr) {
    console.warn('[COORDINATOR_NOTIF] Web Push notification delivery warning (in-app saved):', pushErr.message);
  }

  return {
    notification: notificationRecord,
    push: pushResult,
  };
}

