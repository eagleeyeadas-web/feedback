import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getMaterialInventory,
  setMaterialOpeningStock,
  adjustMaterialStock,
  issueMaterialsForChecklist,
  getMaterialTransactions,
} from '../services/materialStockService.js';
import {
  getStoreMaterialRequirements,
  getStoreMaterialRequirementById,
  syncStoreRequirementForChecklist,
  issueFullJobStock,
  issueServiceJobStock,
} from '../services/storeRequirementService.js';
import {
  issueExtraBackupDevices,
  rejectExtraBackupDevices,
} from '../services/backupItemService.js';
import { generateStoreManagerRequirementPDF } from '../services/storeManagerPdfGenerator.js';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * GET /api/admin/materials
 * List all materials and current inventory balances
 */
router.get('/', requireRole('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'), async (req, res) => {
  try {
    const materials = await getMaterialInventory();
    return res.json(materials);
  } catch (err) {
    console.error('Error fetching materials:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch material inventory' });
  }
});

/**
 * GET /api/admin/materials/transactions
 * Get material stock movement and issuance records
 */
router.get('/transactions', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const result = await getMaterialTransactions(req.query);
    return res.json(result);
  } catch (err) {
    console.error('Error fetching material transactions:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch material transactions' });
  }
});

/**
 * POST /api/admin/materials/opening-stock
 * Explicitly set Opening Stock for a material (Store Manager / Admin only)
 * Does not add on top of existing stock; sets explicit opening baseline.
 */
router.post('/opening-stock', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { material_name, material_id, opening_stock, reason } = req.body;
    const result = await setMaterialOpeningStock({
      material_name,
      material_id,
      opening_stock,
      reason,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error setting material opening stock:', err);
    return res.status(400).json({ error: err.message || 'Failed to set opening stock' });
  }
});

/**
 * POST /api/admin/materials/adjust
 * Adjust or Restock material inventory balances (Add, Remove, Set)
 */
router.post('/adjust', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { material_name, action, quantity, reason } = req.body;
    const result = await adjustMaterialStock({
      material_name,
      action,
      quantity,
      reason,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error adjusting material stock:', err);
    return res.status(400).json({ error: err.message || 'Failed to adjust material stock' });
  }
});

/**
 * POST /api/admin/materials/issue-for-checklist
 * Authorized stock-issuance action for a checklist.
 * Server-side atomic transaction with auditable stock movement record.
 */
router.post('/issue-for-checklist', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { checklist_id, items, remarks } = req.body;
    const result = await issueMaterialsForChecklist({
      checklist_id,
      items,
      remarks,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error issuing materials for checklist:', err);
    return res.status(400).json({ error: err.message || 'Failed to issue materials' });
  }
});

/**
 * POST /api/admin/materials/issue-full-job
 * Unified atomic issuance of BOTH camera devices AND installation materials for a checklist.
 */
router.post('/issue-full-job', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { checklist_id, issue_devices, issue_materials, issue_backup_items, remarks } = req.body;
    const result = await issueFullJobStock({
      checklist_id,
      issue_devices: issue_devices !== undefined ? Boolean(issue_devices) : true,
      issue_materials: issue_materials !== undefined ? Boolean(issue_materials) : true,
      issue_backup_items: issue_backup_items !== undefined ? Boolean(issue_backup_items) : true,
      remarks,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    if (err.already_issued || err.code === 'ALREADY_ISSUED' || err.status === 409 || err.message?.includes('already been issued')) {
      return res.status(409).json({
        error: err.message,
        already_issued: true,
        stock_issuance_status: 'Completed',
        is_issued: true,
        checklist_id: req.body?.checklist_id,
      });
    }
    console.error('Error issuing full job stock:', err);
    return res.status(400).json({ error: err.message || 'Failed to issue job stock' });
  }
});

/**
 * POST /api/admin/materials/issue-service-stock
 * Issue requested devices and materials for a Service job.
 */
router.post('/issue-service-stock', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { checklist_id, items, remarks } = req.body;
    const result = await issueServiceJobStock({
      checklist_id,
      items,
      remarks,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error issuing service job stock:', err);
    return res.status(400).json({ error: err.message || 'Failed to issue service job stock' });
  }
});

/**
 * POST /api/admin/materials/issue-extra-devices
 * Explicit Store Manager review and authorized issuance of technician extra backup devices.
 * Supports partial issuance, verifies usable stock, records ledger movement, and updates status.
 */
router.post('/issue-extra-devices', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { checklist_id, items, remarks } = req.body;
    const result = await issueExtraBackupDevices({
      checklist_id,
      items,
      remarks,
      user: req.profile || req.user,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error issuing extra backup devices:', err);
    return res.status(400).json({ error: err.message || 'Failed to issue extra backup devices' });
  }
});

/**
 * POST /api/admin/materials/reject-extra-devices
 * Store Manager explicitly rejects technician's extra backup devices request.
 */
router.post('/reject-extra-devices', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { checklist_id, reason } = req.body;
    const result = await rejectExtraBackupDevices({
      checklist_id,
      reason,
      user: req.profile || req.user,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error rejecting extra backup devices:', err);
    return res.status(400).json({ error: err.message || 'Failed to reject extra backup devices' });
  }
});

/**
 * GET /api/admin/materials/requirements
 * List all installation and service material requirements for Store Manager
 */
router.get('/requirements', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const result = await getStoreMaterialRequirements(req.query);
    return res.json(result);
  } catch (err) {
    console.error('Error fetching store material requirements:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch store requirements' });
  }
});

/**
 * GET /api/admin/materials/requirements/:id
 */
router.get('/requirements/:id', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const requirement = await getStoreMaterialRequirementById(req.params.id);
    return res.json(requirement);
  } catch (err) {
    console.error('Error fetching requirement detail:', err);
    return res.status(404).json({ error: err.message || 'Requirement not found' });
  }
});

/**
 * GET /api/admin/materials/requirements/:id/pdf
 * Download dedicated Store Manager — Device & Material Requirement Sheet PDF
 * Focuses strictly on client, location, devices, assigned team, and calculated BOM requirements with live shortages.
 * Excludes customer selling price, payment methods, advance, and pending payments.
 */
router.get('/requirements/:id/pdf', requireRole('STORE_MANAGER', 'ADMIN', 'TECHNICAL', 'SALES'), async (req, res) => {
  try {
    const requirement = await getStoreMaterialRequirementById(req.params.id);
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
    console.error('Error generating Store Manager requirement PDF:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate Store Manager requirement PDF' });
  }
});

/**
 * POST /api/admin/materials/requirements/sync
 */
router.post('/requirements/sync', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { data: checklists, error } = await supabase
      .from('installation_checklists')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    let synced = 0;
    if (Array.isArray(checklists)) {
      for (const chk of checklists) {
        await syncStoreRequirementForChecklist(chk);
        synced++;
      }
    }
    return res.json({ success: true, synced_count: synced });
  } catch (err) {
    console.error('Error syncing store requirements:', err);
    return res.status(500).json({ error: err.message || 'Failed to sync requirements' });
  }
});

export default router;
