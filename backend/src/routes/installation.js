import { Router } from 'express';
import { z } from 'zod';
import { requireRole, requireAdmin } from '../middleware/auth.js';
import {
  createChecklist,
  getChecklists,
  getChecklistById,
  updateChecklist,
  deleteChecklist,
  getInstallationStats,
} from '../services/installationService.js';
import { generateInstallationChecklistPDF } from '../services/installationPdfGenerator.js';
import { issueStockForJob } from '../services/inventoryService.js';
import {
  submitTechnicalReport,
  declareDeviceReturns,
  verifyStoreReturn,
  resolveDiscrepancy,
} from '../services/workflowService.js';

const router = Router();

const DEVICE_TYPES = [
  '2 Channel Live',
  '2 Channel Recording',
  '4 Channel Live',
  '4 Channel Recording',
  '6 Channel Live',
  '6 Channel Recording',
  '8 Channel Live',
];

const indianMobileRegex = /^[6-9]\d{9}$/;

const checklistValidationSchema = z.object({
  client_name: z.string().min(1, 'Client name is required'),
  client_mobile: z.string().refine((val) => indianMobileRegex.test(val.replace(/\s+/g, '')), {
    message: 'Valid 10-digit Indian mobile number is required (starting with 6-9)',
  }),
  client_location: z.string().min(1, 'Client location is required'),
  google_maps_location: z.string().nullable().optional(),
  device_type: z.enum(DEVICE_TYPES, {
    errorMap: () => ({ message: 'Invalid device type option selected' }),
  }),
  number_of_devices: z.number().int().gt(0, 'Number of devices must be greater than 0'),
  number_of_vehicles: z.number().int().gt(0, 'Number of vehicles must be greater than 0'),
  extra_devices: z.boolean().default(false),
  extra_device_type: z.string().nullable().optional(),
  extra_device_count: z.number().int().gt(0).nullable().optional(),
  confirmed_price: z.number().gte(0, 'Confirmed price must be 0 or greater'),
  payment_method: z.enum(['Cash', 'UPI', 'Bank Transfer', 'Credit', 'Other'], {
    errorMap: () => ({ message: 'Valid payment method option is required' }),
  }),
  advance_received: z.boolean().default(false),
  advance_amount: z.number().gte(0, 'Advance amount cannot be negative').default(0),
  pending_payment: z.boolean().default(false),
  pending_amount: z.number().gte(0, 'Pending amount cannot be negative').default(0),
  installation_duration: z.string().min(1, 'Installation duration is required'),
  vehicle_type: z.string().min(1, 'Vehicle type is required'),
  custom_vehicle_type: z.string().nullable().optional(),
  expected_arrival_date: z.string().min(1, 'Expected arrival date is required'),
  expected_arrival_time: z.string().min(1, 'Expected arrival time is required'),
  installation_or_service: z.enum(['Installation', 'Service'], {
    errorMap: () => ({ message: 'Installation or Service selection is required' }),
  }),
  service_engineer: z.string().min(1, 'Team Member 1 – Service Engineer is required'),
  service_assistant: z.string().min(1, 'Team Member 2 – Service Assistant is required'),
  installation_status: z.enum(['Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled']).default('Pending'),
  payment_status: z.enum(['Paid', 'Partially Paid', 'Pending']).default('Pending'),
  remarks: z.string().nullable().optional(),
  client_confirmation: z.enum(['Confirmed', 'Not Confirmed']).default('Confirmed'),
}).superRefine((data, ctx) => {
  if (data.extra_devices) {
    if (!data.extra_device_type || !DEVICE_TYPES.includes(data.extra_device_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extra_device_type'],
        message: 'Type of Extra Device is required when Extra Devices to be Carried is Yes',
      });
    }
    if (!data.extra_device_count || data.extra_device_count <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extra_device_count'],
        message: 'Number of Extra Devices must be greater than 0',
      });
    }
  }

  const adv = data.advance_received ? (data.advance_amount || 0) : 0;
  const pend = data.pending_payment ? (data.pending_amount || 0) : 0;
  if (adv + pend > data.confirmed_price) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['advance_amount'],
      message: 'Advance amount + Pending amount cannot exceed Confirmed Price',
    });
  }
});

/**
 * GET /api/admin/installations/stats
 * Dashboard statistics for installation checklists (Accessible to all 4 roles)
 */
router.get('/stats', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const stats = await getInstallationStats();
    return res.json(stats);
  } catch (err) {
    console.error('Error fetching installation stats:', err);
    return res.status(500).json({ error: 'Failed to fetch installation statistics' });
  }
});

/**
 * GET /api/admin/installations
 * List installation checklists with search, filters, pagination (Accessible to all 4 roles)
 */
router.get('/', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const result = await getChecklists(req.query);
    return res.json(result);
  } catch (err) {
    console.error('Error in GET /installations:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch installation checklists' });
  }
});

/**
 * GET /api/admin/installations/:id
 * Get single installation checklist by ID (Accessible to all 4 roles)
 */
router.get('/:id', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const item = await getChecklistById(req.params.id);
    return res.json(item);
  } catch (err) {
    console.error('Error in GET /installations/:id:', err);
    return res.status(404).json({ error: err.message || 'Installation checklist not found' });
  }
});

/**
 * GET /api/admin/installations/:id/pdf
 * Download PDF for an installation checklist (Accessible to all 4 roles)
 */
router.get('/:id/pdf', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const item = await getChecklistById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Installation checklist not found' });
    }

    const pdfBuffer = await generateInstallationChecklistPDF(item);
    const filename = `EagleEye-Installation-${item.checklist_number}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error in GET /installations/:id/pdf:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate installation PDF' });
  }
});

/**
 * POST /api/admin/installations
 * Create a new installation checklist (SALES, ADMIN)
 */
router.post('/', requireRole('SALES', 'ADMIN'), async (req, res) => {
  try {
    const parsed = checklistValidationSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstErr = parsed.error.errors[0]?.message || 'Validation failed';
      return res.status(400).json({ error: firstErr, details: parsed.error.format() });
    }

    const created = await createChecklist(req.profile.id, parsed.data);
    return res.status(201).json(created);
  } catch (err) {
    console.error('Error in POST /installations:', err);
    return res.status(500).json({ error: err.message || 'Failed to create installation checklist' });
  }
});

/**
 * PUT /api/admin/installations/:id
 * Update an existing installation checklist (SALES, ADMIN)
 */
router.put('/:id', requireRole('SALES', 'ADMIN'), async (req, res) => {
  try {
    const parsed = checklistValidationSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstErr = parsed.error.errors[0]?.message || 'Validation failed';
      return res.status(400).json({ error: firstErr, details: parsed.error.format() });
    }

    const updated = await updateChecklist(req.params.id, parsed.data);
    return res.json(updated);
  } catch (err) {
    console.error('Error in PUT /installations/:id:', err);
    return res.status(500).json({ error: err.message || 'Failed to update installation checklist' });
  }
});

/**
 * DELETE /api/admin/installations/:id
 * Delete an installation checklist (ADMIN only)
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await deleteChecklist(req.params.id);
    return res.json(result);
  } catch (err) {
    console.error('Error in DELETE /installations/:id:', err);
    return res.status(500).json({ error: err.message || 'Failed to delete installation checklist' });
  }
});

/**
 * Stage 2: STORE_MANAGER issues stock for an approved job
 * POST /api/admin/installations/:id/issue-stock
 */
router.post('/:id/issue-stock', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { device_type, quantity, notes } = req.body;
    const result = await issueStockForJob({
      checklist_id: req.params.id,
      device_type,
      quantity: parseInt(quantity, 10),
      user: req.profile,
      notes,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /installations/:id/issue-stock:', err);
    return res.status(400).json({ error: err.message || 'Failed to issue stock' });
  }
});

/**
 * Stage 3: TECHNICAL records actual site installation quantities
 * POST /api/admin/installations/:id/technical-report
 */
router.post('/:id/technical-report', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const {
      devices_carried_qty,
      devices_installed_qty,
      devices_unused_qty,
      devices_damaged_qty,
      devices_missing_qty,
      extra_devices_carried_qty,
      extra_devices_installed_qty,
      extra_devices_unused_qty,
      extra_devices_damaged_qty,
      extra_devices_missing_qty,
      completion_status,
      remarks,
    } = req.body;

    const result = await submitTechnicalReport({
      checklist_id: req.params.id,
      user: req.profile,
      devices_carried_qty: parseInt(devices_carried_qty, 10) || 0,
      devices_installed_qty: parseInt(devices_installed_qty, 10) || 0,
      devices_unused_qty: parseInt(devices_unused_qty, 10) || 0,
      devices_damaged_qty: parseInt(devices_damaged_qty, 10) || 0,
      devices_missing_qty: parseInt(devices_missing_qty, 10) || 0,
      extra_devices_carried_qty: parseInt(extra_devices_carried_qty, 10) || 0,
      extra_devices_installed_qty: parseInt(extra_devices_installed_qty, 10) || 0,
      extra_devices_unused_qty: parseInt(extra_devices_unused_qty, 10) || 0,
      extra_devices_damaged_qty: parseInt(extra_devices_damaged_qty, 10) || 0,
      extra_devices_missing_qty: parseInt(extra_devices_missing_qty, 10) || 0,
      completion_status,
      remarks,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /installations/:id/technical-report:', err);
    return res.status(400).json({ error: err.message || 'Failed to submit technical report' });
  }
});

/**
 * Stage 4: TECHNICAL declares unused devices for store return
 * POST /api/admin/installations/:id/declare-return
 */
router.post('/:id/declare-return', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { device_type, declared_return_qty, remarks } = req.body;
    const result = await declareDeviceReturns({
      checklist_id: req.params.id,
      device_type,
      declared_return_qty: parseInt(declared_return_qty, 10),
      user: req.profile,
      remarks,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /installations/:id/declare-return:', err);
    return res.status(400).json({ error: err.message || 'Failed to declare returns' });
  }
});

/**
 * Stage 5: STORE_MANAGER physically verifies returned devices
 * POST /api/admin/installations/:id/verify-return
 */
router.post('/:id/verify-return', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { return_id, accepted_usable_qty, damaged_qty, missing_qty, remarks } = req.body;
    const result = await verifyStoreReturn({
      return_id,
      accepted_usable_qty: parseInt(accepted_usable_qty, 10) || 0,
      damaged_qty: parseInt(damaged_qty, 10) || 0,
      missing_qty: parseInt(missing_qty, 10) || 0,
      user: req.profile,
      remarks,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /installations/:id/verify-return:', err);
    return res.status(400).json({ error: err.message || 'Failed to verify store return' });
  }
});

/**
 * Stage 6: ADMIN resolves open discrepancy
 * POST /api/admin/installations/:id/resolve-discrepancy
 */
router.post('/:id/resolve-discrepancy', requireAdmin, async (req, res) => {
  try {
    const { discrepancy_id, resolution_notes, status } = req.body;
    const result = await resolveDiscrepancy({
      discrepancy_id,
      user: req.profile,
      resolution_notes,
      status,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /installations/:id/resolve-discrepancy:', err);
    return res.status(400).json({ error: err.message || 'Failed to resolve discrepancy' });
  }
});

export default router;

