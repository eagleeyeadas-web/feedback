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
  calculateBookingEndDate,
  parseDurationDays,
  updateEngineerBookingEndDate,
} from './engineerBookingService.js';
import { inMemoryChecklistSchedules } from './installationService.js';
import { flagBookingForReview, handleInstallationDateChange } from './coordinatorBookingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/schedule_extensions_storage.json');

export const inMemoryExtensions = new Map();
export const inMemoryRevisions = new Map();

/**
 * Helper to get currently active pending extension request for a checklist
 */
export function getPendingExtensionForChecklist(checklistId) {
  if (!checklistId) return null;
  for (const ext of inMemoryExtensions.values()) {
    if (ext.checklist_id === checklistId && ext.status === 'PENDING') {
      return ext;
    }
  }
  return null;
}

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.extensions)) {
        data.extensions.forEach((ext) => inMemoryExtensions.set(ext.id, ext));
      }
      if (Array.isArray(data.revisions)) {
        data.revisions.forEach((rev) => inMemoryRevisions.set(rev.id, rev));
      }
    }
  } catch (err) {
    console.warn('Could not load schedule extensions fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      extensions: Array.from(inMemoryExtensions.values()),
      revisions: Array.from(inMemoryRevisions.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save schedule extensions fallback storage:', err.message);
  }
}

loadStorage();

/**
 * Permanently delete schedule extensions and revisions for a deleted checklist
 */
export function deleteScheduleExtensionsForChecklist(checklistId) {
  let changed = false;
  inMemoryExtensions.forEach((e, k) => {
    if (e.checklist_id === checklistId) {
      inMemoryExtensions.delete(k);
      changed = true;
    }
  });
  inMemoryRevisions.forEach((r, k) => {
    if (r.checklist_id === checklistId) {
      inMemoryRevisions.delete(k);
      changed = true;
    }
  });
  if (changed) {
    saveStorage();
  }
}

export function cleanupTestExtensionsForYear(year = '2028') {
  inMemoryExtensions.forEach((e, k) => {
    if (e.requested_completion_date?.startsWith(year) || e.original_dates?.arrival_date?.startsWith(year)) {
      inMemoryExtensions.delete(k);
    }
  });
  inMemoryRevisions.forEach((r, k) => {
    if (r.new_schedule?.completion_date?.startsWith(year) || r.previous_schedule?.arrival_date?.startsWith(year)) {
      inMemoryRevisions.delete(k);
    }
  });
  saveStorage();
}


/**
 * Fetch checklist helper
 */
async function getChecklist(checklistId) {
  try {
    const { data, error } = await supabase
      .from('installation_checklists')
      .select('*')
      .eq('id', checklistId)
      .single();
    if (!error && data) return data;
  } catch (err) {
    // Non-blocking
  }

  // Fallback to checking workflow storage or in-memory
  try {
    const wfPath = path.join(__dirname, '../data/workflow_storage.json');
    if (fs.existsSync(wfPath)) {
      const wf = JSON.parse(fs.readFileSync(wfPath, 'utf-8'));
      if (wf.checklists && wf.checklists[checklistId]) {
        return wf.checklists[checklistId];
      }
    }
  } catch (e) {}

  return null;
}

/**
 * 1. Request Schedule Extension (Technician action from Technical Workspace)
 */
export async function requestScheduleExtension({
  checklistId,
  user,
  requestedCompletionDate,
  requestedReturnTravelDate = null,
  additionalWorkingDays = null,
  restDayRequested = false,
  requestedRestDate = null,
  reason,
  notes = '',
}) {
  if (!checklistId) throw new Error('Checklist ID is required.');
  if (!requestedCompletionDate) throw new Error('Requested revised completion date is required.');
  if (!reason || !reason.trim()) throw new Error('A reason for the extension request is required.');

  const checklist = await getChecklist(checklistId);
  if (!checklist) {
    const err = new Error('Installation checklist not found.');
    err.statusCode = 404;
    throw err;
  }

  // Prevent duplicate PENDING request for the same checklist
  let existingPending = Array.from(inMemoryExtensions.values()).find(
    (e) => e.checklist_id === checklistId && e.status === 'PENDING'
  );
  if (!existingPending) {
    try {
      const { data } = await supabase
        .from('schedule_extension_requests')
        .select('*')
        .eq('checklist_id', checklistId)
        .eq('status', 'PENDING')
        .maybeSingle();
      if (data) existingPending = data;
    } catch (e) {}
  }
  if (existingPending) {
    const err = new Error(
      `An extension request is already pending review for ${checklist.checklist_number}. Please wait for HR review.`
    );
    err.statusCode = 409;
    throw err;
  }

  // Validate dates: requested completion date cannot be before original arrival date or current completion date
  const arrivalDate = checklist.current_expected_arrival_date || checklist.expected_arrival_date;
  const currentCompletionDate = checklist.current_booking_end_date || checklist.booking_end_date || arrivalDate;

  if (requestedCompletionDate < arrivalDate) {
    throw new Error(`Requested completion date (${requestedCompletionDate}) cannot be before arrival date (${arrivalDate}).`);
  }
  if (currentCompletionDate && requestedCompletionDate <= currentCompletionDate) {
    throw new Error(`Requested completion date (${requestedCompletionDate}) must be after current expected completion date (${currentCompletionDate}).`);
  }

  let days = parseInt(additionalWorkingDays, 10);
  if (isNaN(days) || days <= 0) {
    if (currentCompletionDate && requestedCompletionDate) {
      const diff = Math.round((new Date(requestedCompletionDate) - new Date(currentCompletionDate)) / (1000 * 60 * 60 * 24));
      days = Math.max(1, diff);
    } else {
      days = 1;
    }
  }

  const reqId = uuidv4();
  const extensionRecord = {
    id: reqId,
    checklist_id: checklistId,
    checklist_number: checklist.checklist_number,
    client_name: checklist.client_name,
    client_location: checklist.client_location || '',
    technician_user_id: user?.id || null,
    technician_name: user?.full_name || user?.email || checklist.service_engineer,
    engineer_name: checklist.service_engineer,
    engineer_id: checklist.service_engineer_id,
    current_completion_date: currentCompletionDate,
    original_dates: {
      arrival_date: checklist.original_expected_arrival_date || checklist.expected_arrival_date,
      arrival_time: checklist.original_expected_arrival_time || checklist.expected_arrival_time,
      duration: checklist.original_installation_duration || checklist.installation_duration,
      completion_date: checklist.original_booking_end_date || checklist.booking_end_date,
    },
    current_dates: {
      arrival_date: checklist.current_expected_arrival_date || checklist.expected_arrival_date,
      arrival_time: checklist.current_expected_arrival_time || checklist.expected_arrival_time,
      duration: checklist.current_installation_duration || checklist.installation_duration,
      completion_date: currentCompletionDate,
    },
    requested_completion_date: requestedCompletionDate,
    requested_return_travel_date: requestedReturnTravelDate || null,
    additional_working_days: days,
    rest_day_requested: Boolean(restDayRequested),
    requested_rest_date: requestedRestDate || null,
    reason: reason.trim(),
    notes: notes ? notes.trim() : null,
    status: 'PENDING',
    coordinator_decision_notes: null,
    decided_by: null,
    decided_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Try DB insert
  try {
    const { data: dbData, error } = await supabase
      .from('schedule_extension_requests')
      .insert([
        {
          id: reqId,
          checklist_id: checklistId,
          technician_user_id: user?.id,
          technician_name: extensionRecord.technician_name,
          requested_completion_date: requestedCompletionDate,
          requested_return_travel_date: requestedReturnTravelDate,
          additional_working_days: extensionRecord.additional_working_days,
          rest_day_requested: extensionRecord.rest_day_requested,
          requested_rest_date: requestedRestDate,
          reason: extensionRecord.reason,
          notes: extensionRecord.notes,
          status: 'PENDING',
        },
      ])
      .select()
      .single();

    if (!error && dbData) {
      extensionRecord.id = dbData.id;
    }
  } catch (err) {
    // Non-blocking fallback
  }

  inMemoryExtensions.set(extensionRecord.id, extensionRecord);
  saveStorage();

  // Flag coordinator booking accommodation status as Extension Pending
  try {
    await flagBookingForReview({
      checklistId,
      reason: `Extension requested to ${requestedCompletionDate} (${extensionRecord.additional_working_days} extra days). Pending Coordinator approval.`,
      accommodationAffected: true,
      accommodationStatus: 'Extension Pending',
    });
  } catch (e) {}

  // Create HR notification (Coordinator is NOT notified of pending extension requests)
  await createNotification({
    targetRole: 'HR',
    title: `Extension Request: ${checklist.checklist_number}`,
    message: `${extensionRecord.technician_name} requested extension to ${requestedCompletionDate} (${extensionRecord.additional_working_days} extra days). Reason: ${extensionRecord.reason}`,
    type: 'EXTENSION_REQUEST',
    checklistId,
    checklistNumber: checklist.checklist_number,
    metadata: {
      extension_id: extensionRecord.id,
      requested_completion_date: requestedCompletionDate,
      rest_day_requested: extensionRecord.rest_day_requested,
      requested_rest_date: requestedRestDate,
    },
  });

  await logAudit({
    actor_id: user?.id,
    actor_email: user?.email,
    actor_role: user?.role,
    action: 'REQUEST_SCHEDULE_EXTENSION',
    target_table: 'schedule_extension_requests',
    target_id: extensionRecord.id,
    details: {
      checklist_id: checklistId,
      checklist_number: checklist.checklist_number,
      requested_completion_date: requestedCompletionDate,
      additional_working_days: extensionRecord.additional_working_days,
      rest_day_requested: extensionRecord.rest_day_requested,
    },
  });

  return extensionRecord;
}

/**
 * 2. Approve Schedule Extension (Strictly HR or ADMIN)
 */
export async function approveScheduleExtension(arg1, arg2, arg3) {
  let extensionId;
  let user;
  let decisionNotes = '';

  if (typeof arg1 === 'object' && arg1 !== null && !arg2) {
    extensionId = arg1.extensionId || arg1.id;
    user = arg1.user;
    decisionNotes = arg1.decisionNotes || arg1.notes || '';
  } else {
    extensionId = arg1;
    user = arg2;
    decisionNotes = arg3 || '';
  }

  if (!user || !['HR', 'ADMIN', 'SUPER_ADMIN'].includes(String(user.role).toUpperCase())) {
    const err = new Error('Permission Denied: Only authorized HR or Admin can approve schedule extensions.');
    err.statusCode = 403;
    throw err;
  }

  let ext = inMemoryExtensions.get(extensionId);
  if (!ext) {
    try {
      const { data, error } = await supabase
        .from('schedule_extension_requests')
        .select('*')
        .eq('id', extensionId)
        .single();
      if (!error && data) ext = data;
    } catch (e) {}
  }

  if (!ext) {
    const err = new Error('Extension request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (ext.status !== 'PENDING') {
    const err = new Error(`Cannot approve extension request: current status is already ${ext.status}.`);
    err.statusCode = 400;
    throw err;
  }

  const checklist = await getChecklist(ext.checklist_id);
  if (!checklist) {
    const err = new Error('Associated installation checklist not found.');
    err.statusCode = 404;
    throw err;
  }

  const engineerName = checklist.service_engineer;
  const resolvedEng = resolveEngineer(engineerName);
  const engId = resolvedEng ? resolvedEng.id : checklist.service_engineer_id;

  // SERIALIZED ATOMIC APPROVAL: Lock on the engineer
  return await acquireEngineerLock(engId, async () => {
    // Re-verify status under mutex lock from both memory and DB to prevent concurrent decision race conditions
    const currentMemoryExt = inMemoryExtensions.get(extensionId);
    if (currentMemoryExt && currentMemoryExt.status !== 'PENDING') {
      const err = new Error(`Cannot approve extension request: current status is already ${currentMemoryExt.status}.`);
      err.statusCode = 400;
      throw err;
    }

    try {
      const { data: dbLatest } = await supabase
        .from('schedule_extension_requests')
        .select('status')
        .eq('id', extensionId)
        .single();
      if (dbLatest && dbLatest.status !== 'PENDING') {
        const err = new Error(`Cannot approve extension request: current status is already ${dbLatest.status}.`);
        err.statusCode = 400;
        throw err;
      }
    } catch (e) {}

    const currentExt = currentMemoryExt || ext;
    const startDate = checklist.current_expected_arrival_date || checklist.expected_arrival_date;
    const newEndDate = currentExt.requested_completion_date;

    // 1. Re-validate schedule conflicts against latest database state
    const availCheck = await checkEngineerAvailability({
      engineerIdOrName: engId,
      startDate,
      endDate: newEndDate,
      excludeChecklistId: ext.checklist_id,
    });

    if (!availCheck.available) {
      const c = availCheck.conflict;
      const conflictMsg = `Cannot Approve Extension: Engineer ${engineerName} has a conflicting commitment with ${c.checklist_number || 'another booking'} from ${c.booking_start_date} to ${c.booking_end_date}.`;
      const err = new Error(conflictMsg);
      err.statusCode = 409;
      err.conflict = c;
      throw err;
    }

    // 2. Calculate new duration
    const startObj = new Date(startDate);
    const endObj = new Date(newEndDate);
    const diffDays = Math.round((endObj - startObj) / (1000 * 60 * 60 * 24)) + 1;
    const newDurationStr = `${Math.max(1, diffDays)} Days`;
    const newRevisionNumber = (checklist.schedule_revision_number || 0) + 1;
    const nowIso = new Date().toISOString();

    const prevSchedule = {
      arrival_date: checklist.current_expected_arrival_date || checklist.expected_arrival_date,
      arrival_time: checklist.current_expected_arrival_time || checklist.expected_arrival_time,
      duration: checklist.current_installation_duration || checklist.installation_duration,
      completion_date: checklist.current_booking_end_date || checklist.booking_end_date,
      revision_number: checklist.schedule_revision_number || 0,
    };

    const newSchedule = {
      arrival_date: startDate,
      arrival_time: checklist.current_expected_arrival_time || checklist.expected_arrival_time,
      duration: newDurationStr,
      completion_date: newEndDate,
      revision_number: newRevisionNumber,
    };

    // 3. Atomically update installation_checklists (Original schedule preserved!)
    const updatePayload = {
      current_expected_arrival_date: startDate,
      current_booking_end_date: newEndDate,
      current_installation_duration: newDurationStr,
      booking_end_date: newEndDate, // Maintain legacy synchronization
      installation_duration: newDurationStr,
      extension_approved_end_date: newEndDate,
      extension_decision_at: nowIso,
      schedule_revision_number: newRevisionNumber,
      schedule_last_updated_at: nowIso,
      updated_at: nowIso,
    };

    // Preserve original dates if not yet set
    if (!checklist.original_expected_arrival_date) {
      updatePayload.original_expected_arrival_date = checklist.expected_arrival_date;
      updatePayload.original_expected_arrival_time = checklist.expected_arrival_time;
      updatePayload.original_installation_duration = checklist.installation_duration;
      updatePayload.original_booking_end_date = checklist.booking_end_date || checklist.expected_arrival_date;
    }

    try {
      await supabase.from('installation_checklists').update(updatePayload).eq('id', ext.checklist_id);
    } catch (e) {
      console.warn('DB checklist update warning during extension approval:', e.message);
    }

    inMemoryChecklistSchedules.set(ext.checklist_id, {
      original_expected_arrival_date: updatePayload.original_expected_arrival_date || checklist.original_expected_arrival_date || checklist.expected_arrival_date,
      original_expected_arrival_time: updatePayload.original_expected_arrival_time || checklist.original_expected_arrival_time || checklist.expected_arrival_time,
      original_installation_duration: updatePayload.original_installation_duration || checklist.original_installation_duration || checklist.installation_duration,
      original_booking_end_date: updatePayload.original_booking_end_date || checklist.original_booking_end_date || checklist.booking_end_date,
      current_expected_arrival_date: updatePayload.current_expected_arrival_date,
      current_expected_arrival_time: updatePayload.current_expected_arrival_time,
      current_installation_duration: updatePayload.current_installation_duration,
      current_booking_end_date: updatePayload.current_booking_end_date,
      extension_approved_end_date: newEndDate,
      extension_decision_at: nowIso,
      schedule_revision_number: updatePayload.schedule_revision_number,
      schedule_last_updated_at: updatePayload.schedule_last_updated_at,
    });

    // 4. Update engineer_bookings active date range
    await updateEngineerBookingEndDate({ checklistId: ext.checklist_id, newEndDate });

    // 5. If rest day was requested within the extension, create/approve the rest day record
    if (ext.rest_day_requested && ext.requested_rest_date) {
      try {
        const restRecord = {
          id: uuidv4(),
          engineer_id: engId,
          engineer_name: engineerName,
          checklist_id: ext.checklist_id,
          checklist_number: checklist.checklist_number,
          rest_start_date: ext.requested_rest_date,
          rest_end_date: ext.requested_rest_date,
          reason: `Post-installation rest day approved with extension for ${checklist.checklist_number}`,
          notes: decisionNotes || '',
          status: 'APPROVED',
          coordinator_decision_notes: 'Approved via extension workflow',
          decided_by: user.id,
          decided_at: nowIso,
          created_by: user.id,
          created_at: nowIso,
          updated_at: nowIso,
        };

        await supabase.from('rest_day_requests').insert([restRecord]);
      } catch (e) {
        // Fallback store
      }
    }

    // 6. Critical Rule 1: Automatically update affected room booking to Pending Review and preserve dates
    try {
      await handleInstallationDateChange({
        checklistId: ext.checklist_id,
        oldStartDate: prevSchedule.arrival_date,
        newStartDate: startDate,
        oldEndDate: prevSchedule.completion_date,
        newEndDate: newEndDate,
        reason: `Schedule extended to ${newEndDate} (${ext.additional_working_days} extra working days).`,
        user,
      });
      await flagBookingForReview({
        checklistId: ext.checklist_id,
        reason: `Schedule extended to ${newEndDate} (${ext.additional_working_days} extra working days). Return travel / hotel dates may need manual adjustment.`,
        returnTravelAffected: true,
        accommodationAffected: true,
        accommodationStatus: 'Pending Review',
      });
    } catch (e) {
      console.warn('Booking flag error during extension approval:', e.message);
    }

    // 7. Write schedule revision history entry
    const revId = uuidv4();
    const revisionRecord = {
      id: revId,
      checklist_id: ext.checklist_id,
      revision_number: newRevisionNumber,
      previous_schedule: prevSchedule,
      new_schedule: newSchedule,
      new_completion_date: newEndDate,
      action: 'APPROVED',
      reason: `Extension Request Approved: ${ext.reason}${decisionNotes ? ' | Note: ' + decisionNotes : ''}`,
      changed_by: user.id,
      changed_by_email: user.email,
      changed_by_role: user.role,
      related_extension_id: ext.id,
      created_at: nowIso,
    };

    try {
      await supabase.from('schedule_revision_history').insert([revisionRecord]);
    } catch (e) {}
    inMemoryRevisions.set(revId, revisionRecord);

    // 8. Update extension request status
    currentExt.status = 'APPROVED';
    currentExt.coordinator_decision_notes = decisionNotes ? decisionNotes.trim() : null;
    currentExt.decision_notes = decisionNotes ? decisionNotes.trim() : null;
    currentExt.decided_by = user.id;
    currentExt.reviewed_by = user.email || user.id;
    currentExt.reviewer = user.email || user.id;
    currentExt.decided_at = nowIso;
    currentExt.reviewed_at = nowIso;
    currentExt.updated_at = nowIso;

    try {
      await supabase
        .from('schedule_extension_requests')
        .update({
          status: 'APPROVED',
          coordinator_decision_notes: currentExt.coordinator_decision_notes,
          decided_by: user.id,
          decided_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', currentExt.id);
    } catch (e) {}

    inMemoryExtensions.set(currentExt.id, currentExt);
    saveStorage();

    // 9. Notify Coordinator that date has been extended and room/travel bookings may require attention
    await createNotification({
      targetRole: 'COORDINATOR',
      title: 'Date Extended — Review Room Booking and Travel Arrangements',
      message: 'HR has approved an extension for this installation. Please review accommodation checkout dates and travel arrangements, and update any bookings that require changes.',
      type: 'SCHEDULE_EXTENSION_APPROVED',
      checklistId: ext.checklist_id,
      checklistNumber: checklist.checklist_number,
      metadata: {
        extension_id: ext.id,
        technician: checklist.service_engineer,
        checklist_number: checklist.checklist_number,
        original_date: prevSchedule.completion_date,
        approved_date: newEndDate,
        action_url: `/coordinator?view=${ext.checklist_id}&action=manage_logistics`,
        booking_url: `/coordinator?view=${ext.checklist_id}&action=manage_logistics`,
      },
    });

    // 10. Notify technician of decision
    await createNotification({
      targetRole: 'TECHNICAL',
      targetUserId: ext.technician_user_id,
      title: `Extension Approved: ${checklist.checklist_number}`,
      message: `Your schedule extension for ${checklist.checklist_number} to ${newEndDate} was approved by HR.${decisionNotes ? ' Note: ' + decisionNotes : ''}`,
      type: 'EXTENSION_APPROVED',
      checklistId: ext.checklist_id,
      checklistNumber: checklist.checklist_number,
      metadata: {
        extension_id: ext.id,
        new_completion_date: newEndDate,
        decision_notes: decisionNotes,
      },
    });

    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'APPROVE_SCHEDULE_EXTENSION',
      target_table: 'schedule_extension_requests',
      target_id: ext.id,
      details: {
        checklist_id: ext.checklist_id,
        checklist_number: checklist.checklist_number,
        new_completion_date: newEndDate,
        decision_notes: decisionNotes,
      },
    });

    return {
      success: true,
      ...ext,
      extension: ext,
      schedule: newSchedule,
    };
  });
}

/**
 * 3. Reject Schedule Extension (Strictly HR or ADMIN)
 */
export async function rejectScheduleExtension(arg1, arg2, arg3) {
  let extensionId;
  let user;
  let decisionNotes = '';

  if (typeof arg1 === 'object' && arg1 !== null && !arg2) {
    extensionId = arg1.extensionId || arg1.id;
    user = arg1.user;
    decisionNotes = arg1.decisionNotes || arg1.notes || '';
  } else {
    extensionId = arg1;
    user = arg2;
    decisionNotes = arg3 || '';
  }

  if (!user || !['HR', 'ADMIN', 'SUPER_ADMIN'].includes(String(user.role).toUpperCase())) {
    const err = new Error('Permission Denied: Only authorized HR or Admin can reject schedule extensions.');
    err.statusCode = 403;
    throw err;
  }

  let ext = inMemoryExtensions.get(extensionId);
  if (!ext) {
    try {
      const { data } = await supabase
        .from('schedule_extension_requests')
        .select('*')
        .eq('id', extensionId)
        .single();
      if (data) ext = data;
    } catch (e) {}
  }

  if (!ext) {
    const err = new Error('Extension request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (ext.status !== 'PENDING') {
    const err = new Error(`Cannot reject extension request: current status is already ${ext.status}.`);
    err.statusCode = 400;
    throw err;
  }

  const checklist = await getChecklist(ext.checklist_id);
  const engineerName = checklist?.service_engineer || ext.engineer_name;
  const resolvedEng = resolveEngineer(engineerName);
  const engId = resolvedEng ? resolvedEng.id : (ext.engineer_id || checklist?.service_engineer_id || 'eng-lock');

  return await acquireEngineerLock(engId, async () => {
    // Re-verify status under mutex lock from both memory and DB to prevent concurrent decision race conditions
    const currentMemoryExt = inMemoryExtensions.get(extensionId);
    if (currentMemoryExt && currentMemoryExt.status !== 'PENDING') {
      const err = new Error(`Cannot reject extension request: current status is already ${currentMemoryExt.status}.`);
      err.statusCode = 400;
      throw err;
    }

    try {
      const { data: dbLatest } = await supabase
        .from('schedule_extension_requests')
        .select('status')
        .eq('id', extensionId)
        .single();
      if (dbLatest && dbLatest.status !== 'PENDING') {
        const err = new Error(`Cannot reject extension request: current status is already ${dbLatest.status}.`);
        err.statusCode = 400;
        throw err;
      }
    } catch (e) {}

    const currentExt = currentMemoryExt || ext;
    const nowIso = new Date().toISOString();

    // Official schedule remains completely unchanged!
    currentExt.status = 'REJECTED';
    currentExt.coordinator_decision_notes = decisionNotes ? decisionNotes.trim() : 'Availability date request declined by HR';
    currentExt.decision_notes = decisionNotes ? decisionNotes.trim() : null;
    currentExt.decided_by = user.id;
    currentExt.reviewed_by = user.email || user.id;
    currentExt.reviewer = user.email || user.id;
    currentExt.decided_at = nowIso;
    currentExt.reviewed_at = nowIso;
    currentExt.updated_at = nowIso;

    try {
      await supabase
        .from('schedule_extension_requests')
        .update({
          status: 'REJECTED',
          coordinator_decision_notes: currentExt.coordinator_decision_notes,
          decided_by: user.id,
          decided_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', currentExt.id);
    } catch (e) {}

    inMemoryExtensions.set(currentExt.id, currentExt);
    saveStorage();

    // Revert accommodation status and clear review flags on coordinator booking without changing official dates
    try {
      const { getBookingRecord, saveCoordinatorBooking } = await import('./coordinatorBookingService.js');
      const b = await getBookingRecord(ext.checklist_id);
      if (b && (b.accommodation_status === 'Extension Pending' || b.accommodation_status === 'Extension Required' || b.schedule_flagged_for_review)) {
        const prevStatusBeforeRequest = (b.accommodation_history && b.accommodation_history.length > 0) || (b.extra_nights > 0)
          ? 'Extended'
          : (b.hotel_booking_reference ? 'Confirmed' : (b.accommodation_required ? 'Pending' : 'Required'));

        await saveCoordinatorBooking({
          checklistId: ext.checklist_id,
          bookingData: {
            ...b,
            accommodation_status: prevStatusBeforeRequest,
            schedule_flagged_for_review: false,
            accommodation_dates_affected: false,
            return_travel_date_affected: false,
            coordinator_notes: b.coordinator_notes
              ? `${b.coordinator_notes} | Extension rejected: ${decisionNotes || 'declined'}`
              : `Extension rejected: ${decisionNotes || 'declined'}`,
          },
          user,
        });
      }
    } catch (bErr) {
      console.warn('Could not reset booking review on extension rejection:', bErr.message);
    }

    // Notify technician of rejection
    await createNotification({
      targetRole: 'TECHNICAL',
      targetUserId: ext.technician_user_id,
      title: `Availability Date Request Rejected: ${checklist?.checklist_number || 'Job'}`,
      message: `Your availability date extension request for ${checklist?.checklist_number || 'job'} was rejected.${decisionNotes ? ' Reason: ' + decisionNotes : ''}`,
      type: 'EXTENSION_REJECTED',
      checklistId: ext.checklist_id,
      checklistNumber: checklist?.checklist_number,
      metadata: {
        extension_id: ext.id,
        checklist_number: checklist?.checklist_number,
        decision_notes: decisionNotes,
      },
    });

    await logAudit({
      actor_id: user.id,
      actor_email: user.email,
      actor_role: user.role,
      action: 'REJECT_SCHEDULE_EXTENSION',
      target_table: 'schedule_extension_requests',
      target_id: ext.id,
      details: {
        checklist_id: ext.checklist_id,
        decision_notes: decisionNotes,
      },
    });

    return { success: true, ...ext, extension: ext };
  });
}

/**
 * 4. Cancel Schedule Extension (Technician or Coordinator)
 */
export async function cancelScheduleExtension({ extensionId, user }) {
  let ext = inMemoryExtensions.get(extensionId);
  if (!ext) {
    try {
      const { data } = await supabase
        .from('schedule_extension_requests')
        .select('*')
        .eq('id', extensionId)
        .single();
      if (data) ext = data;
    } catch (e) {}
  }

  if (!ext) {
    const err = new Error('Extension request not found.');
    err.statusCode = 404;
    throw err;
  }

  if (ext.status !== 'PENDING') {
    const err = new Error(`Cannot cancel extension request with status ${ext.status}.`);
    err.statusCode = 400;
    throw err;
  }

  const nowIso = new Date().toISOString();
  ext.status = 'CANCELLED';
  ext.updated_at = nowIso;

  try {
    await supabase
      .from('schedule_extension_requests')
      .update({ status: 'CANCELLED', updated_at: nowIso })
      .eq('id', ext.id);
  } catch (e) {}

  inMemoryExtensions.set(ext.id, ext);
  saveStorage();

  return { success: true, extension: ext };
}

/**
 * 5. Query Extension Requests (with filtering)
 */
export async function getExtensionRequests({ status = null, checklistId = null, limit = 100 } = {}) {
  const requests = [];
  const seenIds = new Set();

  try {
    let q = supabase.from('schedule_extension_requests').select('*').order('created_at', { ascending: false }).limit(limit);
    if (status && status !== 'ALL') q = q.eq('status', status);
    if (checklistId) q = q.eq('checklist_id', checklistId);

    const { data, error } = await q;
    if (!error && Array.isArray(data)) {
      data.forEach((r) => {
        seenIds.add(r.id);
        requests.push(r);
      });
    }
  } catch (err) {}

  inMemoryExtensions.forEach((r) => {
    if (seenIds.has(r.id)) return;
    const matchStatus = !status || status === 'ALL' || r.status === status;
    const matchChecklist = !checklistId || r.checklist_id === checklistId;
    if (matchStatus && matchChecklist) {
      requests.push(r);
    }
  });

  requests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return requests.slice(0, limit);
}

/**
 * 6. Get Schedule Revision History for a checklist
 */
export async function getScheduleRevisionHistory(checklistId) {
  const revisions = [];
  const seenIds = new Set();

  try {
    const { data, error } = await supabase
      .from('schedule_revision_history')
      .select('*')
      .eq('checklist_id', checklistId)
      .order('revision_number', { ascending: true });

    if (!error && Array.isArray(data)) {
      data.forEach((rev) => {
        seenIds.add(rev.id);
        revisions.push(rev);
      });
    }
  } catch (err) {}

  inMemoryRevisions.forEach((rev) => {
    if (seenIds.has(rev.id)) return;
    if (rev.checklist_id === checklistId) {
      revisions.push(rev);
    }
  });

  revisions.sort((a, b) => (a.revision_number || 0) - (b.revision_number || 0));
  return revisions;
}

/**
 * 7. Delete an individual schedule extension request
 */
export async function deleteScheduleExtensionById(id) {
  try {
    await supabase.from('schedule_extension_requests').delete().eq('id', id);
  } catch (err) {
    console.warn('Could not delete extension from Supabase:', err.message);
  }

  const existed = inMemoryExtensions.has(id);
  if (existed) {
    inMemoryExtensions.delete(id);
    saveStorage();
  }
  return { success: true, id };
}

/**
 * 8. Bulk delete schedule extension requests (pending or test)
 */
export async function clearScheduleExtensions({ status = 'ALL', checklistId = null } = {}) {
  const all = await getExtensionRequests({ status, checklistId, limit: 200 });
  let deletedCount = 0;

  for (const item of all) {
    try {
      await deleteScheduleExtensionById(item.id);
      deletedCount++;
    } catch { /* continue */ }
  }

  return { success: true, deletedCount };
}
