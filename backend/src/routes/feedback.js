import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import supabase from '../services/supabase.js';
import { generateFeedbackPDF } from '../services/pdfGenerator.js';
import { feedbackSchema, validate } from '../middleware/validate.js';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiter for feedback submissions
const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/feedback
 * Submit customer feedback
 */
router.post('/', feedbackLimiter, validate(feedbackSchema), async (req, res) => {
  try {
    const data = req.validatedBody;

    // Generate feedback ID using the database function
    const { data: idResult, error: idError } = await supabase
      .rpc('generate_feedback_id');

    if (idError) {
      console.error('Error generating feedback ID:', idError);
      return res.status(500).json({ error: 'Failed to generate feedback ID' });
    }

    const feedbackId = idResult;

    // Extract signature data URL for PDF embedding
    const signatureDataUrl = data.signature;

    // Upload signature image to Supabase Storage
    const signatureBuffer = Buffer.from(
      data.signature.replace(/^data:image\/\w+;base64,/, ''),
      'base64'
    );
    const signaturePath = `signatures/${feedbackId}.png`;

    const { error: sigUploadError } = await supabase.storage
      .from('signatures')
      .upload(signaturePath, signatureBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (sigUploadError) {
      console.error('Signature upload error:', sigUploadError);
      return res.status(500).json({ error: 'Failed to save signature' });
    }

    // Insert feedback record
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const pdfExpiresAt = new Date(nowDate.getTime() + (20 * 24 * 60 * 60 * 1000)).toISOString();

    const feedbackRecord = {
      feedback_id: feedbackId,
      customer_name: data.customerName,
      phone_number: data.phoneNumber,
      company_name: data.companyName || null,
      email: data.email || null,
      vehicle_number: data.vehicleNumber || null,
      imei_number: data.imeiNumber,
      vehicle_type: data.vehicleType,
      product_service: data.productService,
      service_date: data.serviceDate,
      technician: data.technician,
      rating_product_quality: data.ratingProductQuality,
      rating_installation: data.ratingInstallation,
      rating_performance: data.ratingPerformance,
      rating_professionalism: data.ratingProfessionalism,
      rating_support: data.ratingSupport,
      issue_resolved: data.issueResolved,
      improvement_suggestions: data.improvementSuggestions || null,
      additional_comments: data.additionalComments || null,
      signature_path: signaturePath,
      submitted_at: now,
      pdf_expires_at: pdfExpiresAt,
      ip_address: req.ip,
      user_agent: req.get('User-Agent') || null,
    };

    let insertedFeedback = null;
    let { data: fbData, error: insertError } = await supabase
      .from('feedback')
      .insert(feedbackRecord)
      .select()
      .single();

    if (insertError && insertError.message?.includes('pdf_expires_at')) {
      console.warn('Supabase DB feedback table lacks pdf_expires_at column; retrying insertion without pdf_expires_at...');
      delete feedbackRecord.pdf_expires_at;
      const retryResult = await supabase
        .from('feedback')
        .insert(feedbackRecord)
        .select()
        .single();
      fbData = retryResult.data;
      insertError = retryResult.error;
    }

    if (insertError || !fbData) {
      console.error('Feedback insert error:', insertError);
      // Clean up uploaded signature
      await supabase.storage.from('signatures').remove([signaturePath]);
      return res.status(500).json({ error: 'Failed to save feedback' });
    }

    insertedFeedback = fbData;

    // Generate PDF (Handled separately so PDF errors never compromise database insertion)
    try {
      let logoBase64 = null;
      try {
        const { data: logoData } = await supabase.storage
          .from('assets')
          .download('logo.png');
        if (logoData) {
          const logoBuffer = Buffer.from(await logoData.arrayBuffer());
          logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
        }
      } catch (e) {
        // Fallback to local logo
      }

      if (!logoBase64) {
        try {
          const localLogoPath = path.resolve('../frontend/public/logo.png');
          if (fs.existsSync(localLogoPath)) {
            const logoBuffer = fs.readFileSync(localLogoPath);
            logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
          }
        } catch (err) {
          // Continue if missing
        }
      }

      const pdfData = {
        ...insertedFeedback,
        signatureDataUrl,
      };

      const pdfBuffer = await generateFeedbackPDF(pdfData, logoBase64);
      const pdfPath = `pdfs/${feedbackId}.pdf`;

      const { error: pdfUploadError } = await supabase.storage
        .from('pdfs')
        .upload(pdfPath, pdfBuffer, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (!pdfUploadError) {
        await supabase
          .from('feedback')
          .update({ pdf_path: pdfPath })
          .eq('id', insertedFeedback.id);
      }
    } catch (pdfErr) {
      console.warn('PDF generation warning (database record preserved successfully):', pdfErr);
    }

    return res.status(201).json({
      success: true,
      feedbackId,
      submittedAt: now,
      message: 'Feedback submitted successfully',
    });
  } catch (error) {
    console.error('Feedback submission error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/feedback/:feedbackId/pdf
 * Download feedback PDF (publicly accessible with correct feedback ID)
 */
router.get('/:feedbackId/pdf', async (req, res) => {
  try {
    const { feedbackId } = req.params;

    // Validate feedback ID format
    if (!/^EE-\d{8}-\d{4}$/.test(feedbackId)) {
      return res.status(400).json({ error: 'Invalid feedback ID format' });
    }

    // Get feedback record to find PDF path & expiry
    const { data: feedback, error: fetchError } = await supabase
      .from('feedback')
      .select('pdf_path, pdf_expires_at, feedback_id')
      .eq('feedback_id', feedbackId)
      .single();

    if (fetchError || !feedback) {
      return res.status(404).json({ error: 'Feedback not found' });
    }

    if (!feedback.pdf_path || (feedback.pdf_expires_at && new Date(feedback.pdf_expires_at) <= new Date())) {
      return res.status(410).json({ error: 'Customer Feedback PDF has expired after 20-day retention window.' });
    }

    // Download PDF from storage
    const { data: pdfData, error: downloadError } = await supabase.storage
      .from('pdfs')
      .download(feedback.pdf_path);

    if (downloadError || !pdfData) {
      return res.status(500).json({ error: 'Failed to retrieve PDF' });
    }

    const buffer = Buffer.from(await pdfData.arrayBuffer());

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="EagleEye_Feedback_${feedbackId}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    console.error('PDF download error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
