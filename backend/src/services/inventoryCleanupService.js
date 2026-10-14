import supabase from './supabase.js';
import { pruneLocalExpiredMovements } from './stockMovementService.js';
import { logAudit } from './auditService.js';

let cleanupInterval = null;
let isCleanupRunning = false;
let lastCleanupStatus = {
  last_run_at: null,
  status: 'IDLE',
  summary: null,
  error: null,
};

/**
 * Executes server-side 20-day automatic history retention cleanup.
 *
 * Rules:
 * 1. Cutoff: created_at < current database time - INTERVAL '20 days'
 * 2. Records newer than or equal to cutoff remain.
 * 3. Pending returns (status = 'PENDING_STORE_VERIFICATION') MUST NEVER be deleted.
 * 4. Verified returns older than 20 days are deleted ONLY if not tied to open discrepancies.
 * 5. Stock movements older than 20 days are deleted ONLY if not tied to active discrepancies or pending returns.
 * 6. Authoritative inventory stock balances in inventory_products and material_inventory are NEVER touched or recalculated.
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
    console.log(`[InventoryRetention] Starting 20-day history retention cleanup (Triggered by: ${executed_by})...`);

    // 1. Call PostgreSQL Stored Procedure in Supabase
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('cleanup_expired_inventory_history', {
      p_executed_by: executed_by,
    });

    if (rpcErr) {
      throw new Error(`Database cleanup stored procedure error: ${rpcErr.message}`);
    }

    const resultRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    const cutoffTimestamp = resultRow?.cutoff_timestamp || new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const movementsDeleted = Number(resultRow?.movements_deleted) || 0;
    const deviceReturnsDeleted = Number(resultRow?.device_returns_deleted) || 0;
    const materialReturnsDeleted = Number(resultRow?.material_returns_deleted) || 0;

    // 2. Prune local in-memory fallback stores to mirror database
    const localMovementsPruned = pruneLocalExpiredMovements(cutoffTimestamp);

    const summary = {
      success: true,
      cutoff_timestamp: cutoffTimestamp,
      server_time: new Date().toISOString(),
      movements_deleted: movementsDeleted,
      device_returns_deleted: deviceReturnsDeleted,
      material_returns_deleted: materialReturnsDeleted,
      local_movements_pruned: localMovementsPruned,
      executed_by,
    };

    lastCleanupStatus.status = 'COMPLETED';
    lastCleanupStatus.summary = summary;
    lastCleanupStatus.error = null;

    console.log(
      `[InventoryRetention] Cleanup completed successfully. Deleted: ${movementsDeleted} stock movements, ${deviceReturnsDeleted} device returns, ${materialReturnsDeleted} material returns older than 20 days.`
    );

    if (user) {
      await logAudit({
        actor_id: user.id,
        actor_email: user.email,
        actor_role: user.role,
        action: 'EXECUTE_INVENTORY_20DAY_CLEANUP',
        target_table: 'stock_movements',
        target_id: 'centralized_20day_cleanup',
        details: summary,
      }).catch(() => null);
    }

    return summary;
  } catch (err) {
    console.error('[InventoryRetention] Cleanup failed:', err.message);
    lastCleanupStatus.status = 'FAILED';
    lastCleanupStatus.error = err.message;

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

    if (!error && data) {
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
        console.log('[InventoryRetention] Running daily scheduled inventory cleanup on server startup...');
        await executeInventoryCleanup({ executed_by: 'SERVER_DAILY_STARTUP' });
      } else {
        console.log(`[InventoryRetention] Last cleanup was run at ${new Date(lastRun).toISOString()}. Next run scheduled in 24 hours.`);
      }
    } catch (e) {
      console.warn('[InventoryRetention] Scheduled check error:', e.message);
    }
  }, 15000);

  // Set recurring 24-hour interval timer
  cleanupInterval = setInterval(async () => {
    try {
      console.log('[InventoryRetention] Triggering recurring 24-hour inventory retention cleanup...');
      await executeInventoryCleanup({ executed_by: 'SERVER_DAILY_INTERVAL' });
    } catch (e) {
      console.error('[InventoryRetention] Scheduled interval cleanup error:', e.message);
    }
  }, TWENTY_FOUR_HOURS_MS);

  console.log('[InventoryRetention] Daily 24-hour server-side history retention job scheduled.');
}
