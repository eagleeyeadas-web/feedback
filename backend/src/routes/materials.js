import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getMaterialInventory,
  adjustMaterialStock,
  issueMaterialsForChecklist,
  getMaterialTransactions,
} from '../services/materialStockService.js';
import {
  getStoreMaterialRequirements,
  getStoreMaterialRequirementById,
  syncStoreRequirementForChecklist,
} from '../services/storeRequirementService.js';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * GET /api/admin/materials
 * List all materials and current inventory balances
 * Accessible to STORE_MANAGER, ADMIN, TECHNICAL, SALES
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
 * Accessible to STORE_MANAGER, ADMIN
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
 * POST /api/admin/materials/adjust
 * Adjust or Restock material inventory balances (Add, Remove, Set)
 * Accessible ONLY to STORE_MANAGER, ADMIN
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
 * Accessible ONLY to STORE_MANAGER, ADMIN
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
 * GET /api/admin/materials/requirements
 * List all installation and service material requirements for Store Manager
 * With live stock levels, shortages, and filters
 * Accessible to STORE_MANAGER, ADMIN
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
 * Retrieve specific store requirement details
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
 * Idempotently sync / backfill requirements from existing checklists
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
