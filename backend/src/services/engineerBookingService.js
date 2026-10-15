import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { inMemoryChecklistSchedules } from './installationService.js';

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
const inMemoryBookings = new Map(); // key: booking id or checklist_id -> booking object
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
 * Overlap check for two inclusive date ranges [startA, endA] and [startB, endB]
 */
export function isDateRangeOverlapping(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

/**
 * Resolve engineer from ID or Name against MAIN_SERVICE_ENGINEERS
 */
export function resolveEngineer(idOrName) {
  if (!idOrName) return null;
  const query = String(idOrName).trim().toLowerCase();

  const byId = MAIN_SERVICE_ENGINEERS.find((e) => e.id.toLowerCase() === query);
  if (byId) return byId;

  const byName = MAIN_SERVICE_ENGINEERS.find((e) => e.name.toLowerCase() === query);
  if (byName) return byName;

  const byPartial = MAIN_SERVICE_ENGINEERS.find(
    (e) => e.name.toLowerCase().includes(query) || query.includes(e.name.toLowerCase())
  );
  if (byPartial) return byPartial;

  return {
    id: `eng-${query.replace(/\s+/g, '-').toLowerCase()}`,
    name: idOrName.trim(),
    role: 'Service Engineer',
    email: '',
  };
}

/**
 * Fetch all configured service engineers (strictly restricted to the four authorized engineers)
 */
export async function getAllServiceEngineers() {
  const map = new Map();
  MAIN_SERVICE_ENGINEERS.forEach((eng) => {
    map.set(eng.name.toLowerCase(), { ...eng });
  });

  try {
    const { data: dbEngineers, error } = await supabase
      .from('service_engineers')
      .select('*')
      .in('name', SERVICE_ENGINEER_OPTIONS)
      .eq('is_active', true);

    if (!error && Array.isArray(dbEngineers)) {
      dbEngineers.forEach((dbE) => {
        const key = dbE.name.toLowerCase();
        if (map.has(key)) {
          map.set(key, { ...map.get(key), ...dbE });
        }
      });
    }
  } catch (err) {}

  return SERVICE_ENGINEER_OPTIONS.map((name) => map.get(name.toLowerCase())).filter(Boolean);
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
  const engId = resolved ? resolved.id : engineerIdOrName;
  const engName = resolved ? resolved.name : engineerIdOrName;

  const commitments = [];
  const seenIds = new Set();

  // 1-5. Concurrently Fetch Bookings, Active Checklists, Rest Days, Leaves, and Travel from Supabase
  const [
    dbBookingsRes,
    checklistsRes,
    dbRestRes,
    dbLeavesRes,
    dbCoordRes,
  ] = await Promise.all([
    (async () => {
      try {
        return await supabase
          .from('engineer_bookings')
          .select('*')
          .or(`engineer_id.eq.${engId},engineer_name.ilike.%${engName}%`)
          .in('status', ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']);
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        return await supabase
          .from('installation_checklists')
          .select('*')
          .ilike('service_engineer', `%${engName}%`);
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        return await supabase
          .from('rest_day_requests')
          .select('*')
          .or(`engineer_id.eq.${engId},engineer_name.ilike.%${engName}%`)
          .eq('status', 'APPROVED');
      } catch (e) { return { data: null }; }
    })(),
    (async () => {
      try {
        return await supabase
          .from('leave_requests')
          .select('*')
          .or(`engineer_id.eq.${engId},engineer_name.ilike.%${engName}%`)
          .eq('status', 'APPROVED');
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
  ]);

  // Process 1: Job Bookings from engineer_bookings
  const dbBookings = dbBookingsRes?.data;
  if (Array.isArray(dbBookings)) {
    dbBookings.forEach((b) => {
      seenIds.add(b.id);
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
    const isMatching = (b.engineer_id === engId) || (b.engineer_name && b.engineer_name.toLowerCase() === engName.toLowerCase());
    const bStatus = String(b.status || '').toUpperCase();
    const isActive = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'SITE WORK COMPLETED'].includes(bStatus);
    if (isMatching && isActive) {
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
  const checklists = checklistsRes?.data;
  if (Array.isArray(checklists)) {
    checklists.forEach((ch) => {
      const instStatus = String(ch.installation_status || '').toUpperCase();
      if (!['ASSIGNED', 'IN PROGRESS', 'COMPLETED', 'SITE WORK COMPLETED'].includes(instStatus)) return;
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

  // Process 5: Recorded Travel Commitments
  const dbCoord = dbCoordRes?.data;
  if (Array.isArray(dbCoord)) {
    dbCoord.forEach((cb) => {
      const assigned = (cb.assigned_engineer || '').toLowerCase();
      if (assigned.includes(engName.toLowerCase()) && cb.travel_datetime) {
        const travelDate = cb.travel_datetime.split('T')[0];
        commitments.push({
          id: `travel-${cb.id}`,
          type: 'TRAVEL',
          status: 'RECORDED',
          checklist_id: cb.checklist_id,
          start_date: travelDate,
          end_date: travelDate,
          destination: cb.destination,
          departure_city: cb.departure_city,
        });
      }
    });
  }

  const coordStorage = readJsonFallback('coordinator_bookings_storage.json');
  if (coordStorage?.bookings) {
    Object.values(coordStorage.bookings).forEach((cb) => {
      if (cb.travel_required && cb.travel_datetime) {
        const assigned = (cb.assigned_engineer || '').toLowerCase();
        if (assigned.includes(engName.toLowerCase())) {
          const travelDate = cb.travel_datetime.split('T')[0];
          if (!commitments.some((c) => c.id === `travel-${cb.id || cb.checklist_id}`)) {
            commitments.push({
              id: `travel-${cb.id || cb.checklist_id}`,
              type: 'TRAVEL',
              status: 'RECORDED',
              checklist_id: cb.checklist_id,
              start_date: travelDate,
              end_date: travelDate,
              destination: cb.destination,
            });
          }
        }
      }
    });
  }

  // 6. Apply Early Completion and Incomplete Assignment rules:
  // - A completed assignment does not block future dates: its blocking range ends strictly on actual completion!
  // - Never mark a technician available solely because a date passed if their assignment is still active or incomplete!
  const todayStr = new Date().toISOString().split('T')[0];
  commitments.forEach((c) => {
    if (c.type === 'JOB' && (c.status === 'COMPLETED' || c.status === 'SITE WORK COMPLETED')) {
      const completionDate = c.actual_completion_datetime ? c.actual_completion_datetime.split('T')[0] : c.start_date;
      c.effective_end_date = completionDate;
      c.original_scheduled_end_date = c.end_date;
    } else if (c.type === 'JOB' && c.status !== 'CANCELLED') {
      // If assignment is active and incomplete, but its scheduled end date was in the past,
      // it continues to block today and cannot be marked available solely because the date passed!
      const scheduledEnd = c.effective_end_date || c.end_date;
      if (scheduledEnd && scheduledEnd < todayStr) {
        c.effective_end_date = todayStr;
        c.original_scheduled_end_date = scheduledEnd;
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
  startDate,
  endDate,
  duration = '1 Day',
  excludeChecklistId = null,
}) {
  if (!startDate) {
    throw new Error('Start date is required to check availability.');
  }

  const finalEndDate = endDate || calculateBookingEndDate(startDate, duration);
  if (finalEndDate < startDate) {
    throw new Error(`End date (${finalEndDate}) cannot be before start date (${startDate}).`);
  }

  const resolved = resolveEngineer(engineerIdOrName);
  const engId = resolved ? resolved.id : engineerIdOrName;
  const engName = resolved ? resolved.name : engineerIdOrName;

  const commitments = await getEngineerCommitments(engId);
  const warnings = await getEngineerPendingWarnings(engId);

  // Find blocking commitment
  const conflicting = commitments.find((c) => {
    if (excludeChecklistId && (c.checklist_id === excludeChecklistId || c.id === excludeChecklistId)) {
      return false;
    }

    if (c.type === 'JOB' && (c.status === 'COMPLETED' || c.status === 'SITE WORK COMPLETED')) {
      const completionDate = (c.actual_completion_datetime || '').split('T')[0];
      if (completionDate) {
        if (startDate >= completionDate) return false;
      } else {
        if (startDate >= c.start_date) return false;
      }
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

  if (conflicting || conflictingPending) {
    let reasonText = '';
    let conflictObj = null;

    if (conflictingPending && !conflicting) {
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
    } else {
      if (conflicting.type === 'REST_DAY') {
        reasonText = `Engineer ${engName} has an approved Rest Day from ${conflicting.start_date} to ${conflicting.end_date}.`;
      } else if (conflicting.type === 'LEAVE') {
        reasonText = `Engineer ${engName} is on approved Leave (${conflicting.leave_type || 'Casual'}) from ${conflicting.start_date} to ${conflicting.end_date}.`;
      } else if (conflicting.type === 'TRAVEL') {
        reasonText = `Engineer ${engName} has a scheduled travel commitment on ${conflicting.start_date} (Destination: ${conflicting.destination || 'Site'}).`;
      } else {
        reasonText = `Engineer ${engName} is booked for ${conflicting.checklist_number || 'an assigned job'} from ${conflicting.start_date} to ${conflicting.end_date}.`;
      }

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

    // Find suggested available alternatives among the other authorized engineers
    const allEngineers = await getAllServiceEngineers();
    const otherEngineers = allEngineers.filter((e) => e.id !== engId);
    const suggestedEngineers = [];

    for (const other of otherEngineers) {
      const otherCommitments = await getEngineerCommitments(other.id);
      const hasConflict = otherCommitments.some((oc) => {
        if (oc.type === 'JOB' && (oc.status === 'COMPLETED' || oc.status === 'SITE WORK COMPLETED')) {
          const compDate = (oc.actual_completion_datetime || '').split('T')[0];
          if (compDate && startDate >= compDate) return false;
          if (!compDate && startDate >= oc.start_date) return false;
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
          suggestedEngineers.push({
            id: other.id,
            name: other.name,
            phone: other.phone,
          });
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
    };
  }

  return {
    available: true,
    engineer_id: engId,
    engineer_name: engName,
    requested_start_date: startDate,
    requested_end_date: finalEndDate,
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
  if (!startDate) {
    return MAIN_SERVICE_ENGINEERS.map((eng) => ({
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
  const engineers = await getAllServiceEngineers();

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
export async function releaseEngineerBooking({ checklistId }) {
  if (!checklistId) return;

  try {
    await supabase
      .from('engineer_bookings')
      .update({ status: 'RELEASED', updated_at: new Date().toISOString() })
      .eq('checklist_id', checklistId);
  } catch (err) {}

  let found = false;
  inMemoryBookings.forEach((b, k) => {
    if (b.checklist_id === checklistId || k === checklistId) {
      b.status = 'RELEASED';
      b.updated_at = new Date().toISOString();
      found = true;
    }
  });

  if (found) {
    saveStorage();
  }
}

/**
 * Permanently delete engineer booking for a deleted checklist
 */
export async function deleteEngineerBookingForChecklist(checklistId) {
  if (!checklistId) return;

  try {
    await supabase.from('engineer_bookings').delete().eq('checklist_id', checklistId);
  } catch (err) {}

  let found = false;
  inMemoryBookings.forEach((b, k) => {
    if (b.checklist_id === checklistId || k === checklistId) {
      inMemoryBookings.delete(k);
      found = true;
    }
  });

  if (found) {
    saveStorage();
  }
}

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
 * Calculate meaningful status for an engineer on a single specific date
 */
function determineEngineerDateStatus(commitments, dateStr) {
  const activeOnDate = commitments.filter((c) => {
    if (c.type === 'JOB' && (c.status === 'COMPLETED' || c.status === 'SITE WORK COMPLETED')) {
      const compDate = (c.actual_completion_datetime || '').split('T')[0];
      // A completed assignment must NEVER block on or after its actual completion date!
      if (compDate && dateStr >= compDate) return false;
      if (!compDate) return false;
    }
    const end = c.effective_end_date || c.end_date;
    const start = c.effective_start_date || c.start_date;
    if (end < start) return false;
    return start <= dateStr && end >= dateStr;
  });

  if (activeOnDate.length === 0) {
    return { status: 'AVAILABLE', label: 'Available', commitment: null };
  }

  // Conflict if multiple active overlapping commitments
  if (activeOnDate.length > 1) {
    return { status: 'CONFLICT', label: 'Schedule Conflict', commitments: activeOnDate };
  }

  const primary = activeOnDate[0];
  if (primary.type === 'LEAVE') {
    return { status: 'LEAVE', label: 'On Leave', commitment: primary };
  }
  if (primary.type === 'REST_DAY') {
    return { status: 'REST', label: 'Rest Day', commitment: primary };
  }
  if (primary.type === 'TRAVEL') {
    return { status: 'TRAVEL', label: 'Traveling', commitment: primary };
  }
  if (primary.type === 'JOB') {
    if (primary.status === 'COMPLETED' || primary.status === 'SITE WORK COMPLETED') {
      return { status: 'COMPLETED', label: 'Completed', commitment: primary };
    }
    if (primary.status === 'IN_PROGRESS') {
      return { status: 'IN_PROGRESS', label: 'On Installation/Service', commitment: primary };
    }
    return { status: 'ASSIGNED', label: 'Assigned', commitment: primary };
  }

  return { status: 'UNAVAILABLE', label: 'Unavailable', commitment: primary };
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
      dObj.setUTCDate(dObj.getUTCDate() + 29); // 30 days
      end = dObj.toISOString().split('T')[0];
    } else {
      // Default: week (7 days)
      dObj.setUTCDate(dObj.getUTCDate() + 6);
      end = dObj.toISOString().split('T')[0];
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
    traveling: 0,
    resting: 0,
    on_leave: 0,
    conflicts: 0,
  };

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
    const dayStat = determineEngineerDateStatus(comms, start);
    if (dayStat.status === 'AVAILABLE') summary.available++;
    else if (dayStat.status === 'ASSIGNED') summary.assigned++;
    else if (dayStat.status === 'IN_PROGRESS') summary.in_progress++;
    else if (dayStat.status === 'TRAVEL') summary.traveling++;
    else if (dayStat.status === 'REST') summary.resting++;
    else if (dayStat.status === 'LEAVE') summary.on_leave++;
    else if (dayStat.status === 'CONFLICT') summary.conflicts++;
  }

  const schedule = engineers.map((eng) => {
    const commitments = engineerCommitmentMap.get(eng.id) || [];
    const warnings = engineerWarningMap.get(eng.id) || [];

    const days = dateList.map((dateStr) => {
      const dateStatus = determineEngineerDateStatus(commitments, dateStr);
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
      };
    });

    return {
      engineer: eng,
      days,
      warnings,
      total_booked_days: days.filter((d) => !d.is_available).length,
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

