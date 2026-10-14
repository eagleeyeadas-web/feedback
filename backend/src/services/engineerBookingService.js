import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';

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

/**
 * Concurrency Lock per engineer: Serializes concurrent reservation attempts on the same engineer
 */
async function acquireEngineerLock(engineerId, fn) {
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
 * e.g., '1 Day' -> 1, '2 Days' -> 2, '3 Days' -> 3
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
 * Example: start = 2026-10-12, days = 1 -> end = 2026-10-12 (1 inclusive day)
 * Example: start = 2026-10-12, days = 2 -> end = 2026-10-13 (2 inclusive days: 12th & 13th)
 */
export function calculateBookingEndDate(startDateStr, durationDaysOrEndDate) {
  if (!startDateStr) return null;

  // If already a valid YYYY-MM-DD end date string
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
  // Add (days - 1) days for inclusive end date
  startObj.setUTCDate(startObj.getUTCDate() + (Math.max(1, days) - 1));

  return startObj.toISOString().split('T')[0];
}

/**
 * Overlap check for two inclusive date ranges [startA, endA] and [startB, endB]
 * A conflict exists if and only if: startA <= endB && endA >= startB
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

  // 1. Direct ID match
  const byId = MAIN_SERVICE_ENGINEERS.find((e) => e.id.toLowerCase() === query);
  if (byId) return byId;

  // 2. Direct Name match
  const byName = MAIN_SERVICE_ENGINEERS.find((e) => e.name.toLowerCase() === query);
  if (byName) return byName;

  // 3. Partial Name match
  const byPartial = MAIN_SERVICE_ENGINEERS.find(
    (e) => e.name.toLowerCase().includes(query) || query.includes(e.name.toLowerCase())
  );
  if (byPartial) return byPartial;

  // Return fallback engineer descriptor with stable slug
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

  // 1. Seed the 4 authorized main engineers
  MAIN_SERVICE_ENGINEERS.forEach((eng) => {
    map.set(eng.name.toLowerCase(), { ...eng });
  });

  // 2. Query database service_engineers table if present (only matching the 4 authorized names)
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
  } catch (err) {
    // Database table might not be migrated yet
  }

  // Return exactly the 4 authorized engineers in the required order: Mathi, Guna, Sakthivel, Kamalesh
  return SERVICE_ENGINEER_OPTIONS.map((name) => map.get(name.toLowerCase())).filter(Boolean);
}

/**
 * Fetch active bookings for an engineer across both DB and fallback memory
 */
export async function getActiveBookingsForEngineer(engineerIdOrName) {
  const resolved = resolveEngineer(engineerIdOrName);
  const engId = resolved ? resolved.id : engineerIdOrName;
  const engName = resolved ? resolved.name : engineerIdOrName;

  const bookings = [];
  const seenBookingIds = new Set();

  // 1. Query Supabase engineer_bookings table
  try {
    const { data: dbBookings, error } = await supabase
      .from('engineer_bookings')
      .select('*')
      .or(`engineer_id.eq.${engId},engineer_name.ilike.%${engName}%`)
      .in('status', ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']);

    if (!error && Array.isArray(dbBookings)) {
      dbBookings.forEach((b) => {
        seenBookingIds.add(b.id);
        bookings.push(b);
      });
    }
  } catch (err) {
    // Non-blocking fallback
  }

  // 2. Query in-memory / storage fallback
  inMemoryBookings.forEach((b) => {
    if (seenBookingIds.has(b.id)) return;
    const isMatching =
      b.engineer_id === engId ||
      b.engineer_name.toLowerCase() === engName.toLowerCase();
    const isActive = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status);

    if (isMatching && isActive) {
      bookings.push(b);
    }
  });

  // 3. Fallback: Also check installation_checklists directly for existing assigned jobs
  try {
    const { data: checklists, error: chErr } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, client_name, service_engineer, expected_arrival_date, installation_duration, installation_status')
      .ilike('service_engineer', `%${engName}%`)
      .in('installation_status', ['Assigned', 'In Progress', 'Completed']);

    if (!chErr && Array.isArray(checklists)) {
      checklists.forEach((ch) => {
        if (!ch.expected_arrival_date) return;
        const exists = bookings.some((b) => b.checklist_id === ch.id || b.checklist_number === ch.checklist_number);
        if (!exists) {
          const start = ch.expected_arrival_date;
          const end = calculateBookingEndDate(start, ch.installation_duration || '1 Day');
          bookings.push({
            id: `ch-booking-${ch.id}`,
            engineer_id: engId,
            engineer_name: engName,
            checklist_id: ch.id,
            checklist_number: ch.checklist_number,
            client_name: ch.client_name,
            booking_start_date: start,
            booking_end_date: end,
            status: ch.installation_status === 'Completed' ? 'COMPLETED' : 'ASSIGNED',
          });
        }
      });
    }
  } catch (err) {
    // Non-blocking
  }

  return bookings;
}

/**
 * Check if an engineer is available for a requested date range [startDate, endDate]
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

  const activeBookings = await getActiveBookingsForEngineer(engId);

  // Filter out the current checklist if editing an existing job
  const conflicting = activeBookings.find((b) => {
    if (excludeChecklistId && (b.checklist_id === excludeChecklistId || b.id === excludeChecklistId)) {
      return false;
    }
    return isDateRangeOverlapping(startDate, finalEndDate, b.booking_start_date, b.booking_end_date);
  });

  if (conflicting) {
    return {
      available: false,
      engineer_id: engId,
      engineer_name: engName,
      requested_start_date: startDate,
      requested_end_date: finalEndDate,
      conflict: {
        checklist_id: conflicting.checklist_id,
        checklist_number: conflicting.checklist_number,
        client_name: conflicting.client_name || 'Assigned Job',
        booking_start_date: conflicting.booking_start_date,
        booking_end_date: conflicting.booking_end_date,
        status: conflicting.status,
      },
      message: `Engineer ${engName} is booked for ${conflicting.checklist_number} from ${conflicting.booking_start_date} to ${conflicting.booking_end_date}.`,
    };
  }

  return {
    available: true,
    engineer_id: engId,
    engineer_name: engName,
    requested_start_date: startDate,
    requested_end_date: finalEndDate,
    conflict: null,
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
        message: check.message || null,
      };
    })
  );

  return results;
}

/**
 * Atomic Reservation: Concurrency-Safe booking with Mutex Locking & DB Exclusion
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
      const errorMsg = `Booking Conflict: Engineer ${engName} is already booked for checklist ${c.checklist_number} from ${c.booking_start_date} to ${c.booking_end_date}. Overlapping assignments are prohibited.`;
      const err = new Error(errorMsg);
      err.statusCode = 409;
      err.conflict = c;
      throw err;
    }

    // 2. Release any prior booking for this checklist (if reassigning or updating dates)
    if (checklistId) {
      await releaseEngineerBooking({ checklistId });
    }

    const bookingId = `booking-${engId}-${checklistId || Date.now()}`;
    const bookingRecord = {
      id: bookingId,
      engineer_id: engId,
      engineer_name: engName,
      checklist_id: checklistId || null,
      checklist_number: checklistNumber || 'TBD',
      booking_start_date: startDate,
      booking_end_date: finalEndDate,
      status: status || 'ASSIGNED',
      created_by: user ? user.id : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 3. Attempt DB insert into engineer_bookings
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
            status: status || 'ASSIGNED',
            created_by: user ? user.id : null,
          },
        ])
        .select()
        .single();

      if (!dbErr && dbCreated) {
        bookingRecord.id = dbCreated.id;
      }
    } catch (err) {
      console.warn('DB engineer_bookings table not available, using in-memory store:', err.message);
    }

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
            booking_end_date: finalEndDate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', checklistId);
      } catch (updErr) {
        // Non-blocking
      }
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
 * Release / Cancel an engineer booking (e.g., job cancelled or engineer reassigned)
 */
export async function releaseEngineerBooking({ checklistId }) {
  if (!checklistId) return;

  // 1. Release in DB
  try {
    await supabase
      .from('engineer_bookings')
      .update({ status: 'RELEASED', updated_at: new Date().toISOString() })
      .eq('checklist_id', checklistId);
  } catch (err) {
    // Non-blocking
  }

  // 2. Release in-memory
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
 * Availability Calendar: Fetch date-based schedule across all 5 main engineers
 */
export async function getAvailabilityCalendar({ startDate, endDate }) {
  const todayStr = new Date().toISOString().split('T')[0];
  const start = startDate || todayStr;

  // Default to 14 days view if end date not provided
  let end = endDate;
  if (!end) {
    const [y, m, d] = start.split('-').map(Number);
    const dObj = new Date(Date.UTC(y, m - 1, d));
    dObj.setUTCDate(dObj.getUTCDate() + 13);
    end = dObj.toISOString().split('T')[0];
  }

  const engineers = await getAllServiceEngineers();
  const dateList = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const current = new Date(Date.UTC(sy, sm - 1, sd));
  const finish = new Date(Date.UTC(ey, em - 1, ed));

  while (current <= finish) {
    dateList.push(current.toISOString().split('T')[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const schedule = await Promise.all(
    engineers.map(async (eng) => {
      const bookings = await getActiveBookingsForEngineer(eng.id);
      const days = dateList.map((dateStr) => {
        const activeBooking = bookings.find(
          (b) => b.booking_start_date <= dateStr && b.booking_end_date >= dateStr
        );

        return {
          date: dateStr,
          is_available: !activeBooking,
          booking: activeBooking
            ? {
                checklist_id: activeBooking.checklist_id,
                checklist_number: activeBooking.checklist_number,
                client_name: activeBooking.client_name,
                booking_start_date: activeBooking.booking_start_date,
                booking_end_date: activeBooking.booking_end_date,
                status: activeBooking.status,
              }
            : null,
        };
      });

      return {
        engineer: eng,
        days,
        total_booked_days: days.filter((d) => !d.is_available).length,
      };
    })
  );

  return {
    start_date: start,
    end_date: end,
    dates: dateList,
    schedule,
  };
}
