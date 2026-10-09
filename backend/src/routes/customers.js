import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import supabase from '../services/supabase.js';

const router = Router();

/**
 * GET /api/admin/customers
 * Accessible to SALES, ADMIN
 */
router.get('/', requireRole('SALES'), async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    let query = supabase
      .from('customers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (search) {
      query = query.or(`client_name.ilike.%${search}%,client_mobile.ilike.%${search}%,client_location.ilike.%${search}%`);
    }

    const { data, count, error } = await query;
    if (error) throw new Error(error.message);

    return res.json({
      customers: data || [],
      totalCount: count || 0,
      page: pageNum,
      totalPages: Math.ceil((count || 0) / limitNum) || 1,
    });
  } catch (err) {
    console.error('Error in GET /customers:', err);
    return res.status(500).json({ error: err.message || 'Failed to fetch customer records' });
  }
});

/**
 * POST /api/admin/customers
 * Create or update a customer record (SALES, ADMIN)
 */
router.post('/', requireRole('SALES'), async (req, res) => {
  try {
    const { client_name, client_mobile, client_location, google_maps_location, company_name, email } = req.body;
    if (!client_name || !client_mobile) {
      return res.status(400).json({ error: 'Client name and mobile number are required' });
    }

    const customerData = {
      client_name,
      client_mobile,
      client_location: client_location || '',
      google_maps_location: google_maps_location || null,
      company_name: company_name || null,
      email: email || null,
      created_by: req.profile.id,
    };

    const { data: created, error } = await supabase
      .from('customers')
      .upsert([customerData], { onConflict: 'client_mobile' })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return res.status(201).json(created);
  } catch (err) {
    console.error('Error in POST /customers:', err);
    return res.status(400).json({ error: err.message || 'Failed to save customer record' });
  }
});

export default router;
