import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getAvailableCourierCompanies,
  getCourierDispatches,
  getCourierDispatchByChecklistId,
  getCourierDispatchById,
  getCourieredChecklists,
  dispatchChecklistViaCourier,
  updateCourierDeliveryStatus,
  recordCourierReturnToStore,
} from '../services/courierService.js';

const router = Router();

/**
 * GET /api/admin/courier/companies
 * Fetch list of authorized courier partners
 */
router.get('/companies', requireRole('STORE_MANAGER', 'SALES', 'ADMIN', 'COORDINATOR', 'TECHNICAL'), (req, res) => {
  return res.json({ companies: getAvailableCourierCompanies() });
});

/**
 * GET /api/admin/courier/checklists
 * Fetch couriered checklists with requirement and dispatch status
 */
router.get('/checklists', requireRole('STORE_MANAGER', 'SALES', 'ADMIN', 'COORDINATOR', 'TECHNICAL'), async (req, res) => {
  try {
    const { search, status, page, limit } = req.query;
    const result = await getCourieredChecklists({
      search: search || '',
      status: status || '',
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error fetching couriered checklists:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch couriered checklists' });
  }
});

/**
 * GET /api/admin/courier
 * Fetch all courier dispatches
 */
router.get('/', requireRole('STORE_MANAGER', 'SALES', 'ADMIN', 'COORDINATOR', 'TECHNICAL'), async (req, res) => {
  try {
    const { checklistId, search, status, page, limit } = req.query;
    const result = await getCourierDispatches({
      checklistId,
      search,
      status,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in GET /api/admin/courier:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch courier dispatches' });
  }
});

/**
 * GET /api/admin/courier/:checklistId
 * Fetch courier dispatch for a specific checklist
 */
router.get('/:checklistId', requireRole('STORE_MANAGER', 'SALES', 'ADMIN', 'COORDINATOR', 'TECHNICAL'), async (req, res) => {
  try {
    const dispatch = await getCourierDispatchByChecklistId(req.params.checklistId);
    if (!dispatch) {
      return res.status(404).json({ error: 'No courier dispatch record found for this checklist' });
    }
    return res.json(dispatch);
  } catch (err) {
    console.error('Error in GET /api/admin/courier/:checklistId:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch courier dispatch' });
  }
});

/**
 * POST /api/admin/courier/dispatch
 * Atomically verify stock, issue items, and record courier dispatch (STORE_MANAGER, ADMIN)
 */
router.post('/dispatch', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const {
      checklist_id,
      courier_company,
      tracking_number,
      dispatch_date,
      expected_delivery_date,
      delivery_notes,
      items,
    } = req.body;

    const result = await dispatchChecklistViaCourier({
      checklist_id,
      courier_company,
      tracking_number,
      dispatch_date,
      expected_delivery_date,
      delivery_notes,
      items,
      user: req.profile,
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('Error in POST /api/admin/courier/dispatch:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({
      error: err.message || 'Failed to dispatch checklist via courier',
      shortages: err.shortages || [],
    });
  }
});

/**
 * PUT /api/admin/courier/:dispatchId/status
 * Update courier shipment status (e.g. In Transit, Delivered, Delivery Exception, Cancelled)
 */
router.put('/:dispatchId/status', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { delivery_status, notes, delivery_confirmation } = req.body;
    const result = await updateCourierDeliveryStatus({
      dispatch_id: req.params.dispatchId,
      delivery_status,
      notes,
      delivery_confirmation,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in PUT /api/admin/courier/:dispatchId/status:', err);
    return res.status(400).json({ error: err.message || 'Failed to update courier delivery status' });
  }
});

/**
 * POST /api/admin/courier/:dispatchId/return
 * Process authorized courier return or cancellation (credits stock back with audit ledger entry)
 */
router.post('/:dispatchId/return', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { returned_items, remarks } = req.body;
    const result = await recordCourierReturnToStore({
      dispatch_id: req.params.dispatchId,
      returned_items,
      remarks,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /api/admin/courier/:dispatchId/return:', err);
    return res.status(400).json({ error: err.message || 'Failed to process courier return' });
  }
});

export default router;
