import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import supabase from './supabase.js';
import { logAudit } from './auditService.js';
import {
  SERVICE_ENGINEER_OPTIONS,
  MAIN_SERVICE_ENGINEERS,
  resolveEngineer,
  getEngineerCommitments,
  calculateEarliestAvailabilityDate,
} from './engineerBookingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_FILE = path.join(__dirname, '../data/hr_availability_storage.json');

// In-memory fallback map: key = overrideId, value = override object
export const inMemoryOverrides = new Map();

function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.overrides)) {
        data.overrides.forEach((o) => inMemoryOverrides.set(o.id, o));
      }
    }
  } catch (err) {
    console.warn('Could not load HR availability fallback storage:', err.message);
  }
}

function saveStorage() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = {
      overrides: Array.from(inMemoryOverrides.values()),
      updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Could not save HR availability fallback storage:', err.message);
  }
}

loadStorage();

/**
 * Validate that an engineer belongs strictly to the 4 authorized main service engineers:
 * Mathi, Guna, Sakthivel, Kamalesh
 */
export function validateAuthorizedServiceEngineer(engineerIdOrName) {
  const resolved = resolveEngineer(engineerIdOrName);
  if (!resolved || !SERVICE_ENGINEER_OPTIONS.includes(resolved.name)) {
    const err = new Error(
      `HR Availability Management is restricted strictly to the four authorized service engineers: ${SERVICE_ENGINEER_OPTIONS.join(', ')}.`
    );
    err.statusCode = 400;
    throw err;
  }
  return resolved;
}

/**
 * Check if a date string falls within a date/datetime range
 */
function isDateWithinRange(targetDateStr, startDatetime, endDatetime) {
  if (!targetDateStr) return false;
  const target = targetDateStr.split('T')[0];
  const start = startDatetime.split('T')[0];
  if (target < start) return false;
  if (endDatetime) {
    const end = endDatetime.split('T')[0];
    if (target > end) return false;
  }
  return true;
}

/**
 * Check if two datetime ranges overlap
 */
export function isRangeOverlapping(start1, end1, start2, end2) {
  const s1 = new Date(start1).getTime();
  const e1 = end1 ? new Date(end1).getTime() : Infinity;
  const s2 = new Date(start2).getTime();
  const e2 = end2 ? new Date(end2).getTime() : Infinity;
  return s1 <= e2 && s2 <= e1;
}

/**
 * Helper to fetch all overrides from DB merged with fallback memory
 */
export async function getAllOverrides() {
  try {
    const { data, error } = await supabase
      .from('technician_availability_overrides')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      data.forEach((o) => inMemoryOverrides.set(o.id, o));
    }
  } catch (err) {
    // Schema or connection fallback
  }

  return Array.from(inMemoryOverrides.values());
}

/**
 * Get the currently active override for an engineer at a given timestamp/date
 */
export async function getActiveOverrideForEngineer(engineerIdOrName, referenceDatetime = new Date().toISOString()) {
  const resolved = validateAuthorizedServiceEngineer(engineerIdOrName);
  const all = await getAllOverrides();

  const refTime = new Date(referenceDatetime).getTime();

  // Find most recent active override that encompasses the reference time
  const matches = all.filter((o) => {
    if (!o.is_active) return false;
    const isMatchingEng = o.engineer_id === resolved.id || o.engineer_name.toLowerCase() === resolved.name.toLowerCase();
    if (!isMatchingEng) return false;

    const start = new Date(o.effective_start_datetime).getTime();
    const end = o.effective_end_datetime ? new Date(o.effective_end_datetime).getTime() : Infinity;

    // Check expiry
    if (end < refTime) {
      o.is_active = false; // Expired
      return false;
    }

    return refTime >= start && refTime <= end;
  });

  if (matches.length === 0) return null;
  // Sort descending by created_at to return latest override
  matches.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return matches[0];
}

/**
 * Check hard conflicts for an engineer in a datetime window
 * (Active Jobs, Approved Leaves, Approved Rest Days, Travel)
 */
export async function getHardConflictsForRange(engineerIdOrName, startDatetime, endDatetime = null) {
  const resolved = validateAuthorizedServiceEngineer(engineerIdOrName);
  const commitments = await getEngineerCommitments(resolved.id);

  const startDateStr = startDatetime.split('T')[0];
  const endDateStr = endDatetime ? endDatetime.split('T')[0] : '2099-12-31';

  const conflicts = commitments.filter((c) => {
    // Only active hard commitments
    if (c.type === 'JOB') {
      if (c.status === 'CANCELLED' || c.status === 'RELEASED') return false;
      const compDate = (c.actual_completion_datetime || '').split('T')[0];
      if (compDate && startDateStr > compDate) return false;
      if (c.is_overdue) return true;
    }

    const cStart = c.effective_start_date || c.start_date;
    const cEnd = c.effective_end_date || c.end_date;
    if (!cStart || !cEnd || cEnd < cStart) return false;

    return cStart <= endDateStr && cStart <= cEnd && cEnd >= startDateStr;
  });

  return conflicts;
}

/**
 * 1. Get Technician Availability Overview for the 4 Engineers
 * Combines calculated schedule status, active manual overrides, hard conflict checks, and history.
 */
export async function getTechnicianAvailabilityOverview(referenceDatetime = new Date().toISOString()) {
  const todayStr = referenceDatetime.split('T')[0];
  const allOverrides = await getAllOverrides();

  const overview = await Promise.all(
    MAIN_SERVICE_ENGINEERS.map(async (eng) => {
      // 1. Fetch commitments and calculate schedule status
      const commitments = await getEngineerCommitments(eng.id);

      // Determine today's calculated schedule status
      let calculatedStatus = 'AVAILABLE';
      let currentCommitment = null;

      const activeToday = commitments.filter((c) => {
        if (c.type === 'JOB' && (c.status === 'COMPLETED' || c.status === 'SITE WORK COMPLETED')) {
          const compDate = (c.actual_completion_datetime || '').split('T')[0];
          if (compDate && todayStr > compDate) return false;
        }
        if (c.type === 'JOB' && c.is_overdue) {
          return todayStr >= c.start_date;
        }
        const start = c.effective_start_date || c.start_date;
        const end = c.effective_end_date || c.end_date;
        return start <= todayStr && end >= todayStr;
      });

      if (activeToday.length > 0) {
        currentCommitment = activeToday[0];
        if (currentCommitment.type === 'LEAVE') calculatedStatus = 'LEAVE';
        else if (currentCommitment.type === 'REST_DAY') calculatedStatus = 'REST';
        else if (currentCommitment.type === 'TRAVEL') calculatedStatus = 'TRAVEL';
        else if (currentCommitment.type === 'JOB') {
          if (currentCommitment.is_overdue) calculatedStatus = 'OVERDUE';
          else if (currentCommitment.status === 'IN_PROGRESS') calculatedStatus = 'IN_PROGRESS';
          else calculatedStatus = 'ASSIGNED';
        }
      }

      // 2. Fetch current active manual override
      const activeOverride = await getActiveOverrideForEngineer(eng.id, referenceDatetime);

      // 3. Check for hard conflicts if an override exists or is being evaluated
      let hasDiscrepancy = false;
      let discrepancyWarning = null;
      let effectiveOperationalStatus = calculatedStatus;
      let overrideBlockedByConflict = false;
      let hardConflicts = [];

      if (activeOverride) {
        hardConflicts = await getHardConflictsForRange(
          eng.id,
          activeOverride.effective_start_datetime,
          activeOverride.effective_end_datetime
        );

        if (activeOverride.manual_status === 'Unavailable' || activeOverride.manual_status === 'Not Available') {
          effectiveOperationalStatus = 'UNAVAILABLE';
          if (calculatedStatus === 'AVAILABLE') {
            hasDiscrepancy = true;
            discrepancyWarning = `Technician has no scheduled jobs today, but is manually set to Not Available by HR: "${activeOverride.reason}".`;
          }
        } else if (activeOverride.manual_status === 'Rest Day') {
          effectiveOperationalStatus = 'REST';
          if (calculatedStatus === 'AVAILABLE') {
            hasDiscrepancy = true;
            discrepancyWarning = `Technician has no scheduled jobs today, but is manually set to Rest Day by HR: "${activeOverride.reason}".`;
          }
        } else if (activeOverride.manual_status === 'On Leave') {
          effectiveOperationalStatus = 'LEAVE';
          if (calculatedStatus === 'AVAILABLE') {
            hasDiscrepancy = true;
            discrepancyWarning = `Technician has no scheduled jobs today, but is manually set to On Leave by HR: "${activeOverride.reason}".`;
          }
        } else if (activeOverride.manual_status === 'Available') {
          // Rule: If HR sets technician to Available while an active job, approved leave/rest day,
          // travel constraint, or another hard conflict exists, PREVENT the override from making the
          // technician schedulable and clearly explain the conflict.
          if (hardConflicts.length > 0) {
            overrideBlockedByConflict = true;
            effectiveOperationalStatus = calculatedStatus; // Hard schedule PREVAILS
            hasDiscrepancy = true;
            const conflictLabels = hardConflicts
              .map((c) => (c.checklist_number ? `Job #${c.checklist_number}` : c.type))
              .join(', ');
            discrepancyWarning = `Manual override is set to "Available", but technician has active commitments (${conflictLabels}). Manual status cannot silently erase or override active assignments.`;
          } else {
            effectiveOperationalStatus = 'AVAILABLE';
            if (calculatedStatus !== 'AVAILABLE') {
              hasDiscrepancy = true;
              discrepancyWarning = `Calculated status is ${calculatedStatus}, but active manual override is Available.`;
            }
          }
        }
      }

      // 4. Fetch override history for this technician
      const history = allOverrides
        .filter((o) => o.engineer_id === eng.id || o.engineer_name.toLowerCase() === eng.name.toLowerCase())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return {
        id: eng.id,
        name: eng.name,
        role: eng.role,
        phone: eng.phone,
        email: eng.email,
        calculated_status: calculatedStatus,
        manual_status: activeOverride ? activeOverride.manual_status : 'None',
        effective_operational_status: effectiveOperationalStatus,
        active_override: activeOverride || null,
        current_commitment: currentCommitment,
        has_discrepancy: hasDiscrepancy,
        discrepancy_warning: discrepancyWarning,
        override_blocked_by_conflict: overrideBlockedByConflict,
        hard_conflicts_count: hardConflicts.length,
        hard_conflicts: hardConflicts,
        history,
      };
    })
  );

  return overview;
}

/**
 * 2. Set Technician Manual Availability Override
 * Supports statuses: 'Available', 'Not Available', 'Rest Day', 'On Leave'
 * Accepts single date (date/selected_date) or start/end datetime range.
 * Validates hard conflicts: cannot override active jobs without explicit authorized resolution.
 */
export async function setTechnicianManualAvailability(params) {
  const engineerIdOrName = params.engineerIdOrName || params.engineer_name || params.engineer_id || params.engineer;
  const rawStatus = params.manualStatus || params.manual_status || params.status;
  const reason = params.reason || params.notes || '';
  const date = params.date || params.selected_date;
  const effectiveStartDatetime = params.effectiveStartDatetime || params.effective_start_datetime || (date ? `${String(date).split('T')[0]}T00:00:00.000Z` : null);
  const effectiveEndDatetime = params.effectiveEndDatetime || params.effective_end_datetime || (date ? `${String(date).split('T')[0]}T23:59:59.999Z` : null);
  const confirmed = params.confirmed ?? params.confirmation ?? true;
  const user = params.user || {};

  const resolved = validateAuthorizedServiceEngineer(engineerIdOrName);

  const normalizedStatus = (rawStatus === 'Unavailable' || rawStatus === 'Not Available')
    ? 'Not Available'
    : rawStatus;

  const ALLOWED_STATUSES = ['Available', 'Not Available', 'Rest Day', 'On Leave'];
  if (!normalizedStatus || !ALLOWED_STATUSES.includes(normalizedStatus)) {
    const err = new Error(`Manual availability status must be one of: ${ALLOWED_STATUSES.join(', ')}.`);
    err.statusCode = 400;
    throw err;
  }

  const effectiveReason = (reason && String(reason).trim())
    ? String(reason).trim()
    : `Availability set to ${normalizedStatus} by HR`;

  if (!effectiveStartDatetime) {
    const err = new Error('Effective date is required.');
    err.statusCode = 400;
    throw err;
  }

  const startIso = new Date(effectiveStartDatetime).toISOString();
  let endIso = null;
  if (effectiveEndDatetime) {
    endIso = new Date(effectiveEndDatetime).toISOString();
    if (new Date(endIso).getTime() < new Date(startIso).getTime()) {
      const err = new Error('Effective end date/time cannot be before effective start date/time.');
      err.statusCode = 400;
      throw err;
    }
  }

  // Check hard conflicts
  const hardConflicts = await getHardConflictsForRange(resolved.id, startIso, endIso);

  let overrideBlockedByConflict = false;
  let warningMessage = null;

  if (normalizedStatus === 'Available' && hardConflicts.length > 0) {
    overrideBlockedByConflict = true;
    const conflictSummary = hardConflicts
      .map((c) => (c.checklist_number ? `Job #${c.checklist_number} (${c.client_name || 'Client'})` : c.type))
      .join(', ');

    warningMessage = `Technician has existing active commitments (${conflictSummary}) in this period. Setting manual availability to "Available" will NOT make the technician schedulable or erase active commitments.`;
  }

  // Deactivate existing active overrides for this engineer that overlap with the new date range
  const allOverrides = await getAllOverrides();
  const newStartStr = startIso.split('T')[0];
  const newEndStr = endIso ? endIso.split('T')[0] : (newStartStr || '2099-12-31');

  allOverrides.forEach((o) => {
    if (
      o.is_active &&
      (o.engineer_id === resolved.id || o.engineer_name.toLowerCase() === resolved.name.toLowerCase())
    ) {
      const oStartStr = o.effective_start_datetime ? o.effective_start_datetime.split('T')[0] : '';
      const oEndStr = o.effective_end_datetime ? o.effective_end_datetime.split('T')[0] : (oStartStr || '2099-12-31');
      if (newStartStr <= oEndStr && newEndStr >= oStartStr) {
        o.is_active = false;
        o.updated_at = new Date().toISOString();
      }
    }
  });

  const nowIso = new Date().toISOString();
  const overrideId = uuidv4();

  const record = {
    id: overrideId,
    engineer_id: resolved.id,
    engineer_name: resolved.name,
    manual_status: normalizedStatus,
    reason: effectiveReason,
    effective_start_datetime: startIso,
    effective_end_datetime: endIso,
    is_active: true,
    created_by: user.id || null,
    created_by_email: user.email || 'hr@gmail.com',
    created_by_role: user.role || 'HR',
    reversal_reason: null,
    reversed_at: null,
    reversed_by: null,
    reversed_by_email: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // Attempt DB persist
  try {
    await supabase.from('technician_availability_overrides').insert([record]);
  } catch (err) {
    console.warn('DB insert technician_availability_overrides exception:', err.message);
  }

  inMemoryOverrides.set(overrideId, record);
  saveStorage();

  await logAudit({
    actor_id: user.id,
    actor_email: user.email || 'hr@gmail.com',
    actor_role: user.role || 'HR',
    action: 'SET_TECHNICIAN_MANUAL_AVAILABILITY',
    target_table: 'technician_availability_overrides',
    target_id: overrideId,
    details: {
      engineer_name: resolved.name,
      manual_status: manualStatus,
      reason: record.reason,
      start: startIso,
      end: endIso,
      override_blocked_by_conflict: overrideBlockedByConflict,
      hard_conflicts_count: hardConflicts.length,
    },
  });

  return {
    success: true,
    override: record,
    ...record,
    schedulable: manualStatus === 'Available' && !overrideBlockedByConflict,
    is_schedulable: manualStatus === 'Available' && !overrideBlockedByConflict,
    override_blocked_by_conflict: overrideBlockedByConflict,
    hard_conflicts: hardConflicts,
    active_conflicts: hardConflicts,
    warning: warningMessage,
  };
}

/**
 * 3. Reverse an existing manual availability override
 */
export async function reverseTechnicianManualAvailability(overrideIdOrObj, reasonArg = '', userArg = {}) {
  let overrideId;
  let reason = '';
  let user = {};

  if (typeof overrideIdOrObj === 'object' && overrideIdOrObj !== null) {
    overrideId = overrideIdOrObj.overrideId || overrideIdOrObj.override_id || overrideIdOrObj.id;
    reason = overrideIdOrObj.reason || '';
    user = overrideIdOrObj.user || {};
  } else {
    overrideId = overrideIdOrObj;
    reason = reasonArg;
    user = userArg;
  }

  if (!overrideId) {
    const err = new Error('Override ID is required to reverse an availability override.');
    err.statusCode = 400;
    throw err;
  }

  const all = await getAllOverrides();
  const override = all.find((o) => o.id === overrideId) || inMemoryOverrides.get(overrideId);

  if (!override) {
    const err = new Error('Availability override not found.');
    err.statusCode = 404;
    throw err;
  }

  const nowIso = new Date().toISOString();
  override.is_active = false;
  override.reversal_reason = reason ? String(reason).trim() : 'Reversed by HR';
  override.reversed_at = nowIso;
  override.reversed_by = user.id || null;
  override.reversed_by_email = user.email || 'hr@gmail.com';
  override.updated_at = nowIso;

  try {
    await supabase
      .from('technician_availability_overrides')
      .update({
        is_active: false,
        reversal_reason: override.reversal_reason,
        reversed_at: nowIso,
        reversed_by: user.id || null,
        reversed_by_email: override.reversed_by_email,
        updated_at: nowIso,
      })
      .eq('id', overrideId);
  } catch (err) {
    console.warn('DB update technician_availability_overrides exception:', err.message);
  }

  inMemoryOverrides.set(overrideId, override);
  saveStorage();

  await logAudit({
    actor_id: user.id,
    actor_email: user.email || 'hr@gmail.com',
    actor_role: user.role || 'HR',
    action: 'REVERSE_TECHNICIAN_MANUAL_AVAILABILITY',
    target_table: 'technician_availability_overrides',
    target_id: overrideId,
    details: {
      engineer_name: override.engineer_name,
      reversal_reason: override.reversal_reason,
    },
  });

  return {
    success: true,
    override,
    ...override,
    reversal_reason: override.reversal_reason,
    reversed_by: override.reversed_by_email,
    message: 'Manual override reversed. Schedule and availability recalculated from actual constraints.',
  };
}
