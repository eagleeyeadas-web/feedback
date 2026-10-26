-- Eagle Eye SafDrive - 60-Day Automatic Stock Movement Cleanup
-- Migration 056: Automatic 60-Day History Retention for Stock Movements
--
-- Objective:
-- Automatically delete stock movement history records that are older than 60 days
-- based strictly on database timestamps (created_at < NOW() - INTERVAL '60 days').
--
-- Critical Protections:
-- 1. Authoritative inventory stock balances in inventory_products and material_inventory
--    are NEVER modified, reduced, increased, or recalculated.
-- 2. Quotations, quotation line items, and sequence numbers are NEVER touched or deleted.
-- 3. Checklists, products, materials, BOM configurations, and user accounts remain untouched.
-- 4. Records newer than or equal to the 60-day cutoff MUST be retained.
-- 5. Records with NULL or invalid timestamps are safely preserved.
-- 6. Batched deletion to prevent table locks on large production datasets.

-- 1. Ensure index on stock_movements(created_at) for efficient cutoff filtering
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at_retention 
ON public.stock_movements (created_at);

-- 2. Create dedicated 60-day cleanup procedure for stock movements
CREATE OR REPLACE FUNCTION cleanup_expired_stock_movements_60day(
  p_executed_by TEXT DEFAULT 'SYSTEM_CRON',
  p_batch_size INTEGER DEFAULT 500
)
RETURNS TABLE (
  success BOOLEAN,
  cutoff_timestamp TIMESTAMPTZ,
  movements_deleted INTEGER,
  device_returns_deleted INTEGER,
  material_returns_deleted INTEGER,
  error_message TEXT
) AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '60 days';
  v_mov_count INTEGER := 0;
  v_batch_deleted INTEGER := 0;
  v_dev_count INTEGER := 0;
  v_mat_count INTEGER := 0;
  v_err TEXT := NULL;
BEGIN
  BEGIN
    -- A. Delete eligible verified device returns strictly older than 60 days
    -- Exclude pending returns and returns associated with open discrepancies
    WITH deleted_dev AS (
      DELETE FROM public.job_device_returns
      WHERE created_at < v_cutoff
        AND created_at IS NOT NULL
        AND status = 'VERIFIED_AND_RECONCILED'
        AND checklist_id NOT IN (
          SELECT checklist_id FROM public.inventory_discrepancies WHERE status = 'OPEN' AND checklist_id IS NOT NULL
        )
      RETURNING id
    )
    SELECT COUNT(*) INTO v_dev_count FROM deleted_dev;

    -- B. Delete eligible verified material returns strictly older than 60 days
    -- Exclude pending returns and returns associated with open discrepancies
    WITH deleted_mat AS (
      DELETE FROM public.job_material_returns
      WHERE created_at < v_cutoff
        AND created_at IS NOT NULL
        AND status = 'VERIFIED_AND_RECONCILED'
        AND checklist_id NOT IN (
          SELECT checklist_id FROM public.inventory_discrepancies WHERE status = 'OPEN' AND checklist_id IS NOT NULL
        )
      RETURNING id
    )
    SELECT COUNT(*) INTO v_mat_count FROM deleted_mat;

    -- C. Delete eligible stock movements strictly older than 60 days
    -- Process in batched loop if requested to prevent table locking
    LOOP
      WITH eligible_batch AS (
        SELECT id FROM public.stock_movements
        WHERE created_at < v_cutoff
          AND created_at IS NOT NULL
          AND (
            checklist_id IS NULL OR (
              checklist_id NOT IN (
                SELECT checklist_id FROM public.inventory_discrepancies WHERE status = 'OPEN' AND checklist_id IS NOT NULL
                UNION
                SELECT checklist_id FROM public.job_device_returns WHERE status = 'PENDING_STORE_VERIFICATION'
                UNION
                SELECT checklist_id FROM public.job_material_returns WHERE status = 'PENDING_STORE_VERIFICATION'
              )
            )
          )
        LIMIT p_batch_size
      ),
      deleted_rows AS (
        DELETE FROM public.stock_movements
        WHERE id IN (SELECT id FROM eligible_batch)
        RETURNING id
      )
      SELECT COUNT(*) INTO v_batch_deleted FROM deleted_rows;

      v_mov_count := v_mov_count + v_batch_deleted;

      -- Exit loop when no more rows qualify in this batch
      EXIT WHEN v_batch_deleted = 0;
    END LOOP;

    -- D. Log successful cleanup into retention_cleanup_logs
    INSERT INTO public.retention_cleanup_logs (
      cutoff_timestamp,
      movements_deleted,
      device_returns_deleted,
      material_returns_deleted,
      status,
      executed_by,
      details
    ) VALUES (
      v_cutoff,
      v_mov_count,
      v_dev_count,
      v_mat_count,
      'SUCCESS',
      COALESCE(p_executed_by, 'SYSTEM_CRON'),
      jsonb_build_object(
        'policy', '60-DAY-RETENTION',
        'server_time', NOW(),
        'cutoff', v_cutoff,
        'movements_deleted', v_mov_count,
        'device_returns_deleted', v_dev_count,
        'material_returns_deleted', v_mat_count
      )
    );

    RETURN QUERY SELECT TRUE, v_cutoff, v_mov_count, v_dev_count, v_mat_count, NULL::TEXT;
    RETURN;

  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO public.retention_cleanup_logs (
      cutoff_timestamp,
      movements_deleted,
      device_returns_deleted,
      material_returns_deleted,
      status,
      error_message,
      executed_by
    ) VALUES (
      v_cutoff,
      0,
      0,
      0,
      'FAILED',
      v_err,
      COALESCE(p_executed_by, 'SYSTEM_CRON')
    );

    RETURN QUERY SELECT FALSE, v_cutoff, 0, 0, 0, v_err;
    RETURN;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update existing cleanup_expired_inventory_history to also use 60 days
CREATE OR REPLACE FUNCTION cleanup_expired_inventory_history(
  p_executed_by TEXT DEFAULT 'SYSTEM_CRON'
)
RETURNS TABLE (
  success BOOLEAN,
  cutoff_timestamp TIMESTAMPTZ,
  movements_deleted INTEGER,
  device_returns_deleted INTEGER,
  material_returns_deleted INTEGER,
  error_message TEXT
) AS $$
BEGIN
  RETURN QUERY SELECT * FROM cleanup_expired_stock_movements_60day(p_executed_by, 500);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Configure automated daily scheduling in pg_cron if available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule legacy 20-day job if registered
    PERFORM cron.unschedule('inventory_20day_history_cleanup');
    -- Unschedule previous 60-day job name if exists to ensure clean idempotent state
    PERFORM cron.unschedule('stock_movements_60day_cleanup');
    -- Schedule daily 60-day cleanup at 03:00 AM UTC
    PERFORM cron.schedule('stock_movements_60day_cleanup', '0 3 * * *', 'SELECT cleanup_expired_stock_movements_60day(''PG_CRON'')');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
