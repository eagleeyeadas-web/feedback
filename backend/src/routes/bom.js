import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getAllBoms,
  getBomByDeviceType,
  calculateBomRequirements,
  calculateJobPreliminaryBom,
  calculateJobFinalBom,
  updateDeviceBom,
  resetBomToTemplate,
  getChecklistBomHistory,
  COMMON_UNITS,
  STANDARD_DEVICE_TYPES,
} from '../services/bomService.js';

const router = Router();

/**
 * GET /api/admin/bom/units
 * List supported/common measurement units
 * Accessible to all staff
 */
router.get('/units', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), (req, res) => {
  return res.json({
    units: COMMON_UNITS,
    device_types: STANDARD_DEVICE_TYPES,
  });
});

/**
 * GET /api/admin/bom/history
 * Review which BOM version was used for installation checklists
 * Accessible to STORE_MANAGER, ADMIN
 */
router.get('/history', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const result = await getChecklistBomHistory(req.query);
    return res.json(result);
  } catch (err) {
    console.error('Error fetching checklist BOM history:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch BOM history' });
  }
});

/**
 * POST /api/admin/bom/calculate
 * Live preliminary calculation endpoint for Sales Installation Checklist:
 * Calculates BOM for required devices, extra devices, and combined preliminary BOM for all carried devices.
 * Accessible to all roles (SALES, ADMIN, STORE_MANAGER, TECHNICAL)
 */
router.post('/calculate', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const {
      device_type,
      number_of_devices,
      device_configurations,
      extra_device_configurations,
      extra_devices,
      extra_device_type,
      extra_device_count,
      has_extra_devices,
      job_type,
      installation_or_service,
    } = req.body;
    const effectiveJobType = job_type || installation_or_service;

    // Reject or ignore BOM calculation requests for Service jobs
    if (effectiveJobType === 'Service') {
      return res.json({
        applicable: false,
        configured: false,
        job_type: 'Service',
        message: 'BOM calculations are only applicable for Installation jobs, not Service jobs.',
        device_configurations: [],
        items: [],
        total_devices: 0,
      });
    }

    if (!device_configurations && !device_type) {
      return res.status(400).json({ error: 'device_configurations or device_type is required' });
    }

    const requiredConfigs = device_configurations || [{ device_type, number_of_devices: number_of_devices || 1 }];
    const extraConfigs = extra_device_configurations || ((has_extra_devices || extra_devices) ? req.body : []);

    const calculation = await calculateJobPreliminaryBom({
      requiredConfigs,
      extraConfigs,
    });

    return res.json(calculation);
  } catch (err) {
    console.error('Error calculating preliminary BOM:', err);
    return res.status(500).json({ error: err.message || 'Failed to calculate preliminary BOM' });
  }
});

/**
 * POST /api/admin/bom/calculate-final
 * Calculates Final BOM for devices actually installed, including extra devices installed.
 * Excludes unused extra devices.
 * Returns Preliminary vs Final BOM comparison with differences and actual material usage.
 */
router.post('/calculate-final', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const {
      installed_device_configurations,
      device_items,
      preliminary_bom_snapshot,
      actual_materials_issued,
      actual_materials_used,
      actual_materials_returned,
    } = req.body;

    const calculation = await calculateJobFinalBom({
      installedDeviceConfigs: installed_device_configurations || device_items || [],
      preliminaryBomSnapshot: preliminary_bom_snapshot,
      actualMaterialsIssued: actual_materials_issued || [],
      actualMaterialsUsed: actual_materials_used || [],
      actualMaterialsReturned: actual_materials_returned || [],
    });

    return res.json(calculation);
  } catch (err) {
    console.error('Error calculating Final BOM:', err);
    return res.status(500).json({ error: err.message || 'Failed to calculate Final BOM' });
  }
});

/**
 * GET /api/admin/bom
 * Get all BOMs by device type
 * Accessible to all authenticated staff
 */
router.get('/', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const boms = await getAllBoms();
    return res.json(boms);
  } catch (err) {
    console.error('Error in GET /bom:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch BOMs' });
  }
});

/**
 * GET /api/admin/bom/:deviceType
 * Get specific BOM configuration by device type
 * Accessible to all authenticated staff
 */
router.get('/:deviceType', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const bom = await getBomByDeviceType(req.params.deviceType);
    if (!bom) {
      return res.status(404).json({
        configured: false,
        device_type: req.params.deviceType,
        warning: `No BOM configured for "${req.params.deviceType}".`,
      });
    }
    return res.json(bom);
  } catch (err) {
    console.error(`Error in GET /bom/${req.params.deviceType}:`, err);
    return res.status(500).json({ error: err.message || 'Failed to fetch BOM' });
  }
});

/**
 * PUT /api/admin/bom/:deviceType
 * Store Manager updates the BOM configuration for a device type.
 * Saves changes persistently in Supabase and increments version.
 * Accessible ONLY to STORE_MANAGER, ADMIN
 */
router.put('/:deviceType', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { items, notes, is_configured } = req.body;
    const updated = await updateDeviceBom(req.params.deviceType, {
      items,
      notes,
      is_configured,
      user: req.profile,
    });
    return res.json({
      success: true,
      message: `BOM for "${req.params.deviceType}" updated successfully to version v${updated.version}.`,
      bom: updated,
    });
  } catch (err) {
    console.error(`Error updating BOM for ${req.params.deviceType}:`, err);
    return res.status(400).json({ error: err.message || 'Failed to update BOM configuration' });
  }
});

/**
 * POST /api/admin/bom/:deviceType/reset
 * Reset device BOM to standard initial template
 * Accessible ONLY to STORE_MANAGER, ADMIN
 */
router.post('/:deviceType/reset', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const reset = await resetBomToTemplate(req.params.deviceType, req.profile);
    return res.json({
      success: true,
      message: `BOM for "${req.params.deviceType}" reset to default template.`,
      bom: reset,
    });
  } catch (err) {
    console.error(`Error resetting BOM for ${req.params.deviceType}:`, err);
    return res.status(400).json({ error: err.message || 'Failed to reset BOM' });
  }
});

export default router;
