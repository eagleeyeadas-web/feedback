import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getCoordinatorChecklists,
  getBookingDetails,
  saveCoordinatorBooking,
  getBookingAuditHistory,
} from '../services/coordinatorBookingService.js';

const router = Router();

// Strict least-privilege access: ONLY COORDINATOR and ADMIN can access Coordinator workspace APIs
router.use(requireRole('COORDINATOR', 'ADMIN'));

/**
 * GET /api/admin/coordinator/bookings
 * Fetch checklists merged with their coordinator booking details.
 * Supports tabs ('pending', 'completed'), search, engineer filter, location filter, date filter.
 */
router.get('/bookings', async (req, res) => {
  try {
    const result = await getCoordinatorChecklists(req.query);
    return res.json(result);
  } catch (err) {
    console.error('Error in GET /coordinator/bookings:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch coordinator bookings' });
  }
});

/**
 * GET /api/admin/coordinator/bookings/:checklistId
 * Fetch full details for a single checklist and its travel/room booking.
 */
router.get('/bookings/:checklistId', async (req, res) => {
  try {
    const details = await getBookingDetails(req.params.checklistId);
    return res.json(details);
  } catch (err) {
    console.error('Error in GET /coordinator/bookings/:checklistId:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to fetch booking details' });
  }
});

/**
 * POST /api/admin/coordinator/bookings/:checklistId
 * Save or update travel & room booking details for a checklist.
 * Prevents accidental completion when required arrangements are missing.
 */
router.post('/bookings/:checklistId', async (req, res) => {
  try {
    const saved = await saveCoordinatorBooking({
      checklistId: req.params.checklistId,
      bookingData: req.body,
      user: req.profile || req.user || {},
    });
    return res.json({ success: true, booking: saved });
  } catch (err) {
    console.error('Error in POST /coordinator/bookings/:checklistId:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({
      error: err.message || 'Failed to save booking details',
      errors: err.errors || undefined,
    });
  }
});

/**
 * POST /api/admin/coordinator/bookings/:checklistId/status
 * Quick action to update booking status (IN_PROGRESS, COMPLETED, NOT_REQUIRED)
 */
router.post('/bookings/:checklistId/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Retrieve existing booking to validate or merge
    const details = await getBookingDetails(req.params.checklistId);
    const mergedBookingData = {
      ...(details.booking || {}),
      booking_status: status,
      coordinator_notes: notes || details.booking?.coordinator_notes,
    };

    const saved = await saveCoordinatorBooking({
      checklistId: req.params.checklistId,
      bookingData: mergedBookingData,
      user: req.profile || req.user || {},
    });

    return res.json({ success: true, booking: saved });
  } catch (err) {
    console.error('Error in POST /coordinator/bookings/:checklistId/status:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({
      error: err.message || 'Failed to update booking status',
      errors: err.errors || undefined,
    });
  }
});

/**
 * GET /api/admin/coordinator/bookings/:checklistId/history
 * Fetch audit trail of coordinator updates and status changes.
 */
router.get('/bookings/:checklistId/history', async (req, res) => {
  try {
    const history = await getBookingAuditHistory(req.params.checklistId);
    return res.json({ history });
  } catch (err) {
    console.error('Error in GET /coordinator/bookings/:checklistId/history:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch booking history' });
  }
});

export default router;
