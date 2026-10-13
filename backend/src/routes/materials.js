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
} from '../services/storeRequirementService.js';
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
    const { checklist_id, issue_devices, issue_materials, remarks } = req.body;
    const result = await issueFullJobStock({
      checklist_id,
      issue_devices: issue_devices !== undefined ? Boolean(issue_devices) : true,
      issue_materials: issue_materials !== undefined ? Boolean(issue_materials) : true,
      remarks,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error issuing full job stock:', err);
    return res.status(400).json({ error: err.message || 'Failed to issue job stock' });
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
 * POST /api/admin/materials/requirements/sync
 */
router.post('/requirements/sync', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { data: checklists, error } = await supabase
      .from('installation_checklists')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

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
