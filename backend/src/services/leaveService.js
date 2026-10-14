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
const STORAGE_FILE = path.join(__dirname, '../data/leave_requests_storage.json');

const inMemoryLeaves = new Map();

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.leaves)) {
        data.leaves.forEach((l) => inMemoryLeaves.set(l.id, l));
      }
    }
  } catch (err) {
    console.warn('Could not load leave requests fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      leaves: Array.from(inMemoryLeaves.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save leave requests fallback storage:', err.message);
  }
}

loadStorage();

export function cleanupTestLeavesForYear(year = '2028') {
  inMemoryLeaves.forEach((l, k) => {
    if (l.leave_start_date?.startsWith(year) || l.leave_end_date?.startsWith(year)) {
      inMemoryLeaves.delete(k);
    }
  });
  saveStorage();
}


/**
 * 1. Request Leave
 */
export async function requestLeave({
  engineerIdOrName,
  leaveStartDate,
  leaveEndDate = null,
  startDate = null,
  endDate = null,
  leaveType = 'Casual',
  reason,
  notes = '',
  user = null,
}) {
  const actualStartDate = leaveStartDate || startDate;
  const actualEndDate = leaveEndDate || endDate || actualStartDate;

  if (!engineerIdOrName) throw new Error('Service Engineer is required.');
  if (!actualStartDate) throw new Error('Leave start date is required.');
  if (!reason || !reason.trim()) throw new Error('A reason for the leave request is required.');

  if (actualEndDate < actualStartDate) {
    throw new Error(`Leave end date (${actualEndDate}) cannot be before start date (${actualStartDate}).`);
  }

  const resolved = resolveEngineer(engineerIdOrName);
  if (!resolved) {
    throw new Error(`Service Engineer "${engineerIdOrName}" is not recognized.`);
  }

  // Prevent duplicate pending requests for overlapping dates
  const existingPending = Array.from(inMemoryLeaves.values()).find(
    (l) =>
      l.status === 'PENDING' &&
      l.engineer_id === resolved.id &&
      isDateRangeOverlapping(leaveStartDate, finalEndDate, l.leave_start_date, l.leave_end_date)
  );

  if (existingPending) {
    const err = new Error(
      `A leave request for ${resolved.name} is already pending for overlapping dates (${existingPending.leave_start_date} to ${existingPending.leave_end_date}).`
    );
    err.statusCode = 409;
    throw err;
  }

  const reqId = uuidv4();
  const leaveRecord = {
    id: reqId,
    engineer_id: resolved.id,
    engineer_name: resolved.name,
    leave_start_date: actualStartDate,
    leave_end_date: actualEndDate,
    leave_type: leaveType || 'Casual',
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
      .from('leave_requests')
      .insert([
        {
          id: reqId,
          engineer_id: resolved.id,
          engineer_name: resolved.name,
          leave_start_date: actualStartDate,
          leave_end_date: actualEndDate,
          leave_type: leaveRecord.leave_type,
          reason: leaveRecord.reason,
          notes: leaveRecord.notes,
          status: 'PENDING',
          created_by: user?.id,
        },
      ])
      .select()
      .single();

    if (!error && dbData) {
      leaveRecord.id = dbData.id;
    }
  } catch (err) {}

  inMemoryLeaves.set(leaveRecord.id, leaveRecord);
  saveStorage();

  // Notify Coordinator
  await createNotification({
    targetRole: 'COORDINATOR',
    title: `Leave Request: ${resolved.name}`,
    message: `${resolved.name} requested leave (${leaveRecord.leave_type}) from ${actualStartDate} to ${actualEndDate}. Reason: ${leaveRecord.reason}`,
    type: 'LEAVE_REQUEST',
    metadata: {
      leave_id: leaveRecord.id,
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
    action: 'REQUEST_LEAVE',
    target_table: 'leave_requests',
    target_id: leaveRecord.id,
    details: {
      engineer_id: resolved.id,
      engineer_name: resolved.name,
      leave_start_date: actualStartDate,
      leave_end_date: actualEndDate,
    },
  });

  return leaveRecord;
}

/**
 * 2. Approve Leave (Strictly COORDINATOR or ADMIN)
 */
export async function approveLeave({ leaveId, user, decisionNotes = '' }) {
  if (!user || !['COORDINATOR', 'ADMIN', 'SUPER_ADMIN'].includes(String(user.role).toUpperCase())) {
    const err = new Error('Permission Denied: Only authorized Coordinator or Admin can approve leave requests.');
    err.statusCode = 403;
    throw err;
  }

  let leave = inMemoryLeaves.get(leaveId);
  if (!leave) {
    try {
      const { data } = await supabase.from('leave_requests').select('*').eq('id', leaveId).single();
      if (data) leave = data;
    } catch (e) {}
  }

  if (!leave) {
    const err = new Error('Leave request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (leave.status !== 'PENDING') {
    const err = new Error(`Cannot approve leave request: current status is already ${leave.status}.`);
    err.statusCode = 400;
    throw err;
  }

  // SERIALIZED ATOMIC APPROVAL
  return await acquireEngineerLock(leave.engineer_id, async () => {
    // Check if the leave would conflict with an already assigned active job
    const availCheck = await checkEngineerAvailability({
      engineerIdOrName: leave.engineer_id,
      startDate: leave.leave_start_date,
      endDate: leave.leave_end_date,
    });

    if (!availCheck.available) {
      const c = availCheck.conflict;
      const conflictMsg = `Leave Conflict: Engineer ${leave.engineer_name} is already booked for ${c.checklist_number} from ${c.booking_start_date} to ${c.booking_end_date}. Coordinator must reassign or resolve the existing assignment before approving leave.`;
      const err = new Error(conflictMsg);
      err.statusCode = 409;
      err.conflict = c;
      throw err;
    }

    const nowIso = new Date().toISOString();
    leave.status = 'APPROVED';
    leave.coordinator_decision_notes = decisionNotes ? decisionNotes.trim() : null;
    leave.decided_by = user.id;
    leave.decided_at = nowIso;
    leave.updated_at = nowIso;

    try {
      await supabase
        .from('leave_requests')
        .update({
          status: 'APPROVED',
          coordinator_decision_notes: leave.coordinator_decision_notes,
          decided_by: user.id,
          decided_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', leave.id);
    } catch (e) {}

    inMemoryLeaves.set(leave.id, leave);
    saveStorage();

    // Notify technician
    await createNotification({
      targetRole: 'TECHNICAL',
      targetUserId: leave.created_by,
      title: `Leave Approved: ${leave.engineer_name}`,
      message: `Your leave request from ${leave.leave_start_date} to ${leave.leave_end_date} has been approved.${decisionNotes ? ' Note: ' + decisionNotes : ''}`,
      type: 'LEAVE_APPROVED',
      metadata: {
        leave_id: leave.id,
        start_date: leave.leave_start_date,
        end_date: leave.leave_end_date,
      },
    });

    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'APPROVE_LEAVE',
      target_table: 'leave_requests',
      target_id: leave.id,
      details: {
        engineer_id: leave.engineer_id,
        leave_start_date: leave.leave_start_date,
        leave_end_date: leave.leave_end_date,
        decision_notes: decisionNotes,
      },
    });

    return { success: true, leave };
  });
}

/**
 * 3. Reject Leave (Strictly COORDINATOR or ADMIN)
 */
export async function rejectLeave({ leaveId, user, decisionNotes = '' }) {
  if (!user || !['COORDINATOR', 'ADMIN', 'SUPER_ADMIN'].includes(String(user.role).toUpperCase())) {
    const err = new Error('Permission Denied: Only authorized Coordinator or Admin can reject leave requests.');
    err.statusCode = 403;
    throw err;
  }

  let leave = inMemoryLeaves.get(leaveId);
  if (!leave) {
    try {
      const { data } = await supabase.from('leave_requests').select('*').eq('id', leaveId).single();
      if (data) leave = data;
    } catch (e) {}
  }

  if (!leave) {
    const err = new Error('Leave request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (leave.status !== 'PENDING') {
    const err = new Error(`Cannot reject leave request: current status is already ${leave.status}.`);
    err.statusCode = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  leave.status = 'REJECTED';
  leave.coordinator_decision_notes = decisionNotes ? decisionNotes.trim() : 'Leave request declined by Coordinator';
  leave.decided_by = user.id;
  leave.decided_at = nowIso;
  leave.updated_at = nowIso;

  try {
    await supabase
      .from('leave_requests')
      .update({
        status: 'REJECTED',
        coordinator_decision_notes: leave.coordinator_decision_notes,
        decided_by: user.id,
        decided_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', leave.id);
  } catch (e) {}

  inMemoryLeaves.set(leave.id, leave);
  saveStorage();

  // Notify technician
  await createNotification({
    targetRole: 'TECHNICAL',
    targetUserId: leave.created_by,
    title: `Leave Request Declined: ${leave.engineer_name}`,
    message: `Your leave request from ${leave.leave_start_date} to ${leave.leave_end_date} was not approved.${decisionNotes ? ' Reason: ' + decisionNotes : ''}`,
    type: 'LEAVE_REJECTED',
    metadata: {
      leave_id: leave.id,
      decision_notes: decisionNotes,
    },
  });

  return { success: true, leave };
}

/**
 * 4. Cancel Leave
 */
export async function cancelLeave({ leaveId, user }) {
  let leave = inMemoryLeaves.get(leaveId);
  if (!leave) {
    try {
      const { data } = await supabase.from('leave_requests').select('*').eq('id', leaveId).single();
      if (data) leave = data;
    } catch (e) {}
  }

  if (!leave) {
    const err = new Error('Leave request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (leave.status !== 'PENDING') {
    const err = new Error(`Cannot cancel leave request with status ${leave.status}.`);
    err.statusCode = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  leave.status = 'CANCELLED';
  leave.updated_at = nowIso;

  try {
    await supabase.from('leave_requests').update({ status: 'CANCELLED', updated_at: nowIso }).eq('id', leave.id);
  } catch (e) {}

  inMemoryLeaves.set(leave.id, leave);
  saveStorage();
  return { success: true, leave };
}

/**
 * 5. Query Leave Requests
 */
export async function getLeaveRequests({ status = null, engineerId = null, limit = 100 } = {}) {
  const list = [];
  const seenIds = new Set();

  try {
    let q = supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status && status !== 'ALL') q = q.eq('status', status);
    if (engineerId) q = q.eq('engineer_id', engineerId);

    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      data.forEach((l) => {
        seenIds.add(l.id);
        list.push(l);
      });
    }
  } catch (err) {}

  inMemoryLeaves.forEach((l) => {
    if (seenIds.has(l.id)) return;
    const matchStatus = !status || status === 'ALL' || l.status === status;
    const matchEng = !engineerId || l.engineer_id === engineerId;
    if (matchStatus && matchEng) {
      list.push(l);
    }
  });

  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return list.slice(0, limit);
}

/**
 * 6. Get Approved Leave for an Engineer
 */
export async function getApprovedLeaveForEngineer(engineerIdOrName) {
  const resolved = resolveEngineer(engineerIdOrName);
  const engId = resolved ? resolved.id : engineerIdOrName;
  const all = await getLeaveRequests({ status: 'APPROVED', engineerId: engId, limit: 100 });
  return all;
}
