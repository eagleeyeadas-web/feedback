import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import supabase from '../services/supabase.js';
import { logAudit } from '../services/auditService.js';

const router = Router();
router.use(requireAdmin);

/**
 * GET /api/admin/users
 * List all employee accounts with role
 */
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return res.json(data || []);
  } catch (err) {
    console.error('Error in GET /users:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch employee users' });
  }
});

/**
 * POST /api/admin/users
 * Create a new employee user account (ADMIN only)
 */
router.post('/', async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }

    const validRoles = ['ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'];
    const normalizedRole = String(role).toUpperCase();
    if (!validRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    // 1. Create auth user in Supabase Auth via Admin API
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: normalizedRole },
    });

    if (authErr) throw new Error(authErr.message);

    // 2. Insert user profile into admin_users
    const profile = {
      id: authData.user.id,
      email,
      full_name: full_name || '',
      role: normalizedRole,
      is_active: true,
    };

    const { data: created, error: profileErr } = await supabase
      .from('admin_users')
      .upsert([profile])
      .select()
      .single();

    if (profileErr) throw new Error(profileErr.message);

    await logAudit({
      actor_id: req.profile.id,
      actor_email: req.profile.email,
      actor_role: req.profile.role,
      action: 'CREATE_EMPLOYEE_USER',
      target_table: 'admin_users',
      target_id: created.id,
      details: { email, role: normalizedRole },
    });

    return res.status(201).json(created);
  } catch (err) {
    console.error('Error in POST /users:', err);
    return res.status(400).json({ error: err.message || 'Failed to create employee user' });
  }
});

/**
 * PUT /api/admin/users/:id
 * Update an employee user role or active status (ADMIN only)
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { role, is_active, full_name } = req.body;

    const validRoles = ['ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'];
    const updateData = {};

    if (role) {
      const normalizedRole = String(role).toUpperCase();
      if (!validRoles.includes(normalizedRole)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }
      updateData.role = normalizedRole;
    }

    if (typeof is_active === 'boolean') updateData.is_active = is_active;
    if (full_name !== undefined) updateData.full_name = full_name;

    const { data: updated, error } = await supabase
      .from('admin_users')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    await logAudit({
      actor_id: req.profile.id,
      actor_email: req.profile.email,
      actor_role: req.profile.role,
      action: 'UPDATE_EMPLOYEE_USER',
      target_table: 'admin_users',
      target_id: id,
      details: updateData,
    });

    return res.json(updated);
  } catch (err) {
    console.error('Error in PUT /users/:id:', err);
    return res.status(400).json({ error: err.message || 'Failed to update employee user' });
  }
});

export default router;
