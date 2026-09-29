import supabase from './supabase.js';

/**
 * Automatically deletes expired quotations and their associated PDF files from Supabase Storage.
 * Expiry logic: expires_at <= current UTC time (10 days after creation).
 * 
 * Safety features:
 * - Idempotent execution
 * - Pagination / batching (50 records per run)
 * - Safe error handling (if Storage fails, retains DB record for retry)
 * - Retains unrelated files and DB records
 */
export async function runQuotationCleanup() {
  const nowUtc = new Date().toISOString();
  console.log(`[Quotation Cleanup Job] Starting automated cleanup at ${nowUtc}...`);

  let totalProcessed = 0;
  let totalDeleted = 0;
  let totalFailed = 0;

  try {
    // Fetch up to 50 expired quotations
    const { data: expiredQuotations, error: fetchError } = await supabase
      .from('quotations')
      .select('id, quotation_number, pdf_path, created_at, expires_at')
      .lte('expires_at', nowUtc)
      .limit(50);

    if (fetchError) {
      console.error('[Quotation Cleanup Job] Error fetching expired quotations:', fetchError.message);
      return { processed: 0, deleted: 0, failed: 0, error: fetchError.message };
    }

    if (!expiredQuotations || expiredQuotations.length === 0) {
      console.log('[Quotation Cleanup Job] No expired quotations found to clean up.');
      return { processed: 0, deleted: 0, failed: 0, timestamp: nowUtc };
    }

    console.log(`[Quotation Cleanup Job] Found ${expiredQuotations.length} expired quotation(s) past 10-day retention window.`);

    for (const q of expiredQuotations) {
      totalProcessed++;
      let pdfDeletedSuccessfully = true;

      // Step 1: Remove PDF from Supabase Storage if path exists
      if (q.pdf_path) {
        try {
          const { error: storageError } = await supabase.storage
            .from('pdfs')
            .remove([q.pdf_path]);

          if (storageError) {
            // Ignore if file was already missing (404/Not Found)
            const isNotFound = storageError.message?.toLowerCase().includes('not found') ||
                               storageError.message?.includes('404') ||
                               storageError.statusCode === 404;

            if (!isNotFound) {
              console.error(`[Quotation Cleanup Job] Storage deletion error for PDF (${q.pdf_path}):`, storageError.message);
              pdfDeletedSuccessfully = false;
            } else {
              console.log(`[Quotation Cleanup Job] PDF file already missing from storage (${q.pdf_path}), proceeding with DB deletion.`);
            }
          } else {
            console.log(`[Quotation Cleanup Job] Successfully deleted PDF from storage: ${q.pdf_path}`);
          }
        } catch (err) {
          console.error(`[Quotation Cleanup Job] Unexpected error removing PDF (${q.pdf_path}):`, err.message);
          pdfDeletedSuccessfully = false;
        }
      }

      // Step 2: Delete Quotation Database Record (only if PDF removal succeeded or file missing)
      if (pdfDeletedSuccessfully) {
        const { error: dbDeleteError } = await supabase
          .from('quotations')
          .delete()
          .eq('id', q.id);

        if (dbDeleteError) {
          console.error(`[Quotation Cleanup Job] DB record deletion failed for quotation ${q.quotation_number} (${q.id}):`, dbDeleteError.message);
          totalFailed++;
        } else {
          console.log(`[Quotation Cleanup Job] Successfully deleted expired quotation record: ${q.quotation_number} (ID: ${q.id})`);
          totalDeleted++;
        }
      } else {
        console.warn(`[Quotation Cleanup Job] Retaining DB record ${q.quotation_number} for retry on next scheduled run because PDF deletion failed.`);
        totalFailed++;
      }
    }

    console.log(`[Quotation Cleanup Job] Completed cleanup run. Processed: ${totalProcessed}, Deleted: ${totalDeleted}, Failed/Retrying: ${totalFailed}`);
    return {
      processed: totalProcessed,
      deleted: totalDeleted,
      failed: totalFailed,
      timestamp: nowUtc,
    };
  } catch (error) {
    console.error('[Quotation Cleanup Job] Critical exception during quotation cleanup:', error.message);
    return { processed: totalProcessed, deleted: totalDeleted, failed: totalFailed, error: error.message };
  }
}

/**
 * Automatically deletes expired customer feedback PDF files from Supabase Storage.
 * Expiry logic: pdf_expires_at <= current UTC time (10 days after submitted_at).
 * 
 * Safety features:
 * - Deletes ONLY the PDF file from Supabase Storage ('pdfs' bucket).
 * - Updates the feedback DB record setting `pdf_path = null` (DOES NOT DELETE DB RECORD).
 * - Retains customer details, ratings, comments, and feedback DB record.
 * - Idempotent & safe to run repeatedly.
 * - If Storage deletion fails, retains `pdf_path` for retry on the next scheduled run.
 * - Safe handling of already-missing files (404 / Object not found).
 */
export async function runFeedbackPdfCleanup() {
  const now = new Date();
  const nowUtc = now.toISOString();
  const tenDaysAgoUtc = new Date(now.getTime() - (10 * 24 * 60 * 60 * 1000)).toISOString();
  console.log(`[Feedback PDF Cleanup Job] Starting automated feedback PDF cleanup at ${nowUtc}...`);

  let totalProcessed = 0;
  let totalPdfsDeleted = 0;
  let totalFailed = 0;

  try {
    // Attempt 1: Fetch expired feedback using pdf_expires_at column
    let expiredFeedback = null;
    let fetchError = null;

    const { data: dataExpiry, error: errExpiry } = await supabase
      .from('feedback')
      .select('id, feedback_id, pdf_path, submitted_at, pdf_expires_at')
      .not('pdf_path', 'is', null)
      .lte('pdf_expires_at', nowUtc)
      .limit(50);

    if (errExpiry && errExpiry.message?.includes('pdf_expires_at')) {
      // Fallback query if migration column not applied yet: submitted_at <= 10 days ago
      console.log('[Feedback PDF Cleanup Job] pdf_expires_at column not detected; falling back to submitted_at <= 10 days ago query.');
      const { data: dataSubmitted, error: errSubmitted } = await supabase
        .from('feedback')
        .select('id, feedback_id, pdf_path, submitted_at')
        .not('pdf_path', 'is', null)
        .lte('submitted_at', tenDaysAgoUtc)
        .limit(50);

      expiredFeedback = dataSubmitted;
      fetchError = errSubmitted;
    } else {
      expiredFeedback = dataExpiry;
      fetchError = errExpiry;
    }

    if (fetchError) {
      console.error('[Feedback PDF Cleanup Job] Error fetching expired feedback PDFs:', fetchError.message);
      return { processed: 0, deleted: 0, failed: 0, error: fetchError.message };
    }

    if (!expiredFeedback || expiredFeedback.length === 0) {
      console.log('[Feedback PDF Cleanup Job] No expired customer feedback PDFs found to clean up.');
      return { processed: 0, deleted: 0, failed: 0, timestamp: nowUtc };
    }

    console.log(`[Feedback PDF Cleanup Job] Found ${expiredFeedback.length} expired feedback PDF(s) past 10-day retention window.`);

    for (const f of expiredFeedback) {
      totalProcessed++;
      let pdfDeletedSuccessfully = true;

      if (f.pdf_path) {
        try {
          const { error: storageError } = await supabase.storage
            .from('pdfs')
            .remove([f.pdf_path]);

          if (storageError) {
            const isNotFound = storageError.message?.toLowerCase().includes('not found') ||
                               storageError.message?.includes('404') ||
                               storageError.statusCode === 404;

            if (!isNotFound) {
              console.error(`[Feedback PDF Cleanup Job] Storage deletion error for PDF (${f.pdf_path}):`, storageError.message);
              pdfDeletedSuccessfully = false;
            } else {
              console.log(`[Feedback PDF Cleanup Job] PDF file already missing from storage (${f.pdf_path}), updating DB reference to NULL.`);
            }
          } else {
            console.log(`[Feedback PDF Cleanup Job] Successfully deleted feedback PDF from storage: ${f.pdf_path}`);
          }
        } catch (err) {
          console.error(`[Feedback PDF Cleanup Job] Unexpected error removing feedback PDF (${f.pdf_path}):`, err.message);
          pdfDeletedSuccessfully = false;
        }
      }

      // Step 2: Update Database Record to clear pdf_path reference (KEEP DB RECORD!)
      if (pdfDeletedSuccessfully) {
        const { error: dbUpdateError } = await supabase
          .from('feedback')
          .update({ pdf_path: null })
          .eq('id', f.id);

        if (dbUpdateError) {
          console.error(`[Feedback PDF Cleanup Job] DB record update failed for feedback ${f.feedback_id} (${f.id}):`, dbUpdateError.message);
          totalFailed++;
        } else {
          console.log(`[Feedback PDF Cleanup Job] Cleared PDF reference for feedback record ${f.feedback_id} (ID: ${f.id}). Record preserved.`);
          totalPdfsDeleted++;
        }
      } else {
        console.warn(`[Feedback PDF Cleanup Job] Retaining pdf_path reference for feedback ${f.feedback_id} for retry on next scheduled run because PDF deletion failed.`);
        totalFailed++;
      }
    }

    console.log(`[Feedback PDF Cleanup Job] Completed feedback PDF cleanup run. Processed: ${totalProcessed}, Deleted PDFs: ${totalPdfsDeleted}, Failed/Retrying: ${totalFailed}`);
    return {
      processed: totalProcessed,
      deleted: totalPdfsDeleted,
      failed: totalFailed,
      timestamp: nowUtc,
    };
  } catch (error) {
    console.error('[Feedback PDF Cleanup Job] Critical exception during feedback PDF cleanup:', error.message);
    return { processed: totalProcessed, deleted: totalPdfsDeleted, failed: totalFailed, error: error.message };
  }
}

/**
 * Combined cleanup job for both Quotation PDFs/Records and Customer Feedback PDFs.
 */
export async function runFullCleanup() {
  console.log('[Full Scheduled Cleanup] Triggering combined 10-day retention cleanup jobs...');
  const quotationResult = await runQuotationCleanup();
  const feedbackPdfResult = await runFeedbackPdfCleanup();

  return {
    quotations: quotationResult,
    feedbackPdfs: feedbackPdfResult,
    timestamp: new Date().toISOString(),
  };
}

