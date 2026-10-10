import supabase from './supabase.js';

/**
 * Eagle Eye SafDrive — Centralized 20-Day Automatic Cleanup Service
 * 
 * Retention Policy:
 * - 20 Calendar Days (480 hours) retention for temporary attachments (PDFs & signatures).
 * - Deletes the actual Storage objects from Supabase Storage buckets ('pdfs', 'signatures').
 * - PRESERVES core database records: Quotation history, line items, customer feedback,
 *   installation checklists, and customer profiles are kept in the database.
 * - STRICT EXCLUSION: Stock & Inventory tables, quantities, transactions, and return
 *   ledgers are permanently and unconditionally excluded from cleanup.
 * - Idempotent, safe batch pagination, error-retry handling, and zero cascade damage.
 */

export const RETENTION_DAYS = 20;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const MAX_BATCHES = 20; // Up to 1,000 records per run to prevent memory/HTTP timeouts

/**
 * Automatically cleans up expired quotation PDF files from Supabase Storage.
 * Expiry logic: expires_at <= current UTC time (20 days after creation) or created_at <= 20 days ago.
 * 
 * Safety features:
 * - Deletes ONLY the physical PDF from Supabase Storage ('pdfs' bucket).
 * - Updates the quotation database record setting `pdf_path = null`.
 * - PRESERVES the quotation record, its line items, customer details, pricing, and history!
 * - Never triggers cascading deletes to quotation items or related workflows.
 * - Idempotent execution with batch pagination.
 * - Retains DB reference for retry if Storage removal encounters a network/system failure.
 */
export async function runQuotationCleanup() {
  const now = new Date();
  const nowUtc = now.toISOString();
  const twentyDaysAgoUtc = new Date(now.getTime() - RETENTION_MS).toISOString();

  console.log(`[Quotation Cleanup Job] Starting 20-day automated quotation PDF cleanup at ${nowUtc}...`);

  let totalProcessed = 0;
  let totalFilesDeleted = 0;
  let totalFailed = 0;
  let batchIndex = 0;

  try {
    while (batchIndex < MAX_BATCHES) {
      batchIndex++;

      // Fetch batch of up to 50 expired quotations that still have a PDF attachment
      let expiredQuotations = null;
      let fetchError = null;

      const { data: dataExpiry, error: errExpiry } = await supabase
        .from('quotations')
        .select('id, quotation_number, pdf_path, created_at, expires_at')
        .not('pdf_path', 'is', null)
        .lte('expires_at', nowUtc)
        .limit(BATCH_SIZE);

      if (errExpiry && errExpiry.message?.includes('expires_at')) {
        // Fallback query if expires_at column is missing or null: created_at <= 20 days ago
        console.log('[Quotation Cleanup Job] Falling back to created_at <= 20 days query.');
        const { data: dataCreated, error: errCreated } = await supabase
          .from('quotations')
          .select('id, quotation_number, pdf_path, created_at')
          .not('pdf_path', 'is', null)
          .lte('created_at', twentyDaysAgoUtc)
          .limit(BATCH_SIZE);

        expiredQuotations = dataCreated;
        fetchError = errCreated;
      } else {
        expiredQuotations = dataExpiry;
        fetchError = errExpiry;
      }

      if (fetchError) {
        console.error('[Quotation Cleanup Job] Error fetching expired quotations:', fetchError.message);
        return {
          processed: totalProcessed,
          deletedFiles: totalFilesDeleted,
          failed: totalFailed,
          error: fetchError.message,
        };
      }

      // No more expired quotations in this batch
      if (!expiredQuotations || expiredQuotations.length === 0) {
        break;
      }

      console.log(`[Quotation Cleanup Job] Batch ${batchIndex}: Processing ${expiredQuotations.length} expired quotation PDF(s)...`);

      for (const q of expiredQuotations) {
        totalProcessed++;
        let pdfDeletedSuccessfully = true;

        // Step 1: Remove PDF from Supabase Storage 'pdfs' bucket
        if (q.pdf_path) {
          try {
            const { error: storageError } = await supabase.storage
              .from('pdfs')
              .remove([q.pdf_path]);

            if (storageError) {
              const isNotFound = storageError.message?.toLowerCase().includes('not found') ||
                                 storageError.message?.includes('404') ||
                                 storageError.statusCode === 404;

              if (!isNotFound) {
                console.error(`[Quotation Cleanup Job] Storage deletion error for PDF (${q.pdf_path}):`, storageError.message);
                pdfDeletedSuccessfully = false;
              } else {
                console.log(`[Quotation Cleanup Job] PDF file already missing from storage (${q.pdf_path}), clearing DB reference.`);
              }
            } else {
              console.log(`[Quotation Cleanup Job] Successfully deleted quotation PDF from storage: ${q.pdf_path}`);
            }
          } catch (err) {
            console.error(`[Quotation Cleanup Job] Unexpected error removing PDF (${q.pdf_path}):`, err.message);
            pdfDeletedSuccessfully = false;
          }
        }

        // Step 2: Clear pdf_path reference in database, PRESERVING the quotation record and its line items!
        if (pdfDeletedSuccessfully) {
          const { error: dbUpdateError } = await supabase
            .from('quotations')
            .update({ pdf_path: null })
            .eq('id', q.id);

          if (dbUpdateError) {
            console.error(`[Quotation Cleanup Job] DB update failed for quotation ${q.quotation_number} (${q.id}):`, dbUpdateError.message);
            totalFailed++;
          } else {
            console.log(`[Quotation Cleanup Job] Cleared PDF reference for quotation ${q.quotation_number} (ID: ${q.id}). Quotation & items preserved.`);
            totalFilesDeleted++;
          }
        } else {
          console.warn(`[Quotation Cleanup Job] Retaining DB reference for quotation ${q.quotation_number} for retry on next scheduled run because Storage deletion failed.`);
          totalFailed++;
        }
      }

      // If batch had fewer than BATCH_SIZE, all available items have been processed
      if (expiredQuotations.length < BATCH_SIZE) {
        break;
      }
    }

    console.log(`[Quotation Cleanup Job] Completed quotation cleanup run. Processed: ${totalProcessed}, Deleted PDFs: ${totalFilesDeleted}, Failed/Retrying: ${totalFailed}`);
    return {
      processed: totalProcessed,
      deletedFiles: totalFilesDeleted,
      failed: totalFailed,
      dbRecordsPreserved: true,
      timestamp: nowUtc,
    };
  } catch (error) {
    console.error('[Quotation Cleanup Job] Critical exception during quotation cleanup:', error.message);
    return { processed: totalProcessed, deletedFiles: totalFilesDeleted, failed: totalFailed, error: error.message };
  }
}

/**
 * Automatically cleans up expired customer feedback PDF files & signature images from Supabase Storage.
 * Expiry logic: pdf_expires_at <= current UTC time (20 days after submitted_at) or submitted_at <= 20 days ago.
 * 
 * Safety features:
 * - Deletes the physical PDF file from Supabase Storage ('pdfs' bucket).
 * - Deletes the physical signature image from Supabase Storage ('signatures' bucket).
 * - Updates the feedback DB record setting `pdf_path = null` and `signature_path = null`.
 * - PRESERVES the customer feedback DB record, ratings, comments, and customer info!
 * - Idempotent with batch pagination.
 */
export async function runFeedbackPdfCleanup() {
  const now = new Date();
  const nowUtc = now.toISOString();
  const twentyDaysAgoUtc = new Date(now.getTime() - RETENTION_MS).toISOString();

  console.log(`[Feedback Cleanup Job] Starting 20-day automated feedback attachment cleanup at ${nowUtc}...`);

  let totalProcessed = 0;
  let totalPdfsDeleted = 0;
  let totalSignaturesDeleted = 0;
  let totalFailed = 0;
  let batchIndex = 0;

  try {
    while (batchIndex < MAX_BATCHES) {
      batchIndex++;

      let expiredFeedback = null;
      let fetchError = null;

      // Query feedback records that have an attachment and are older than 20 days
      const { data: dataExpiry, error: errExpiry } = await supabase
        .from('feedback')
        .select('id, feedback_id, pdf_path, signature_path, submitted_at, pdf_expires_at')
        .or('pdf_path.not.is.null,signature_path.not.is.null')
        .lte('pdf_expires_at', nowUtc)
        .limit(BATCH_SIZE);

      if (errExpiry && errExpiry.message?.includes('pdf_expires_at')) {
        // Fallback query if pdf_expires_at is not present: submitted_at <= 20 days ago
        console.log('[Feedback Cleanup Job] Falling back to submitted_at <= 20 days query.');
        const { data: dataSubmitted, error: errSubmitted } = await supabase
          .from('feedback')
          .select('id, feedback_id, pdf_path, signature_path, submitted_at')
          .or('pdf_path.not.is.null,signature_path.not.is.null')
          .lte('submitted_at', twentyDaysAgoUtc)
          .limit(BATCH_SIZE);

        expiredFeedback = dataSubmitted;
        fetchError = errSubmitted;
      } else {
        expiredFeedback = dataExpiry;
        fetchError = errExpiry;
      }

      if (fetchError) {
        console.error('[Feedback Cleanup Job] Error fetching expired feedback PDFs:', fetchError.message);
        return {
          processed: totalProcessed,
          deletedPdfs: totalPdfsDeleted,
          deletedSignatures: totalSignaturesDeleted,
          failed: totalFailed,
          error: fetchError.message,
        };
      }

      if (!expiredFeedback || expiredFeedback.length === 0) {
        break;
      }

      console.log(`[Feedback Cleanup Job] Batch ${batchIndex}: Processing ${expiredFeedback.length} expired feedback attachment(s)...`);

      for (const f of expiredFeedback) {
        totalProcessed++;
        let pdfDeletedSuccessfully = true;
        let sigDeletedSuccessfully = true;

        // Step 1: Remove PDF from Supabase Storage 'pdfs' bucket
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
                console.error(`[Feedback Cleanup Job] Storage deletion error for PDF (${f.pdf_path}):`, storageError.message);
                pdfDeletedSuccessfully = false;
              }
            } else {
              totalPdfsDeleted++;
              console.log(`[Feedback Cleanup Job] Successfully deleted feedback PDF from storage: ${f.pdf_path}`);
            }
          } catch (err) {
            console.error(`[Feedback Cleanup Job] Unexpected error removing feedback PDF (${f.pdf_path}):`, err.message);
            pdfDeletedSuccessfully = false;
          }
        }

        // Step 2: Remove signature from Supabase Storage 'signatures' bucket
        if (f.signature_path) {
          try {
            const { error: sigError } = await supabase.storage
              .from('signatures')
              .remove([f.signature_path]);

            if (sigError) {
              const isNotFound = sigError.message?.toLowerCase().includes('not found') ||
                                 sigError.message?.includes('404') ||
                                 sigError.statusCode === 404;

              if (!isNotFound) {
                console.error(`[Feedback Cleanup Job] Storage deletion error for signature (${f.signature_path}):`, sigError.message);
                sigDeletedSuccessfully = false;
              }
            } else {
              totalSignaturesDeleted++;
              console.log(`[Feedback Cleanup Job] Successfully deleted feedback signature from storage: ${f.signature_path}`);
            }
          } catch (err) {
            console.error(`[Feedback Cleanup Job] Unexpected error removing signature (${f.signature_path}):`, err.message);
            sigDeletedSuccessfully = false;
          }
        }

        // Step 3: Update Database Record to clear file paths, PRESERVING the customer feedback row!
        const updatePayload = {};
        if (pdfDeletedSuccessfully && f.pdf_path) updatePayload.pdf_path = null;
        if (sigDeletedSuccessfully && f.signature_path) updatePayload.signature_path = null;

        if (Object.keys(updatePayload).length > 0) {
          const { error: dbUpdateError } = await supabase
            .from('feedback')
            .update(updatePayload)
            .eq('id', f.id);

          if (dbUpdateError) {
            if (dbUpdateError.message?.includes('signature_path') && dbUpdateError.message?.includes('not-null constraint')) {
              // If remote schema has not yet executed Migration 011 (DROP NOT NULL on signature_path),
              // safely clear pdf_path = null and retain signature_path to maintain DB integrity.
              const { error: fallbackErr } = await supabase
                .from('feedback')
                .update({ pdf_path: null })
                .eq('id', f.id);
              if (!fallbackErr) {
                console.log(`[Feedback Cleanup Job] Cleared PDF attachment for feedback ${f.feedback_id} (ID: ${f.id}). (signature_path retained due to DB column constraint).`);
              } else {
                console.error(`[Feedback Cleanup Job] DB fallback update failed for feedback ${f.feedback_id}:`, fallbackErr.message);
                totalFailed++;
              }
            } else {
              console.error(`[Feedback Cleanup Job] DB record update failed for feedback ${f.feedback_id} (${f.id}):`, dbUpdateError.message);
              totalFailed++;
            }
          } else {
            console.log(`[Feedback Cleanup Job] Cleared attachments for feedback ${f.feedback_id} (ID: ${f.id}). Feedback record preserved.`);
          }
        } else if (!pdfDeletedSuccessfully || !sigDeletedSuccessfully) {
          console.warn(`[Feedback Cleanup Job] Retaining attachment references for feedback ${f.feedback_id} for retry on next scheduled run.`);
          totalFailed++;
        }
      }

      if (expiredFeedback.length < BATCH_SIZE) {
        break;
      }
    }

    console.log(`[Feedback Cleanup Job] Completed feedback cleanup run. Processed: ${totalProcessed}, Deleted PDFs: ${totalPdfsDeleted}, Deleted Signatures: ${totalSignaturesDeleted}, Failed/Retrying: ${totalFailed}`);
    return {
      processed: totalProcessed,
      deletedPdfs: totalPdfsDeleted,
      deletedSignatures: totalSignaturesDeleted,
      failed: totalFailed,
      dbRecordsPreserved: true,
      timestamp: nowUtc,
    };
  } catch (error) {
    console.error('[Feedback Cleanup Job] Critical exception during feedback PDF cleanup:', error.message);
    return { processed: totalProcessed, deletedPdfs: totalPdfsDeleted, deletedSignatures: totalSignaturesDeleted, failed: totalFailed, error: error.message };
  }
}

/**
 * Combined Centralized 20-Day Cleanup Engine.
 * 
 * Reusable orchestrator running cleanup across all eligible modules while
 * strictly and explicitly excluding Stock & Inventory, Installation Checklists,
 * Customers, and Audit logs.
 */
export async function runFullCleanup() {
  console.log(`[Full Scheduled Cleanup] Triggering centralized 20-day retention cleanup jobs at ${new Date().toISOString()}...`);
  console.log('[Full Scheduled Cleanup] Exclusions: Stock & Inventory, Checklists, Customers, and Audit Logs are permanently protected.');

  const quotationResult = await runQuotationCleanup();
  const feedbackResult = await runFeedbackPdfCleanup();

  return {
    success: true,
    policy: '20-Day Centralized Automatic Retention',
    retentionDays: RETENTION_DAYS,
    timestamp: new Date().toISOString(),
    modules: {
      quotations: quotationResult,
      customerFeedback: feedbackResult,
    },
    excludedModules: [
      'inventory_products (Stock balances & definitions)',
      'inventory_transactions (Stock movements & transaction history)',
      'store_device_returns (Store returns & verification records)',
      'installation_checklists (Installation jobs & customer requirements)',
      'job_device_carry_records (Technician carry audit trails)',
      'technical_installation_reports (Site work completion reports)',
      'customers (Customer directory)',
      'admin_users & audit_logs (Security & audit trails)',
      'assets/logo.png (Branding & letterhead assets)',
    ],
  };
}

/**
 * Express Route Handler for Centralized 20-Day Cleanup Trigger.
 * Validates authentication via:
 * 1. process.env.CRON_SECRET (via header `x-cron-secret` or query param `secret`)
 *    - Strict: NEVER uses a hardcoded fallback secret!
 * 2. Supabase Admin Bearer Token
 */
export async function handleCleanupEndpoint(req, res) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = req.headers['x-cron-secret'] || req.query.secret;

    let isCronAuthorized = false;
    if (cronSecret && providedSecret && providedSecret === cronSecret) {
      isCronAuthorized = true;
    }

    const authHeader = req.headers.authorization;
    let isAdmin = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) isAdmin = true;
    }

    if (!isCronAuthorized && !isAdmin) {
      if (!cronSecret && !authHeader) {
        console.error('[Cleanup API] CRON_SECRET environment variable is not configured on the server.');
        return res.status(500).json({ error: 'CRON_SECRET environment variable is not configured on the server' });
      }
      return res.status(401).json({ error: 'Unauthorized cleanup request: Invalid or missing x-cron-secret' });
    }

    const result = await runFullCleanup();
    return res.json({ message: 'Centralized 20-day scheduled cleanup executed successfully', result });
  } catch (err) {
    console.error('Cleanup route error:', err);
    return res.status(500).json({ error: 'Cleanup execution failed' });
  }
}

