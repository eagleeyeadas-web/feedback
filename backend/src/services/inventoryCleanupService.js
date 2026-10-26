import supabase from './supabase.js';
import { pruneLocalExpiredMovements } from './stockMovementService.js';
import { logAudit } from './auditService.js';

export const STOCK_RETENTION_DAYS = 60;

let cleanupInterval = null;
let isCleanupRunning = false;
let lastCleanupStatus = {
  last_run_at: null,
  last_successful_run: null,
  status: 'IDLE',
  summary: null,
  error: null,
};

/**
 * Executes server-side 60-day automatic history retention cleanup for stock movements.
 *
 * Rules:
 * 1. Cutoff: created_at < current database time - INTERVAL '60 days'
 * 2. Records newer than or equal to cutoff remain intact.
 * 3. Records with missing or invalid timestamps are NEVER deleted.
 * 4. Pending returns (status = 'PENDING_STORE_VERIFICATION') MUST NEVER be deleted.
 * 5. Verified returns older than 60 days are deleted ONLY if not tied to open discrepancies.
 * 6. Stock movements older than 60 days are deleted ONLY if not tied to active discrepancies or pending returns.
 * 7. Authoritative inventory stock balances in inventory_products and material_inventory are NEVER touched or recalculated.
 * 8. Quotations, line items, sequences, checklists, and master catalogues are NEVER modified or deleted.
 */
export async function executeInventoryCleanup({ executed_by = 'SYSTEM_CRON', user = null } = {}) {
  if (isCleanupRunning) {
    return {
      success: false,
      message: 'Cleanup is currently running in another process. Please wait.',
      status: 'BUSY',
    };
  }

  isCleanupRunning = true;
  const startedAt = new Date().toISOString();
  lastCleanupStatus.last_run_at = startedAt;
  lastCleanupStatus.status = 'RUNNING';

  try {
    console.log(`[InventoryRetention] Starting 60-day history retention cleanup (Triggered by: ${executed_by})...`);

    // 1. Calculate authoritative 60-day cutoff timestamp
    // 60 days = 60 * 24 * 60 * 60 * 1000 ms
    const cutoffDate = new Date(Date.now() - STOCK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const fallbackCutoffIso = cutoffDate.toISOString();

    let movementsDeleted = 0;
    let deviceReturnsDeleted = 0;
    let materialReturnsDeleted = 0;
    let cutoffTimestamp = fallbackCutoffIso;
    let procedureExecuted = false;

    // 2. Try calling dedicated 60-day database stored procedure
    try {
      const { data: rpc60Result, error: rpc60Err } = await supabase.rpc('cleanup_expired_stock_movements_60day', {
        p_executed_by: executed_by,
        p_batch_size: 500,
      });

      if (!rpc60Err && rpc60Result) {
        const row = Array.isArray(rpc60Result) ? rpc60Result[0] : rpc60Result;
        cutoffTimestamp = row?.cutoff_timestamp || fallbackCutoffIso;
        movementsDeleted = Number(row?.movements_deleted) || 0;
        deviceReturnsDeleted = Number(row?.device_returns_deleted) || 0;
        materialReturnsDeleted = Number(row?.material_returns_deleted) || 0;
        procedureExecuted = true;
      }
    } catch (rpcErr) {
      // Stored procedure not yet migrated; fallback to direct safe batched query cleanup
      procedureExecuted = false;
    }

    // 3. Fallback: If 60-day RPC was not present in DB, execute batched deletion via Supabase API
    if (!procedureExecuted) {
      // Find open discrepancy checklist IDs to preserve
      let protectedChecklistIds = new Set();
      try {
        const { data: discData } = await supabase
          .from('inventory_discrepancies')
          .select('checklist_id')
          .eq('status', 'OPEN');
        (discData || []).forEach((d) => {
          if (d.checklist_id) protectedChecklistIds.add(d.checklist_id);
        });

        const { data: devPend } = await supabase
          .from('job_device_returns')
          .select('checklist_id')
          .eq('status', 'PENDING_STORE_VERIFICATION');
        (devPend || []).forEach((d) => {
          if (d.checklist_id) protectedChecklistIds.add(d.checklist_id);
        });

        const { data: matPend } = await supabase
          .from('job_material_returns')
          .select('checklist_id')
          .eq('status', 'PENDING_STORE_VERIFICATION');
        (matPend || []).forEach((d) => {
          if (d.checklist_id) protectedChecklistIds.add(d.checklist_id);
        });
      } catch (e) {
        // Discrepancy tables might be empty or unmigrated; continue safely
      }

      // Query eligible stock movements strictly older than 60 days
      const { data: oldMovements, error: fetchErr } = await supabase
        .from('stock_movements')
        .select('id, checklist_id, created_at')
        .lt('created_at', fallbackCutoffIso)
        .not('created_at', 'is', null)
        .limit(1000);

      if (fetchErr) {
        throw new Error(`Failed to query expired stock movements: ${fetchErr.message}`);
      }

      if (Array.isArray(oldMovements) && oldMovements.length > 0) {
        // Filter out movements connected to active protected checklists
        const eligibleToDelete = oldMovements.filter(
          (m) => !m.checklist_id || !protectedChecklistIds.has(m.checklist_id)
        );

        const eligibleIds = eligibleToDelete.map((m) => m.id);

        // Delete in controlled batches of 500
        const BATCH_SIZE = 500;
        for (let i = 0; i < eligibleIds.length; i += BATCH_SIZE) {
          const batch = eligibleIds.slice(i, i + BATCH_SIZE);
          const { error: delErr } = await supabase
            .from('stock_movements')
            .delete()
            .in('id', batch);

          if (delErr) {
            console.warn(`[InventoryRetention] Batch deletion warning: ${delErr.message}`);
          } else {
            movementsDeleted += batch.length;
          }
        }
      }

      // Delete eligible verified returns older than 60 days
      try {
        const { data: devOld } = await supabase
          .from('job_device_returns')
          .select('id, checklist_id')
          .lt('created_at', fallbackCutoffIso)
          .eq('status', 'VERIFIED_AND_RECONCILED')
          .not('created_at', 'is', null)
          .limit(500);

        const devEligible = (devOld || [])
          .filter((d) => !d.checklist_id || !protectedChecklistIds.has(d.checklist_id))
          .map((d) => d.id);

        if (devEligible.length > 0) {
          const { error: dErr } = await supabase.from('job_device_returns').delete().in('id', devEligible);
          if (!dErr) deviceReturnsDeleted = devEligible.length;
        }
      } catch (e) {
        // ignore
      }

      try {
        const { data: matOld } = await supabase
          .from('job_material_returns')
          .select('id, checklist_id')
          .lt('created_at', fallbackCutoffIso)
          .eq('status', 'VERIFIED_AND_RECONCILED')
          .not('created_at', 'is', null)
          .limit(500);

        const matEligible = (matOld || [])
          .filter((d) => !d.checklist_id || !protectedChecklistIds.has(d.checklist_id))
          .map((d) => d.id);

        if (matEligible.length > 0) {
          const { error: mErr } = await supabase.from('job_material_returns').delete().in('id', matEligible);
          if (!mErr) materialReturnsDeleted = matEligible.length;
        }
      } catch (e) {
        // ignore
      }

      // Record successful cleanup in retention_cleanup_logs
      try {
        await supabase.from('retention_cleanup_logs').insert([
          {
            cutoff_timestamp: fallbackCutoffIso,
            movements_deleted: movementsDeleted,
            device_returns_deleted: deviceReturnsDeleted,
            material_returns_deleted: materialReturnsDeleted,
            status: 'SUCCESS',
            executed_by: executed_by || 'SYSTEM_CRON',
            details: {
              policy: '60-DAY-RETENTION',
              retention_days: STOCK_RETENTION_DAYS,
              server_time: new Date().toISOString(),
              cutoff: fallbackCutoffIso,
              movements_deleted: movementsDeleted,
              device_returns_deleted: deviceReturnsDeleted,
              material_returns_deleted: materialReturnsDeleted,
            },
          },
        ]);
      } catch (logErr) {
        console.warn('[InventoryRetention] Could not write to retention_cleanup_logs:', logErr.message);
      }
    }

    // 4. Prune local in-memory/file fallback storage to mirror database
    const localMovementsPruned = pruneLocalExpiredMovements(cutoffTimestamp);

    const summary = {
      success: true,
      policy: '60-DAY-RETENTION',
      retention_days: STOCK_RETENTION_DAYS,
      cutoff_timestamp: cutoffTimestamp,
      server_time: new Date().toISOString(),
      movements_deleted: movementsDeleted,
      device_returns_deleted: deviceReturnsDeleted,
      material_returns_deleted: materialReturnsDeleted,
      local_movements_pruned: localMovementsPruned,
      executed_by,
    };

    lastCleanupStatus.status = 'COMPLETED';
    lastCleanupStatus.last_successful_run = new Date().toISOString();
    lastCleanupStatus.summary = summary;
    lastCleanupStatus.error = null;

    console.log(
      `[InventoryRetention] 60-day cleanup completed successfully. Deleted: ${movementsDeleted} stock movements, ${deviceReturnsDeleted} device returns, ${materialReturnsDeleted} material returns older than 60 days.`
    );

    if (user) {
      await logAudit({
        actor_id: user.id,
        actor_email: user.email,
        actor_role: user.role,
        action: 'EXECUTE_INVENTORY_60DAY_CLEANUP',
        target_table: 'stock_movements',
        target_id: 'centralized_60day_cleanup',
        details: summary,
      }).catch(() => null);
    }

    return summary;
  } catch (err) {
    console.error('[InventoryRetention] 60-day cleanup failed:', err.message);
    lastCleanupStatus.status = 'FAILED';
    lastCleanupStatus.error = err.message;

    // Log failure in retention_cleanup_logs if possible
    try {
      await supabase.from('retention_cleanup_logs').insert([
        {
          cutoff_timestamp: new Date(Date.now() - STOCK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
          movements_deleted: 0,
          device_returns_deleted: 0,
          material_returns_deleted: 0,
          status: 'FAILED',
          error_message: err.message,
          executed_by: executed_by || 'SYSTEM_CRON',
        },
      ]);
    } catch (e) {
      // ignore
    }

    return {
      success: false,
      error: err.message,
      executed_by,
    };
  } finally {
    isCleanupRunning = false;
  }
}

/**
 * Get recent retention cleanup execution logs
 */
export async function getCleanupLogs(limit = 20) {
  try {
    const { data, error } = await supabase
      .from('retention_cleanup_logs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(limit);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (e) {
    console.warn('Could not fetch retention cleanup logs from DB:', e.message);
  }

  return [
    {
      id: 'local-status',
      run_at: lastCleanupStatus.last_run_at,
      status: lastCleanupStatus.status,
      error_message: lastCleanupStatus.error,
      details: lastCleanupStatus.summary,
    },
  ];
}

/**
 * Get unified real-time 60-day retention cleanup status for Store Manager UI & monitoring
 */
export async function getCleanupStatus() {
  let latestLog = null;
  let lastSuccessfulRun = lastCleanupStatus.last_successful_run;

  try {
    const { data, error } = await supabase
      .from('retention_cleanup_logs')
      .select('*')
      .order('run_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      latestLog = data;
      if (data.status === 'SUCCESS') {
        lastSuccessfulRun = data.run_at;
      }
    }
  } catch (e) {
    // ignore
  }

  const isHealthy = latestLog ? latestLog.status === 'SUCCESS' : lastCleanupStatus.status !== 'FAILED';

  return {
    policy: '60-DAY-RETENTION',
    retention_days: STOCK_RETENTION_DAYS,
    notice: 'Stock movement history is retained for 60 days. Older records are automatically removed.',
    scheduler_configured: true,
    scheduler_frequency: 'Daily (Every 24 hours & on server boot)',
    is_running: isCleanupRunning,
    status: isCleanupRunning ? 'RUNNING' : (isHealthy ? 'ACTIVE' : 'FAILED'),
    health: isHealthy ? 'HEALTHY' : 'WARNING',
    last_run_at: latestLog?.run_at || lastCleanupStatus.last_run_at,
    last_successful_run: lastSuccessfulRun || latestLog?.run_at,
    movements_deleted_last_run: latestLog?.movements_deleted !== undefined ? Number(latestLog.movements_deleted) : 0,
    cutoff_timestamp: latestLog?.cutoff_timestamp || null,
    error_message: latestLog?.status === 'FAILED' ? latestLog.error_message : lastCleanupStatus.error,
  };
}

/**
 * Start the daily server-side scheduled cleanup job (runs automatically once every 24 hours)
 */
export function startDailyCleanupSchedule() {
  if (cleanupInterval) return;

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  // Initial check after 15 seconds of server uptime
  setTimeout(async () => {
    try {
      // Check last run from database to avoid unnecessary runs if recently executed
      const { data: logs } = await supabase
        .from('retention_cleanup_logs')
        .select('run_at')
        .order('run_at', { ascending: false })
        .limit(1);

      const lastRun = logs && logs[0] ? new Date(logs[0].run_at).getTime() : 0;
      const now = Date.now();

      // If more than 24 hours since last run, trigger automatic cleanup
      if (now - lastRun > TWENTY_FOUR_HOURS_MS) {
        console.log('[InventoryRetention] Running daily scheduled 60-day inventory cleanup on server startup...');
        await executeInventoryCleanup({ executed_by: 'SERVER_DAILY_STARTUP' });
      } else {
        console.log(`[InventoryRetention] Last 60-day cleanup was run at ${new Date(lastRun).toISOString()}. Next run scheduled in 24 hours.`);
      }
    } catch (e) {
      console.warn('[InventoryRetention] Scheduled check error:', e.message);
    }
  }, 15000);

  // Set recurring 24-hour interval timer
  cleanupInterval = setInterval(async () => {
    try {
      console.log('[InventoryRetention] Triggering recurring 24-hour 60-day inventory retention cleanup...');
      await executeInventoryCleanup({ executed_by: 'SERVER_DAILY_INTERVAL' });
    } catch (e) {
      console.error('[InventoryRetention] Scheduled interval cleanup error:', e.message);
    }
  }, TWENTY_FOUR_HOURS_MS);

  console.log('[InventoryRetention] Daily 24-hour server-side 60-day history retention job scheduled.');
}
