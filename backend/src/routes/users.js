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
    const usersWithAccurateRoles = (data || []).map((u) => {
      const emailLower = (u.email || '').toLowerCase();
      let role = u.role;
      if (emailLower === 'sales@gmail.com') role = 'SALES';
      else if (emailLower === 'tech@gmail.com') role = 'TECHNICAL';
      else if (emailLower === 'store@gmail.com') role = 'STORE_MANAGER';
      else if (emailLower === 'coordinator@gmail.com') role = 'COORDINATOR';
      else if (emailLower === 'eagleeye@gmail.com') role = 'SUPER_ADMIN';
      else if (emailLower === 'admin@eagleeyesafdrive.com') role = 'ADMIN';
      return { ...u, role };
    });
    return res.json(usersWithAccurateRoles);
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

    const validRoles = ['ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'];
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
      app_metadata: { role: normalizedRole },
    });

    if (authErr) throw new Error(authErr.message);

    // 2. Insert user profile into admin_users (fallback to 'admin' if check constraint requires it)
    let profile = {
      id: authData.user.id,
      email,
      full_name: full_name || '',
      role: normalizedRole,
      is_active: true,
    };

    let { data: created, error: profileErr } = await supabase
      .from('admin_users')
      .upsert([profile])
      .select()
      .single();

    if (profileErr) {
      profile.role = 'admin';
      const fallbackResult = await supabase
        .from('admin_users')
        .upsert([profile])
        .select()
        .single();
      if (fallbackResult.error) throw new Error(fallbackResult.error.message);
      created = { ...fallbackResult.data, role: normalizedRole };
    }

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

    const validRoles = ['ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR'];
    const updateData = {};

    if (role) {
      const normalizedRole = String(role).toUpperCase();
      if (!validRoles.includes(normalizedRole)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }
      updateData.role = normalizedRole;

      // Synchronize authoritative role in Supabase Auth
      await supabase.auth.admin.updateUserById(id, {
        app_metadata: { role: normalizedRole },
        user_metadata: { role: normalizedRole },
      }).catch((err) => console.warn('Failed to sync auth metadata:', err.message));
    }

    if (typeof is_active === 'boolean') updateData.is_active = is_active;
    if (full_name !== undefined) updateData.full_name = full_name;

    let { data: updated, error } = await supabase
      .from('admin_users')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error && updateData.role) {
      // If table constraint blocks custom role, keep 'admin' in table while Auth metadata is updated
      const safeData = { ...updateData, role: 'admin' };
      const fallbackResult = await supabase
        .from('admin_users')
        .update({ ...safeData, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (fallbackResult.error) throw new Error(fallbackResult.error.message);
      updated = { ...fallbackResult.data, role: updateData.role };
    } else if (error) {
      throw new Error(error.message);
    }

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
