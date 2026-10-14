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
  getServiceEngineers,
} from '../services/installationService.js';
import {
  getEngineersAvailabilityForRange,
  getAvailabilityCalendar,
} from '../services/engineerBookingService.js';
import { generateInstallationChecklistPDF } from '../services/installationPdfGenerator.js';
import { generateStoreManagerRequirementPDF } from '../services/storeManagerPdfGenerator.js';
import { getStoreMaterialRequirementById, syncStoreRequirementForChecklist } from '../services/storeRequirementService.js';
import { issueStockForJob } from '../services/inventoryService.js';
import {
  submitTechnicalReport,
  declareDeviceReturns,
  declareMaterialReturns,
  verifyStoreReturn,
  verifyStoreMaterialReturn,
  resolveDiscrepancy,
  submitDeviceCarryRecord,
  getDeviceCarryRecord,
  startInstallationJob,
  submitInstallationCompletionReport,
  getInstallationCompletionReport,
  getPendingStoreReturns,
  getPendingStoreMaterialReturns,
  getAllStoreReturns,
  getAllStoreMaterialReturns,
  enrichChecklistsWithWorkflowStatus,
} from '../services/workflowService.js';
import multer from 'multer';
import {
  getExpensesForChecklist,
  saveJobExpenses,
  getTechnicianCurrentMonthTotal,
  uploadExpenseReceipt,
  generateTechnicianExpensePDFForChecklist,
} from '../services/expenseService.js';
import {
  requestScheduleExtension,
  getExtensionRequests,
  getScheduleRevisionHistory,
} from '../services/scheduleExtensionService.js';
import {
  requestRestDay,
  getRestDays,
} from '../services/restDayService.js';
import {
  requestLeave,
  getLeaveRequests,
} from '../services/leaveService.js';
import {
  getNotifications,
  markNotificationRead,
} from '../services/appNotificationService.js';
import {
  getAvailableBackupProducts,
  getBackupDeclaration,
  saveBackupDeclaration,
  verifyStoreBackupItemReturn,
} from '../services/backupItemService.js';

const uploadReceipt = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only JPEG, PNG, WebP, and PDF are accepted.'));
    }
  },
});

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

export const SALESPERSON_OPTIONS = [
  'Ranjith',
  'Abinaya',
  'Kavitha',
  'Kavitha Balu',
  'Padmapriya',
];

export const SERVICE_ENGINEER_OPTIONS = [
  'Mathi',
  'Guna',
  'Sakthivel',
  'Kamalesh',
];

const indianMobileRegex = /^[6-9]\d{9}$/;

export const deviceConfigItemSchema = z.object({
  device_type: z.enum(DEVICE_TYPES, {
    errorMap: () => ({ message: 'Invalid device type option selected' }),
  }),
  number_of_devices: z.coerce.number().int().gt(0, 'Number of devices must be a positive whole number greater than 0'),
  number_of_vehicles: z.coerce.number().int().gt(0, 'Number of vehicles must be a positive whole number greater than 0').optional().default(1),
});

export const extraDeviceItemSchema = z.object({
  device_type: z.enum(DEVICE_TYPES, {
    errorMap: () => ({ message: 'Invalid extra device type option selected' }),
  }),
  extra_quantity: z.coerce.number().int().gt(0, 'Extra quantity must be a positive whole number greater than 0'),
});

export const checklistValidationSchema = z.object({
  salesperson_name: z.enum(SALESPERSON_OPTIONS, {
    errorMap: () => ({ message: 'Salesperson Name is required. Please select one of the authorized salespeople: Ranjith, Abinaya, Kavitha, Kavitha Balu, or Padmapriya.' }),
  }).optional().nullable(),
  client_name: z.string().min(1, 'Client name is required'),
  client_mobile: z.string().refine((val) => indianMobileRegex.test(val.replace(/\s+/g, '')), {
    message: 'Valid 10-digit Indian mobile number is required (starting with 6-9)',
  }),
  client_location: z.string().min(1, 'Client location is required'),
  google_maps_location: z.string().nullable().optional(),
  device_configurations: z.array(deviceConfigItemSchema).min(1, 'At least one device configuration is required').optional(),
  device_type: z.string().optional(),
  number_of_devices: z.coerce.number().int().gt(0, 'Number of devices must be greater than 0').optional(),
  number_of_vehicles: z.coerce.number().int().gt(0, 'Number of vehicles must be greater than 0').optional().default(1),
  extra_devices: z.boolean().default(false),
  extra_device_configurations: z.array(extraDeviceItemSchema).optional().nullable(),
  extra_device_type: z.string().nullable().optional(),
  extra_device_count: z.number().int().gt(0).nullable().optional(),
  total_devices_carried: z.coerce.number().int().gt(0).optional(),
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
  service_engineer: z.enum(SERVICE_ENGINEER_OPTIONS, {
    errorMap: () => ({ message: 'Service Engineer is required. Please select one of: Mathi, Guna, Sakthivel, or Kamalesh.' }),
  }),
  service_engineer_id: z.string().nullable().optional(),
  booking_end_date: z.string().nullable().optional(),
  service_assistant: z.string().nullable().optional().default(''),
  installation_status: z.enum(['Assigned', 'Completed'], {
    errorMap: () => ({ message: 'Installation Status must be either Assigned or Completed' }),
  }).default('Assigned'),
  payment_status: z.enum(['Paid', 'Partially Paid', 'Pending']).default('Pending'),
  remarks: z.string().nullable().optional(),
  client_confirmation: z.enum(['Confirmed', 'Not Confirmed']).default('Confirmed'),
  bom_snapshot: z.any().nullable().optional(),
  material_issuance_status: z.enum(['PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'NOT_APPLICABLE']).optional(),
}).superRefine((data, ctx) => {
  // If device_configurations is not provided, enforce legacy device fields
  if (!data.device_configurations || data.device_configurations.length === 0) {
    if (!data.device_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['device_type'],
        message: 'Type of Device is required',
      });
    } else if (!DEVICE_TYPES.includes(data.device_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['device_type'],
        message: 'Invalid device type option selected',
      });
    }
    if (!data.number_of_devices || data.number_of_devices <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['number_of_devices'],
        message: 'Number of devices must be greater than 0',
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

  if (data.extra_devices) {
    if (Array.isArray(data.extra_device_configurations) && data.extra_device_configurations.length === 0 && !data.extra_device_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extra_device_configurations'],
        message: 'At least one extra device is required when carrying extra devices',
      });
    }
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
 * GET /api/admin/installations/service-engineers
 * Dropdown options for authorized Service Engineers
 */
router.get('/service-engineers', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), (req, res) => {
  return res.json(SERVICE_ENGINEER_OPTIONS);
});

/**
 * GET /api/admin/installations/salespersons
 * Dropdown options for authorized Salespeople
 */
router.get('/salespersons', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), (req, res) => {
  return res.json(SALESPERSON_OPTIONS);
});

/**
 * GET /api/admin/installations/engineers
 * Unique list of service engineers for filtering dropdown
 */
router.get('/engineers', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const engineers = await getServiceEngineers();
    return res.json(engineers);
  } catch (err) {
    console.error('Error fetching service engineers:', err);
    return res.status(500).json({ error: 'Failed to fetch service engineers' });
  }
});

/**
 * GET /api/admin/installations/engineers/availability
 * Real-time availability for all service engineers across a date range
 */
router.get('/engineers/availability', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'), async (req, res) => {
  try {
    const { startDate, endDate, duration, excludeChecklistId } = req.query;
    const availability = await getEngineersAvailabilityForRange({
      startDate,
      endDate,
      duration,
      excludeChecklistId,
    });
    return res.json(availability);
  } catch (err) {
    console.error('Error fetching engineer availability:', err);
    return res.status(400).json({ error: err.message || 'Failed to check engineer availability' });
  }
});

/**
 * GET /api/admin/installations/engineers/calendar
 * Date-based calendar view of all service engineers and their booked dates
 */
router.get('/engineers/calendar', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const calendar = await getAvailabilityCalendar({ startDate, endDate });
    return res.json(calendar);
  } catch (err) {
    console.error('Error fetching engineer availability calendar:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch availability calendar' });
  }
});

/**
 * GET /api/admin/installations/pending-returns
 * Fetch all declared returns pending Store Manager physical verification
 */
router.get('/pending-returns', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const deviceReturns = await getPendingStoreReturns();
    const materialReturns = await getPendingStoreMaterialReturns();
    if (req.query.format === 'structured') {
      return res.json({ device_returns: deviceReturns, material_returns: materialReturns });
    }
    return res.json([...deviceReturns, ...materialReturns]);
  } catch (err) {
    console.error('Error fetching pending returns:', err);
    return res.status(500).json({ error: 'Failed to fetch pending store returns' });
  }
});

/**
 * GET /api/admin/installations/pending-material-returns
 * Fetch all declared fitting material returns pending Store Manager verification
 */
router.get('/pending-material-returns', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const materialReturns = await getPendingStoreMaterialReturns();
    return res.json(materialReturns);
  } catch (err) {
    console.error('Error fetching pending material returns:', err);
    return res.status(500).json({ error: 'Failed to fetch pending store material returns' });
  }
});

/**
 * GET /api/admin/installations/technician-expenses/monthly-summary
 * Fetch current month submitted expenses total for the authenticated technician
 */
router.get('/technician-expenses/monthly-summary', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const techId = req.profile?.id;
    const techName = req.profile?.full_name || req.profile?.email;
    const total = await getTechnicianCurrentMonthTotal(techId, techName);
    return res.json({ total, technician_id: techId, technician_name: techName });
  } catch (err) {
    console.error('Error fetching monthly expense summary:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch monthly expense summary' });
  }
});

/**
 * GET /api/admin/installations
 * List installation checklists with search, filters, pagination (Accessible to all authorized roles)
 */
router.get('/', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'), async (req, res) => {
  try {
    const result = await getChecklists(req.query);
    if (result && Array.isArray(result.checklists)) {
      result.checklists = await enrichChecklistsWithWorkflowStatus(result.checklists);
    }
    return res.json(result);
  } catch (err) {
    console.error('Error in GET /installations:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch installation checklists' });
  }
});

/**
 * GET /api/admin/installations/:id
 * Get single installation checklist by ID (Accessible to all authorized roles)
 */
router.get('/:id', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'), async (req, res) => {
  try {
    let item = await getChecklistById(req.params.id);
    if (item) {
      const enriched = await enrichChecklistsWithWorkflowStatus([item]);
      item = enriched[0] || item;
    }
    return res.json(item);
  } catch (err) {
    console.error('Error in GET /installations/:id:', err);
    return res.status(404).json({ error: err.message || 'Installation checklist not found' });
  }
});

/**
 * GET /api/admin/installations/:id/pdf
 * Download PDF for an installation checklist (Accessible to all authorized roles)
 */
router.get('/:id/pdf', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'), async (req, res) => {
  try {
    let item = await getChecklistById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Installation checklist not found' });
    }

    const enriched = await enrichChecklistsWithWorkflowStatus([item]);
    item = enriched[0] || item;

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
 * GET /api/admin/installations/:id/store-pdf
 * Download dedicated Store Manager — Device & Material Requirement Sheet PDF
 * Accessible to all authenticated staff (Store Manager, Admin, Tech, Sales)
 */
router.get('/:id/store-pdf', requireRole('STORE_MANAGER', 'ADMIN', 'TECHNICAL', 'SALES'), async (req, res) => {
  try {
    let requirement = null;
    try {
      requirement = await getStoreMaterialRequirementById(req.params.id);
    } catch (e) {
      const item = await getChecklistById(req.params.id);
      if (item) {
        requirement = await syncStoreRequirementForChecklist(item);
      }
    }

    if (!requirement) {
      return res.status(404).json({ error: 'Store material requirement record not found' });
    }

    const pdfBuffer = await generateStoreManagerRequirementPDF(requirement);
    const filename = `Store-Requirements-${requirement.checklist_number}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error in GET /installations/:id/store-pdf:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate Store Manager requirement PDF' });
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

    if (!parsed.data.salesperson_name || !SALESPERSON_OPTIONS.includes(parsed.data.salesperson_name)) {
      return res.status(400).json({
        error: 'Salesperson Name is required. Please select one of the authorized salespeople: Ranjith, Abinaya, Kavitha, Kavitha Balu, or Padmapriya.',
      });
    }

    const created = await createChecklist(req.profile.id, parsed.data);
    return res.status(201).json(created);
  } catch (err) {
    console.error('Error in POST /installations:', err);
    const isConflict = err.statusCode === 409 || err.message?.includes('Booking Conflict') || err.message?.includes('already booked');
    const status = isConflict ? 409 : 500;
    return res.status(status).json({
      error: err.message || 'Failed to create installation checklist',
      conflict: err.conflict || null,
    });
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
    const isConflict = err.statusCode === 409 || err.message?.includes('Booking Conflict') || err.message?.includes('already booked');
    const status = isConflict ? 409 : 500;
    return res.status(status).json({
      error: err.message || 'Failed to update installation checklist',
      conflict: err.conflict || null,
    });
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
 * GET /api/admin/installations/:id/carry-record
 * Fetch pre-installation device carry record for job
 */
router.get('/:id/carry-record', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const record = await getDeviceCarryRecord(req.params.id);
    return res.json(record || { checklist_id: req.params.id, items: [], status: 'NOT_RECORDED' });
  } catch (err) {
    console.error('Error fetching carry record:', err);
    return res.status(500).json({ error: 'Failed to fetch device carry record' });
  }
});

/**
 * POST /api/admin/installations/:id/carry-record
 * Submit Pre-Installation Device Carry Form (TECHNICAL, ADMIN)
 */
router.post('/:id/carry-record', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { items, remarks } = req.body;
    const result = await submitDeviceCarryRecord({
      checklist_id: req.params.id,
      user: req.profile,
      items,
      remarks,
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error('Error submitting carry record:', err);
    return res.status(400).json({ error: err.message || 'Failed to submit device carry record' });
  }
});

/**
 * POST /api/admin/installations/:id/start-installation
 * Start installation work after completing mandatory carry form (TECHNICAL, ADMIN)
 */
router.post('/:id/start-installation', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const result = await startInstallationJob({
      checklist_id: req.params.id,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error starting installation:', err);
    return res.status(400).json({ error: err.message || 'Failed to start installation job' });
  }
});

/**
 * GET /api/admin/installations/:id/completion-report
 * Fetch post-installation completion report for job
 */
router.get('/:id/completion-report', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const report = await getInstallationCompletionReport(req.params.id);
    return res.json(report || { checklist_id: req.params.id, items: [] });
  } catch (err) {
    console.error('Error fetching completion report:', err);
    return res.status(500).json({ error: 'Failed to fetch completion report' });
  }
});

/**
 * POST /api/admin/installations/:id/completion-report
 * Submit Post-Installation Completion Form (TECHNICAL, ADMIN)
 */
router.post('/:id/completion-report', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { items, device_items, completion_status, remarks, material_items, materials } = req.body;
    const result = await submitInstallationCompletionReport({
      checklist_id: req.params.id,
      user: req.profile,
      items: items || device_items,
      material_items: material_items || materials,
      completion_status,
      remarks,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error submitting completion report:', err);
    return res.status(400).json({ error: err.message || 'Failed to submit completion report' });
  }
});

/**
 * GET /api/admin/installations/:id/final-bom
 * Fetch Final BOM based on devices actually installed + Preliminary vs Final comparison
 */
router.get('/:id/final-bom', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    let item = await getChecklistById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Installation checklist not found' });
    }
    const enriched = await enrichChecklistsWithWorkflowStatus([item]);
    item = enriched[0] || item;

    const report = await getInstallationCompletionReport(item.id);

    return res.json({
      checklist_id: item.id,
      checklist_number: item.checklist_number,
      client_name: item.client_name,
      installation_status: item.installation_status,
      reconciliation_status: item.reconciliation_status,
      material_return_status: item.material_return_status,
      preliminary_bom_snapshot: item.bom_snapshot,
      final_bom_snapshot: item.final_bom_snapshot || report?.final_bom || report?.final_bom_snapshot,
      actual_materials_used: item.actual_materials_used || report?.material_items?.filter((m) => m.quantity_used > 0) || [],
      actual_materials_returned: item.actual_materials_returned || report?.material_items?.filter((m) => m.quantity_returned > 0) || [],
      devices_carried: item.devices_carried,
      device_returns: item.device_returns || item.returns || [],
      material_returns: item.material_returns || [],
    });
  } catch (err) {
    console.error('Error in GET /installations/:id/final-bom:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch final BOM details' });
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
 * Stage 5B: STORE_MANAGER physically verifies returned materials and credits usable stock
 * POST /api/admin/installations/:id/verify-material-return
 */
router.post('/:id/verify-material-return', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { return_id, accepted_usable_qty, damaged_qty, missing_qty, items, remarks } = req.body;
    const result = await verifyStoreMaterialReturn({
      checklist_id: req.params.id,
      return_id,
      accepted_usable_qty: accepted_usable_qty !== undefined ? parseFloat(accepted_usable_qty) : undefined,
      damaged_qty: parseFloat(damaged_qty) || 0,
      missing_qty: parseFloat(missing_qty) || 0,
      items,
      user: req.profile,
      remarks,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /installations/:id/verify-material-return:', err);
    return res.status(400).json({ error: err.message || 'Failed to verify store material return' });
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

/**
 * Stage 7A: GET /api/admin/installations/:id/expenses
 * Retrieve recorded technician expenses for this job
 * Strictly restricted to TECHNICAL and ADMIN roles
 */
router.get('/:id/expenses', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const result = await getExpensesForChecklist(req.params.id, req.profile);
    return res.json(result);
  } catch (err) {
    console.error('Error in GET /installations/:id/expenses:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to fetch expenses for job' });
  }
});

/**
 * Stage 7B: POST /api/admin/installations/:id/expenses
 * Record or save technician expenses after post-installation report submission
 * Strictly restricted to TECHNICAL and ADMIN roles
 */
router.post('/:id/expenses', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { expenses, is_draft, idempotency_key, delete_ids } = req.body;
    const result = await saveJobExpenses({
      checklist_id: req.params.id,
      user: req.profile,
      expenses,
      is_draft: Boolean(is_draft),
      idempotency_key,
      delete_ids,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /installations/:id/expenses:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to record expenses' });
  }
});

/**
 * Stage 7C: GET /api/admin/installations/:id/expenses/pdf
 * Generate and download or print A4 Technician Expense Report PDF
 * Strictly restricted to TECHNICAL and ADMIN roles
 */
router.get('/:id/expenses/pdf', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { pdfBuffer, checklist } = await generateTechnicianExpensePDFForChecklist(req.params.id, req.profile);
    const filename = `Expense-Report-${checklist.checklist_number}.pdf`;

    const isInline = req.query.inline === 'true' || req.query.print === 'true';
    const dispositionType = isInline ? 'inline' : 'attachment';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error in GET /installations/:id/expenses/pdf:', err);
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Failed to generate technician expense PDF' });
  }
});

/**
 * Stage 7C: POST /api/admin/installations/:id/expenses/receipt
 * Upload receipt photo or PDF for an expense entry
 */
router.post('/:id/expenses/receipt', requireRole('TECHNICAL', 'ADMIN'), (req, res) => {
  uploadReceipt.single('receipt')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Receipt file is required' });
    }
    try {
      const uploadRes = await uploadExpenseReceipt({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        checklist_id: req.params.id,
      });
      return res.json(uploadRes);
    } catch (uploadErr) {
      console.error('Error uploading receipt:', uploadErr);
      const status = uploadErr.statusCode || 500;
      return res.status(status).json({ error: uploadErr.message || 'Failed to upload receipt' });
    }
  });
});

/**
 * POST /api/admin/installations/:id/request-extension
 * Technician submits schedule extension request (TECHNICAL, ADMIN)
 */
router.post('/:id/request-extension', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const {
      requested_completion_date,
      requested_return_travel_date,
      additional_working_days,
      rest_day_requested,
      requested_rest_date,
      reason,
      notes,
    } = req.body;

    const result = await requestScheduleExtension({
      checklistId: req.params.id,
      user: req.profile || req.user,
      requestedCompletionDate: requested_completion_date,
      requestedReturnTravelDate: requested_return_travel_date,
      additionalWorkingDays: additional_working_days,
      restDayRequested: rest_day_requested,
      requestedRestDate: requested_rest_date,
      reason,
      notes,
    });

    return res.status(201).json({ success: true, extension: result });
  } catch (err) {
    console.error('Error in POST /installations/:id/request-extension:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to submit extension request' });
  }
});

/**
 * GET /api/admin/installations/:id/extension-requests
 * Fetch extension requests for a checklist
 */
router.get('/:id/extension-requests', requireRole('TECHNICAL', 'ADMIN', 'COORDINATOR', 'SALES'), async (req, res) => {
  try {
    const requests = await getExtensionRequests({ checklistId: req.params.id });
    return res.json({ requests });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch extension requests' });
  }
});

/**
 * POST /api/admin/installations/rest-days/request
 * Technician requests rest day
 */
router.post('/rest-days/request', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { engineer_name, checklist_id, checklist_number, rest_start_date, rest_end_date, reason, notes } = req.body;
    const result = await requestRestDay({
      engineerIdOrName: engineer_name || req.profile?.full_name || req.profile?.email,
      checklistId: checklist_id,
      checklistNumber: checklist_number,
      restStartDate: rest_start_date,
      restEndDate: rest_end_date,
      reason,
      notes,
      user: req.profile || req.user,
    });
    return res.status(201).json({ success: true, rest_day: result });
  } catch (err) {
    console.error('Error requesting rest day:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to request rest day' });
  }
});

/**
 * GET /api/admin/installations/rest-days
 */
router.get('/rest-days', requireRole('TECHNICAL', 'ADMIN', 'COORDINATOR'), async (req, res) => {
  try {
    const list = await getRestDays(req.query);
    return res.json({ rest_days: list });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch rest days' });
  }
});

/**
 * POST /api/admin/installations/leaves/request
 * Technician requests leave
 */
router.post('/leaves/request', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { engineer_name, leave_start_date, leave_end_date, leave_type, reason, notes } = req.body;
    const result = await requestLeave({
      engineerIdOrName: engineer_name || req.profile?.full_name || req.profile?.email,
      leaveStartDate: leave_start_date,
      leaveEndDate: leave_end_date,
      leaveType: leave_type,
      reason,
      notes,
      user: req.profile || req.user,
    });
    return res.status(201).json({ success: true, leave: result });
  } catch (err) {
    console.error('Error requesting leave:', err);
    const status = err.statusCode || 400;
    return res.status(status).json({ error: err.message || 'Failed to request leave' });
  }
});

/**
 * GET /api/admin/installations/leaves
 */
router.get('/leaves', requireRole('TECHNICAL', 'ADMIN', 'COORDINATOR'), async (req, res) => {
  try {
    const list = await getLeaveRequests(req.query);
    return res.json({ leaves: list });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch leaves' });
  }
});

/**
 * GET /api/admin/installations/:id/schedule-history
 */
router.get('/:id/schedule-history', requireRole('TECHNICAL', 'ADMIN', 'COORDINATOR', 'SALES'), async (req, res) => {
  try {
    const history = await getScheduleRevisionHistory(req.params.id);
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch schedule history' });
  }
});

/**
 * GET /api/admin/installations/notifications/tech
 */
router.get('/notifications/tech', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const notifs = await getNotifications({ role: 'TECHNICAL', userId: req.profile?.id, limit: 50 });
    return res.json({ notifications: notifs });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch technician notifications' });
  }
});

/**
 * GET /api/admin/installations/backup-products
 * Available inventory items and units for loose backup item declaration
 */
router.get('/backup-products', requireRole('TECHNICAL', 'ADMIN', 'STORE_MANAGER', 'SALES', 'COORDINATOR'), async (req, res) => {
  try {
    const products = await getAvailableBackupProducts();
    return res.json({ products });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch backup products: ' + err.message });
  }
});

/**
 * GET /api/admin/installations/:id/backup-declaration
 * Fetch pre-installation backup declaration for a checklist
 */
router.get('/:id/backup-declaration', requireRole('TECHNICAL', 'ADMIN', 'STORE_MANAGER', 'SALES', 'COORDINATOR'), async (req, res) => {
  try {
    const declaration = await getBackupDeclaration(req.params.id);
    return res.json({ declaration });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch backup declaration: ' + err.message });
  }
});

/**
 * POST /api/admin/installations/:id/backup-declaration
 * Technician saves / corrects pre-installation backup item declaration
 */
router.post('/:id/backup-declaration', requireRole('TECHNICAL', 'ADMIN'), async (req, res) => {
  try {
    const { has_backup_items, no_items_reason, items } = req.body;
    const declaration = await saveBackupDeclaration({
      checklistId: req.params.id,
      user: req.profile || req.user,
      hasBackupItems: has_backup_items,
      noItemsReason: no_items_reason,
      items: items || [],
    });
    return res.json({ success: true, declaration });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/admin/installations/:id/backup-returns/verify
 * Store Manager physically verifies returned loose backup items and restores usable stock
 */
router.post('/:id/backup-returns/verify', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { verification_items, remarks } = req.body;
    const result = await verifyStoreBackupItemReturn({
      checklistId: req.params.id,
      user: req.profile || req.user,
      verificationItems: verification_items || [],
      remarks,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;

