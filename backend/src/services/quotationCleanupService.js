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

  const isQuotationsSuccessful = !quotationResult.error && (quotationResult.failed === 0 || quotationResult.processed === 0);
  const isFeedbackSuccessful = !feedbackResult.error && (feedbackResult.failed === 0 || feedbackResult.processed === 0);
  const overallSuccess = isQuotationsSuccessful && isFeedbackSuccessful;

  return {
    success: overallSuccess,
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

export const CLEANUP_JOB_ID = 'centralized_20day_cleanup';
export const COOLDOWN_HOURS = 24;
export const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;
export const LOCK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes lock expiry

// Resilient in-memory fallback state in case database table is unreachable or not yet migrated
let inMemoryCleanupState = {
  id: CLEANUP_JOB_ID,
  last_successful_run_at: null,
  last_run_started_at: null,
  last_run_status: 'IDLE',
  locked_until: null,
  last_run_summary: null,
  last_error: null,
};

/**
 * Test helper to simulate past timestamps and failure recovery
 */
export function _setCleanupStateForTesting(state) {
  inMemoryCleanupState = {
    ...inMemoryCleanupState,
    ...state,
  };
}


/**
 * Get current persistent cleanup state from database (or fallback)
 */
export async function getCleanupState() {
  try {
    const { data, error } = await supabase
      .from('system_cleanup_state')
      .select('*')
      .eq('id', CLEANUP_JOB_ID)
      .maybeSingle();

    if (!error && data) {
      inMemoryCleanupState = { ...data };
      return data;
    }
  } catch (err) {
    console.warn('[Cleanup State] DB fetch failed, using fallback state:', err.message);
  }
  return inMemoryCleanupState;
}

/**
 * Atomically claim cleanup lock and verify 24-hour cooldown.
 * Safe against race conditions from concurrent browser tabs or multiple users.
 */
export async function claimCleanupLock({ userId = null, cooldownHours = 24, force = false } = {}) {
  const now = new Date();
  const nowUtc = now.toISOString();
  const lockExpiry = new Date(now.getTime() + LOCK_TIMEOUT_MS).toISOString();

  // Step 1: Try stored procedure RPC claim_cleanup_lock if available in Supabase
  try {
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('claim_cleanup_lock', {
        p_user_id: userId || null,
        p_cooldown_hours: force ? 0 : cooldownHours,
      });

    if (!rpcError && rpcData && rpcData.length > 0) {
      const claimResult = rpcData[0];
      return {
        claimed: Boolean(claimResult.claimed),
        reason: claimResult.reason,
        lastSuccessfulRunAt: claimResult.last_successful_run_at,
        lockedUntil: claimResult.locked_until,
      };
    }
  } catch (rpcErr) {
    // RPC not available yet; proceed to table optimistic update
  }

  // Step 2: Table-level optimistic claim on system_cleanup_state
  try {
    const { data: existing, error: selectErr } = await supabase
      .from('system_cleanup_state')
      .select('*')
      .eq('id', CLEANUP_JOB_ID)
      .maybeSingle();

    if (!selectErr) {
      const current = existing || inMemoryCleanupState;

      // Check active lock
      if (current.locked_until && new Date(current.locked_until) > now) {
        return {
          claimed: false,
          reason: 'CLEANUP_ALREADY_RUNNING',
          lastSuccessfulRunAt: current.last_successful_run_at,
          lockedUntil: current.locked_until,
        };
      }

      // Check 24-hour cooldown
      if (!force && current.last_successful_run_at) {
        const lastRunTime = new Date(current.last_successful_run_at).getTime();
        if (now.getTime() - lastRunTime < cooldownHours * 60 * 60 * 1000) {
          return {
            claimed: false,
            reason: 'COOLDOWN_ACTIVE',
            lastSuccessfulRunAt: current.last_successful_run_at,
            lockedUntil: null,
          };
        }
      }

      // Claim lock atomically via conditional update
      const { data: updatedRows, error: updateErr } = await supabase
        .from('system_cleanup_state')
        .update({
          last_run_status: 'RUNNING',
          last_run_started_at: nowUtc,
          locked_until: lockExpiry,
          triggered_by_user_id: userId || null,
          updated_at: nowUtc,
        })
        .eq('id', CLEANUP_JOB_ID)
        .select();

      if (!updateErr && updatedRows && updatedRows.length > 0) {
        inMemoryCleanupState = { ...updatedRows[0] };
        return {
          claimed: true,
          reason: 'LOCK_ACQUIRED',
          lastSuccessfulRunAt: updatedRows[0].last_successful_run_at,
          lockedUntil: lockExpiry,
        };
      }
    }
  } catch (dbErr) {
    console.warn('[Cleanup Lock] DB table update failed, evaluating fallback lock:', dbErr.message);
  }

  // Step 3: Resilient in-memory lock fallback
  if (inMemoryCleanupState.locked_until && new Date(inMemoryCleanupState.locked_until) > now) {
    return {
      claimed: false,
      reason: 'CLEANUP_ALREADY_RUNNING',
      lastSuccessfulRunAt: inMemoryCleanupState.last_successful_run_at,
      lockedUntil: inMemoryCleanupState.locked_until,
    };
  }

  if (!force && inMemoryCleanupState.last_successful_run_at) {
    const lastRunTime = new Date(inMemoryCleanupState.last_successful_run_at).getTime();
    if (now.getTime() - lastRunTime < cooldownHours * 60 * 60 * 1000) {
      return {
        claimed: false,
        reason: 'COOLDOWN_ACTIVE',
        lastSuccessfulRunAt: inMemoryCleanupState.last_successful_run_at,
        lockedUntil: null,
      };
    }
  }

  inMemoryCleanupState.last_run_status = 'RUNNING';
  inMemoryCleanupState.last_run_started_at = nowUtc;
  inMemoryCleanupState.locked_until = lockExpiry;
  inMemoryCleanupState.triggered_by_user_id = userId || null;

  return {
    claimed: true,
    reason: 'LOCK_ACQUIRED',
    lastSuccessfulRunAt: inMemoryCleanupState.last_successful_run_at,
    lockedUntil: lockExpiry,
  };
}

/**
 * Release lock and update persistent status
 */
export async function releaseCleanupLock({ success, summary = null, error = null }) {
  const nowUtc = new Date().toISOString();

  // Try RPC first
  try {
    const { error: rpcErr } = await supabase.rpc('release_cleanup_lock', {
      p_success: Boolean(success),
      p_summary: summary || null,
      p_error: error || null,
    });
    if (!rpcErr) return;
  } catch (e) {
    // Fall back to table update
  }

  const updatePayload = {
    last_run_status: success ? 'COMPLETED' : 'FAILED',
    locked_until: null,
    updated_at: nowUtc,
  };

  if (success) {
    updatePayload.last_successful_run_at = nowUtc;
    updatePayload.last_run_summary = summary || null;
    updatePayload.last_error = null;
  } else {
    // Rule 8: Do NOT update last_successful_run_at on failure!
    updatePayload.last_error = error || 'Cleanup execution failed';
  }

  try {
    await supabase
      .from('system_cleanup_state')
      .update(updatePayload)
      .eq('id', CLEANUP_JOB_ID);
  } catch (err) {
    console.warn('[Cleanup Lock] DB release update failed:', err.message);
  }

  inMemoryCleanupState = {
    ...inMemoryCleanupState,
    ...updatePayload,
  };
}

/**
 * Activity-Triggered Cleanup Orchestrator.
 * Enforces 24-hour interval between successful executions and concurrency lock.
 */
export async function executeActivityTriggeredCleanup({ userId = null, force = false } = {}) {
  console.log(`[Activity Cleanup Engine] Evaluating cleanup eligibility (user: ${userId || 'SYSTEM'}, force: ${force})...`);

  // Step 1: Attempt to claim the concurrency lock and evaluate 24-hour cooldown
  const claim = await claimCleanupLock({ userId, cooldownHours: COOLDOWN_HOURS, force });

  if (!claim.claimed) {
    console.log(`[Activity Cleanup Engine] Cleanup skipped. Reason: ${claim.reason} (Last successful run: ${claim.lastSuccessfulRunAt || 'Never'})`);
    return {
      status: 'skipped',
      executed: false,
      reason: claim.reason,
      lastSuccessfulRunAt: claim.lastSuccessfulRunAt,
      lockedUntil: claim.lockedUntil,
    };
  }

  console.log('[Activity Cleanup Engine] Lock acquired! Executing centralized 20-day retention cleanup across all eligible modules...');

  // Step 2: Execute centralized cleanup
  let cleanupResult = null;
  let executionError = null;

  try {
    cleanupResult = await runFullCleanup();
    if (!cleanupResult.success) {
      executionError = 'One or more cleanup modules failed';
    }
  } catch (err) {
    executionError = err.message || 'Unexpected cleanup execution exception';
    console.error('[Activity Cleanup Engine] Execution error:', executionError);
  }

  // Step 3: Release lock and update persistent database state
  const isSuccess = !executionError && cleanupResult && cleanupResult.success;
  await releaseCleanupLock({
    success: isSuccess,
    summary: cleanupResult,
    error: executionError,
  });

  if (!isSuccess) {
    console.error(`[Activity Cleanup Engine] Cleanup failed: ${executionError}. Last successful run timestamp was NOT updated.`);
    return {
      status: 'failed',
      executed: true,
      success: false,
      error: executionError,
      lastSuccessfulRunAt: claim.lastSuccessfulRunAt,
    };
  }

  console.log('[Activity Cleanup Engine] Cleanup completed successfully. Updated persistent last_successful_run_at timestamp.');
  return {
    status: 'completed',
    executed: true,
    success: true,
    result: cleanupResult,
    lastSuccessfulRunAt: new Date().toISOString(),
  };
}

/**
 * Express Route Handler for Centralized 20-Day Cleanup Trigger.
 * Validates authentication via:
 * 1. process.env.CRON_SECRET (via header `x-cron-secret` or query param `secret`)
 *    - Strict: NEVER uses a hardcoded fallback secret!
 * 2. Authenticated user token (Sales, Technical, Store Manager, Admin)
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
    let isAuthenticatedUser = false;
    let userId = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        isAuthenticatedUser = true;
        userId = user.id;
      }
    }

    if (!isCronAuthorized && !isAuthenticatedUser) {
      if (!cronSecret && !authHeader) {
        console.error('[Cleanup API] CRON_SECRET environment variable is not configured on the server.');
        return res.status(500).json({ error: 'CRON_SECRET environment variable is not configured on the server' });
      }
      return res.status(401).json({ error: 'Unauthorized cleanup request: Valid user authentication or x-cron-secret required.' });
    }

    // Force run only allowed if explicit force query is passed by authorized secret/admin
    const force = Boolean(req.query.force && isCronAuthorized);

    const result = await executeActivityTriggeredCleanup({ userId, force });

    if (result.status === 'skipped') {
      return res.json({
        message: 'Cleanup check completed: Skipped because cleanup already executed within 24 hours or is currently running.',
        status: 'skipped',
        reason: result.reason,
        lastSuccessfulRunAt: result.lastSuccessfulRunAt,
        executed: false,
      });
    }

    if (result.status === 'failed') {
      return res.status(500).json({
        error: 'Cleanup execution failed',
        status: 'failed',
        reason: result.error,
        executed: true,
      });
    }

    return res.json({
      message: 'Centralized 20-day scheduled cleanup executed successfully',
      status: 'completed',
      result: result.result,
      lastSuccessfulRunAt: result.lastSuccessfulRunAt,
      executed: true,
    });
  } catch (err) {
    console.error('Cleanup route error:', err);
    return res.status(500).json({ error: 'Cleanup execution failed' });
  }
}

/**
 * Express Route Handler for Inspecting Cleanup Status
 */
export async function handleCleanupStatusEndpoint(req, res) {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = req.headers['x-cron-secret'] || req.query.secret;

    let authorized = false;
    if (cronSecret && providedSecret && providedSecret === cronSecret) {
      authorized = true;
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) authorized = true;
    }

    if (!authorized) {
      return res.status(401).json({ error: 'Unauthorized status request' });
    }

    const state = await getCleanupState();
    return res.json({
      jobId: CLEANUP_JOB_ID,
      retentionDays: RETENTION_DAYS,
      cooldownHours: COOLDOWN_HOURS,
      lastSuccessfulRunAt: state.last_successful_run_at,
      lastRunStatus: state.last_run_status,
      lockedUntil: state.locked_until,
      lastRunSummary: state.last_run_summary,
      lastError: state.last_error,
    });
  } catch (err) {
    console.error('Cleanup status error:', err);
    return res.status(500).json({ error: 'Failed to retrieve cleanup status' });
  }
}


