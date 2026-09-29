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
