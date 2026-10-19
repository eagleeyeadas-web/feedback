import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getTechnicianAvailabilityOverview,
  setTechnicianManualAvailability,
  reverseTechnicianManualAvailability,
  getAllOverrides,
} from '../services/hrAvailabilityService.js';
import {
  getExtensionRequests,
  approveScheduleExtension,
  rejectScheduleExtension,
} from '../services/scheduleExtensionService.js';
import {
  getAvailabilityCalendar,
  getEngineersAvailabilityForRange,
  getAllServiceEngineers,
} from '../services/engineerBookingService.js';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../services/appNotificationService.js';

const router = Router();

// Strict least-privilege role protection: ONLY HR and ADMIN can access HR routes
router.use(requireRole('HR', 'ADMIN', 'SUPER_ADMIN'));

/**
 * GET /api/admin/hr/availability
 * Fetch availability overview for the 4 service engineers (Mathi, Guna, Sakthivel, Kamalesh)
 * Includes calculated schedule status, active manual overrides, discrepancy warnings, and history.
 */
router.get('/availability', async (req, res) => {
  try {
    const referenceDatetime = req.query.date ? `${req.query.date}T00:00:00.000Z` : new Date().toISOString();
    const overview = await getTechnicianAvailabilityOverview(referenceDatetime);
    return res.json({ success: true, engineers: overview });
  } catch (err) {
    console.error('Error in GET /hr/availability:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to fetch technician availability overview' });
  }
});

/**
 * POST /api/admin/hr/availability/override
 * Set manual availability (Available or Unavailable) for one of the 4 service engineers
 */
router.post('/availability/override', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const {
      engineer_name,
      engineer_id,
      manual_status,
      reason,
      effective_start_datetime,
      effective_end_datetime,
      confirmed,
    } = req.body;

    const result = await setTechnicianManualAvailability({
      engineerIdOrName: engineer_id || engineer_name,
      manualStatus: manual_status,
      reason,
      effectiveStartDatetime: effective_start_datetime,
      effectiveEndDatetime: effective_end_datetime || null,
      confirmed: Boolean(confirmed),
      user,
    });

    return res.json(result);
  } catch (err) {
    console.error('Error in POST /hr/availability/override:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({
      error: err.message || 'Failed to set manual availability override',
      conflicts: err.conflicts || [],
    });
  }
});

/**
 * POST /api/admin/hr/availability/override/:id/reverse
 * Reverse an existing manual availability override
 */
router.post('/availability/override/:id/reverse', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const { reason } = req.body;

    const result = await reverseTechnicianManualAvailability({
      overrideId: req.params.id,
      reason,
      user,
    });

    return res.json(result);
  } catch (err) {
    console.error('Error in POST /hr/availability/override/:id/reverse:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to reverse availability override' });
  }
});

/**
 * GET /api/admin/hr/extensions
 * Fetch availability-date extension requests submitted by technicians
 */
router.get('/extensions', async (req, res) => {
  try {
    const requests = await getExtensionRequests(req.query);
    return res.json({ requests });
  } catch (err) {
    console.error('Error in GET /hr/extensions:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to fetch extension requests' });
  }
});

/**
 * POST /api/admin/hr/extensions/:id/approve
 * HR Approves technician availability-date extension request
 * Updates schedule, notifies Coordinator to review travel & room booking, updates calendar
 */
router.post('/extensions/:id/approve', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const { decision_notes } = req.body;

    const result = await approveScheduleExtension({
      extensionId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });

    return res.json(result);
  } catch (err) {
    console.error('Error in POST /hr/extensions/:id/approve:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({
      error: err.message || 'Failed to approve extension request',
      conflict: err.conflict || null,
    });
  }
});

/**
 * POST /api/admin/hr/extensions/:id/reject
 * HR Rejects technician availability-date extension request
 * Schedule remains unchanged; technician notified with recorded reason
 */
router.post('/extensions/:id/reject', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const { decision_notes } = req.body;

    const result = await rejectScheduleExtension({
      extensionId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });

    return res.json(result);
  } catch (err) {
    console.error('Error in POST /hr/extensions/:id/reject:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to reject extension request' });
  }
});

/**
 * GET /api/admin/hr/calendar
 * Fetch visual availability calendar data across all 4 service engineers
 */
router.get('/calendar', async (req, res) => {
  try {
    const calendar = await getAvailabilityCalendar(req.query);
    return res.json(calendar);
  } catch (err) {
    console.error('Error in GET /hr/calendar:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to fetch availability calendar' });
  }
});

/**
 * GET /api/admin/hr/overdue
 * Fetch overdue installation alerts and late completion records
 */
router.get('/overdue', async (req, res) => {
  try {
    const { getOverdueRecords } = await import('../services/overdueDetectionService.js');
    const records = await getOverdueRecords(req.query);
    return res.json({ success: true, records, total: records.length });
  } catch (err) {
    console.error('Error in GET /hr/overdue:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch overdue records' });
  }
});

/**
 * POST /api/admin/hr/overdue/check
 * Trigger on-demand automatic overdue detection check
 */
router.post('/overdue/check', async (req, res) => {
  try {
    const { checkAllOverdueChecklists } = await import('../services/overdueDetectionService.js');
    const result = await checkAllOverdueChecklists(req.body);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /hr/overdue/check:', err);
    return res.status(500).json({ error: err.message || 'Failed to execute overdue detection check' });
  }
});

export default router;
