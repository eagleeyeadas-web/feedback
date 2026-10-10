import { Router } from 'express';
import { z } from 'zod';
import supabase from '../services/supabase.js';
import { generateQuotationPDF, numberToWordsIndian, getFullProductDescription } from '../services/quotationPdfGenerator.js';
import { handleCleanupEndpoint, handleCleanupStatusEndpoint } from '../services/quotationCleanupService.js';
import { peekNextQuotationNumber, generateAndReserveQuotationNumber, handleQuotationDeletion } from '../services/quotationSequenceService.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/admin/quotations/cleanup
 * Centralized 20-day automatic retention cleanup trigger for eligible attachments
 */
router.post('/cleanup', handleCleanupEndpoint);
router.get('/cleanup/status', handleCleanupStatusEndpoint);



// Require admin authentication for remaining quotation endpoints
router.use(requireAdmin);

// Zod Validation Schema for Item
const quotationItemSchema = z.object({
  sno: z.number().optional(),
  item_description: z.string().min(1, 'Item description is required'),
  hsn_sac: z.string().optional().default(''),
  qty: z.number().gt(0, 'Quantity must be greater than 0'),
  uom: z.string().default('Nos'),
  rate: z.number().gte(0, 'Rate must be 0 or greater'),
  discount_pct: z.number().gte(0).max(100).default(0),
});

// Zod Validation Schema for Quotation
const quotationSchema = z.object({
  quotation_number: z.string().optional(),
  customer_name: z.string().min(1, 'Customer name is required'),
  contact_person: z.string().optional().default(''),
  address: z.string().optional().default(''),
  phone_number: z.string().optional().default(''),
  gst_number: z.string().optional().default(''),
  quotation_date: z.string().optional().default(() => new Date().toISOString().split('T')[0]),
  gst_applicable: z.boolean().default(true),
  gst_type: z.enum(['CGST_SGST', 'IGST', 'NONE']).default('CGST_SGST'),
  cgst_pct: z.number().gte(0).max(50).default(9),
  sgst_pct: z.number().gte(0).max(50).default(9),
  igst_pct: z.number().gte(0).max(50).default(18),
  terms_conditions: z.array(z.string()).optional(),
  include_tech_specs: z.boolean().default(false),
  tech_spec_template: z.string().optional().default('default'),
  display_size: z.enum(['7-inch', '10-inch']).optional().default('10-inch'),
  items: z.array(quotationItemSchema).min(1, 'At least one product item is required'),
});

/**
 * GET /api/admin/quotations/next-number
/**
 * GET /api/admin/quotations/next-number
 * NON-MUTATING: Returns preview of the next sequential quotation number (CQS/XXXXX)
 */
router.get('/next-number', async (req, res) => {
  try {
    const nextNo = await peekNextQuotationNumber();
    return res.json({ quotationNumber: nextNo });
  } catch (error) {
    console.error('Error fetching next quotation number:', error);
    return res.json({ quotationNumber: 'CQS/00231' });
  }
});

/**
 * POST /api/admin/quotations
 * Create a new quotation & generate PDF
 */
router.post('/', async (req, res) => {
  try {
    // 1. Validate payload
    const parsed = quotationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;

    // 2. Atomically generate & reserve next quotation number upon save
    const quotationNo = await generateAndReserveQuotationNumber(data.quotation_number);

    // 3. Backend Totals & Taxes Calculation (GST-Inclusive Rate Model)
    let totalInclusive = 0;
    const processedItems = data.items.map((item, index) => {
      const qty = parseFloat(item.qty) || 1;
      const rate = parseFloat(item.rate) || 0; // GST-Inclusive Rate
      const discPct = parseFloat(item.discount_pct) || 0;
      
      const rawTotal = qty * rate;
      const discountAmount = Math.round((rawTotal * (discPct / 100)) * 100) / 100;
      const lineAmount = Math.round((rawTotal - discountAmount) * 100) / 100;

      totalInclusive += lineAmount;

      return {
        sno: index + 1,
        item_description: getFullProductDescription(item.item_description, data.display_size),
        hsn_sac: item.hsn_sac || '852589',
        qty,
        uom: item.uom || 'Nos',
        rate,
        discount_pct: discPct,
        discount_amount: discountAmount,
        amount: lineAmount,
      };
    });

    totalInclusive = Math.round(totalInclusive * 100) / 100;

    let subtotal = totalInclusive;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;
    let cgstPct = 0;
    let sgstPct = 0;
    let igstPct = 0;

    if (data.gst_applicable) {
      if (data.gst_type === 'CGST_SGST') {
        cgstPct = parseFloat(data.cgst_pct) || 9;
        sgstPct = parseFloat(data.sgst_pct) || 9;
        const totalGstRate = (cgstPct + sgstPct) / 100; // 0.18
        
        // Extract Taxable Subtotal from GST-Inclusive Total
        subtotal = Math.round((totalInclusive / (1 + totalGstRate)) * 100) / 100;
        const totalGst = Math.round((totalInclusive - subtotal) * 100) / 100;
        
        cgstAmount = Math.round((totalGst / 2) * 100) / 100;
        sgstAmount = Math.round((totalGst - cgstAmount) * 100) / 100;
      } else if (data.gst_type === 'IGST') {
        igstPct = parseFloat(data.igst_pct) || 18;
        const totalGstRate = igstPct / 100; // 0.18
        
        subtotal = Math.round((totalInclusive / (1 + totalGstRate)) * 100) / 100;
        igstAmount = Math.round((totalInclusive - subtotal) * 100) / 100;
      }
    }

    const netAmount = data.gst_applicable
      ? Math.round((subtotal + cgstAmount + sgstAmount + igstAmount) * 100) / 100
      : totalInclusive;

    // 4. Default Terms & Conditions fallback
    const defaultTerms = [
      '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
      'Payments are non-refundable once the order has been confirmed and processing has begun.',
      'SIM card procurement, activation, and recharge/data charges shall be under the customer\'s scope.',
      'Delivery timelines are estimates only and subject to stock availability.',
      'Products/services provided are subject to "3 years replacement warranty against manufacturing defects".',
      'This warranty does not cover normal wear and tear, misuse, or damage caused by improper handling.',
    ];
    const finalTerms = (data.terms_conditions && data.terms_conditions.length > 0)
      ? data.terms_conditions
      : defaultTerms;

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + (20 * 24 * 60 * 60 * 1000)); // Exactly 20 days in the future

    const quotationRecord = {
      quotation_number: quotationNo,
      customer_name: data.customer_name,
      contact_person: data.contact_person,
      address: data.address,
      phone_number: data.phone_number,
      gst_number: data.gst_number,
      quotation_date: data.quotation_date,
      gst_applicable: data.gst_applicable,
      gst_type: data.gst_applicable ? data.gst_type : 'NONE',
      subtotal,
      cgst_pct: cgstPct,
      cgst_amount: cgstAmount,
      sgst_pct: sgstPct,
      sgst_amount: sgstAmount,
      igst_pct: igstPct,
      igst_amount: igstAmount,
      net_amount: netAmount,
      terms_conditions: finalTerms,
      include_tech_specs: data.include_tech_specs,
      tech_spec_template: data.tech_spec_template,
      display_size: data.display_size || '10-inch',
      created_by: req.user ? req.user.id : null,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    // 5. Generate PDF Buffer
    const pdfBuffer = await generateQuotationPDF(quotationRecord, processedItems);

    // 6. Upload PDF to Supabase Storage `pdfs` bucket
    let pdfPath = null;
    const sanitizedNo = quotationNo.replace(/[^a-zA-Z0-9_-]/g, '_');
    const storageFileName = `quotations/EagleEye_Quotation_${sanitizedNo}.pdf`;

    try {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('pdfs')
        .upload(storageFileName, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (!uploadError && uploadData) {
        pdfPath = uploadData.path;
      } else {
        console.warn('Supabase storage PDF upload warning:', uploadError?.message);
        pdfPath = storageFileName; // Fallback path string
      }
    } catch (storageErr) {
      console.warn('Storage upload error:', storageErr.message);
      pdfPath = storageFileName;
    }

    quotationRecord.pdf_path = pdfPath;

    // 7. Save Quotation Record to Database
    let insertedQuotation = null;
    let { data: insData, error: insertError } = await supabase
      .from('quotations')
      .insert([quotationRecord])
      .select()
      .single();

    // Fallback: If display_size column is not in Supabase PostgreSQL schema yet, retry insertion without display_size
    if (insertError && insertError.message?.includes('display_size')) {
      console.warn('Supabase DB quotations table lacks display_size column; retrying insertion without display_size...');
      delete quotationRecord.display_size;
      const retryResult = await supabase
        .from('quotations')
        .insert([quotationRecord])
        .select()
        .single();
      insData = retryResult.data;
      insertError = retryResult.error;
    }

    if (insertError || !insData) {
      console.error('Database insertion error for quotation:', insertError);
      return res.status(500).json({ error: 'Failed to save quotation to database', details: insertError?.message });
    }

    insertedQuotation = insData;

    // 8. Save Quotation Items to Database
    const itemsToInsert = processedItems.map(item => ({
      quotation_id: insertedQuotation.id,
      ...item,
    }));

    const { error: itemsInsertError } = await supabase
      .from('quotation_items')
      .insert(itemsToInsert);

    if (itemsInsertError) {
      console.error('Database insertion error for quotation items:', itemsInsertError);
    }

    return res.status(201).json({
      message: 'Quotation generated and saved successfully',
      quotation: insertedQuotation,
      items: processedItems,
    });
  } catch (error) {
    console.error('Error creating quotation:', error);
    return res.status(500).json({ error: 'Internal server error while creating quotation' });
  }
});

/**
 * GET /api/admin/quotations/export
 * Export quotation records as CSV with line items
 */
router.get('/export', async (req, res) => {
  try {
    const { search = '' } = req.query;

    let query = supabase
      .from('quotations')
      .select('*, quotation_items(*)');

    if (search && search.trim()) {
      query = query.or(`customer_name.ilike.%${search.trim()}%,quotation_number.ilike.%${search.trim()}%`);
    }

    const { data: quotations, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching quotations for export:', error);
      return res.status(500).json({ error: 'Failed to export quotation records' });
    }

    if (!quotations || quotations.length === 0) {
      return res.status(404).json({ error: 'No quotation records found to export' });
    }

    const headers = [
      'Quotation Number',
      'Quotation Date',
      'Customer / Company Name',
      'Contact Person',
      'Phone Number',
      'Customer Address',
      'Product Description',
      'HSN/SAC',
      'Quantity',
      'UOM',
      'Rate',
      'Discount Percentage',
      'Discount Amount',
      'CGST',
      'SGST',
      'Net Amount',
      'Amount in Words',
      'Created At',
      'Expiry Date',
    ];

    const escapeCsvCell = (val) => {
      if (val === null || val === undefined) return '""';
      return `"${String(val).replace(/"/g, '""')}"`;
    };

    const csvRows = [headers.map(escapeCsvCell).join(',')];

    for (const q of quotations) {
      const items = q.quotation_items && q.quotation_items.length > 0 ? q.quotation_items : [{}];
      
      for (const item of items) {
        const row = [
          q.quotation_number || '',
          q.quotation_date || '',
          q.customer_name || '',
          q.contact_person || '',
          q.phone_number || '',
          q.address || '',
          item.item_description || '',
          item.hsn_sac || '852589',
          item.qty !== undefined ? item.qty : '',
          item.uom || 'Nos',
          item.rate !== undefined ? item.rate : '',
          item.discount_pct !== undefined ? item.discount_pct : 0,
          item.discount_amount !== undefined ? item.discount_amount : 0,
          q.cgst_amount !== undefined ? q.cgst_amount : 0,
          q.sgst_amount !== undefined ? q.sgst_amount : 0,
          q.net_amount !== undefined ? q.net_amount : 0,
          numberToWordsIndian(q.net_amount || 0),
          q.created_at || '',
          q.expires_at || '',
        ];
        csvRows.push(row.map(escapeCsvCell).join(','));
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const csvContent = '\uFEFF' + csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Eagle_Eye_Quotations_${todayStr}.csv"`);
    return res.send(csvContent);
  } catch (error) {
    console.error('Quotation CSV export error:', error);
    return res.status(500).json({ error: 'Internal server error while exporting quotations' });
  }
});

/**
 * GET /api/admin/quotations
 * List quotations with search & pagination
 */
router.get('/', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = supabase
      .from('quotations')
      .select('*', { count: 'exact' });

    if (search.trim()) {
      query = query.or(`customer_name.ilike.%${search.trim()}%,quotation_number.ilike.%${search.trim()}%`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) {
      console.error('Error fetching quotations:', error);
      return res.status(500).json({ error: 'Failed to fetch quotations' });
    }

    return res.json({
      quotations: data || [],
      totalCount: count || 0,
      page: parseInt(page),
      totalPages: Math.ceil((count || 0) / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error listing quotations:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/quotations/:id
 * Get quotation detail with line items
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: quotation, error: qError } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', id)
      .single();

    if (qError || !quotation) {
      return res.status(404).json({ error: 'Quotation not found' });
    }

    const { data: items, error: iError } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', id)
      .order('sno', { ascending: true });

    return res.json({
      quotation,
      items: items || [],
    });
  } catch (error) {
    console.error('Error fetching quotation detail:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/admin/quotations/:id/pdf
 * Download generated quotation PDF
 */
router.get('/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch quotation and items
    const { data: quotation, error: qError } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', id)
      .single();

    if (qError || !quotation) {
      return res.status(404).json({ error: 'Quotation not found' });
    }

    const { data: items } = await supabase
      .from('quotation_items')
      .select('*')
      .eq('quotation_id', id)
      .order('sno', { ascending: true });

    // Try downloading existing PDF from storage
    if (quotation.pdf_path) {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('pdfs')
        .download(quotation.pdf_path);

      if (!downloadError && fileData) {
        const buffer = Buffer.from(await fileData.arrayBuffer());
        const filename = `EagleEye_Quotation_${quotation.quotation_number.replace(/\//g, '-')}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(buffer);
      }
    }

    // Fallback: Regenerate PDF dynamically
    const pdfBuffer = await generateQuotationPDF(quotation, items || []);
    const filename = `EagleEye_Quotation_${quotation.quotation_number.replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Error downloading quotation PDF:', error);
    return res.status(500).json({ error: 'Internal server error downloading PDF' });
  }
});

/**
 * DELETE /api/admin/quotations/:id
 * Delete a quotation record
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await handleQuotationDeletion(id);

    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Failed to delete quotation' });
    }

    return res.json({
      message: 'Quotation deleted successfully',
      quotationNumber: result.quotationNumber,
      reclaimed: result.reclaimed,
      newLastValue: result.newLastValue,
    });
  } catch (error) {
    console.error('Error deleting quotation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
