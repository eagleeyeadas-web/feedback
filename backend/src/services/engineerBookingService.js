import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { inMemoryChecklistSchedules, getBusinessToday } from './installationService.js';
import {
  getAllServiceEngineers as getDynamicServiceEngineers,
  inMemoryServiceEngineers,
  getServiceEngineerById,
  getActiveServiceEngineersSync,
} from './serviceEngineerService.js';

export { getActiveServiceEngineersSync };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.resolve(__dirname, '../data/engineer_bookings_storage.json');

/**
 * 1. THE FOUR AUTHORIZED SERVICE ENGINEERS (Exact names & deterministic UUIDs)
 */
export const SERVICE_ENGINEER_OPTIONS = [
  'Mathi',
  'Guna',
  'Sakthivel',
  'Kamalesh',
];

export const MAIN_SERVICE_ENGINEERS = [
  {
    id: 'e1000000-0000-0000-0000-000000000001',
    name: 'Mathi',
    role: 'Service Engineer',
    phone: '+91 98401 11001',
    email: 'mathi@eagleeyesafdrive.com',
  },
  {
    id: 'e1000000-0000-0000-0000-000000000006',
    name: 'Guna',
    role: 'Service Engineer',
    phone: '+91 98401 11002',
    email: 'guna@eagleeyesafdrive.com',
  },
  {
    id: 'e1000000-0000-0000-0000-000000000004',
    name: 'Sakthivel',
    role: 'Service Engineer',
    phone: '+91 98401 11003',
    email: 'sakthivel@eagleeyesafdrive.com',
  },
  {
    id: 'e1000000-0000-0000-0000-000000000002',
    name: 'Kamalesh',
    role: 'Service Engineer',
    phone: '+91 98401 11004',
    email: 'kamalesh@eagleeyesafdrive.com',
  },
];

/**
 * In-memory storage of bookings and concurrency lock map
 */
export const inMemoryBookings = new Map(); // key: booking id or checklist_id -> booking object
const engineerMutexQueues = new Map(); // key: engineer_id -> Promise chain for concurrency serialization

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.bookings)) {
        data.bookings.forEach((b) => inMemoryBookings.set(b.id || b.checklist_id, b));
      }
    }
  } catch (err) {
    console.warn('Could not load engineer bookings fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = {
      bookings: Array.from(inMemoryBookings.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save engineer bookings fallback storage:', err.message);
  }
}

// Initialize storage on module load
loadStorage();

export function cleanupTestBookingsForYear(year = '2028') {
  inMemoryBookings.forEach((b, k) => {
    if (b.booking_start_date?.startsWith(year) || b.booking_end_date?.startsWith(year)) {
      inMemoryBookings.delete(k);
    }
  });
  saveStorage();
}


/**
 * Concurrency Lock per engineer: Serializes concurrent reservation attempts on the same engineer
 */
export async function acquireEngineerLock(engineerId, fn) {
  let currentPromise = engineerMutexQueues.get(engineerId) || Promise.resolve();
  let release;
  const nextPromise = new Promise((resolve) => {
    release = resolve;
  });
  engineerMutexQueues.set(engineerId, currentPromise.then(() => nextPromise));
  await currentPromise;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Helper: Parse duration string into integer number of days
 */
export function parseDurationDays(durationStr) {
  if (!durationStr) return 1;
  const match = String(durationStr).match(/(\d+)/);
  if (match) {
    const days = parseInt(match[1], 10);
    return Math.max(1, days);
  }
  return 1;
}

/**
 * Helper: Calculate inclusive booking end date (YYYY-MM-DD)
 */
export function calculateBookingEndDate(startDateStr, durationDaysOrEndDate) {
  if (!startDateStr) return null;

  if (typeof durationDaysOrEndDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(durationDaysOrEndDate)) {
    if (durationDaysOrEndDate < startDateStr) {
      throw new Error(`End date (${durationDaysOrEndDate}) cannot be before start date (${startDateStr}).`);
    }
    return durationDaysOrEndDate;
  }

  const days = typeof durationDaysOrEndDate === 'number'
    ? durationDaysOrEndDate
    : parseDurationDays(durationDaysOrEndDate);

  const [y, m, d] = startDateStr.split('-').map(Number);
  const startObj = new Date(Date.UTC(y, m - 1, d));
  startObj.setUTCDate(startObj.getUTCDate() + (Math.max(1, days) - 1));

  return startObj.toISOString().split('T')[0];
}

/**
 * Helper: Calculate earliest availability date for a technician (YYYY-MM-DD)
 * Rule: Scheduled end date is the final working day and is inclusive.
 * The technician's earliest availability date is strictly the next calendar day (scheduled end date + 1 day).
 */
export function calculateEarliestAvailabilityDate(scheduledEndDateStr) {
  if (!scheduledEndDateStr) return null;
  const [y, m, d] = scheduledEndDateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().split('T')[0];
}

/**
 * Overlap check for two inclusive date ranges [startA, endA] and [startB, endB]
 */
export function isDateRangeOverlapping(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

/**
/**
 * Resolve engineer from ID or Name dynamically across all active and seeded engineers
 */
export function resolveEngineer(idOrName) {
  if (!idOrName) return null;
  const query = String(idOrName).trim().toLowerCase();

  // 1. Check in-memory service engineers map (includes all active and newly added engineers)
  if (inMemoryServiceEngineers.has(query)) {
    return inMemoryServiceEngineers.get(query);
  }

  // 2. Check MAIN_SERVICE_ENGINEERS seed
  const byId = MAIN_SERVICE_ENGINEERS.find((e) => e.id.toLowerCase() === query);
  if (byId) return byId;

  const byName = MAIN_SERVICE_ENGINEERS.find((e) => e.name.toLowerCase() === query);
  if (byName) return byName;

  const byPartial = MAIN_SERVICE_ENGINEERS.find(
    (e) => e.name.toLowerCase().includes(query) || query.includes(e.name.toLowerCase())
  );
  if (byPartial) return byPartial;

  // 3. Check for any in-memory engineer by partial name
  for (const [k, eng] of inMemoryServiceEngineers.entries()) {
    if (eng.name?.toLowerCase().includes(query) || query.includes(eng.name?.toLowerCase())) {
      return eng;
    }
  }

  return {
    id: `eng-${query.replace(/\s+/g, '-').toLowerCase()}`,
    name: idOrName.trim(),
    role: 'Service Engineer',
    email: '',
  };
}

/**
 * Fetch all configured active service engineers dynamically from authoritative records
 */
export async function getAllServiceEngineers() {
  return await getDynamicServiceEngineers({ includeInactive: false });
}

/**
 * Helper to read JSON fallback storage safely
 */
function readJsonFallback(filename) {
  try {
    const fullPath = path.resolve(__dirname, `../data/${filename}`);
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    }
  } catch (e) {}
  return null;
}

/**
 * Fetch all commitments for an engineer across:
 * - Assigned / In-Progress / Completed jobs
 * - Approved rest days
 * - Approved leaves
 * - Recorded travel dates
 * - Early completion recalculation
 */
export async function getEngineerCommitments(engineerIdOrName) {
  const resolved = resolveEngineer(engineerIdOrName);
  const engId = resolved ? resolved.id : (typeof engineerIdOrName === 'string' ? engineerIdOrName : null);
  const engName = resolved ? resolved.name : (typeof engineerIdOrName === 'string' ? engineerIdOrName : '');
  const isValidUuid = engId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(engId);

  const commitments = [];
  const seenIds = new Set();

  // 1-5. Concurrently Fetch Bookings, All Checklists, Rest Days, Leaves, and Travel from Supabase
  const [
    dbBookingsRes,
    checklistsRes,
    dbRestRes,
    dbLeavesRes,
    dbCoordRes,
    allChecklistsRes,
  ] = await Promise.all([
    (async () => {
      try {
        let q = supabase.from('engineer_bookings').select('*').in('status', ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']);
        if (isValidUuid && engName) {
          q = q.or(`engineer_id.eq.${engId},engineer_name.ilike.%${engName}%`);
        } else if (isValidUuid) {
          q = q.eq('engineer_id', engId);
        } else if (engName) {
          q = q.ilike('engineer_name', `%${engName}%`);
        }
        return await q;
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        if (!engName) return { data: null };
        return await supabase
          .from('installation_checklists')
          .select('*')
          .ilike('service_engineer', `%${engName}%`);
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        let q = supabase.from('rest_day_requests').select('*').eq('status', 'APPROVED');
        if (isValidUuid && engName) {
          q = q.or(`engineer_id.eq.${engId},engineer_name.ilike.%${engName}%`);
        } else if (isValidUuid) {
          q = q.eq('engineer_id', engId);
        } else if (engName) {
          q = q.ilike('engineer_name', `%${engName}%`);
        }
        return await q;
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        let q = supabase.from('leave_requests').select('*').eq('status', 'APPROVED');
        if (isValidUuid && engName) {
          q = q.or(`engineer_id.eq.${engId},engineer_name.ilike.%${engName}%`);
        } else if (isValidUuid) {
          q = q.eq('engineer_id', engId);
        } else if (engName) {
          q = q.ilike('engineer_name', `%${engName}%`);
        }
        return await q;
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        return await supabase
          .from('coordinator_bookings')
          .select('*')
          .eq('travel_required', true)
          .not('travel_datetime', 'is', null);
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        return await supabase
          .from('installation_checklists')
          .select('id, checklist_number, client_name, installation_status, service_engineer, current_expected_arrival_date, expected_arrival_date, current_booking_end_date, booking_end_date, installation_duration, actual_completion_datetime, actual_start_datetime');
      } catch (e) { return { data: null }; }
    })(),
  ]);

  const allChecklists = allChecklistsRes?.data;
  const checklistMap = new Map();
  if (Array.isArray(allChecklists)) {
    allChecklists.forEach((c) => checklistMap.set(String(c.id).toLowerCase(), c));
  }

  // Process 1: Job Bookings from engineer_bookings
  const dbBookings = dbBookingsRes?.data;
  if (Array.isArray(dbBookings)) {
    dbBookings.forEach((b) => {
      seenIds.add(b.id);
      if (b.checklist_id && allChecklists) {
        const chk = checklistMap.get(String(b.checklist_id).toLowerCase());
        if (!chk) {
          const ageMs = b.created_at ? (Date.now() - new Date(b.created_at).getTime()) : Infinity;
          if (ageMs > 30000) return; // Orphaned assignment of deleted checklist
        } else if (chk.installation_status === 'Cancelled') {
          return; // Cancelled checklist
        }
      }
      commitments.push({
        id: b.id,
        type: 'JOB',
        status: b.status,
        checklist_id: b.checklist_id,
        checklist_number: b.checklist_number,
        client_name: b.client_name,
        start_date: b.booking_start_date,
        end_date: b.booking_end_date,
        actual_completion_datetime: b.actual_completion_datetime || null,
      });
    });
  }

  // In-memory bookings fallback
  inMemoryBookings.forEach((b) => {
    if (seenIds.has(b.id)) return;
    const isMatching = (engId && b.engineer_id === engId) || (b.engineer_name && engName && b.engineer_name.toLowerCase() === engName.toLowerCase());
    const bStatus = String(b.status || '').toUpperCase();
    const isActive = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'SITE WORK COMPLETED'].includes(bStatus);
    if (isMatching && isActive) {
      if (b.checklist_id && allChecklists) {
        const chk = checklistMap.get(String(b.checklist_id).toLowerCase());
        if (!chk) {
          const ageMs = b.created_at ? (Date.now() - new Date(b.created_at).getTime()) : Infinity;
          if (ageMs > 30000) return; // Orphaned assignment of deleted checklist
        } else if (chk.installation_status === 'Cancelled' || chk.installation_status === 'Assign Later' || chk.remarks?.includes('[CANCELLED')) {
          return; // Cancelled or unscheduled checklist
        }
      }
      commitments.push({
        id: b.id,
        type: 'JOB',
        status: bStatus,
        checklist_id: b.checklist_id,
        checklist_number: b.checklist_number,
        client_name: b.client_name,
        start_date: b.booking_start_date,
        end_date: b.booking_end_date,
        actual_completion_datetime: b.actual_completion_datetime || null,
      });
    }
  });

  // Process 2: Active Checklists
  const checklists = Array.isArray(allChecklists)
    ? allChecklists.filter((ch) => (ch.service_engineer || '').toLowerCase().includes(engName.toLowerCase()))
    : (checklistsRes?.data || []);
  if (Array.isArray(checklists)) {
    checklists.forEach((ch) => {
      const instStatus = String(ch.installation_status || '').toUpperCase();
      if (!['ASSIGNED', 'IN PROGRESS', 'COMPLETED', 'SITE WORK COMPLETED'].includes(instStatus) || ch.remarks?.includes('[CANCELLED')) return;
      const sched = inMemoryChecklistSchedules?.get(ch.id);
      const start = sched?.current_expected_arrival_date || ch.current_expected_arrival_date || ch.expected_arrival_date;
      const end = sched?.current_booking_end_date || ch.current_booking_end_date || ch.booking_end_date || calculateBookingEndDate(start, ch.installation_duration || '1 Day');
      if (!start) return;

      const existingJob = commitments.find((c) => c.checklist_id === ch.id);
      if (existingJob) {
        existingJob.start_date = start;
        existingJob.end_date = end;
        existingJob.status = (instStatus === 'COMPLETED' || instStatus === 'SITE WORK COMPLETED') ? 'COMPLETED' : (instStatus === 'IN PROGRESS' ? 'IN_PROGRESS' : 'ASSIGNED');
        existingJob.actual_completion_datetime = sched?.actual_completion_datetime || ch.actual_completion_datetime || existingJob.actual_completion_datetime || null;
        existingJob.actual_start_datetime = sched?.actual_start_datetime || ch.actual_start_datetime || existingJob.actual_start_datetime || null;
      } else {
        commitments.push({
          id: `chk-${ch.id}`,
          type: 'JOB',
          status: (instStatus === 'COMPLETED' || instStatus === 'SITE WORK COMPLETED') ? 'COMPLETED' : (instStatus === 'IN PROGRESS' ? 'IN_PROGRESS' : 'ASSIGNED'),
          checklist_id: ch.id,
          checklist_number: ch.checklist_number,
          client_name: ch.client_name,
          start_date: start,
          end_date: end,
          actual_completion_datetime: sched?.actual_completion_datetime || ch.actual_completion_datetime || null,
          actual_start_datetime: sched?.actual_start_datetime || ch.actual_start_datetime || null,
        });
      }
    });
  }

  // Process 3: Approved Rest Days
  const dbRest = dbRestRes?.data;
  if (Array.isArray(dbRest)) {
    dbRest.forEach((r) => {
      commitments.push({
        id: r.id,
        type: 'REST_DAY',
        status: 'APPROVED',
        checklist_id: r.checklist_id,
        checklist_number: r.checklist_number,
        start_date: r.rest_start_date,
        end_date: r.rest_end_date,
        reason: r.reason,
      });
    });
  }

  const restStorage = readJsonFallback('rest_days_storage.json');
  if (restStorage?.rest_days) {
    const restArray = Array.isArray(restStorage.rest_days)
      ? restStorage.rest_days
      : Object.values(restStorage.rest_days);
    restArray.forEach((r) => {
      if (r.status === 'APPROVED' && (r.engineer_id === engId || r.engineer_name?.toLowerCase() === engName.toLowerCase())) {
        if (!commitments.some((c) => c.id === r.id)) {
          commitments.push({
            id: r.id,
            type: 'REST_DAY',
            status: 'APPROVED',
            checklist_id: r.checklist_id,
            checklist_number: r.checklist_number,
            start_date: r.rest_start_date,
            end_date: r.rest_end_date,
            reason: r.reason,
          });
        }
      }
    });
  }

  // Process 4: Approved Leaves
  const dbLeaves = dbLeavesRes?.data;
  if (Array.isArray(dbLeaves)) {
    dbLeaves.forEach((l) => {
      commitments.push({
        id: l.id,
        type: 'LEAVE',
        status: 'APPROVED',
        leave_type: l.leave_type,
        start_date: l.leave_start_date,
        end_date: l.leave_end_date,
        reason: l.reason,
      });
    });
  }

  const leaveStorage = readJsonFallback('leave_requests_storage.json');
  if (leaveStorage?.leaves) {
    const leaveArray = Array.isArray(leaveStorage.leaves)
      ? leaveStorage.leaves
      : Object.values(leaveStorage.leaves);
    leaveArray.forEach((l) => {
      if (l.status === 'APPROVED' && (l.engineer_id === engId || l.engineer_name?.toLowerCase() === engName.toLowerCase())) {
        if (!commitments.some((c) => c.id === l.id)) {
          commitments.push({
            id: l.id,
            type: 'LEAVE',
            status: 'APPROVED',
            leave_type: l.leave_type,
            start_date: l.leave_start_date,
            end_date: l.leave_end_date,
            reason: l.reason,
          });
        }
      }
    });
  }

  // Process 5: Recorded Travel Commitments (Outbound and Return)
  const isConfirmedTravel = (cb, type) => {
    if (type === 'OUTBOUND') {
      return ['Booked', 'Confirmed'].includes(cb.outbound_status) ||
        Boolean(cb.outbound_ticket_reference || cb.ticket_reference) ||
        (Boolean(cb.outbound_operator) && Number(cb.outbound_fare) > 0);
    } else {
      return ['Booked', 'Confirmed', 'Booking Confirmed'].includes(cb.return_status) ||
        Boolean(cb.return_ticket_reference) ||
        (Boolean(cb.return_operator) && Number(cb.return_fare) > 0);
    }
  };

  const isOrphanedOrCancelledTravel = (cb, type) => {
    if (isConfirmedTravel(cb, type)) return false; // Independent confirmed tickets are always preserved!
    if (!cb.checklist_id || !allChecklists) return false;
    const chk = checklistMap.get(String(cb.checklist_id).toLowerCase());
    if (!chk) {
      const ageMs = cb.created_at ? (Date.now() - new Date(cb.created_at).getTime()) : Infinity;
      return ageMs > 30000; // Orphaned unbooked travel from deleted checklist
    }
    return chk.installation_status === 'Cancelled';
  };

  const dbCoord = dbCoordRes?.data;
  if (Array.isArray(dbCoord)) {
    dbCoord.forEach((cb) => {
      const assigned = (cb.assigned_engineer || '').toLowerCase();
      if (assigned.includes(engName.toLowerCase())) {
        // Outbound Travel
        const outTime = cb.outbound_departure_datetime || cb.travel_datetime;
        if (outTime && cb.outbound_status !== 'Cancelled' && !isOrphanedOrCancelledTravel(cb, 'OUTBOUND')) {
          const travelDate = outTime.split('T')[0];
          commitments.push({
            id: `travel-out-${cb.id}`,
            type: 'TRAVEL',
            travel_type: 'OUTBOUND',
            status: cb.outbound_status || 'RECORDED',
            checklist_id: cb.checklist_id,
            start_date: travelDate,
            end_date: travelDate,
            destination: cb.outbound_destination || cb.destination,
            departure_city: cb.outbound_origin || cb.departure_city,
          });
        }
        // Return Travel
        if (cb.return_departure_datetime && cb.return_status !== 'Cancelled' && !isOrphanedOrCancelledTravel(cb, 'RETURN')) {
          const retDate = cb.return_departure_datetime.split('T')[0];
          commitments.push({
            id: `travel-ret-${cb.id}`,
            type: 'TRAVEL',
            travel_type: 'RETURN',
            status: cb.return_status || 'RECORDED',
            checklist_id: cb.checklist_id,
            start_date: retDate,
            end_date: retDate,
            destination: cb.return_destination || cb.departure_city,
            departure_city: cb.return_origin || cb.destination,
          });
        }
      }
    });
  }

  // Fallback and in-memory coordinator bookings store
  const coordStorage = readJsonFallback('coordinator_bookings_storage.json');
  const fallbackCoordList = [];
  if (coordStorage?.bookings) {
    fallbackCoordList.push(...Object.values(coordStorage.bookings));
  }
  try {
    const { inMemoryBookings: memCoord } = await import('./coordinatorBookingService.js');
    if (memCoord) {
      memCoord.forEach((cb) => fallbackCoordList.push(cb));
    }
  } catch (e) {}

  fallbackCoordList.forEach((cb) => {
    const assigned = (cb.assigned_engineer || '').toLowerCase();
    if (assigned.includes(engName.toLowerCase())) {
      // Outbound Travel
      const outTime = cb.outbound_departure_datetime || cb.travel_datetime;
      if (outTime && cb.outbound_status !== 'Cancelled' && !isOrphanedOrCancelledTravel(cb, 'OUTBOUND')) {
        const travelDate = outTime.split('T')[0];
        const outId = `travel-out-${cb.id || cb.checklist_id}`;
        if (!commitments.some((c) => c.id === outId)) {
          commitments.push({
            id: outId,
            type: 'TRAVEL',
            travel_type: 'OUTBOUND',
            status: cb.outbound_status || 'RECORDED',
            checklist_id: cb.checklist_id,
            start_date: travelDate,
            end_date: travelDate,
            destination: cb.outbound_destination || cb.destination,
            departure_city: cb.outbound_origin || cb.departure_city,
          });
        }
      }
      // Return Travel
      if (cb.return_departure_datetime && cb.return_status !== 'Cancelled' && !isOrphanedOrCancelledTravel(cb, 'RETURN')) {
        const retDate = cb.return_departure_datetime.split('T')[0];
        const retId = `travel-ret-${cb.id || cb.checklist_id}`;
        if (!commitments.some((c) => c.id === retId)) {
          commitments.push({
            id: retId,
            type: 'TRAVEL',
            travel_type: 'RETURN',
            status: cb.return_status || 'RECORDED',
            checklist_id: cb.checklist_id,
            start_date: retDate,
            end_date: retDate,
            destination: cb.return_destination || cb.departure_city,
            departure_city: cb.return_origin || cb.destination,
          });
        }
      }
    }
  });

  // 6. Apply Early Completion and Incomplete Assignment rules:
  // - Scheduled end date is the final working day (inclusive). Earliest availability date is strictly next calendar day.
  // - A completed assignment does not block future dates: its blocking range ends strictly on actual completion date!
  // - If the installation remains incomplete after scheduled end date, do not automatically release the technician.
  //   Mark the job overdue and keep the technician unavailable until completion or an approved schedule update.
  const todayStr = getBusinessToday();
  commitments.forEach((c) => {
    if (c.type === 'JOB' && (c.status === 'COMPLETED' || c.status === 'SITE WORK COMPLETED')) {
      const completionDate = c.actual_completion_datetime ? c.actual_completion_datetime.split('T')[0] : c.start_date;
      c.effective_end_date = completionDate;
      c.original_scheduled_end_date = c.end_date;
    } else if (c.type === 'JOB' && c.status !== 'CANCELLED') {
      const scheduledEnd = c.effective_end_date || c.end_date;
      if (scheduledEnd && scheduledEnd < todayStr) {
        c.effective_end_date = todayStr;
        c.original_scheduled_end_date = scheduledEnd;
        c.is_overdue = true;
      }
    }
  });

  return commitments;
}

/**
 * Fetch all active pending schedule extension requests for an engineer (DB + fallback storage)
 */
export async function getPendingExtensionsForEngineer(engineerIdOrName) {
  const resolved = resolveEngineer(engineerIdOrName);
  const engId = resolved ? resolved.id : engineerIdOrName;
  const engName = resolved ? resolved.name : engineerIdOrName;

  const list = [];
  const seenIds = new Set();

  try {
    const { data } = await supabase
      .from('schedule_extension_requests')
      .select('*')
      .eq('status', 'PENDING');
    if (Array.isArray(data)) {
      data.forEach((e) => {
        const matches =
          e.engineer_id === engId ||
          e.technician_user_id === engId ||
          (e.engineer_name && e.engineer_name.toLowerCase() === engName.toLowerCase()) ||
          (e.technician_name && e.technician_name.toLowerCase() === engName.toLowerCase());
        if (matches) {
          seenIds.add(e.id);
          list.push(e);
        }
      });
    }
  } catch (err) {}

  const extStorage = readJsonFallback('schedule_extensions_storage.json');
  if (extStorage?.extensions) {
    const extArray = Array.isArray(extStorage.extensions)
      ? extStorage.extensions
      : Object.values(extStorage.extensions);
    extArray.forEach((e) => {
      if (seenIds.has(e.id)) return;
      if (e.status === 'PENDING') {
        const matches =
          e.engineer_id === engId ||
          e.technician_user_id === engId ||
          (e.engineer_name && e.engineer_name.toLowerCase() === engName.toLowerCase()) ||
          (e.technician_name && e.technician_name.toLowerCase() === engName.toLowerCase());
        if (matches) {
          seenIds.add(e.id);
          list.push(e);
        }
      }
    });
  }

  return list;
}

/**
 * Fetch pending warnings for an engineer (pending extension, pending leave, pending rest)
 */
export async function getEngineerPendingWarnings(engineerIdOrName) {
  const resolved = resolveEngineer(engineerIdOrName);
  const engId = resolved ? resolved.id : engineerIdOrName;
  const engName = resolved ? resolved.name : engineerIdOrName;

  const warnings = [];

  // 1. Pending Extensions (Protected period: current completion -> requested completion)
  const pendingExts = await getPendingExtensionsForEngineer(engId);
  pendingExts.forEach((e) => {
    const start = e.current_completion_date || e.current_dates?.completion_date || e.original_dates?.arrival_date || e.requested_completion_date;
    const end = e.requested_completion_date;
    warnings.push({
      type: 'PENDING_EXTENSION',
      id: e.id,
      checklist_id: e.checklist_id,
      checklist_number: e.checklist_number,
      start_date: start,
      end_date: end,
      requested_date: e.requested_completion_date,
      message: `Pending availability date request for ${e.checklist_number} to ${e.requested_completion_date}`,
    });
  });

  // 2. Pending Rest Days
  const restStorage = readJsonFallback('rest_days_storage.json');
  if (restStorage?.rest_days) {
    const restArray = Array.isArray(restStorage.rest_days)
      ? restStorage.rest_days
      : Object.values(restStorage.rest_days);
    restArray.forEach((r) => {
      if (r.status === 'PENDING' && (r.engineer_id === engId || r.engineer_name?.toLowerCase() === engName.toLowerCase())) {
        warnings.push({
          type: 'PENDING_REST',
          id: r.id,
          checklist_id: r.checklist_id,
          checklist_number: r.checklist_number,
          start_date: r.rest_start_date,
          end_date: r.rest_end_date,
          message: `Pending rest-day request from ${r.rest_start_date} to ${r.rest_end_date}`,
        });
      }
    });
  }

  // 3. Pending Leave
  const leaveStorage = readJsonFallback('leave_requests_storage.json');
  if (leaveStorage?.leaves) {
    const leaveArray = Array.isArray(leaveStorage.leaves)
      ? leaveStorage.leaves
      : Object.values(leaveStorage.leaves);
    leaveArray.forEach((l) => {
      if (l.status === 'PENDING' && (l.engineer_id === engId || l.engineer_name?.toLowerCase() === engName.toLowerCase())) {
        warnings.push({
          type: 'PENDING_LEAVE',
          id: l.id,
          start_date: l.leave_start_date,
          end_date: l.leave_end_date,
          message: `Pending leave request from ${l.leave_start_date} to ${l.leave_end_date}`,
        });
      }
    });
  }

  return warnings;
}

/**
 * Check if an engineer is available for a requested date range [startDate, endDate]
 * Performs comprehensive blocking check against Jobs, Rest Days, Leave, and Travel
 * If unavailable, suggests alternative available engineers from the authorized 4!
 */
export async function checkEngineerAvailability({
  engineerIdOrName,
  engineerName,
  startDate,
  endDate,
  duration = '1 Day',
  excludeChecklistId = null,
}) {
  const targetEng = engineerIdOrName || engineerName;
  if (!startDate) {
    throw new Error('Start date is required to check availability.');
  }

  const finalEndDate = endDate || calculateBookingEndDate(startDate, duration);
  if (finalEndDate < startDate) {
    throw new Error(`End date (${finalEndDate}) cannot be before start date (${startDate}).`);
  }

  const resolved = resolveEngineer(targetEng);
  const engId = resolved ? resolved.id : targetEng;
  const engName = resolved ? resolved.name : targetEng;

  const commitments = await getEngineerCommitments(targetEng);
  const warnings = await getEngineerPendingWarnings(targetEng);

  // Find blocking commitment
  const conflicting = commitments.find((c) => {
    if (excludeChecklistId && (c.checklist_id === excludeChecklistId || c.id === excludeChecklistId)) {
      return false;
    }

    if (c.type === 'JOB' && (c.status === 'COMPLETED' || c.status === 'SITE WORK COMPLETED')) {
      const completionDate = (c.actual_completion_datetime || '').split('T')[0];
      if (completionDate) {
        // Scheduled end date is the final working day (inclusive). Earliest availability is strictly the next calendar day.
        if (startDate > completionDate) return false;
      } else {
        if (startDate > c.start_date) return false;
      }
    }

    // Incomplete & Overdue Rule: If installation remains incomplete after scheduled end date,
    // do not automatically release the technician. Keep technician unavailable until completion or an approved schedule update.
    if (c.type === 'JOB' && c.is_overdue) {
      return true;
    }

    const effectiveEnd = c.effective_end_date || c.end_date;
    const effectiveStart = c.effective_start_date || c.start_date;
    if (effectiveEnd < effectiveStart) return false;
    return isDateRangeOverlapping(startDate, finalEndDate, effectiveStart, effectiveEnd);
  });

  // 2. Check pending extension requests (Protected Period Rule):
  // While an availability-date extension is pending Coordinator approval,
  // new assignments during the period affected by the proposed extension MUST be prevented!
  let conflictingPending = null;
  const pendingExtensions = await getPendingExtensionsForEngineer(engId);
  conflictingPending = pendingExtensions.find((ext) => {
    if (excludeChecklistId && ext.checklist_id === excludeChecklistId) {
      return false;
    }
    const propStart = ext.current_dates?.arrival_date || ext.original_dates?.arrival_date || ext.current_completion_date;
    const propEnd = ext.requested_completion_date;
    if (!propStart || !propEnd) return false;
    return isDateRangeOverlapping(startDate, finalEndDate, propStart, propEnd);
  });

  // 3. Check HR Manual Availability Overrides (Strictly blocks new conflicting assignments during override period)
  let hrManualConflict = null;
  try {
    const { getManualOverridesForEngineerRange } = await import('./hrAvailabilityService.js');
    const overrides = await getManualOverridesForEngineerRange(engId, startDate, finalEndDate);
    const blockingOverride = overrides.find((o) =>
      ['Not Available', 'Unavailable', 'Rest Day', 'On Leave'].includes(o.manual_status)
    );

    if (blockingOverride) {
      const oStart = blockingOverride.effective_start_datetime.split('T')[0];
      const oEnd = blockingOverride.effective_end_datetime ? blockingOverride.effective_end_datetime.split('T')[0] : oStart;

      let statusKey = 'UNAVAILABLE';
      let statusLabel = 'Not Available';
      if (blockingOverride.manual_status === 'Rest Day') {
        statusKey = 'REST';
        statusLabel = 'Rest Day';
      } else if (blockingOverride.manual_status === 'On Leave') {
        statusKey = 'LEAVE';
        statusLabel = 'On Leave';
      }

      hrManualConflict = {
        type: 'HR_MANUAL_OVERRIDE',
        status: statusKey,
        manual_status: blockingOverride.manual_status,
        reason: `Cannot Assign: Engineer ${engName} has been manually set to ${statusLabel} by HR ("${blockingOverride.reason}").`,
        booking_start_date: oStart,
        booking_end_date: oEnd,
      };
    }
  } catch (hrErr) {
    console.warn('Error checking HR manual overrides in checkEngineerAvailability:', hrErr.message);
  }

  if (conflicting || conflictingPending || hrManualConflict) {
    let reasonText = '';
    let conflictObj = null;

    if (conflicting) {
      if (conflicting.is_overdue) {
        reasonText = `Cannot Assign: Engineer ${engName} has an overdue incomplete installation (${conflicting.checklist_number || 'assignment'}) scheduled to finish on ${conflicting.original_scheduled_end_date || conflicting.end_date}. Technician remains unavailable until completion or an approved schedule update.`;
        conflictObj = {
          type: 'OVERDUE_INCOMPLETE',
          checklist_id: conflicting.checklist_id || null,
          checklist_number: conflicting.checklist_number || null,
          client_name: conflicting.client_name || null,
          booking_start_date: conflicting.start_date,
          booking_end_date: conflicting.original_scheduled_end_date || conflicting.end_date,
          status: 'OVERDUE',
          reason: reasonText,
        };
      } else if (conflicting.type === 'REST_DAY') {
        reasonText = `Engineer ${engName} has an approved Rest Day from ${conflicting.start_date} to ${conflicting.end_date}.`;
      } else if (conflicting.type === 'LEAVE') {
        reasonText = `Engineer ${engName} is on approved Leave (${conflicting.leave_type || 'Casual'}) from ${conflicting.start_date} to ${conflicting.end_date}.`;
      } else if (conflicting.type === 'TRAVEL') {
        const isRet = conflicting.travel_type === 'RETURN';
        reasonText = `Engineer ${engName} has a scheduled ${isRet ? 'return ' : ''}travel commitment on ${conflicting.start_date} (${isRet ? 'Return travel from site' : 'Destination: ' + (conflicting.destination || 'Site')}).`;
      } else {
        reasonText = `Engineer ${engName} is booked for ${conflicting.checklist_number || 'an assigned job'} from ${conflicting.start_date} to ${conflicting.end_date}.`;
      }

      if (!conflictObj) {
        conflictObj = {
          type: conflicting.type,
          checklist_id: conflicting.checklist_id || null,
          checklist_number: conflicting.checklist_number || null,
          client_name: conflicting.client_name || null,
          booking_start_date: conflicting.start_date,
          booking_end_date: conflicting.effective_end_date || conflicting.end_date,
          status: conflicting.status,
          reason: reasonText,
        };
      }
    } else if (conflictingPending) {
      reasonText = `Cannot Assign: Engineer ${engName} has a pending availability date request for ${conflictingPending.checklist_number} through ${conflictingPending.requested_completion_date} awaiting Coordinator approval. New assignments cannot be booked during this protected period.`;
      conflictObj = {
        type: 'PENDING_EXTENSION_PROTECTED',
        checklist_id: conflictingPending.checklist_id || null,
        checklist_number: conflictingPending.checklist_number || null,
        client_name: conflictingPending.client_name || null,
        booking_start_date: conflictingPending.current_dates?.arrival_date || conflictingPending.original_dates?.arrival_date || conflictingPending.current_completion_date,
        booking_end_date: conflictingPending.requested_completion_date,
        status: 'PENDING_APPROVAL',
        reason: reasonText,
      };
    } else if (hrManualConflict) {
      reasonText = hrManualConflict.reason;
      conflictObj = hrManualConflict;
    }

    // Find suggested available alternatives among the other authorized engineers
    const allEngineers = await getAllServiceEngineers();
    const otherEngineers = allEngineers.filter((e) => e.id !== engId);
    const suggestedEngineers = [];

    for (const other of otherEngineers) {
      const otherCommitments = await getEngineerCommitments(other.id);
      const hasConflict = otherCommitments.some((oc) => {
        if (oc.type === 'JOB' && (oc.status === 'COMPLETED' || oc.status === 'SITE WORK COMPLETED')) {
          const compDate = (oc.actual_completion_datetime || '').split('T')[0];
          if (compDate && startDate > compDate) return false;
          if (!compDate && startDate > oc.start_date) return false;
        }
        if (oc.type === 'JOB' && oc.is_overdue) {
          return true;
        }
        const ocEnd = oc.effective_end_date || oc.end_date;
        const ocStart = oc.effective_start_date || oc.start_date;
        if (ocEnd < ocStart) return false;
        return isDateRangeOverlapping(startDate, finalEndDate, ocStart, ocEnd);
      });

      if (!hasConflict) {
        // Also ensure suggested engineer does not have a conflicting pending extension
        const otherPendingExts = await getPendingExtensionsForEngineer(other.id);
        const otherHasPending = otherPendingExts.some((ext) => {
          const pStart = ext.current_dates?.arrival_date || ext.original_dates?.arrival_date || ext.current_completion_date;
          const pEnd = ext.requested_completion_date;
          return pStart && pEnd && isDateRangeOverlapping(startDate, finalEndDate, pStart, pEnd);
        });

        if (!otherHasPending) {
          // Also ensure suggested engineer does not have a conflicting HR manual override
          let otherBlockedByHr = false;
          try {
            const { getManualOverridesForEngineerRange } = await import('./hrAvailabilityService.js');
            const otherOverrides = await getManualOverridesForEngineerRange(other.id, startDate, finalEndDate);
            otherBlockedByHr = otherOverrides.some((o) =>
              ['Not Available', 'Unavailable', 'Rest Day', 'On Leave'].includes(o.manual_status)
            );
          } catch (e) {}

          if (!otherBlockedByHr) {
            suggestedEngineers.push({
              id: other.id,
              name: other.name,
              phone: other.phone,
            });
          }
        }
      }
    }

    return {
      available: false,
      engineer_id: engId,
      engineer_name: engName,
      requested_start_date: startDate,
      requested_end_date: finalEndDate,
      conflict: conflictObj,
      warnings,
      suggested_engineers: suggestedEngineers,
      message: reasonText,
      reasons: [reasonText],
    };
  }

  return {
    available: true,
    engineer_id: engId,
    engineer_name: engName,
    requested_start_date: startDate,
    requested_end_date: finalEndDate,
    earliest_availability_date: calculateEarliestAvailabilityDate(finalEndDate),
    conflict: null,
    warnings,
    suggested_engineers: [],
  };
}

/**
 * Get availability status for ALL main service engineers for a given date range
 */
export async function getEngineersAvailabilityForRange({
  startDate,
  endDate,
  duration = '1 Day',
  excludeChecklistId = null,
}) {
  const engineers = await getAllServiceEngineers();
  if (!startDate) {
    return engineers.map((eng) => ({
      id: eng.id,
      name: eng.name,
      role: eng.role,
      available: true,
      conflict: null,
      warnings: [],
      suggested_engineers: [],
    }));
  }

  const finalEndDate = endDate || calculateBookingEndDate(startDate, duration);

  const results = await Promise.all(
    engineers.map(async (eng) => {
      const check = await checkEngineerAvailability({
        engineerIdOrName: eng.id,
        startDate,
        endDate: finalEndDate,
        excludeChecklistId,
      });

      return {
        id: eng.id,
        name: eng.name,
        role: eng.role,
        available: check.available,
        conflict: check.conflict,
        earliest_availability_date: check.earliest_availability_date || calculateEarliestAvailabilityDate(finalEndDate),
        warnings: check.warnings || [],
        suggested_engineers: check.suggested_engineers || [],
        message: check.message || null,
      };
    })
  );

  return results;
}

/**
 * Atomic Reservation: Concurrency-Safe booking with Mutex Locking & Conflict Exclusion
 */
export async function reserveEngineerAtomic({
  engineerIdOrName,
  checklistId,
  checklistNumber,
  startDate,
  endDate,
  duration = '1 Day',
  user,
  status = 'ASSIGNED',
}) {
  if (!startDate) {
    throw new Error('Installation start date is required.');
  }

  const finalEndDate = endDate || calculateBookingEndDate(startDate, duration);
  if (finalEndDate < startDate) {
    throw new Error(`Booking end date (${finalEndDate}) cannot be before start date (${startDate}).`);
  }

  const resolved = resolveEngineer(engineerIdOrName);
  if (!resolved) {
    throw new Error(`Service Engineer "${engineerIdOrName}" is not recognized.`);
  }

  const engId = resolved.id;
  const engName = resolved.name;

  // SERIALIZE: Run inside per-engineer concurrency mutex
  return await acquireEngineerLock(engId, async () => {
    // 1. Re-check availability atomically
    const availCheck = await checkEngineerAvailability({
      engineerIdOrName: engId,
      startDate,
      endDate: finalEndDate,
      excludeChecklistId: checklistId,
    });

    if (!availCheck.available) {
      const c = availCheck.conflict;
      const errorMsg = `Booking Conflict: ${c.reason || `Engineer ${engName} is already committed from ${c.booking_start_date} to ${c.booking_end_date}.`}`;
      const err = new Error(errorMsg);
      err.statusCode = 409;
      err.conflict = c;
      err.suggestedEngineers = availCheck.suggested_engineers;
      throw err;
    }

    // 2. Release any prior booking for this checklist
    if (checklistId) {
      await releaseEngineerBooking({ checklistId });
    }

    const bookingId = `booking-${engId}-${checklistId || Date.now()}`;
    const normalizedBookingStatus = (() => {
      const s = String(status || '').toUpperCase().trim().replace(/\s+/g, '_');
      if (['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RELEASED'].includes(s)) return s;
      if (s === 'SITE_WORK_COMPLETED' || s === 'CLOSED' || s === 'DONE') return 'COMPLETED';
      return 'ASSIGNED';
    })();

    const bookingRecord = {
      id: bookingId,
      engineer_id: engId,
      engineer_name: engName,
      checklist_id: checklistId || null,
      checklist_number: checklistNumber || 'TBD',
      booking_start_date: startDate,
      booking_end_date: finalEndDate,
      status: normalizedBookingStatus,
      created_by: user ? user.id : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 3. Attempt DB insert
    try {
      const { data: dbCreated, error: dbErr } = await supabase
        .from('engineer_bookings')
        .insert([
          {
            engineer_id: engId,
            engineer_name: engName,
            checklist_id: checklistId,
            checklist_number: checklistNumber,
            booking_start_date: startDate,
            booking_end_date: finalEndDate,
            status: normalizedBookingStatus,
            created_by: user ? user.id : null,
          },
        ])
        .select()
        .single();

      if (!dbErr && dbCreated) {
        bookingRecord.id = dbCreated.id;
      }
    } catch (err) {}

    // 4. Update in-memory fallback store
    inMemoryBookings.set(bookingRecord.id, bookingRecord);
    if (checklistId) {
      inMemoryBookings.set(checklistId, bookingRecord);
    }
    saveStorage();

    // 5. Update installation_checklists booking_end_date & service_engineer_id if checklist exists
    if (checklistId) {
      try {
        await supabase
          .from('installation_checklists')
          .update({
            service_engineer_id: engId,
            service_engineer: engName,
            current_booking_end_date: finalEndDate,
            booking_end_date: finalEndDate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', checklistId);
      } catch (updErr) {}
    }

    if (user) {
      await logAudit({
        actor_id: user.id,
        actor_email: user.email,
        actor_role: user.role,
        action: 'BOOK_SERVICE_ENGINEER',
        target_table: 'engineer_bookings',
        target_id: bookingRecord.id,
        details: {
          engineer_id: engId,
          engineer_name: engName,
          checklist_number: checklistNumber,
          startDate,
          endDate: finalEndDate,
        },
      });
    }

    return bookingRecord;
  });
}

/**
 * Release / Cancel an engineer booking
 */
export async function releaseEngineerBooking(checklistIdOrObj) {
  const checklistId = typeof checklistIdOrObj === 'object' && checklistIdOrObj !== null
    ? (checklistIdOrObj.checklistId || checklistIdOrObj.checklist_id || checklistIdOrObj.id)
    : checklistIdOrObj;
  if (!checklistId) return;

  const idStr = String(checklistId).trim().toLowerCase();
  const nowIso = new Date().toISOString();

  try {
    await supabase
      .from('engineer_bookings')
      .update({ status: 'RELEASED', updated_at: nowIso })
      .eq('checklist_id', checklistId);
  } catch (err) {}

  let found = false;
  for (const [k, b] of inMemoryBookings.entries()) {
    if (
      String(k).toLowerCase() === idStr ||
      (b?.checklist_id && String(b.checklist_id).toLowerCase() === idStr) ||
      (b?.id && String(b.id).toLowerCase() === idStr)
    ) {
      b.status = 'RELEASED';
      b.updated_at = nowIso;
      found = true;
    }
  }

  if (found) {
    saveStorage();
  }
}

/**
 * Permanently delete engineer booking for a deleted checklist
 */
export async function deleteEngineerBookingForChecklist(checklistId) {
  if (!checklistId) return;
  const idStr = String(checklistId).trim().toLowerCase();

  try {
    await supabase.from('engineer_bookings').delete().eq('checklist_id', checklistId);
  } catch (err) {}

  let found = false;
  for (const [k, b] of inMemoryBookings.entries()) {
    if (
      String(k).toLowerCase() === idStr ||
      (b?.checklist_id && String(b.checklist_id).toLowerCase() === idStr) ||
      (b?.id && String(b.id).toLowerCase() === idStr)
    ) {
      inMemoryBookings.delete(k);
      found = true;
    }
  }

  if (found) {
    saveStorage();
  }
}

/**
 * Reconcile engineer bookings against database checklists
 * Prunes orphaned bookings for deleted checklists and releases cancelled assignments.
 */
export async function reconcileEngineerBookings() {
  let changed = false;
  try {
    const { data: dbChecklists, error } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, installation_status');

    if (error || !Array.isArray(dbChecklists)) return false;

    const checklistMap = new Map();
    dbChecklists.forEach((c) => checklistMap.set(String(c.id).toLowerCase(), c));

    const now = Date.now();
    for (const [k, b] of inMemoryBookings.entries()) {
      if (!b || !b.checklist_id) continue;
      const chkId = String(b.checklist_id).toLowerCase();
      const existingChecklist = checklistMap.get(chkId);

      const ageMs = b.created_at ? (now - new Date(b.created_at).getTime()) : Infinity;
      if (ageMs < 30000) continue;

      if (!existingChecklist) {
        inMemoryBookings.delete(k);
        changed = true;
      } else if (existingChecklist.installation_status === 'Cancelled' && b.status !== 'RELEASED' && b.status !== 'CANCELLED') {
        b.status = 'RELEASED';
        changed = true;
      }
    }

    if (changed) {
      saveStorage();
    }
  } catch (err) {
    console.warn('Engineer bookings reconciliation error:', err.message);
  }
  return changed;
}

// Trigger initial async reconciliation
setTimeout(() => {
  reconcileEngineerBookings().catch(() => {});
}, 600);

/**
 * Update active date range for an engineer booking upon approved schedule extension
 */
export async function updateEngineerBookingEndDate({ checklistId, newEndDate }) {
  if (!checklistId || !newEndDate) return;
  const nowIso = new Date().toISOString();

  try {
    await supabase
      .from('engineer_bookings')
      .update({ booking_end_date: newEndDate, updated_at: nowIso })
      .eq('checklist_id', checklistId);
  } catch (err) {}

  let found = false;
  inMemoryBookings.forEach((b, k) => {
    if (b.checklist_id === checklistId || k === checklistId) {
      b.booking_end_date = newEndDate;
      b.updated_at = nowIso;
      found = true;
    }
  });

  if (found) {
    saveStorage();
  }
}

/**
 * Helper to calculate the earliest available date for an engineer starting from reference date
 */
function getEngineerEarliestAvailableDate(commitments, fromDateStr, overrides = []) {
  if (!fromDateStr) return null;
  const [y, m, d] = fromDateStr.split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 90; i++) {
    const dStr = cur.toISOString().split('T')[0];
    const stat = determineEngineerDateStatus(commitments, dStr, overrides);
    if (stat.status === 'AVAILABLE') {
      return dStr;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return null;
}

/**
 * Calculate meaningful status for an engineer on a single specific date
 * Respects active HR manual availability overrides (Available / Unavailable)
 */
function determineEngineerDateStatus(commitments, dateStr, overrides = []) {
  // Check active HR manual override covering this date (pick most recent if multiple)
  const activeOverrides = overrides.filter((o) => {
    if (!o.is_active) return false;
    const oStart = (o.effective_start_datetime || '').split('T')[0];
    const oEnd = o.effective_end_datetime ? o.effective_end_datetime.split('T')[0] : (oStart || '2099-12-31');
    return dateStr >= oStart && dateStr <= oEnd;
  });
  const activeOverride = activeOverrides.length > 0
    ? activeOverrides.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]
    : null;

  const activeOnDate = commitments.filter((c) => {
    if (c.type === 'JOB' && (c.status === 'COMPLETED' || c.status === 'SITE WORK COMPLETED')) {
      const compDate = (c.actual_completion_datetime || '').split('T')[0];
      // Scheduled end date is final working day (inclusive).
      // A completed assignment must NEVER block strictly AFTER its actual completion date!
      if (compDate && dateStr > compDate) return false;
      if (!compDate && dateStr > c.start_date) return false;
    }

    // Overdue Incomplete Rule: If installation remains incomplete after scheduled end date,
    // do not automatically release the technician. Keep technician unavailable.
    if (c.type === 'JOB' && c.is_overdue) {
      if (dateStr < c.start_date) return false;
      return true;
    }

    const end = c.effective_end_date || c.end_date;
    const start = c.effective_start_date || c.start_date;
    if (end < start) return false;
    return start <= dateStr && end >= dateStr;
  });

  // Handle HR manual overrides: 'Not Available', 'Unavailable', 'Rest Day', 'On Leave'
  if (activeOverride) {
    const mStat = activeOverride.manual_status;
    if (mStat === 'Not Available' || mStat === 'Unavailable') {
      return {
        status: 'UNAVAILABLE',
        label: 'Not Available (HR)',
        commitment: activeOnDate[0] || null,
        manual_override: activeOverride,
      };
    }
    if (mStat === 'Rest Day') {
      return {
        status: 'REST',
        label: 'Rest Day (HR)',
        commitment: activeOnDate[0] || null,
        manual_override: activeOverride,
      };
    }
    if (mStat === 'On Leave') {
      return {
        status: 'LEAVE',
        label: 'On Leave (HR)',
        commitment: activeOnDate[0] || null,
        manual_override: activeOverride,
      };
    }
  }

  if (activeOnDate.length === 0) {
    if (activeOverride && activeOverride.manual_status === 'Available') {
      return {
        status: 'AVAILABLE',
        label: 'Available (HR Override)',
        commitment: null,
        manual_override: activeOverride,
      };
    }
    return { status: 'AVAILABLE', label: 'Available', commitment: null, manual_override: activeOverride || null };
  }

  // Conflict if multiple active overlapping commitments
  if (activeOnDate.length > 1) {
    return {
      status: 'CONFLICT',
      label: 'Schedule Conflict',
      commitments: activeOnDate,
      manual_override: activeOverride || null,
      discrepancy: Boolean(activeOverride && activeOverride.manual_status === 'Available'),
    };
  }

  const primary = activeOnDate[0];
  const overrideInfo = {
    manual_override: activeOverride || null,
    discrepancy: Boolean(activeOverride && activeOverride.manual_status === 'Available'),
    discrepancy_warning: activeOverride && activeOverride.manual_status === 'Available'
      ? `Manual override is set to Available, but active commitment (${primary.checklist_number ? `Job #${primary.checklist_number}` : primary.type}) exists. Active assignments prevail.`
      : null,
  };

  if (primary.type === 'LEAVE') {
    return { ...overrideInfo, status: 'LEAVE', label: 'On Leave', commitment: primary };
  }
  if (primary.type === 'REST_DAY') {
    return { ...overrideInfo, status: 'REST', label: 'Rest Day', commitment: primary };
  }
  if (primary.type === 'TRAVEL') {
    return { ...overrideInfo, status: 'TRAVEL', label: 'Traveling', commitment: primary };
  }
  if (primary.type === 'JOB') {
    if (primary.status === 'COMPLETED' || primary.status === 'SITE WORK COMPLETED') {
      return { ...overrideInfo, status: 'COMPLETED', label: 'Completed', commitment: primary };
    }
    const schedEnd = primary.original_scheduled_end_date || primary.end_date;
    if (primary.is_overdue && schedEnd && dateStr > schedEnd) {
      return { ...overrideInfo, status: 'OVERDUE', label: 'Overdue (Incomplete)', commitment: primary };
    }
    if (primary.status === 'IN_PROGRESS') {
      return { ...overrideInfo, status: 'IN_PROGRESS', label: 'On Installation/Service', commitment: primary };
    }
    return { ...overrideInfo, status: 'ASSIGNED', label: 'Assigned', commitment: primary };
  }

  return { ...overrideInfo, status: 'UNAVAILABLE', label: 'Unavailable', commitment: primary };
}

/**
 * Availability Calendar: Fetch date-based schedule across all 4 main engineers
 * Supports view modes: 'day', 'week', 'month'
 * Supports filters: engineerId, jobType, status
 * Calculates real live summary metrics for the selected reference date
 */
export async function getAvailabilityCalendar({
  startDate,
  endDate,
  view = 'week',
  engineerId = null,
  jobType = null,
  statusFilter = null,
} = {}) {
  const todayStr = new Date().toISOString().split('T')[0];
  let start = startDate || todayStr;
  let end = endDate;

  // View mode day / week / month range calculation
  if (!end) {
    const [y, m, d] = start.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));

    if (view === 'day') {
      end = start;
    } else if (view === 'month') {
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const monthEnd = new Date(Date.UTC(y, m, 0));
      start = monthStart.toISOString().split('T')[0];
      end = monthEnd.toISOString().split('T')[0];
    } else {
      // Default: week (7 dates, Monday through Sunday)
      const dayOfWeek = dObj.getUTCDay(); // 0 is Sunday, 1 is Monday...
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      dObj.setUTCDate(dObj.getUTCDate() + diffToMonday);
      start = dObj.toISOString().split('T')[0];
      const endObj = new Date(dObj.getTime());
      endObj.setUTCDate(endObj.getUTCDate() + 6);
      end = endObj.toISOString().split('T')[0];
    }
  }

  const allMainEngineers = await getAllServiceEngineers();
  const engineers = (engineerId && engineerId !== 'ALL')
    ? allMainEngineers.filter((e) => e.id === engineerId || e.name.toLowerCase() === engineerId.toLowerCase())
    : allMainEngineers;

  const dateList = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const current = new Date(Date.UTC(sy, sm - 1, sd));
  const finish = new Date(Date.UTC(ey, em - 1, ed));

  while (current <= finish) {
    dateList.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  // Summary Metrics calculated at the reference start date
  const summary = {
    reference_date: start,
    total_engineers: allMainEngineers.length, // exactly 4
    available: 0,
    assigned: 0,
    in_progress: 0,
    overdue: 0,
    traveling: 0,
    resting: 0,
    on_leave: 0,
    conflicts: 0,
  };

  // Prefetch active HR manual overrides
  let allOverrides = [];
  try {
    const { getAllOverrides } = await import('./hrAvailabilityService.js');
    allOverrides = await getAllOverrides();
  } catch (e) {}

  const engineerOverrideMap = new Map();
  allMainEngineers.forEach((eng) => {
    const engOverrides = allOverrides.filter(
      (o) => o.is_active && (o.engineer_id === eng.id || o.engineer_name.toLowerCase() === eng.name.toLowerCase())
    );
    engineerOverrideMap.set(eng.id, engOverrides);
  });

  // Batch prefetch commitments and warnings once in parallel for all engineers
  const engineerCommitmentMap = new Map();
  const engineerWarningMap = new Map();

  await Promise.all(
    allMainEngineers.map(async (eng) => {
      const [comms, warns] = await Promise.all([
        getEngineerCommitments(eng.id),
        getEngineerPendingWarnings(eng.id),
      ]);
      engineerCommitmentMap.set(eng.id, comms);
      engineerWarningMap.set(eng.id, warns);
    })
  );

  for (const eng of allMainEngineers) {
    const comms = engineerCommitmentMap.get(eng.id) || [];
    const engOverrides = engineerOverrideMap.get(eng.id) || [];
    const dayStat = determineEngineerDateStatus(comms, start, engOverrides);
    if (dayStat.status === 'AVAILABLE') summary.available++;
    else if (dayStat.status === 'ASSIGNED') summary.assigned++;
    else if (dayStat.status === 'IN_PROGRESS') summary.in_progress++;
    else if (dayStat.status === 'OVERDUE') summary.overdue++;
    else if (dayStat.status === 'TRAVEL') summary.traveling++;
    else if (dayStat.status === 'REST') summary.resting++;
    else if (dayStat.status === 'LEAVE') summary.on_leave++;
    else if (dayStat.status === 'CONFLICT') summary.conflicts++;
  }

  const schedule = engineers.map((eng) => {
    const commitments = engineerCommitmentMap.get(eng.id) || [];
    const warnings = engineerWarningMap.get(eng.id) || [];
    const engOverrides = engineerOverrideMap.get(eng.id) || [];

    const days = dateList.map((dateStr) => {
      const dateStatus = determineEngineerDateStatus(commitments, dateStr, engOverrides);
      const dayWarning = warnings.find((w) => {
        const wStart = w.start_date || w.requested_date;
        const wEnd = w.end_date || w.requested_date;
        return wStart && wEnd && wStart <= dateStr && wEnd >= dateStr;
      });

      return {
        date: dateStr,
        status: dateStatus.status,
        status_label: dateStatus.label,
        is_available: dateStatus.status === 'AVAILABLE',
        commitment: dateStatus.commitment,
        commitments: dateStatus.commitments,
        has_pending_warning: Boolean(dayWarning),
        warning: dayWarning || null,
        manual_override: dateStatus.manual_override || null,
      };
    });

    return {
      engineer: eng,
      days,
      warnings,
      total_booked_days: days.filter((d) => !d.is_available).length,
      earliest_availability_date: getEngineerEarliestAvailableDate(commitments, start, engOverrides),
    };
  });

  return {
    start_date: start,
    end_date: end,
    view,
    dates: dateList,
    summary,
    schedule,
  };
}

/**
 * Mark an engineer booking as completed by checklist ID (updates in-memory & file storage)
 */
export function completeEngineerBookingByChecklistId(checklistId, completionIso = new Date().toISOString()) {
  if (!checklistId) return;
  inMemoryBookings.forEach((b) => {
    if (b.checklist_id === checklistId) {
      b.status = 'COMPLETED';
      b.actual_completion_datetime = completionIso;
      b.updated_at = completionIso;
    }
  });
  saveStorage();
}

