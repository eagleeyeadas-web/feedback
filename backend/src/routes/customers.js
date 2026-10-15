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
    if (error) {
      console.warn('Customers table not available, falling back to installation_checklists:', error.message);
      const { data: checklists } = await supabase
        .from('installation_checklists')
        .select('id, client_name, client_mobile, client_location, company_name, created_at')
        .order('created_at', { ascending: false });

      const map = new Map();
      for (const item of (checklists || [])) {
        if (item.client_mobile && !map.has(item.client_mobile)) {
          map.set(item.client_mobile, item);
        }
      }
      const uniqueList = Array.from(map.values());
      return res.json({
        customers: uniqueList.slice(offset, offset + limitNum),
        totalCount: uniqueList.length,
        page: pageNum,
        totalPages: Math.ceil(uniqueList.length / limitNum) || 1,
      });
    }

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

/**
 * GET /api/admin/customers/deletion-preview
 * Evaluates customer records and checks for active dependencies (checklists, quotations)
 */
router.get('/deletion-preview', requireRole('SALES', 'ADMIN'), async (req, res) => {
  try {
    const { scope = 'ALL', search = '' } = req.query;

    const [
      { data: customers, error: custErr },
      { data: checklists },
      { data: quotations },
    ] = await Promise.all([
      supabase.from('customers').select('*').order('created_at', { ascending: false }),
      supabase.from('installation_checklists').select('id, client_mobile, client_name'),
      supabase.from('quotations').select('id, phone_number, customer_name'),
    ]);

    const activeMobiles = new Set();
    const activeNames = new Set();

    (checklists || []).forEach((c) => {
      if (c.client_mobile) activeMobiles.add(c.client_mobile);
      if (c.client_name) activeNames.add(c.client_name.toLowerCase().trim());
    });
    (quotations || []).forEach((q) => {
      const phone = q.phone_number || q.client_phone;
      const name = q.customer_name || q.client_name;
      if (phone) activeMobiles.add(phone);
      if (name) activeNames.add(name.toLowerCase().trim());
    });

    let records = [];
    if (!custErr && customers) {
      records = customers;
    } else {
      const map = new Map();
      for (const item of (checklists || [])) {
        if (item.client_mobile && !map.has(item.client_mobile)) {
          map.set(item.client_mobile, item);
        }
      }
      records = Array.from(map.values());
    }
    const testPattern = /(test|demo|sample|dummy|temp)/i;

    const eligible = [];
    const protectedRecords = [];

    for (const cust of records) {
      const isTest =
        testPattern.test(cust.client_name || '') ||
        testPattern.test(cust.company_name || '') ||
        testPattern.test(cust.client_mobile || '');

      if (scope === 'TEST' && !isTest) {
        continue;
      }
      if (scope === 'FILTERED' && search) {
        const matchesSearch =
          (cust.client_name || '').toLowerCase().includes(search.toLowerCase()) ||
          (cust.client_mobile || '').toLowerCase().includes(search.toLowerCase()) ||
          (cust.client_location || '').toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) continue;
      }

      const hasDependentChecklist = cust.client_mobile && activeMobiles.has(cust.client_mobile);
      const hasDependentName = cust.client_name && activeNames.has(cust.client_name.toLowerCase().trim());

      if (hasDependentChecklist || hasDependentName) {
        protectedRecords.push({
          ...cust,
          reason: 'Customer has linked operational checklists or quotations in history',
        });
      } else {
        eligible.push(cust);
      }
    }

    return res.json({
      totalCount: records.length,
      eligibleCount: eligible.length,
      protectedCount: protectedRecords.length,
      eligibleCustomers: eligible.slice(0, 100),
      protectedCustomers: protectedRecords.slice(0, 20),
      scope,
    });
  } catch (err) {
    console.error('Error in GET /customers/deletion-preview:', err);
    return res.status(500).json({ error: 'Failed to preview customer deletion' });
  }
});

/**
 * POST /api/admin/customers/delete-all
 * Safely delete multiple or all eligible customer records, preserving those with active history
 */
router.post('/delete-all', requireRole('SALES', 'ADMIN'), async (req, res) => {
  try {
    const { scope = 'ALL', confirmedCount, search = '' } = req.body;

    const [
      { data: customers, error: custErr },
      { data: checklists },
      { data: quotations },
    ] = await Promise.all([
      supabase.from('customers').select('*'),
      supabase.from('installation_checklists').select('id, client_mobile, client_name'),
      supabase.from('quotations').select('id, phone_number, customer_name'),
    ]);

    const activeMobiles = new Set();
    const activeNames = new Set();

    (checklists || []).forEach((c) => {
      if (c.client_mobile) activeMobiles.add(c.client_mobile);
      if (c.client_name) activeNames.add(c.client_name.toLowerCase().trim());
    });
    (quotations || []).forEach((q) => {
      const phone = q.phone_number || q.client_phone;
      const name = q.customer_name || q.client_name;
      if (phone) activeMobiles.add(phone);
      if (name) activeNames.add(name.toLowerCase().trim());
    });

    let records = [];
    if (!custErr && customers) {
      records = customers;
    } else {
      const map = new Map();
      for (const item of (checklists || [])) {
        if (item.client_mobile && !map.has(item.client_mobile)) {
          map.set(item.client_mobile, item);
        }
      }
      records = Array.from(map.values());
    }
    const testPattern = /(test|demo|sample|dummy|temp)/i;

    const eligibleToDelete = [];
    let skippedCount = 0;

    for (const cust of records) {
      const isTest =
        testPattern.test(cust.client_name || '') ||
        testPattern.test(cust.company_name || '') ||
        testPattern.test(cust.client_mobile || '');

      if (scope === 'TEST' && !isTest) {
        skippedCount++;
        continue;
      }
      if (scope === 'FILTERED' && search) {
        const matchesSearch =
          (cust.client_name || '').toLowerCase().includes(search.toLowerCase()) ||
          (cust.client_mobile || '').toLowerCase().includes(search.toLowerCase()) ||
          (cust.client_location || '').toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) {
          skippedCount++;
          continue;
        }
      }

      const hasDependentChecklist = cust.client_mobile && activeMobiles.has(cust.client_mobile);
      const hasDependentName = cust.client_name && activeNames.has(cust.client_name.toLowerCase().trim());

      if (hasDependentChecklist || hasDependentName) {
        skippedCount++;
      } else {
        eligibleToDelete.push(cust);
      }
    }

    if (typeof confirmedCount === 'number' && confirmedCount !== eligibleToDelete.length) {
      return res.status(400).json({
        error: `Confirmation count mismatch. Expected ${eligibleToDelete.length} customer(s), but received ${confirmedCount}.`,
        eligibleCount: eligibleToDelete.length,
        totalCount: records.length,
      });
    }

    let deletedCount = 0;
    let failedCount = 0;

    for (const cust of eligibleToDelete) {
      try {
        const { error: delErr } = await supabase.from('customers').delete().eq('id', cust.id);
        if (delErr) {
          failedCount++;
        } else {
          deletedCount++;
        }
      } catch {
        failedCount++;
      }
    }

    return res.json({
      success: true,
      message: `Successfully deleted ${deletedCount} customer record(s). Preserved ${skippedCount} customer(s) with dependencies.`,
      deletedCount,
      skippedCount,
      failedCount,
      totalEvaluated: records.length,
    });
  } catch (err) {
    console.error('Error in POST /customers/delete-all:', err);
    return res.status(500).json({ error: 'Failed to delete customer records' });
  }
});

/**
 * DELETE /api/admin/customers/:id
 * Delete a single customer record if free of dependencies
 */
router.delete('/:id', requireRole('SALES', 'ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    const { data: customer, error: fetchErr } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !customer) {
      return res.status(404).json({ error: 'Customer record not found' });
    }

    // Dependency check
    const [
      { data: checklists },
      { data: quotations },
    ] = await Promise.all([
      supabase.from('installation_checklists').select('id, checklist_number').eq('client_mobile', customer.client_mobile),
      supabase.from('quotations').select('id, quotation_number').eq('phone_number', customer.client_mobile),
    ]);

    const reasons = [];
    if (checklists && checklists.length > 0) {
      reasons.push(`Linked to ${checklists.length} installation checklist(s): ${checklists.map((c) => c.checklist_number).join(', ')}`);
    }
    if (quotations && quotations.length > 0) {
      reasons.push(`Linked to ${quotations.length} quotation(s): ${quotations.map((q) => q.quotation_number).join(', ')}`);
    }

    if (reasons.length > 0) {
      return res.status(409).json({
        error: 'Customer cannot be deleted because dependent operational records exist.',
        reasons,
        customer,
      });
    }

    const { error: delErr } = await supabase.from('customers').delete().eq('id', id);
    if (delErr) {
      return res.status(500).json({ error: delErr.message || 'Failed to delete customer record' });
    }

    return res.json({
      success: true,
      message: `Customer ${customer.client_name} deleted successfully.`,
      id,
    });
  } catch (err) {
    console.error('Error in DELETE /customers/:id:', err);
    return res.status(500).json({ error: 'Failed to delete customer record' });
  }
});

export default router;
