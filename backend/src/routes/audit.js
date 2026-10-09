import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { getAuditLogs } from '../services/auditService.js';

const router = Router();
router.use(requireAdmin);

/**
 * GET /api/admin/audit-logs
 * List system audit logs (ADMIN only)
 */
router.get('/', async (req, res) => {
  try {
    const logs = await getAuditLogs(req.query);
    return res.json(logs);
  } catch (err) {
    console.error('Error in GET /audit-logs:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch audit logs' });
  }
});

export default router;
