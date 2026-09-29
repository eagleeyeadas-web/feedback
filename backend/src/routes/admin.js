import { Router } from 'express';
import supabase from '../services/supabase.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// All admin routes require authentication
router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * Get dashboard statistics
 */
router.get('/stats', async (req, res) => {
  try {
    // Total submissions
    const { count: totalCount, error: totalError } = await supabase
      .from('feedback')
      .select('*', { count: 'exact', head: true });

    // Today's submissions (IST timezone)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: todayCount, error: todayError } = await supabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .gte('submitted_at', todayStart.toISOString());

    // Average rating
    const { data: ratingData, error: ratingError } = await supabase
      .from('feedback')
      .select('average_rating');

    let avgRating = 0;
    if (ratingData && ratingData.length > 0) {
      avgRating = (
        ratingData.reduce((sum, r) => sum + parseFloat(r.average_rating), 0) / ratingData.length
      ).toFixed(1);
    }

    // Unresolved / Partially resolved
    const { count: unresolvedCount, error: unresolvedError } = await supabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .in('issue_resolved', ['No', 'Partially']);

    if (totalError || todayError || ratingError || unresolvedError) {
      console.error('Stats error:', { totalError, todayError, ratingError, unresolvedError });
    }

    return res.json({
      totalSubmissions: totalCount || 0,
      todaySubmissions: todayCount || 0,
      averageRating: parseFloat(avgRating) || 0,
      unresolvedCount: unresolvedCount || 0,
    });
  } catch (error) {
    console.error('Stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

/**
 * GET /api/admin/feedback
 * List feedback with search, filters, and pagination
 */
router.get('/feedback', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      dateFrom = '',
      dateTo = '',
      product = '',
      technician = '',
      rating = '',
      resolution = '',
      sortBy = 'submitted_at',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * limitNum;

    // Build query
    let query = supabase
      .from('feedback')
      .select('*', { count: 'exact' });

    // Search filter
    if (search) {
      query = query.or(
        `customer_name.ilike.%${search}%,phone_number.ilike.%${search}%,vehicle_number.ilike.%${search}%,imei_number.ilike.%${search}%,feedback_id.ilike.%${search}%`
      );
    }

    // Date range filter
    if (dateFrom) {
      query = query.gte('service_date', dateFrom);
    }
    if (dateTo) {
      query = query.lte('service_date', dateTo);
    }

    // Product filter
    if (product) {
      query = query.ilike('product_service', `%${product}%`);
    }

    // Technician filter
    if (technician) {
      query = query.ilike('technician', `%${technician}%`);
    }

    // Rating filter (minimum rating)
    if (rating) {
      query = query.gte('average_rating', parseFloat(rating));
    }

    // Resolution filter
    if (resolution) {
      query = query.eq('issue_resolved', resolution);
    }

    // Sorting
    const validSortColumns = ['submitted_at', 'customer_name', 'average_rating', 'service_date', 'feedback_id'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'submitted_at';
    const ascending = sortOrder === 'asc';

    query = query
      .order(sortColumn, { ascending })
      .range(offset, offset + limitNum - 1);

    const { data: feedbackList, count, error } = await query;

    if (error) {
      console.error('Feedback list error:', error);
      return res.status(500).json({ error: 'Failed to fetch feedback' });
    }

    return res.json({
      data: feedbackList || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limitNum),
      },
    });
  } catch (error) {
    console.error('Feedback list error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/feedback/:id
 * Get individual feedback detail
 */
router.get('/feedback/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: feedback, error } = await supabase
      .from('feedback')
      .select('*')
      .or(`id.eq.${id},feedback_id.eq.${id}`)
      .single();

    if (error || !feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    // Get signed URL for signature
    let signatureUrl = null;
    if (feedback.signature_path) {
      const { data: signedUrl } = await supabase.storage
        .from('signatures')
        .createSignedUrl(feedback.signature_path, 300); // 5 min expiry
      signatureUrl = signedUrl?.signedUrl || null;
    }

    return res.json({
      ...feedback,
      signature_url: signatureUrl,
    });
  } catch (error) {
    console.error('Feedback detail error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/feedback/:id/pdf
 * Download feedback PDF (admin access)
 */
router.get('/feedback/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: feedback, error: fetchError } = await supabase
      .from('feedback')
      .select('pdf_path, feedback_id')
      .or(`id.eq.${id},feedback_id.eq.${id}`)
      .single();

    if (fetchError || !feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    if (!feedback.pdf_path) {
      return res.status(404).json({ error: 'PDF not available' });
    }

    const { data: pdfData, error: downloadError } = await supabase.storage
      .from('pdfs')
      .download(feedback.pdf_path);

    if (downloadError || !pdfData) {
      return res.status(500).json({ error: 'Failed to retrieve PDF' });
    }

    const buffer = Buffer.from(await pdfData.arrayBuffer());

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${feedback.feedback_id}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    console.error('Admin PDF download error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/export
 * Export feedback records as CSV
 */
router.get('/export', async (req, res) => {
  try {
    const {
      search = '',
      dateFrom = '',
      dateTo = '',
      product = '',
      technician = '',
      rating = '',
      resolution = '',
    } = req.query;

    let query = supabase
      .from('feedback')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (search) {
      query = query.or(
        `customer_name.ilike.%${search}%,phone_number.ilike.%${search}%,vehicle_number.ilike.%${search}%,imei_number.ilike.%${search}%,feedback_id.ilike.%${search}%`
      );
    }
    if (dateFrom) query = query.gte('service_date', dateFrom);
    if (dateTo) query = query.lte('service_date', dateTo);
    if (product) query = query.ilike('product_service', `%${product}%`);
    if (technician) query = query.ilike('technician', `%${technician}%`);
    if (rating) query = query.gte('average_rating', parseFloat(rating));
    if (resolution) query = query.eq('issue_resolved', resolution);

    const { data: records, error } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to export data' });
    }

    // Build CSV
    const headers = [
      'Feedback ID', 'Customer Name', 'Phone Number', 'Company', 'Email',
      'Vehicle Number', 'IMEI Number', 'Vehicle Type', 'Product/Service',
      'Service Date', 'Technician', 'Product Quality', 'Installation',
      'Performance', 'Professionalism', 'Support', 'Average Rating',
      'Issue Resolved', 'Improvement Suggestions', 'Additional Comments',
      'Submitted At',
    ];

    const csvRows = [headers.join(',')];

    for (const r of records || []) {
      const row = [
        r.feedback_id,
        `"${(r.customer_name || '').replace(/"/g, '""')}"`,
        r.phone_number,
        `"${(r.company_name || '').replace(/"/g, '""')}"`,
        r.email || '',
        r.vehicle_number || '',
        r.imei_number,
        `"${(r.vehicle_type || '').replace(/"/g, '""')}"`,
        `"${(r.product_service || '').replace(/"/g, '""')}"`,
        r.service_date,
        `"${(r.technician || '').replace(/"/g, '""')}"`,
        r.rating_product_quality,
        r.rating_installation,
        r.rating_performance,
        r.rating_professionalism,
        r.rating_support,
        r.average_rating,
        r.issue_resolved,
        `"${(r.improvement_suggestions || '').replace(/"/g, '""')}"`,
        `"${(r.additional_comments || '').replace(/"/g, '""')}"`,
        r.submitted_at,
      ];
      csvRows.push(row.join(','));
    }

    const csvContent = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="feedback_export_${Date.now()}.csv"`);
    return res.send(csvContent);
  } catch (error) {
    console.error('Export error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
