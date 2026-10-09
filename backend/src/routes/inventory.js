import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getInventoryProducts,
  getInventoryTransactions,
  receiveNewStock,
} from '../services/inventoryService.js';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * GET /api/admin/inventory
 * Accessible to STORE_MANAGER, SALES, TECHNICAL, ADMIN
 */
router.get('/', requireRole('STORE_MANAGER', 'SALES', 'TECHNICAL'), async (req, res) => {
  try {
    const products = await getInventoryProducts();
    return res.json(products);
  } catch (err) {
    console.error('Error in GET /inventory:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch inventory' });
  }
});

/**
 * GET /api/admin/inventory/transactions
 * Accessible to STORE_MANAGER, ADMIN
 */
router.get('/transactions', requireRole('STORE_MANAGER'), async (req, res) => {
  try {
    const result = await getInventoryTransactions(req.query);
    return res.json(result);
  } catch (err) {
    console.error('Error in GET /inventory/transactions:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch inventory transactions' });
  }
});

/**
 * POST /api/admin/inventory/receive
 * Receive new stock batch (STORE_MANAGER, ADMIN)
 */
router.post('/receive', requireRole('STORE_MANAGER'), async (req, res) => {
  try {
    const { device_type, quantity, supplier, purchase_ref, unit_cost, received_date, remarks } = req.body;
    const result = await receiveNewStock({
      device_type,
      quantity: parseInt(quantity, 10),
      user: req.profile,
      supplier,
      purchase_ref,
      unit_cost: unit_cost ? parseFloat(unit_cost) : null,
      received_date,
      remarks,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /inventory/receive:', err);
    return res.status(400).json({ error: err.message || 'Failed to receive stock' });
  }
});

/**
 * GET /api/admin/inventory/discrepancies
 * Accessible to STORE_MANAGER, ADMIN
 */
router.get('/discrepancies', requireRole('STORE_MANAGER'), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('inventory_discrepancies')
      .select('*, checklist:installation_checklists(checklist_number, client_name), author:admin_users(email, full_name)')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return res.json(data || []);
  } catch (err) {
    console.error('Error in GET /inventory/discrepancies:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch discrepancies' });
  }
});

export default router;
