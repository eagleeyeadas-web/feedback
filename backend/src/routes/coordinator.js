import { Router } from 'express';
import multer from 'multer';
import { requireRole } from '../middleware/auth.js';
import {
  getCoordinatorChecklists,
  getBookingDetails,
  saveCoordinatorBooking,
  getBookingAuditHistory,
  extendRoomBooking,
  updateReturnTicketBooking,
  getReturnTicketTasks,
  submitTechnicianReturnTicket,
  verifyReturnTicketBooking,
  requestReturnTicketCorrection,
  uploadTicketReceiptService,
} from '../services/coordinatorBookingService.js';
import {
  getExtensionRequests,
  approveScheduleExtension,
  rejectScheduleExtension,
  getScheduleRevisionHistory,
  deleteScheduleExtensionById,
  clearScheduleExtensions,
} from '../services/scheduleExtensionService.js';
import {
  getRestDays,
  approveRestDay,
  rejectRestDay,
  deleteRestDayById,
  clearRestDays,
} from '../services/restDayService.js';
import {
  getLeaveRequests,
  approveLeave,
  rejectLeave,
  deleteLeaveById,
  clearLeaveRequests,
} from '../services/leaveService.js';
import {
  getAvailabilityCalendar,
  getEngineersAvailabilityForRange,
  getAllServiceEngineers,
  getEngineerCommitments,
} from '../services/engineerBookingService.js';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotificationById,
  clearNotifications,
} from '../services/appNotificationService.js';
import {
  previewChecklistsDeletion,
  safeDeleteAllEligibleChecklists,
  checkChecklistDeletionEligibility,
  safeDeleteChecklist,
  cancelChecklist,
} from '../services/installationService.js';
import {
  generateConflictId,
  isConflictDeleted,
  deleteConflictId,
  deleteConflictIds,
  resetDeletedConflicts,
} from '../services/conflictHistoryService.js';

const router = Router();

// Checklist deletion endpoints are accessible to SALES, COORDINATOR, and ADMIN
const requireChecklistDeleteRole = requireRole('SALES', 'COORDINATOR', 'ADMIN', 'SUPER_ADMIN');

/**
 * GET /api/admin/coordinator/checklists/deletion-preview
 * Previews eligible checklists and calculated workflow impact for deletion.
 */
router.get('/checklists/deletion-preview', requireChecklistDeleteRole, async (req, res) => {
  try {
    const preview = await previewChecklistsDeletion(req.query);
    return res.json(preview);
  } catch (err) {
    console.error('Error in GET /coordinator/checklists/deletion-preview:', err);
    return res.status(500).json({ error: err.message || 'Failed to preview checklists deletion' });
  }
});

/**
 * POST /api/admin/coordinator/checklists/delete-all
 * Deletes all eligible checklists and their complete workflows safely.
 */
router.post('/checklists/delete-all', requireChecklistDeleteRole, async (req, res) => {
  try {
    const result = await safeDeleteAllEligibleChecklists({
      user: req.profile || req.user,
      confirmedCount: req.body.confirmedCount,
      params: req.body.params || {},
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /coordinator/checklists/delete-all:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message || 'Failed to delete eligible checklists',
      preview: err.preview || null,
    });
  }
});

/**
 * GET /api/admin/coordinator/checklists/:id/deletion-check
 * Evaluates checklist deletion eligibility and full workflow impact breakdown.
 */
router.get('/checklists/:id/deletion-check', requireChecklistDeleteRole, async (req, res) => {
  try {
    const check = await checkChecklistDeletionEligibility(req.params.id);
    return res.json(check);
  } catch (err) {
    console.error('Error in GET /coordinator/checklists/:id/deletion-check:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to check deletion eligibility' });
  }
});

/**
 * DELETE /api/admin/coordinator/checklists/:id
 * Permanently deletes a checklist and its entire workflow cascade.
 */
router.delete('/checklists/:id', requireChecklistDeleteRole, async (req, res) => {
  try {
    const result = await safeDeleteChecklist(req.params.id, req.profile || req.user);
    return res.json(result);
  } catch (err) {
    console.error('Error in DELETE /coordinator/checklists/:id:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message || 'Failed to delete checklist',
      reasons: err.reasons || [],
      canCancel: err.canCancel || false,
      checklist: err.checklist || null,
    });
  }
});

/**
 * POST /api/admin/coordinator/checklists/:id/cancel
 * Cancels a checklist when permanent deletion is unsafe, preserving operational history.
 */
router.post('/checklists/:id/cancel', requireChecklistDeleteRole, async (req, res) => {
  try {
    const result = await cancelChecklist({
      checklistId: req.params.id,
      user: req.profile || req.user,
      reason: req.body.reason || 'Cancelled by authorized user',
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /coordinator/checklists/:id/cancel:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to cancel checklist' });
  }
});

const uploadTicketReceiptMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only JPEG, PNG, WebP, and PDF receipts are accepted.'));
    }
  },
});

/**
 * GET /api/admin/coordinator/return-ticket-tasks
 * Retrieve return ticket tasks (filtered by assigned technician for TECHNICAL role, all for COORDINATOR/ADMIN)
 */
router.get('/return-ticket-tasks', requireRole('TECHNICAL', 'COORDINATOR', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const tasks = await getReturnTicketTasks({
      user: req.profile || req.user,
      status: req.query.status,
      search: req.query.search,
    });
    return res.json({ tasks });
  } catch (err) {
    console.error('Error in GET /return-ticket-tasks:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to fetch return ticket tasks' });
  }
});

/**
 * POST /api/admin/coordinator/bookings/:checklistId/technician-return-ticket
 * Technician submits return journey booking details for Coordinator verification
 */
router.post('/bookings/:checklistId/technician-return-ticket', requireRole('TECHNICAL', 'COORDINATOR', 'ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const result = await submitTechnicianReturnTicket({
      checklistId: req.params.checklistId,
      bookingData: req.body,
      user: req.profile || req.user,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /technician-return-ticket:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to submit return ticket details' });
  }
});

/**
 * POST /api/admin/coordinator/upload-ticket-receipt
 * Upload receipt/ticket image or PDF
 */
router.post('/upload-ticket-receipt', requireRole('TECHNICAL', 'COORDINATOR', 'ADMIN', 'SUPER_ADMIN'), uploadTicketReceiptMulter.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No ticket or receipt file provided' });
    }
    const result = await uploadTicketReceiptService({
      file,
      checklistId: req.body.checklistId,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /upload-ticket-receipt:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to upload ticket receipt' });
  }
});

// Strict least-privilege access: ONLY COORDINATOR and ADMIN can access Coordinator workspace APIs (travel, accommodation, leaves, rest days, extensions)
router.use(requireRole('COORDINATOR', 'ADMIN'));

/**
 * POST /api/admin/coordinator/bookings/:checklistId/verify-return-ticket
 * Coordinator verifies submitted return-ticket details and completes task
 */
router.post('/bookings/:checklistId/verify-return-ticket', async (req, res) => {
  try {
    const result = await verifyReturnTicketBooking({
      checklistId: req.params.checklistId,
      user: req.profile || req.user,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /verify-return-ticket:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to verify return ticket task' });
  }
});

/**
 * POST /api/admin/coordinator/bookings/:checklistId/request-return-ticket-correction
 * Coordinator requests correction on return ticket details
 */
router.post('/bookings/:checklistId/request-return-ticket-correction', async (req, res) => {
  try {
    const { reason } = req.body;
    const result = await requestReturnTicketCorrection({
      checklistId: req.params.checklistId,
      reason,
      user: req.profile || req.user,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /request-return-ticket-correction:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to request return ticket correction' });
  }
});

/**
 * GET /api/admin/coordinator/bookings
 * Fetch checklists merged with their coordinator booking details.
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
 * Universal endpoint to update outbound, room, or return booking status
 */
router.post('/bookings/:checklistId/status', async (req, res) => {
  try {
    const { status, notes, outbound_status, accommodation_status, return_status, type } = req.body;
    const details = await getBookingDetails(req.params.checklistId);
    const mergedBookingData = {
      ...(details.booking || {}),
    };

    if (notes !== undefined) {
      mergedBookingData.coordinator_notes = notes;
    }

    if (type === 'outbound' || outbound_status) {
      mergedBookingData.outbound_status = outbound_status || status;
    } else if (type === 'room' || type === 'accommodation' || accommodation_status) {
      mergedBookingData.accommodation_status = accommodation_status || status;
    } else if (type === 'return' || return_status) {
      mergedBookingData.return_status = return_status || status;
    } else if (status) {
      if (['Pending', 'Booked', 'Confirmed', 'Cancelled'].includes(status)) {
        mergedBookingData.booking_status = status === 'Confirmed' ? 'COMPLETED' : 'IN_PROGRESS';
      } else {
        mergedBookingData.booking_status = status;
      }
    } else {
      return res.status(400).json({ error: 'Status is required' });
    }

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
 * POST /api/admin/coordinator/bookings/:checklistId/outbound-status
 */
router.post('/bookings/:checklistId/outbound-status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status || !['Pending', 'Booked', 'Confirmed', 'Cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Valid outbound status (Pending, Booked, Confirmed, Cancelled) is required' });
    }
    const details = await getBookingDetails(req.params.checklistId);
    const mergedBookingData = {
      ...(details.booking || {}),
      outbound_status: status,
      coordinator_notes: notes !== undefined ? notes : details.booking?.coordinator_notes,
    };
    const saved = await saveCoordinatorBooking({
      checklistId: req.params.checklistId,
      bookingData: mergedBookingData,
      user: req.profile || req.user || {},
    });
    return res.json({ success: true, booking: saved });
  } catch (err) {
    console.error('Error in POST /coordinator/bookings/:checklistId/outbound-status:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to update outbound status' });
  }
});

/**
 * POST /api/admin/coordinator/bookings/:checklistId/room-status
 */
router.post('/bookings/:checklistId/room-status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status || !['Pending', 'Pending Review', 'Booked', 'Confirmed', 'Cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Valid room booking status (Pending, Pending Review, Booked, Confirmed, Cancelled) is required' });
    }
    const details = await getBookingDetails(req.params.checklistId);
    const mergedBookingData = {
      ...(details.booking || {}),
      accommodation_status: status,
      coordinator_notes: notes !== undefined ? notes : details.booking?.coordinator_notes,
    };
    const saved = await saveCoordinatorBooking({
      checklistId: req.params.checklistId,
      bookingData: mergedBookingData,
      user: req.profile || req.user || {},
    });
    return res.json({ success: true, booking: saved });
  } catch (err) {
    console.error('Error in POST /coordinator/bookings/:checklistId/room-status:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to update room booking status' });
  }
});

/**
 * POST /api/admin/coordinator/bookings/:checklistId/return-status
 */
router.post('/bookings/:checklistId/return-status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!status || !['Pending', 'Booked', 'Confirmed', 'Cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Valid return ticket status (Pending, Booked, Confirmed, Cancelled) is required' });
    }
    const details = await getBookingDetails(req.params.checklistId);
    const mergedBookingData = {
      ...(details.booking || {}),
      return_status: status,
      coordinator_notes: notes !== undefined ? notes : details.booking?.coordinator_notes,
    };
    const saved = await saveCoordinatorBooking({
      checklistId: req.params.checklistId,
      bookingData: mergedBookingData,
      user: req.profile || req.user || {},
    });
    return res.json({ success: true, booking: saved });
  } catch (err) {
    console.error('Error in POST /coordinator/bookings/:checklistId/return-status:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to update return ticket status' });
  }
});

/**
 * GET /api/admin/coordinator/bookings/:checklistId/history
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

/**
 * POST /api/admin/coordinator/bookings/:checklistId/extend-room
 * Extend existing room booking following an approved extension
 * Preserves original room dates, initial checkout date, and appends to audit trail
 */
router.post('/bookings/:checklistId/extend-room', async (req, res) => {
  try {
    const {
      new_check_out_date,
      extra_nights,
      reference_details,
      notes,
      attachment_url,
      attachment_name,
    } = req.body;

    if (!new_check_out_date) {
      return res.status(400).json({ error: 'New checkout date is required' });
    }

    const saved = await extendRoomBooking({
      checklistId: req.params.checklistId,
      newCheckOutDate: new_check_out_date,
      extraNights: extra_nights,
      referenceDetails: reference_details,
      notes,
      attachmentUrl: attachment_url,
      attachmentName: attachment_name,
      user: req.profile || req.user || {},
    });

    return res.json({ success: true, booking: saved });
  } catch (err) {
    console.error('Error in POST /coordinator/bookings/:checklistId/extend-room:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to extend room booking' });
  }
});

/**
 * POST /api/admin/coordinator/bookings/:checklistId/return-ticket
 * Record or update Return Ticket Booking
 */
router.post('/bookings/:checklistId/return-ticket', async (req, res) => {
  try {
    const saved = await updateReturnTicketBooking({
      checklistId: req.params.checklistId,
      returnData: req.body,
      user: req.profile || req.user || {},
    });

    return res.json({ success: true, booking: saved });
  } catch (err) {
    console.error('Error in POST /coordinator/bookings/:checklistId/return-ticket:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to update return ticket booking' });
  }
});

// ============================================================
// SCHEDULE & AVAILABILITY MANAGEMENT APIS
// ============================================================

/**
 * GET /api/admin/coordinator/schedule/extensions
 * Fetch extension requests (filterable by status: PENDING, APPROVED, REJECTED, ALL)
 */
router.get('/schedule/extensions', async (req, res) => {
  try {
    const requests = await getExtensionRequests(req.query);
    return res.json({ requests });
  } catch (err) {
    console.error('Error fetching extension requests:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch extension requests' });
  }
});

/**
 * POST /api/admin/coordinator/schedule/extensions/:id/approve
 * Atomically approve schedule extension, recalculate conflicts, update current expected schedule
 * Permission: Only HR / ADMIN can approve. COORDINATOR role is strictly prohibited.
 */
router.post(['/schedule/extensions/:id/approve', '/schedule-extensions/:id/approve'], async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const role = (user.role || '').toUpperCase();
    if (role === 'COORDINATOR') {
      return res.status(403).json({
        error: 'Coordinators are not permitted to approve or reject HR extension requests. Extension approval authority is restricted to HR.',
      });
    }

    const { decision_notes } = req.body;
    const result = await approveScheduleExtension({
      extensionId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });
    return res.json(result);
  } catch (err) {
    console.error('Error approving schedule extension:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({
      error: err.message || 'Failed to approve extension request',
      conflict: err.conflict || null,
    });
  }
});

/**
 * POST /api/admin/coordinator/schedule/extensions/:id/reject
 * Reject schedule extension with optional decision notes
 * Permission: Only HR / ADMIN can reject. COORDINATOR role is strictly prohibited.
 */
router.post(['/schedule/extensions/:id/reject', '/schedule-extensions/:id/reject'], async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const role = (user.role || '').toUpperCase();
    if (role === 'COORDINATOR') {
      return res.status(403).json({
        error: 'Coordinators are not permitted to approve or reject HR extension requests. Extension approval authority is restricted to HR.',
      });
    }

    const { decision_notes } = req.body;
    const result = await rejectScheduleExtension({
      extensionId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });
    return res.json(result);
  } catch (err) {
    console.error('Error rejecting schedule extension:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to reject extension request' });
  }
});

/**
 * DELETE /api/admin/coordinator/schedule/extensions/:id
 * Delete an individual schedule extension request
 */
router.delete('/schedule/extensions/:id', async (req, res) => {
  try {
    const result = await deleteScheduleExtensionById(req.params.id);
    return res.json({ success: true, message: 'Extension request deleted', id: result.id });
  } catch (err) {
    console.error('Error deleting extension request:', err);
    return res.status(500).json({ error: 'Failed to delete extension request' });
  }
});

/**
 * POST /api/admin/coordinator/schedule/extensions/delete-all
 * Clear or bulk delete schedule extension requests
 */
router.post('/schedule/extensions/delete-all', async (req, res) => {
  try {
    const { status = 'ALL', checklist_id = null } = req.body;
    const result = await clearScheduleExtensions({ status, checklistId: checklist_id });
    return res.json({ success: true, message: `Deleted ${result.deletedCount} extension request(s)`, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Error clearing extension requests:', err);
    return res.status(500).json({ error: 'Failed to clear extension requests' });
  }
});

/**
 * GET /api/admin/coordinator/schedule/rest-days
 * Fetch rest day requests
 */
router.get('/schedule/rest-days', async (req, res) => {
  try {
    const restDays = await getRestDays(req.query);
    return res.json({ rest_days: restDays });
  } catch (err) {
    console.error('Error fetching rest days:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch rest days' });
  }
});

/**
 * POST /api/admin/coordinator/schedule/rest-days/:id/approve
 */
router.post('/schedule/rest-days/:id/approve', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const { decision_notes } = req.body;
    const result = await approveRestDay({
      requestId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });
    return res.json(result);
  } catch (err) {
    console.error('Error approving rest day:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({
      error: err.message || 'Failed to approve rest day',
      conflict: err.conflict || null,
    });
  }
});

/**
 * POST /api/admin/coordinator/schedule/rest-days/:id/reject
 */
router.post('/schedule/rest-days/:id/reject', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const { decision_notes } = req.body;
    const result = await rejectRestDay({
      requestId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });
    return res.json(result);
  } catch (err) {
    console.error('Error rejecting rest day:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to reject rest day' });
  }
});

/**
 * DELETE /api/admin/coordinator/schedule/rest-days/:id
 * Delete an individual rest day request
 */
router.delete('/schedule/rest-days/:id', async (req, res) => {
  try {
    const result = await deleteRestDayById(req.params.id);
    return res.json({ success: true, message: 'Rest day request deleted', id: result.id });
  } catch (err) {
    console.error('Error deleting rest day:', err);
    return res.status(500).json({ error: 'Failed to delete rest day request' });
  }
});

/**
 * POST /api/admin/coordinator/schedule/rest-days/delete-all
 * Clear or bulk delete rest day requests
 */
router.post('/schedule/rest-days/delete-all', async (req, res) => {
  try {
    const { status = 'ALL', engineer_id = null } = req.body;
    const result = await clearRestDays({ status, engineerId: engineer_id });
    return res.json({ success: true, message: `Deleted ${result.deletedCount} rest day request(s)`, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Error clearing rest day requests:', err);
    return res.status(500).json({ error: 'Failed to clear rest day requests' });
  }
});

/**
 * GET /api/admin/coordinator/schedule/leaves
 * Fetch leave requests
 */
router.get('/schedule/leaves', async (req, res) => {
  try {
    const leaves = await getLeaveRequests(req.query);
    return res.json({ leaves });
  } catch (err) {
    console.error('Error fetching leaves:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch leaves' });
  }
});

/**
 * POST /api/admin/coordinator/schedule/leaves/:id/approve
 */
router.post('/schedule/leaves/:id/approve', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const { decision_notes } = req.body;
    const result = await approveLeave({
      leaveId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });
    return res.json(result);
  } catch (err) {
    console.error('Error approving leave:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({
      error: err.message || 'Failed to approve leave request',
      conflict: err.conflict || null,
    });
  }
});

/**
 * POST /api/admin/coordinator/schedule/leaves/:id/reject
 */
router.post('/schedule/leaves/:id/reject', async (req, res) => {
  try {
    const user = req.profile || req.user || {};
    const { decision_notes } = req.body;
    const result = await rejectLeave({
      leaveId: req.params.id,
      user,
      decisionNotes: decision_notes || '',
    });
    return res.json(result);
  } catch (err) {
    console.error('Error rejecting leave:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to reject leave request' });
  }
});

/**
 * DELETE /api/admin/coordinator/schedule/leaves/:id
 * Delete an individual leave request
 */
router.delete('/schedule/leaves/:id', async (req, res) => {
  try {
    const result = await deleteLeaveById(req.params.id);
    return res.json({ success: true, message: 'Leave request deleted', id: result.id });
  } catch (err) {
    console.error('Error deleting leave request:', err);
    return res.status(500).json({ error: 'Failed to delete leave request' });
  }
});

/**
 * POST /api/admin/coordinator/schedule/leaves/delete-all
 * Clear or bulk delete leave requests
 */
router.post('/schedule/leaves/delete-all', async (req, res) => {
  try {
    const { status = 'ALL', engineer_id = null } = req.body;
    const result = await clearLeaveRequests({ status, engineerId: engineer_id });
    return res.json({ success: true, message: `Deleted ${result.deletedCount} leave request(s)`, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('Error clearing leave requests:', err);
    return res.status(500).json({ error: 'Failed to clear leave requests' });
  }
});

/**
 * GET /api/admin/coordinator/schedule/calendar
 * Date-based calendar view with Day, Week, Month view support and status summary
 */
router.get('/schedule/calendar', async (req, res) => {
  try {
    const calendar = await getAvailabilityCalendar(req.query);
    return res.json(calendar);
  } catch (err) {
    console.error('Error fetching schedule calendar:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch schedule calendar' });
  }
});

/**
 * GET /api/admin/coordinator/schedule/conflicts
 * List all detected conflicts and items requiring coordinator resolution
 */
router.get('/schedule/conflicts', async (req, res) => {
  try {
    const engineers = await getAllServiceEngineers();
    const conflicts = [];

    for (const eng of engineers) {
      const comms = await getEngineerCommitments(eng.id);
      // Group overlapping commitments
      for (let i = 0; i < comms.length; i++) {
        for (let j = i + 1; j < comms.length; j++) {
          const a = comms[i];
          const b = comms[j];
          const endA = a.effective_end_date || a.end_date;
          const endB = b.effective_end_date || b.end_date;
          if (a.start_date <= endB && endA >= b.start_date) {
            const overlap_start = a.start_date > b.start_date ? a.start_date : b.start_date;
            const overlap_end = endA < endB ? endA : endB;
            const conflictObj = {
              engineer_id: eng.id,
              engineer_name: eng.name,
              commitment_a: a,
              commitment_b: b,
              overlap_start,
              overlap_end,
            };
            conflictObj.id = generateConflictId(conflictObj);

            // Filter out conflict history items that were deleted by the coordinator
            if (!isConflictDeleted(conflictObj.id)) {
              conflicts.push(conflictObj);
            }
          }
        }
      }
    }

    return res.json({ conflicts, total_conflicts: conflicts.length });
  } catch (err) {
    console.error('Error detecting conflicts:', err);
    return res.status(500).json({ error: err.message || 'Failed to detect conflicts' });
  }
});

/**
 * DELETE /api/admin/coordinator/schedule/conflicts/:id
 * Delete a specific schedule conflict entry from conflict history
 */
router.delete('/schedule/conflicts/:id', async (req, res) => {
  try {
    const conflictId = req.params.id;
    if (!conflictId) {
      return res.status(400).json({ error: 'Conflict ID is required' });
    }
    deleteConflictId(conflictId);
    return res.json({ success: true, message: 'Conflict deleted from history', id: conflictId });
  } catch (err) {
    console.error('Error deleting schedule conflict:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete schedule conflict' });
  }
});

/**
 * DELETE /api/admin/coordinator/schedule/conflicts
 * Delete multiple or all schedule conflicts from history
 */
router.delete('/schedule/conflicts', async (req, res) => {
  try {
    let idsToDelete = req.body?.ids;

    // If specific IDs not passed in body, collect all currently detected conflict IDs
    if (!Array.isArray(idsToDelete) || idsToDelete.length === 0) {
      const engineers = await getAllServiceEngineers();
      idsToDelete = [];
      for (const eng of engineers) {
        const comms = await getEngineerCommitments(eng.id);
        for (let i = 0; i < comms.length; i++) {
          for (let j = i + 1; j < comms.length; j++) {
            const a = comms[i];
            const b = comms[j];
            const endA = a.effective_end_date || a.end_date;
            const endB = b.effective_end_date || b.end_date;
            if (a.start_date <= endB && endA >= b.start_date) {
              const overlap_start = a.start_date > b.start_date ? a.start_date : b.start_date;
              const overlap_end = endA < endB ? endA : endB;
              const cId = generateConflictId({
                engineer_id: eng.id,
                commitment_a: a,
                commitment_b: b,
                overlap_start,
                overlap_end,
              });
              idsToDelete.push(cId);
            }
          }
        }
      }
    }

    const count = deleteConflictIds(idsToDelete);
    return res.json({ success: true, message: `Deleted ${count} conflict history entries`, count });
  } catch (err) {
    console.error('Error clearing conflict history:', err);
    return res.status(500).json({ error: err.message || 'Failed to clear schedule conflict history' });
  }
});

/**
 * GET /api/admin/coordinator/schedule/affected-bookings
 * Return travel and accommodation bookings that are flagged for review due to schedule changes
 */
router.get('/schedule/affected-bookings', async (req, res) => {
  try {
    const resList = await getCoordinatorChecklists({ limit: 100 });
    const flagged = (resList.checklists || []).filter((c) => {
      const b = c.coordinator_booking;
      return b && (b.schedule_flagged_for_review || b.return_travel_date_affected || b.accommodation_dates_affected);
    });
    return res.json({ affected_bookings: flagged, total: flagged.length });
  } catch (err) {
    console.error('Error fetching affected bookings:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch affected bookings' });
  }
});

/**
 * GET /api/admin/coordinator/schedule/history/:checklistId
 * Audit trail of schedule revisions
 */
router.get('/schedule/history/:checklistId', async (req, res) => {
  try {
    const history = await getScheduleRevisionHistory(req.params.checklistId);
    return res.json({ history });
  } catch (err) {
    console.error('Error fetching schedule revision history:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch schedule revision history' });
  }
});

/**
 * Notifications APIs
 */
router.get('/notifications', async (req, res) => {
  try {
    const notifs = await getNotifications({ role: 'COORDINATOR', limit: 50 });
    return res.json({ notifications: notifs });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.post('/notifications/:id/read', async (req, res) => {
  try {
    await markNotificationRead(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

router.post('/notifications/read-all', async (req, res) => {
  try {
    await markAllNotificationsRead({ role: 'COORDINATOR' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

router.delete('/notifications/:id', async (req, res) => {
  try {
    await deleteNotificationById(req.params.id);
    return res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete notification' });
  }
});

router.post('/notifications/delete-all', async (req, res) => {
  try {
    const result = await clearNotifications({ role: 'COORDINATOR' });
    return res.json({ success: true, message: `Cleared ${result.deletedCount} notification(s)`, deletedCount: result.deletedCount });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

export default router;
