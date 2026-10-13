import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import {
  getInventoryProducts,
  getInventorySummary,
  getInventoryTransactions,
  receiveNewStock,
  adjustStock,
  setDeviceOpeningStock,
  issueDevicesForChecklist,
  addNewDeviceProduct,
} from '../services/inventoryService.js';
import {
  getMaterialTransactions,
} from '../services/materialStockService.js';
import {
  getAllStoreReturns,
  getPendingStoreReturns,
  getAllStoreMaterialReturns,
  verifyStoreReturn,
  verifyStoreMaterialReturn,
} from '../services/workflowService.js';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * GET /api/admin/inventory
 * Accessible to STORE_MANAGER, ADMIN
 */
router.get('/', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const products = await getInventoryProducts();
    return res.json(products);
  } catch (err) {
    console.error('Error in GET /inventory:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch inventory' });
  }
});

/**
 * POST /api/admin/inventory/products
 * and alias POST /api/admin/inventory/devices
 * Add new camera device model to inventory
 * Accessible to STORE_MANAGER, ADMIN
 */
router.post('/products', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { device_name, device_type, sku, opening_quantity, min_stock_level, unit } = req.body;
    const result = await addNewDeviceProduct({
      device_name,
      device_type,
      sku,
      opening_quantity,
      min_stock_level,
      unit,
      user: req.profile,
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error('Error in POST /inventory/products:', err);
    return res.status(400).json({ error: err.message || 'Failed to add device product' });
  }
});

router.post('/devices', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { device_name, device_type, sku, opening_quantity, min_stock_level, unit } = req.body;
    const result = await addNewDeviceProduct({
      device_name,
      device_type,
      sku,
      opening_quantity,
      min_stock_level,
      unit,
      user: req.profile,
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error('Error in POST /inventory/devices:', err);
    return res.status(400).json({ error: err.message || 'Failed to add device product' });
  }
});

/**
 * GET /api/admin/inventory/summary
 * Accessible to STORE_MANAGER, ADMIN
 */
router.get('/summary', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const summary = await getInventorySummary();
    return res.json(summary);
  } catch (err) {
    console.error('Error in GET /inventory/summary:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch inventory summary' });
  }
});

/**
 * GET /api/admin/inventory/transactions
 * Accessible to STORE_MANAGER, ADMIN
 */
router.get('/transactions', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const result = await getInventoryTransactions(req.query);
    return res.json(result);
  } catch (err) {
    console.error('Error in GET /inventory/transactions:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch inventory transactions' });
  }
});

/**
 * GET /api/admin/inventory/all-movements
 * Returns unified auditable movements across BOTH camera devices and installation materials
 */
router.get('/all-movements', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { category = 'All', search = '', type = '' } = req.query;

    const [devTx, matTx] = await Promise.all([
      category === 'Materials' ? { transactions: [] } : getInventoryTransactions({ limit: 100, search, type }),
      category === 'Devices' ? { transactions: [] } : getMaterialTransactions({ limit: 100, search, type }),
    ]);

    const formattedDevs = (devTx.transactions || []).map((t) => ({
      ...t,
      category: 'Camera Device',
      item_name: t.device_name || t.device_type,
      unit: 'Nos.',
    }));

    const formattedMats = (matTx.transactions || []).map((t) => ({
      ...t,
      category: 'Installation Material',
      item_name: t.material_name,
      unit: t.unit || 'Nos.',
    }));

    const combined = [...formattedDevs, ...formattedMats].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return res.json({
      transactions: combined,
      totalCount: combined.length,
    });
  } catch (err) {
    console.error('Error in GET /inventory/all-movements:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch combined movements' });
  }
});

/**
 * POST /api/admin/inventory/opening-stock
 * Set actual opening quantity for a camera device (STORE_MANAGER, ADMIN)
 * Opening stock is NOT assumed; Store Manager enters actual count.
 */
router.post('/opening-stock', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { device_type, product_id, opening_quantity, reason } = req.body;
    const result = await setDeviceOpeningStock({
      device_type,
      product_id,
      opening_quantity,
      reason,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /inventory/opening-stock:', err);
    return res.status(400).json({ error: err.message || 'Failed to set opening quantity' });
  }
});

/**
 * POST /api/admin/inventory/receive
 * Receive new stock batch (STORE_MANAGER, ADMIN)
 */
router.post('/receive', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
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
 * POST /api/admin/inventory/adjust
 * Adjust or Edit stock balances (Add, Remove, Set with reason)
 * Accessible to STORE_MANAGER, ADMIN
 */
router.post('/adjust', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { device_type, action, quantity, reason, move_to_damaged } = req.body;
    const result = await adjustStock({
      device_type,
      action,
      quantity,
      reason,
      move_to_damaged: Boolean(move_to_damaged),
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error in POST /inventory/adjust:', err);
    return res.status(400).json({ error: err.message || 'Failed to adjust stock' });
  }
});

/**
 * POST /api/admin/inventory/issue-devices
 * Server-side atomic issuance of camera devices for a checklist
 */
router.post('/issue-devices', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { checklist_id, devices, remarks } = req.body;
    const result = await issueDevicesForChecklist({
      checklist_id,
      devices,
      remarks,
      user: req.profile,
    });
    return res.json(result);
  } catch (err) {
    console.error('Error issuing devices for checklist:', err);
    return res.status(400).json({ error: err.message || 'Failed to issue devices' });
  }
});

/**
 * GET /api/admin/inventory/returns
 * Fetch all declared device returns (STORE_MANAGER, ADMIN)
 */
router.get('/returns', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const deviceReturns = await getAllStoreReturns();
    const materialReturns = await getAllStoreMaterialReturns();
    const formattedDevice = (deviceReturns || []).map((r) => ({ ...r, return_category: 'DEVICE' }));
    const formattedMaterial = (materialReturns || []).map((r) => ({
      ...r,
      return_category: 'MATERIAL',
      device_type: `${r.material_name} (${r.unit || 'Nos.'})`,
    }));
    return res.json([...formattedDevice, ...formattedMaterial]);
  } catch (err) {
    console.error('Error in GET /inventory/returns:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch store returns' });
  }
});

/**
 * POST /api/admin/inventory/verify-return
 * Verify physical store return for devices or materials (STORE_MANAGER, ADMIN)
 */
router.post('/verify-return', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { return_id, return_category, is_material, accepted_usable_qty, damaged_qty, missing_qty, remarks } = req.body;
    if (!return_id) {
      return res.status(400).json({ error: 'return_id is required' });
    }

    const isMat = return_category === 'MATERIAL' || is_material || String(return_id).startsWith('matret-');

    if (isMat) {
      const result = await verifyStoreMaterialReturn({
        return_id,
        accepted_usable_qty: accepted_usable_qty !== undefined ? parseFloat(accepted_usable_qty) : 0,
        damaged_qty: parseFloat(damaged_qty) || 0,
        missing_qty: parseFloat(missing_qty) || 0,
        user: req.profile,
        remarks,
      });
      return res.json(result);
    }

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
    console.error('Error in POST /inventory/verify-return:', err);
    return res.status(400).json({ error: err.message || 'Failed to verify store return' });
  }
});

/**
 * GET /api/admin/inventory/discrepancies
 */
router.get('/discrepancies', requireRole('STORE_MANAGER', 'ADMIN'), async (req, res) => {
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
