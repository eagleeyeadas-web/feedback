import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.resolve(__dirname, '../data/service_engineers_storage.json');

/**
 * Authoritative Seed of the Four Core Service Engineers with Stable UUIDs
 */
export const SEED_SERVICE_ENGINEERS = [
  {
    id: 'e1000000-0000-0000-0000-000000000001',
    name: 'Mathi',
    role: 'Service Engineer',
    phone: '+91 98401 11001',
    email: 'mathi@eagleeyesafdrive.com',
    employee_id: 'EMP-ENG-001',
    is_active: true,
  },
  {
    id: 'e1000000-0000-0000-0000-000000000006',
    name: 'Guna',
    role: 'Service Engineer',
    phone: '+91 98401 11002',
    email: 'guna@eagleeyesafdrive.com',
    employee_id: 'EMP-ENG-002',
    is_active: true,
  },
  {
    id: 'e1000000-0000-0000-0000-000000000004',
    name: 'Sakthivel',
    role: 'Service Engineer',
    phone: '+91 98401 11003',
    email: 'sakthivel@eagleeyesafdrive.com',
    employee_id: 'EMP-ENG-003',
    is_active: true,
  },
  {
    id: 'e1000000-0000-0000-0000-000000000002',
    name: 'Kamalesh',
    role: 'Service Engineer',
    phone: '+91 98401 11004',
    email: 'kamalesh@eagleeyesafdrive.com',
    employee_id: 'EMP-ENG-004',
    is_active: true,
  },
];

// In-memory cache for ultra-fast lookups (key: lower-case name or uuid -> engineer object)
export const inMemoryServiceEngineers = new Map();

/**
 * Load local storage fallback
 */
function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        data.forEach((e) => {
          inMemoryServiceEngineers.set(e.id, { ...e });
          inMemoryServiceEngineers.set(e.name.toLowerCase(), { ...e });
        });
      }
    }
  } catch (err) {
    console.warn('[ServiceEngineerService] Warning reading storage file:', err.message);
  }

  // Ensure 4 seed engineers exist in memory
  SEED_SERVICE_ENGINEERS.forEach((seed) => {
    if (!inMemoryServiceEngineers.has(seed.id)) {
      const nowIso = new Date().toISOString();
      const rec = { ...seed, created_at: nowIso, updated_at: nowIso };
      inMemoryServiceEngineers.set(seed.id, rec);
      inMemoryServiceEngineers.set(seed.name.toLowerCase(), rec);
    }
  });
}

/**
 * Persist in-memory state to local JSON file
 */
function persistStorage() {
  try {
    const list = getDistinctEngineersFromMemory();
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[ServiceEngineerService] Warning writing storage file:', err.message);
  }
}

/**
 * Helper to get unique engineer objects from in-memory cache
 */
export function getDistinctEngineersFromMemory() {
  const seen = new Set();
  const list = [];
  for (const [key, val] of inMemoryServiceEngineers.entries()) {
    if (!seen.has(val.id)) {
      seen.add(val.id);
      list.push({ ...val });
    }
  }
  return list;
}

/**
 * Synchronous access to active engineers from memory
 */
export function getActiveServiceEngineersSync() {
  return getDistinctEngineersFromMemory().filter((e) => e.is_active !== false);
}

// Initialize storage on module load
loadStorage();

/**
 * Synchronize local cache with Supabase service_engineers table
 */
export async function syncServiceEngineersWithDatabase() {
  try {
    const { data, error } = await supabase
      .from('service_engineers')
      .select('*')
      .order('name', { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      data.forEach((e) => {
        inMemoryServiceEngineers.set(e.id, { ...e });
        inMemoryServiceEngineers.set(e.name.toLowerCase(), { ...e });
      });
      persistStorage();
      return getDistinctEngineersFromMemory();
    }
  } catch (err) {
    console.warn('[ServiceEngineerService] Notice syncing with Supabase:', err.message);
  }

  return getDistinctEngineersFromMemory();
}

/**
 * 1. GET ALL SERVICE ENGINEERS
 * @param {Object} options
 * @param {boolean} options.includeInactive - If true, returns both active and deactivated engineers (for HR management)
 */
export async function getAllServiceEngineers({ includeInactive = false } = {}) {
  let list = [];
  try {
    let query = supabase.from('service_engineers').select('*');
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }
    const { data, error } = await query.order('name', { ascending: true });
    if (!error && Array.isArray(data) && data.length > 0) {
      list = data;
      // Update memory cache
      data.forEach((e) => {
        inMemoryServiceEngineers.set(e.id, { ...e });
        inMemoryServiceEngineers.set(e.name.toLowerCase(), { ...e });
      });
    }
  } catch (err) {
    console.warn('[ServiceEngineerService] Fallback to memory for getAllServiceEngineers:', err.message);
  }

  if (list.length === 0) {
    list = getDistinctEngineersFromMemory();
    if (!includeInactive) {
      list = list.filter((e) => e.is_active !== false);
    }
  }

  // Ensure the 4 core engineers are always included if active
  if (!includeInactive) {
    SEED_SERVICE_ENGINEERS.forEach((seed) => {
      const found = list.find((e) => e.id === seed.id || e.name.toLowerCase() === seed.name.toLowerCase());
      if (!found) {
        list.push({ ...seed });
      }
    });
  }

  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 2. GET ACTIVE SERVICE ENGINEER NAMES
 * Returns array of active names, e.g. ['Guna', 'Kamalesh', 'Mathi', 'Sakthivel', ...]
 */
export async function getActiveServiceEngineerNames() {
  const engineers = await getAllServiceEngineers({ includeInactive: false });
  return engineers.map((e) => e.name);
}

/**
 * 3. GET SERVICE ENGINEER BY ID OR NAME
 */
export async function getServiceEngineerById(idOrName) {
  if (!idOrName) return null;
  const q = String(idOrName).trim().toLowerCase();

  // Check memory
  if (inMemoryServiceEngineers.has(q)) {
    return inMemoryServiceEngineers.get(q);
  }

  // Check DB
  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    let query = supabase.from('service_engineers').select('*');
    if (isUuid) {
      query = query.eq('id', q);
    } else {
      query = query.ilike('name', q);
    }
    const { data } = await query.maybeSingle();
    if (data) {
      inMemoryServiceEngineers.set(data.id, data);
      inMemoryServiceEngineers.set(data.name.toLowerCase(), data);
      return data;
    }
  } catch (err) {}

  return null;
}

/**
 * 4. ADD SERVICE ENGINEER
 * Validates non-blank name and prevents case-insensitive duplicate names.
 */
export async function addServiceEngineer({
  name,
  employee_id = null,
  phone = null,
  email = null,
  role = 'Service Engineer',
  user = null,
}) {
  if (!name || !name.trim()) {
    const err = new Error('Service engineer full name is required and cannot be blank.');
    err.statusCode = 400;
    throw err;
  }

  const trimmedName = name.trim();
  if (trimmedName.length < 2) {
    const err = new Error('Service engineer name must be at least 2 characters long.');
    err.statusCode = 400;
    throw err;
  }

  // Check for duplicate name (case-insensitive)
  const existing = await getServiceEngineerById(trimmedName);
  if (existing) {
    if (existing.is_active !== false) {
      const err = new Error(`A service engineer named "${trimmedName}" already exists.`);
      err.statusCode = 409;
      throw err;
    }

    // If an inactive record exists, reactivate it with updated metadata
    const reactivated = await updateServiceEngineer(existing.id, {
      name: trimmedName,
      employee_id: employee_id || existing.employee_id,
      phone: phone !== undefined ? phone : existing.phone,
      email: email !== undefined ? email : existing.email,
      role: role || existing.role || 'Service Engineer',
      is_active: true,
      user,
    });
    return reactivated;
  }

  const id = uuidv4();
  const nowIso = new Date().toISOString();
  const normalizedEmail = email && email.trim()
    ? email.trim()
    : `${trimmedName.toLowerCase().replace(/[^a-z0-9]/g, '')}@eagleeyesafdrive.com`;

  const newRecord = {
    id,
    name: trimmedName,
    role: role || 'Service Engineer',
    phone: phone ? phone.trim() : null,
    email: normalizedEmail,
    employee_id: employee_id ? employee_id.trim() : null,
    is_active: true,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // Attempt database insert
  try {
    const { error: insErr } = await supabase
      .from('service_engineers')
      .insert([newRecord]);

    if (insErr) {
      // If error was due to employee_id not in schema cache, insert without employee_id
      if (insErr.code === 'PGRST204' || insErr.message?.includes('employee_id')) {
        const fallbackRecord = { ...newRecord };
        delete fallbackRecord.employee_id;
        await supabase.from('service_engineers').insert([fallbackRecord]);
      } else {
        throw insErr;
      }
    }
  } catch (err) {
    console.warn('[ServiceEngineerService] DB insert exception:', err.message);
  }

  // Update in-memory & storage
  inMemoryServiceEngineers.set(id, newRecord);
  inMemoryServiceEngineers.set(trimmedName.toLowerCase(), newRecord);
  persistStorage();

  // Audit
  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'HR',
      action: 'ADD_SERVICE_ENGINEER',
      target_table: 'service_engineers',
      target_id: id,
      details: {
        id,
        name: trimmedName,
        employee_id: newRecord.employee_id,
        email: newRecord.email,
      },
    });
  } catch (e) {}

  return newRecord;
}

/**
 * 5. EDIT SERVICE ENGINEER NAME AND DETAILS
 * Preserves stable ID. Updates references throughout the application when name changes.
 */
export async function updateServiceEngineer(
  id,
  { name, employee_id, phone, email, role, is_active, user = null }
) {
  if (!id) throw new Error('Service engineer ID is required.');

  const existing = await getServiceEngineerById(id);
  if (!existing) {
    const err = new Error(`Service engineer with ID "${id}" not found.`);
    err.statusCode = 404;
    throw err;
  }

  const oldName = existing.name;
  let newName = oldName;

  if (name !== undefined) {
    if (!name || !name.trim()) {
      const err = new Error('Service engineer name cannot be empty.');
      err.statusCode = 400;
      throw err;
    }
    newName = name.trim();

    // Check duplicate if name is changing
    if (newName.toLowerCase() !== oldName.toLowerCase()) {
      const dup = await getServiceEngineerById(newName);
      if (dup && dup.id !== existing.id) {
        const err = new Error(`A service engineer named "${newName}" already exists.`);
        err.statusCode = 409;
        throw err;
      }
    }
  }

  const nowIso = new Date().toISOString();
  const updatedRecord = {
    ...existing,
    name: newName,
    role: role !== undefined ? role : existing.role,
    phone: phone !== undefined ? (phone ? phone.trim() : null) : existing.phone,
    email: email !== undefined ? (email ? email.trim() : null) : existing.email,
    employee_id: employee_id !== undefined ? (employee_id ? employee_id.trim() : null) : existing.employee_id,
    is_active: is_active !== undefined ? Boolean(is_active) : (existing.is_active !== false),
    updated_at: nowIso,
  };

  // DB update
  try {
    const dbPayload = {
      name: updatedRecord.name,
      role: updatedRecord.role,
      phone: updatedRecord.phone,
      email: updatedRecord.email,
      is_active: updatedRecord.is_active,
      updated_at: nowIso,
    };
    if (updatedRecord.employee_id !== undefined) {
      dbPayload.employee_id = updatedRecord.employee_id;
    }

    const { error: updErr } = await supabase
      .from('service_engineers')
      .update(dbPayload)
      .eq('id', existing.id);

    if (updErr && (updErr.code === 'PGRST204' || updErr.message?.includes('employee_id'))) {
      delete dbPayload.employee_id;
      await supabase.from('service_engineers').update(dbPayload).eq('id', existing.id);
    }
  } catch (err) {
    console.warn('[ServiceEngineerService] DB update exception:', err.message);
  }

  // Update in-memory
  if (oldName.toLowerCase() !== newName.toLowerCase()) {
    inMemoryServiceEngineers.delete(oldName.toLowerCase());
  }
  inMemoryServiceEngineers.set(existing.id, updatedRecord);
  inMemoryServiceEngineers.set(newName.toLowerCase(), updatedRecord);
  persistStorage();

  // If name changed, CASCADE update all historical references across tables
  if (oldName !== newName) {
    await cascadeEngineerNameUpdate(existing.id, oldName, newName);
  }

  // Audit
  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'HR',
      action: 'UPDATE_SERVICE_ENGINEER',
      target_table: 'service_engineers',
      target_id: existing.id,
      details: {
        id: existing.id,
        old_name: oldName,
        new_name: newName,
        is_active: updatedRecord.is_active,
      },
    });
  } catch (e) {}

  return updatedRecord;
}

/**
 * Helper to cascade engineer name updates across all referencing tables
 */
async function cascadeEngineerNameUpdate(engineerId, oldName, newName) {
  try {
    // 1. installation_checklists (by service_engineer_id OR service_engineer string)
    await supabase
      .from('installation_checklists')
      .update({ service_engineer: newName })
      .or(`service_engineer_id.eq.${engineerId},service_engineer.eq.${oldName}`);

    // 2. engineer_bookings
    await supabase
      .from('engineer_bookings')
      .update({ engineer_name: newName })
      .or(`engineer_id.eq.${engineerId},engineer_name.eq.${oldName}`);

    // 3. coordinator_bookings
    await supabase
      .from('coordinator_bookings')
      .update({ assigned_engineer: newName })
      .eq('assigned_engineer', oldName);

    // 4. schedule_extension_requests
    await supabase
      .from('schedule_extension_requests')
      .update({ engineer_name: newName })
      .eq('engineer_name', oldName);

    // 5. leave_requests
    await supabase
      .from('leave_requests')
      .update({ engineer_name: newName })
      .or(`engineer_id.eq.${engineerId},engineer_name.eq.${oldName}`);

    // 6. rest_day_requests
    await supabase
      .from('rest_day_requests')
      .update({ engineer_name: newName })
      .or(`engineer_id.eq.${engineerId},engineer_name.eq.${oldName}`);

    // 7. technician_availability_overrides
    await supabase
      .from('technician_availability_overrides')
      .update({ engineer_name: newName })
      .or(`engineer_id.eq.${engineerId},engineer_name.eq.${oldName}`);
  } catch (err) {
    console.warn('[ServiceEngineerService] Warning cascading engineer name update:', err.message);
  }
}

/**
 * 6. CHECK SERVICE ENGINEER IMPACT & COMMITMENTS
 * Identifies active commitments and historical records before deactivation or removal.
 */
export async function checkServiceEngineerImpact(idOrName) {
  const engineer = await getServiceEngineerById(idOrName);
  if (!engineer) {
    const err = new Error(`Service engineer "${idOrName}" not found.`);
    err.statusCode = 404;
    throw err;
  }

  const engId = engineer.id;
  const engName = engineer.name;
  const todayStr = new Date().toISOString().split('T')[0];

  const activeCommitments = [];
  let historicalRecordsCount = 0;

  // 1. Check active/assigned installation checklists & bookings
  try {
    const { data: checklists } = await supabase
      .from('installation_checklists')
      .select('id, checklist_number, client_name, expected_arrival_date, installation_status')
      .or(`service_engineer_id.eq.${engId},service_engineer.ilike.${engName}`);

    if (Array.isArray(checklists)) {
      checklists.forEach((chk) => {
        const st = (chk.installation_status || '').trim();
        if (st === 'Assigned' || st === 'In Progress') {
          activeCommitments.push({
            type: 'INSTALLATION_ASSIGNMENT',
            id: chk.id,
            checklist_number: chk.checklist_number,
            client_name: chk.client_name,
            date: chk.expected_arrival_date,
            status: chk.installation_status,
            description: `Active Job ${chk.checklist_number} (${chk.client_name || 'Client'}) scheduled for ${chk.expected_arrival_date || 'TBD'}`,
          });
        } else {
          historicalRecordsCount++;
        }
      });
    }
  } catch (err) {}

  // Check in-memory bookings for active commitments
  try {
    const { inMemoryBookings } = await import('./engineerBookingService.js');
    if (inMemoryBookings) {
      inMemoryBookings.forEach((b) => {
        if (b.engineer_id === engId || (b.engineer_name || '').toLowerCase() === engName.toLowerCase()) {
          const st = String(b.status || '').toUpperCase();
          if (st === 'ASSIGNED' || st === 'IN_PROGRESS') {
            if (!activeCommitments.some((c) => c.checklist_number === b.checklist_number)) {
              activeCommitments.push({
                type: 'INSTALLATION_ASSIGNMENT',
                id: b.id,
                checklist_number: b.checklist_number,
                description: `Active Booking ${b.checklist_number} (${b.booking_start_date} to ${b.booking_end_date})`,
              });
            }
          } else if (st === 'COMPLETED') {
            historicalRecordsCount++;
          }
        }
      });
    }
  } catch (err) {}

  // 2. Check travel bookings
  try {
    const { data: travelBookings } = await supabase
      .from('coordinator_bookings')
      .select('*')
      .ilike('assigned_engineer', engName);

    const allTravel = Array.isArray(travelBookings) ? [...travelBookings] : [];

    try {
      const { inMemoryBookings: memCoord } = await import('./coordinatorBookingService.js');
      if (memCoord) {
        memCoord.forEach((cb) => {
          if ((cb.assigned_engineer || '').toLowerCase().includes(engName.toLowerCase())) {
            if (!allTravel.some((t) => t.id === cb.id)) {
              allTravel.push(cb);
            }
          }
        });
      }
    } catch (e) {}

    allTravel.forEach((tb) => {
      const isOutboundActive = tb.outbound_status && !['Cancelled', 'CANCELLED'].includes(tb.outbound_status);
      const isReturnActive = tb.return_status && !['Cancelled', 'CANCELLED'].includes(tb.return_status);
      const depDate = (tb.outbound_departure_datetime || tb.travel_datetime || '').split('T')[0];
      if (isOutboundActive || isReturnActive) {
        activeCommitments.push({
          type: 'TRAVEL_COMMITMENT',
          id: tb.id,
          date: depDate,
          description: `Travel booking departing ${depDate || 'TBD'} (outbound: ${tb.outbound_status || 'Pending'})`,
        });
      } else {
        historicalRecordsCount++;
      }
    });
  } catch (err) {}

  // 3. Check approved future rest days and leaves
  try {
    const { data: restDays } = await supabase
      .from('rest_day_requests')
      .select('id, rest_start_date, rest_end_date, status')
      .or(`engineer_id.eq.${engId},engineer_name.eq.${engName}`)
      .eq('status', 'APPROVED')
      .gte('rest_end_date', todayStr);

    if (Array.isArray(restDays)) {
      restDays.forEach((rd) => {
        activeCommitments.push({
          type: 'REST_DAY',
          id: rd.id,
          date: rd.rest_start_date,
          description: `Approved Rest Day from ${rd.rest_start_date} to ${rd.rest_end_date}`,
        });
      });
    }

    const { data: leaves } = await supabase
      .from('leave_requests')
      .select('id, leave_start_date, leave_end_date, status')
      .or(`engineer_id.eq.${engId},engineer_name.eq.${engName}`)
      .eq('status', 'APPROVED')
      .gte('leave_end_date', todayStr);

    if (Array.isArray(leaves)) {
      leaves.forEach((lv) => {
        activeCommitments.push({
          type: 'LEAVE',
          id: lv.id,
          date: lv.leave_start_date,
          description: `Approved Leave from ${lv.leave_start_date} to ${lv.leave_end_date}`,
        });
      });
    }
  } catch (err) {}

  // 4. Check historical reports and expenses
  try {
    const { count: reportCount } = await supabase
      .from('technical_installation_reports')
      .select('*', { count: 'exact', head: true })
      .or(`technician_id.eq.${engId}`);
    if (reportCount) historicalRecordsCount += reportCount;

    const { count: expenseCount } = await supabase
      .from('job_expenses')
      .select('*', { count: 'exact', head: true })
      .or(`technician_id.eq.${engId},technician_name.ilike.${engName}`);
    if (expenseCount) historicalRecordsCount += expenseCount;
  } catch (err) {}

  // Fallback memory check for expenses
  try {
    const { inMemoryJobExpenses } = await import('./expenseService.js');
    if (inMemoryJobExpenses) {
      inMemoryJobExpenses.forEach((exp) => {
        if (exp.technician_id === engId || (exp.technician_name || '').toLowerCase() === engName.toLowerCase()) {
          historicalRecordsCount++;
        }
      });
    }
  } catch (err) {}

  const canHardDelete = activeCommitments.length === 0 && historicalRecordsCount === 0;

  return {
    engineer: {
      id: engineer.id,
      name: engineer.name,
      role: engineer.role,
      is_active: engineer.is_active !== false,
      employee_id: engineer.employee_id,
      created_at: engineer.created_at,
    },
    canHardDelete,
    hasActiveCommitments: activeCommitments.length > 0,
    hasHistoricalRecords: historicalRecordsCount > 0,
    activeCommitments,
    historicalRecordsCount,
    message: activeCommitments.length > 0
      ? `Engineer "${engName}" has ${activeCommitments.length} active commitment(s). These must be completed or reallocated before deactivating.`
      : historicalRecordsCount > 0
        ? `Engineer "${engName}" has ${historicalRecordsCount} historical assignment/report record(s). They will be deactivated to preserve audit trails.`
        : `Engineer "${engName}" has no assignments or history and can be safely removed.`,
  };
}

/**
 * 7. DEACTIVATE OR SAFELY REMOVE SERVICE ENGINEER
 * Protects historical records and blocks unsafe deletion when active commitments exist.
 */
export async function deactivateOrRemoveServiceEngineer(id, { reason = '', user = null } = {}) {
  const impact = await checkServiceEngineerImpact(id);
  const eng = impact.engineer;

  if (impact.hasActiveCommitments) {
    const err = new Error(
      `Cannot deactivate or remove engineer "${eng.name}" because they have ${impact.activeCommitments.length} active commitment(s) that must be resolved first:\n${impact.activeCommitments.map((c) => `- ${c.description}`).join('\n')}`
    );
    err.statusCode = 400;
    err.activeCommitments = impact.activeCommitments;
    throw err;
  }

  // If engineer has historical records, deactivate rather than hard deleting
  if (impact.hasHistoricalRecords) {
    const updated = await updateServiceEngineer(eng.id, {
      is_active: false,
      user,
    });

    try {
      await logAudit({
        actor_id: user?.id,
        actor_email: user?.email,
        actor_role: user?.role || 'HR',
        action: 'DEACTIVATE_SERVICE_ENGINEER',
        target_table: 'service_engineers',
        target_id: eng.id,
        details: {
          id: eng.id,
          name: eng.name,
          reason,
          historical_records_count: impact.historicalRecordsCount,
        },
      });
    } catch (e) {}

    return {
      success: true,
      action: 'DEACTIVATED',
      message: `Engineer "${eng.name}" has been deactivated. Historical records and reports are safely preserved.`,
      engineer: updated,
    };
  }

  // If completely clean (no commitments, no history), safe permanent delete
  try {
    await supabase.from('service_engineers').delete().eq('id', eng.id);
  } catch (err) {
    console.warn('[ServiceEngineerService] DB delete exception:', err.message);
  }

  inMemoryServiceEngineers.delete(eng.id);
  inMemoryServiceEngineers.delete(eng.name.toLowerCase());
  persistStorage();

  try {
    await logAudit({
      actor_id: user?.id,
      actor_email: user?.email,
      actor_role: user?.role || 'HR',
      action: 'DELETE_SERVICE_ENGINEER',
      target_table: 'service_engineers',
      target_id: eng.id,
      details: {
        id: eng.id,
        name: eng.name,
        reason,
      },
    });
  } catch (e) {}

  return {
    success: true,
    action: 'DELETED',
    message: `Engineer "${eng.name}" has been permanently removed.`,
    engineer: { id: eng.id, name: eng.name, is_active: false },
  };
}
