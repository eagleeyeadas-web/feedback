import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import { createNotification } from './appNotificationService.js';
import {
  resolveEngineer,
  acquireEngineerLock,
  checkEngineerAvailability,
  isDateRangeOverlapping,
} from './engineerBookingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/rest_days_storage.json');

export const inMemoryRestDays = new Map();

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.rest_days)) {
        data.rest_days.forEach((r) => inMemoryRestDays.set(r.id, r));
      }
    }
  } catch (err) {
    console.warn('Could not load rest days fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      rest_days: Array.from(inMemoryRestDays.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save rest days fallback storage:', err.message);
  }
}

loadStorage();

export function cleanupTestRestDaysForYear(year = '2028') {
  inMemoryRestDays.forEach((r, k) => {
    if (r.rest_start_date?.startsWith(year) || r.rest_end_date?.startsWith(year)) {
      inMemoryRestDays.delete(k);
    }
  });
  saveStorage();
}


/**
 * 1. Request Rest Day
 */
export async function requestRestDay({
  engineerIdOrName,
  checklistId = null,
  checklistNumber = null,
  restStartDate,
  restEndDate = null,
  startDate = null,
  endDate = null,
  reason,
  notes = '',
  user = null,
}) {
  const actualStartDate = restStartDate || startDate;
  const actualEndDate = restEndDate || endDate || actualStartDate;

  if (!engineerIdOrName) throw new Error('Service Engineer is required.');
  if (!actualStartDate) throw new Error('Rest start date is required.');
  if (!reason || !reason.trim()) throw new Error('A valid reason for the rest day request is required.');

  if (actualEndDate < actualStartDate) {
    throw new Error(`Rest end date (${actualEndDate}) cannot be before start date (${actualStartDate}).`);
  }

  const resolved = resolveEngineer(engineerIdOrName);
  if (!resolved) {
    throw new Error(`Service Engineer "${engineerIdOrName}" is not recognized.`);
  }

  // Prevent duplicate pending requests for the exact same engineer and date range
  const existingPending = Array.from(inMemoryRestDays.values()).find(
    (r) =>
      r.status === 'PENDING' &&
      r.engineer_id === resolved.id &&
      isDateRangeOverlapping(actualStartDate, actualEndDate, r.rest_start_date, r.rest_end_date)
  );

  if (existingPending) {
    const err = new Error(
      `A rest day request for ${resolved.name} is already pending for overlapping dates (${existingPending.rest_start_date} to ${existingPending.rest_end_date}).`
    );
    err.statusCode = 409;
    throw err;
  }

  const reqId = uuidv4();
  const restRecord = {
    id: reqId,
    engineer_id: resolved.id,
    engineer_name: resolved.name,
    checklist_id: checklistId || null,
    checklist_number: checklistNumber || null,
    rest_start_date: actualStartDate,
    rest_end_date: actualEndDate,
    reason: reason.trim(),
    notes: notes ? notes.trim() : null,
    status: 'PENDING',
    coordinator_decision_notes: null,
    decided_by: null,
    decided_at: null,
    created_by: user?.id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    const { data: dbData, error } = await supabase
      .from('rest_day_requests')
      .insert([
        {
          id: reqId,
          engineer_id: resolved.id,
          engineer_name: resolved.name,
          checklist_id: checklistId,
          checklist_number: checklistNumber,
          rest_start_date: actualStartDate,
          rest_end_date: actualEndDate,
          reason: restRecord.reason,
          notes: restRecord.notes,
          status: 'PENDING',
          created_by: user?.id,
        },
      ])
      .select()
      .single();

    if (!error && dbData) {
      restRecord.id = dbData.id;
    }
  } catch (err) {}

  inMemoryRestDays.set(restRecord.id, restRecord);
  saveStorage();

  // Notify Coordinator
  await createNotification({
    targetRole: 'COORDINATOR',
    title: `Rest-Day Request: ${resolved.name}`,
    message: `${resolved.name} requested rest from ${actualStartDate} to ${actualEndDate}. Reason: ${restRecord.reason}`,
    type: 'REST_REQUEST',
    checklistId,
    checklistNumber,
    metadata: {
      rest_id: restRecord.id,
      engineer_id: resolved.id,
      engineer_name: resolved.name,
      start_date: actualStartDate,
      end_date: actualEndDate,
    },
  });

  await logAudit({
    actor_id: user?.id,
    actor_email: user?.email,
    actor_role: user?.role,
    action: 'REQUEST_REST_DAY',
    target_table: 'rest_day_requests',
    target_id: restRecord.id,
    details: {
      engineer_id: resolved.id,
      engineer_name: resolved.name,
      rest_start_date: actualStartDate,
      rest_end_date: actualEndDate,
    },
  });

  return restRecord;
}

/**
 * 2. Approve Rest Day (Strictly COORDINATOR or ADMIN)
 */
export async function approveRestDay({ requestId, user, decisionNotes = '' }) {
  if (!user || !['COORDINATOR', 'ADMIN', 'SUPER_ADMIN'].includes(String(user.role).toUpperCase())) {
    const err = new Error('Permission Denied: Only authorized Coordinator or Admin can approve rest-day requests.');
    err.statusCode = 403;
    throw err;
  }

  let rest = inMemoryRestDays.get(requestId);
  if (!rest) {
    try {
      const { data } = await supabase.from('rest_day_requests').select('*').eq('id', requestId).single();
      if (data) rest = data;
    } catch (e) {}
  }

  if (!rest) {
    const err = new Error('Rest day request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (rest.status !== 'PENDING') {
    const err = new Error(`Cannot approve rest day request: current status is already ${rest.status}.`);
    err.statusCode = 400;
    throw err;
  }

  // SERIALIZED ATOMIC APPROVAL
  return await acquireEngineerLock(rest.engineer_id, async () => {
    // Check if the rest day would conflict with an already assigned active job
    const availCheck = await checkEngineerAvailability({
      engineerIdOrName: rest.engineer_id,
      startDate: rest.rest_start_date,
      endDate: rest.rest_end_date,
      excludeChecklistId: rest.checklist_id,
    });

    if (!availCheck.available) {
      const c = availCheck.conflict;
      const conflictMsg = `Rest Day Conflict: Engineer ${rest.engineer_name} is already booked for ${c.checklist_number} from ${c.booking_start_date} to ${c.booking_end_date}. Coordinator must reassign or resolve the existing assignment first.`;
      const err = new Error(conflictMsg);
      err.statusCode = 409;
      err.conflict = c;
      throw err;
    }

    const nowIso = new Date().toISOString();
    rest.status = 'APPROVED';
    rest.coordinator_decision_notes = decisionNotes ? decisionNotes.trim() : null;
    rest.decided_by = user.id;
    rest.decided_at = nowIso;
    rest.updated_at = nowIso;

    try {
      await supabase
        .from('rest_day_requests')
        .update({
          status: 'APPROVED',
          coordinator_decision_notes: rest.coordinator_decision_notes,
          decided_by: user.id,
          decided_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', rest.id);
    } catch (e) {}

    inMemoryRestDays.set(rest.id, rest);
    saveStorage();

    // If linked to a checklist, flag travel booking for review
    if (rest.checklist_id) {
      try {
        await supabase
          .from('coordinator_bookings')
          .update({
            schedule_flagged_for_review: true,
            schedule_review_reason: `Approved rest day from ${rest.rest_start_date} to ${rest.rest_end_date}. Return travel / accommodation may need review.`,
            schedule_flagged_at: nowIso,
            updated_at: nowIso,
          })
          .eq('checklist_id', rest.checklist_id);
      } catch (e) {}
    }

    // Notify technician
    await createNotification({
      targetRole: 'TECHNICAL',
      targetUserId: rest.created_by,
      title: `Rest Day Approved: ${rest.engineer_name}`,
      message: `Rest period from ${rest.rest_start_date} to ${rest.rest_end_date} has been approved.${decisionNotes ? ' Note: ' + decisionNotes : ''}`,
      type: 'REST_APPROVED',
      checklistId: rest.checklist_id,
      checklistNumber: rest.checklist_number,
      metadata: {
        rest_id: rest.id,
        start_date: rest.rest_start_date,
        end_date: rest.rest_end_date,
      },
    });

    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'APPROVE_REST_DAY',
      target_table: 'rest_day_requests',
      target_id: rest.id,
      details: {
        engineer_id: rest.engineer_id,
        rest_start_date: rest.rest_start_date,
        rest_end_date: rest.rest_end_date,
        decision_notes: decisionNotes,
      },
    });

    return { success: true, rest_day: rest };
  });
}

/**
 * 3. Reject Rest Day (Strictly COORDINATOR or ADMIN)
 */
export async function rejectRestDay({ requestId, user, decisionNotes = '' }) {
  if (!user || !['COORDINATOR', 'ADMIN', 'SUPER_ADMIN'].includes(String(user.role).toUpperCase())) {
    const err = new Error('Permission Denied: Only authorized Coordinator or Admin can reject rest-day requests.');
    err.statusCode = 403;
    throw err;
  }

  let rest = inMemoryRestDays.get(requestId);
  if (!rest) {
    try {
      const { data } = await supabase.from('rest_day_requests').select('*').eq('id', requestId).single();
      if (data) rest = data;
    } catch (e) {}
  }

  if (!rest) {
    const err = new Error('Rest day request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (rest.status !== 'PENDING') {
    const err = new Error(`Cannot reject rest day request: current status is already ${rest.status}.`);
    err.statusCode = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  rest.status = 'REJECTED';
  rest.coordinator_decision_notes = decisionNotes ? decisionNotes.trim() : 'Rest day request declined by Coordinator';
  rest.decided_by = user.id;
  rest.decided_at = nowIso;
  rest.updated_at = nowIso;

  try {
    await supabase
      .from('rest_day_requests')
      .update({
        status: 'REJECTED',
        coordinator_decision_notes: rest.coordinator_decision_notes,
        decided_by: user.id,
        decided_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', rest.id);
  } catch (e) {}

  inMemoryRestDays.set(rest.id, rest);
  saveStorage();

  // Notify technician
  await createNotification({
    targetRole: 'TECHNICAL',
    targetUserId: rest.created_by,
    title: `Rest Day Request Declined: ${rest.engineer_name}`,
    message: `Rest day request from ${rest.rest_start_date} to ${rest.rest_end_date} was not approved.${decisionNotes ? ' Reason: ' + decisionNotes : ''}`,
    type: 'REST_REJECTED',
    checklistId: rest.checklist_id,
    checklistNumber: rest.checklist_number,
    metadata: {
      rest_id: rest.id,
      decision_notes: decisionNotes,
    },
  });

  return { success: true, rest_day: rest };
}

/**
 * 4. Cancel Rest Day
 */
export async function cancelRestDay({ requestId, user }) {
  let rest = inMemoryRestDays.get(requestId);
  if (!rest) {
    try {
      const { data } = await supabase.from('rest_day_requests').select('*').eq('id', requestId).single();
      if (data) rest = data;
    } catch (e) {}
  }

  if (!rest) {
    const err = new Error('Rest day request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (rest.status !== 'PENDING') {
    const err = new Error(`Cannot cancel rest day request with status ${rest.status}.`);
    err.statusCode = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  rest.status = 'CANCELLED';
  rest.updated_at = nowIso;

  try {
    await supabase.from('rest_day_requests').update({ status: 'CANCELLED', updated_at: nowIso }).eq('id', rest.id);
  } catch (e) {}

  inMemoryRestDays.set(rest.id, rest);
  saveStorage();
  return { success: true, rest_day: rest };
}

/**
 * 5. Query Rest Days
 */
export async function getRestDays({ status = null, engineerId = null, limit = 100 } = {}) {
  const list = [];
  const seenIds = new Set();

  try {
    let q = supabase.from('rest_day_requests').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status && status !== 'ALL') q = q.eq('status', status);
    if (engineerId) q = q.eq('engineer_id', engineerId);

    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      data.forEach((r) => {
        seenIds.add(r.id);
        list.push(r);
      });
    }
  } catch (err) {}

  inMemoryRestDays.forEach((r) => {
    if (seenIds.has(r.id)) return;
    const matchStatus = !status || status === 'ALL' || r.status === status;
    const matchEng = !engineerId || r.engineer_id === engineerId;
    if (matchStatus && matchEng) {
      list.push(r);
    }
  });

  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return list.slice(0, limit);
}

/**
 * 6. Get Approved Rest Days for an Engineer
 */
export async function getApprovedRestDaysForEngineer(engineerIdOrName) {
  const resolved = resolveEngineer(engineerIdOrName);
  const engId = resolved ? resolved.id : engineerIdOrName;
  const all = await getRestDays({ status: 'APPROVED', engineerId: engId, limit: 100 });
  return all;
}

/**
 * 7. Delete an individual rest day request
 */
export async function deleteRestDayById(id) {
  try {
    await supabase.from('rest_day_requests').delete().eq('id', id);
  } catch (err) {
    console.warn('Could not delete rest day from Supabase:', err.message);
  }

  const existed = inMemoryRestDays.has(id);
  if (existed) {
    inMemoryRestDays.delete(id);
    saveStorage();
  }
  return { success: true, id };
}

/**
 * 8. Bulk delete rest day requests
 */
export async function clearRestDays({ status = 'ALL', engineerId = null } = {}) {
  const all = await getRestDays({ status, engineerId, limit: 200 });
  let deletedCount = 0;

  for (const item of all) {
    try {
      await deleteRestDayById(item.id);
      deletedCount++;
    } catch { /* continue */ }
  }

  return { success: true, deletedCount };
}
