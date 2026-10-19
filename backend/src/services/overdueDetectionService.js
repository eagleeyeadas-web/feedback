import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { createNotification } from './appNotificationService.js';
import { logAudit } from './auditService.js';
import { getChecklists, inMemoryChecklistSchedules } from './installationService.js';
import { inMemoryExtensions } from './scheduleExtensionService.js';
import { inMemoryBookings } from './coordinatorBookingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/overdue_alerts_storage.json');

// Authoritative Business Timezone for SafDrive Indian Operations
export const BUSINESS_TIMEZONE = 'Asia/Kolkata';

export const OVERDUE_CATEGORIES = {
  NO_EXTENSION: 'Overdue — Extension Not Requested',
  PENDING_EXTENSION: 'Overdue — Extension Approval Pending',
  REJECTED_EXTENSION: 'Overdue — Extension Rejected',
  LATE_COMPLETION: 'Late Completion Recorded',
};

export const inMemoryOverdueAlerts = new Map();

/**
 * Returns current date string (YYYY-MM-DD) in Asia/Kolkata
 */
export function getKolkataDateString(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(new Date(date));
  } catch (e) {
    return new Date(date).toISOString().split('T')[0];
  }
}

/**
 * Format timestamp in Asia/Kolkata for display
 */
export function formatKolkataDateTime(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: BUSINESS_TIMEZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: true,
    }).format(new Date(date));
  } catch (e) {
    return new Date(date).toISOString();
  }
}

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.alerts)) {
        data.alerts.forEach((alert) => inMemoryOverdueAlerts.set(alert.id, alert));
      }
    }
  } catch (err) {
    console.warn('Could not load overdue alerts fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      alerts: Array.from(inMemoryOverdueAlerts.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save overdue alerts fallback storage:', err.message);
  }
}

loadStorage();

/**
 * Evaluates whether a checklist is overdue or late completed
 */
export function evaluateChecklistOverdue(chk, options = {}) {
  const referenceDateStr = options.referenceDate || getKolkataDateString();

  const isCompleted = chk.installation_status === 'Completed' || Boolean(chk.actual_completion_datetime || chk.actual_completion_at);

  const schedStart = chk.original_expected_arrival_date || chk.expected_arrival_date || chk.scheduled_start_date || null;
  const schedEnd = chk.current_booking_end_date || chk.booking_end_date || chk.current_expected_arrival_date || chk.expected_arrival_date || chk.scheduled_end_date || schedStart;

  // Case 1: Work is completed
  if (isCompleted) {
    const actualComp = chk.actual_completion_datetime || chk.actual_completion_at;
    const actualCompDate = actualComp ? String(actualComp).split('T')[0] : null;

    // Check if actual completion exceeded scheduled end date without approved extension covering it
    if (actualCompDate && schedEnd && actualCompDate > schedEnd) {
      return {
        isOverdue: false,
        isLate: true,
        category: OVERDUE_CATEGORIES.LATE_COMPLETION,
        scheduledStartDate: schedStart,
        scheduledEndDate: schedEnd,
        actualCompletionAt: actualComp,
        postInstallationSubmittedAt: chk.post_installation_submitted_at || null,
        needsAlert: false, // Handled transactionally on form submission
      };
    }

    return {
      isOverdue: false,
      isLate: false,
      category: null,
      scheduledStartDate: schedStart,
      scheduledEndDate: schedEnd,
      actualCompletionAt: actualComp,
      postInstallationSubmittedAt: chk.post_installation_submitted_at || null,
      needsAlert: false,
    };
  }

  // Case 2: Incomplete work
  if (!schedEnd) {
    return { isOverdue: false, isLate: false, category: null };
  }

  // Scheduled end date has passed in Asia/Kolkata
  if (referenceDateStr > schedEnd) {
    // Check extension requests
    const checklistExtensions = Array.from(inMemoryExtensions.values()).filter(
      (e) => e.checklist_id === chk.id
    );

    const pendingExt = checklistExtensions.find((e) => e.status === 'PENDING');
    if (pendingExt) {
      return {
        isOverdue: true,
        isLate: false,
        category: OVERDUE_CATEGORIES.PENDING_EXTENSION,
        scheduledStartDate: schedStart,
        scheduledEndDate: schedEnd,
        pendingExtensionId: pendingExt.id,
        requestedCompletionDate: pendingExt.requested_completion_date,
        needsAlert: true,
      };
    }

    const rejectedExt = checklistExtensions.find((e) => e.status === 'REJECTED');
    if (rejectedExt) {
      return {
        isOverdue: true,
        isLate: false,
        category: OVERDUE_CATEGORIES.REJECTED_EXTENSION,
        scheduledStartDate: schedStart,
        scheduledEndDate: schedEnd,
        rejectedExtensionId: rejectedExt.id,
        needsAlert: true,
      };
    }

    return {
      isOverdue: true,
      isLate: false,
      category: OVERDUE_CATEGORIES.NO_EXTENSION,
      scheduledStartDate: schedStart,
      scheduledEndDate: schedEnd,
      needsAlert: true,
    };
  }

  return {
    isOverdue: false,
    isLate: false,
    category: null,
    scheduledStartDate: schedStart,
    scheduledEndDate: schedEnd,
  };
}

/**
 * Checks all active checklists and dispatches idempotent overdue alerts to HR
 */
export async function checkAllOverdueChecklists(options = {}) {
  const { checklists: rawChecklists = [] } = await getChecklists({ limit: 500 });
  const referenceDate = options.referenceDate || getKolkataDateString();

  let overdueCount = 0;
  let alertsGenerated = 0;
  const results = [];

  for (const chk of rawChecklists) {
    const evaluation = evaluateChecklistOverdue(chk, { referenceDate });

    if (evaluation.isOverdue) {
      overdueCount++;

      // Check if an alert for this checklist and category has already been sent
      const existingAlert = Array.from(inMemoryOverdueAlerts.values()).find(
        (a) => a.checklist_id === chk.id && a.category === evaluation.category && !a.resolved
      );

      if (!existingAlert && evaluation.needsAlert) {
        alertsGenerated++;

        const alertRecord = {
          id: uuidv4(),
          checklist_id: chk.id,
          checklist_number: chk.checklist_number,
          client_name: chk.client_name,
          client_location: chk.client_location || '',
          technician_name: chk.service_engineer || 'Assigned Technician',
          category: evaluation.category,
          scheduled_start_date: evaluation.scheduledStartDate,
          scheduled_end_date: evaluation.scheduledEndDate,
          actual_completion_at: null,
          post_installation_submitted_at: null,
          notification_sent: true,
          resolved: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Persist to DB if table exists (non-blocking fallback)
        try {
          await supabase.from('overdue_alert_records').insert([alertRecord]);
        } catch (e) {}

        inMemoryOverdueAlerts.set(alertRecord.id, alertRecord);
        saveStorage();

        // Scenario A: Send HR overdue alert
        await createNotification({
          targetRole: 'HR',
          title: `Installation Overdue — Extension Not Requested`,
          message: `The scheduled end date has passed, and the Post-Installation Form has not been successfully submitted. Please review the technician's status and determine whether follow-up is required. Checklist: ${chk.checklist_number}, Customer: ${chk.client_name}, Location: ${chk.client_location || 'N/A'}, Technician: ${chk.service_engineer || 'Assigned'}, Scheduled: ${evaluation.scheduledStartDate || 'N/A'} to ${evaluation.scheduledEndDate}`,
          type: 'OVERDUE_ALERT',
          checklistId: chk.id,
          checklistNumber: chk.checklist_number,
          metadata: {
            alert_id: alertRecord.id,
            category: evaluation.category,
            client_name: chk.client_name,
            client_location: chk.client_location,
            technician_name: chk.service_engineer,
            scheduled_start_date: evaluation.scheduledStartDate,
            scheduled_end_date: evaluation.scheduledEndDate,
            completion_status: chk.installation_status || 'In Progress',
            extension_status: evaluation.category,
            link: `/admin/workspaces/hr?tab=overdue&checklistId=${chk.id}`,
          },
        });

        // Also notify Coordinator of overdue assignment
        try {
          await createNotification({
            targetRole: 'COORDINATOR',
            title: `Job Overdue: ${chk.checklist_number}`,
            message: `Technician ${chk.service_engineer || 'assigned'} has exceeded scheduled end date (${evaluation.scheduledEndDate}) for ${chk.client_name} at ${chk.client_location || 'site'}.`,
            type: 'OVERDUE_LOGISTICS_ALERT',
            checklistId: chk.id,
            checklistNumber: chk.checklist_number,
            metadata: {
              category: evaluation.category,
              scheduled_end_date: evaluation.scheduledEndDate,
            },
          });
        } catch (e) {}

        await logAudit({
          action: 'OVERDUE_ALERT_GENERATED',
          target_table: 'installation_checklists',
          target_id: chk.id,
          details: {
            checklist_number: chk.checklist_number,
            category: evaluation.category,
            scheduled_end_date: evaluation.scheduledEndDate,
          },
        });
      }

      // Update in-memory schedule and booking status
      const compSched = inMemoryChecklistSchedules.get(chk.id) || {};
      compSched.overdue_category = evaluation.category;
      compSched.is_overdue = true;
      inMemoryChecklistSchedules.set(chk.id, compSched);

      const booking = inMemoryBookings.get(chk.id);
      if (booking) {
        booking.overdue_category = evaluation.category;
        inMemoryBookings.set(chk.id, booking);
      }
    } else {
      // If no longer overdue, resolve any active overdue alerts
      resolveOverdueAlertsForChecklist(chk.id, 'No longer overdue');
    }

    results.push({
      checklistId: chk.id,
      checklistNumber: chk.checklist_number,
      ...evaluation,
    });
  }

  return {
    overdueCount,
    processedCount: rawChecklists.length,
    alertsGenerated,
    results,
  };
}

/**
 * Scenario E: Record late completion without fabricating an extension request
 */
export async function recordLateCompletion({
  checklist,
  actualCompletionDatetime,
  submissionDatetime,
  user = {},
}) {
  if (!checklist) return null;

  const schedStart = checklist.original_expected_arrival_date || checklist.expected_arrival_date || checklist.scheduled_start_date || null;
  const schedEnd = checklist.current_booking_end_date || checklist.booking_end_date || checklist.current_expected_arrival_date || checklist.expected_arrival_date || schedStart;

  const actualDate = actualCompletionDatetime ? String(actualCompletionDatetime).split('T')[0] : null;
  const isLate = actualDate && schedEnd && actualDate > schedEnd;

  if (!isLate) {
    return null;
  }

  // Resolve prior overdue alerts for this checklist
  resolveOverdueAlertsForChecklist(checklist.id, 'Late completion recorded');

  const alertRecord = {
    id: uuidv4(),
    checklist_id: checklist.id,
    checklist_number: checklist.checklist_number,
    client_name: checklist.client_name,
    client_location: checklist.client_location || '',
    technician_name: user?.full_name || user?.email || checklist.service_engineer,
    category: OVERDUE_CATEGORIES.LATE_COMPLETION,
    scheduled_start_date: schedStart,
    scheduled_end_date: schedEnd,
    actual_completion_at: actualCompletionDatetime,
    post_installation_submitted_at: submissionDatetime,
    notification_sent: true,
    resolved: true,
    resolved_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await supabase.from('overdue_alert_records').insert([alertRecord]);
  } catch (e) {}

  inMemoryOverdueAlerts.set(alertRecord.id, alertRecord);
  saveStorage();

  // Send Scenario E HR Notification
  await createNotification({
    targetRole: 'HR',
    title: 'Late Completion Recorded',
    message: `The Post-Installation Form was submitted after the scheduled end date. The original schedule and overdue history have been preserved. Review the record if follow-up is required. Checklist: ${checklist.checklist_number}, Customer: ${checklist.client_name}, Technician: ${alertRecord.technician_name}, Scheduled: ${schedEnd}, Completed: ${formatKolkataDateTime(actualCompletionDatetime)}, Submitted: ${formatKolkataDateTime(submissionDatetime)}`,
    type: 'LATE_COMPLETION_ALERT',
    checklistId: checklist.id,
    checklistNumber: checklist.checklist_number,
    metadata: {
      alert_id: alertRecord.id,
      category: OVERDUE_CATEGORIES.LATE_COMPLETION,
      client_name: checklist.client_name,
      client_location: checklist.client_location,
      technician_name: alertRecord.technician_name,
      scheduled_start_date: schedStart,
      scheduled_end_date: schedEnd,
      actual_completion_at: actualCompletionDatetime,
      post_installation_submitted_at: submissionDatetime,
      link: `/admin/workspaces/hr?tab=overdue&checklistId=${checklist.id}`,
    },
  });

  await logAudit({
    actor_id: user.id || null,
    actor_email: user.email || null,
    actor_role: user.role || 'TECHNICAL',
    action: 'LATE_COMPLETION_RECORDED',
    target_table: 'installation_checklists',
    target_id: checklist.id,
    details: {
      checklist_number: checklist.checklist_number,
      scheduled_end_date: schedEnd,
      actual_completion_at: actualCompletionDatetime,
      post_installation_submitted_at: submissionDatetime,
    },
  });

  return alertRecord;
}

/**
 * Resolves active overdue alerts when a job is completed or extension is approved
 */
export function resolveOverdueAlertsForChecklist(checklistId, reason = 'Resolved') {
  let changed = false;
  inMemoryOverdueAlerts.forEach((alert) => {
    if (alert.checklist_id === checklistId && !alert.resolved) {
      alert.resolved = true;
      alert.resolved_at = new Date().toISOString();
      alert.resolution_reason = reason;
      changed = true;
    }
  });

  if (changed) {
    saveStorage();
  }
}

/**
 * Fetch all overdue and late completion records for HR workspace
 */
export async function getOverdueRecords(filters = {}) {
  const { category, resolved } = filters;
  let records = Array.from(inMemoryOverdueAlerts.values());

  if (category) {
    records = records.filter((r) => r.category === category);
  }
  if (resolved !== undefined) {
    const isRes = resolved === 'true' || resolved === true;
    records = records.filter((r) => r.resolved === isRes);
  }

  records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return records;
}

/**
 * Background scheduler running 24/7 independently of browser or user sessions
 */
let schedulerInterval = null;
export function startOverdueDetectionScheduler(intervalMs = 5 * 60 * 1000) {
  if (schedulerInterval) return;

  // Run initial check after 10 seconds of startup
  setTimeout(() => {
    checkAllOverdueChecklists().catch((err) =>
      console.warn('Initial overdue detection check failed:', err.message)
    );
  }, 10000);

  schedulerInterval = setInterval(() => {
    checkAllOverdueChecklists().catch((err) =>
      console.warn('Scheduled overdue detection check failed:', err.message)
    );
  }, intervalMs);

  // Unref to avoid blocking process termination in test environments
  if (schedulerInterval.unref) schedulerInterval.unref();
  console.log(`[OVERDUE_DETECTOR] Automatic 24/7 overdue detection scheduler initialized (interval: ${intervalMs / 1000}s)`);
}

export function stopOverdueDetectionScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
