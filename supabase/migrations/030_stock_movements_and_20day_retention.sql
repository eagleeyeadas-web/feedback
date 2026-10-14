-- ============================================================
-- Eagle Eye SafDrive - Inventory Persistence and 20-Day History Retention
-- Migration 030: Stock Movements Ledger, Device/Material Returns Persistence,
--               and Automated 20-Day History Retention Cleanup
-- ============================================================

-- 1. Ensure INVENTORY_PRODUCTS table exists
CREATE TABLE IF NOT EXISTS inventory_products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                     TEXT UNIQUE,
  device_name             TEXT NOT NULL,
  device_type             TEXT NOT NULL UNIQUE,
  unit                    TEXT NOT NULL DEFAULT 'Nos.',
  opening_quantity        INTEGER NOT NULL DEFAULT 0,
  opening_stock_set       BOOLEAN NOT NULL DEFAULT false,
  usable_stock            INTEGER NOT NULL DEFAULT 0 CHECK (usable_stock >= 0),
  reserved_stock          INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  issued_stock            INTEGER NOT NULL DEFAULT 0 CHECK (issued_stock >= 0),
  returned_usable_stock   INTEGER NOT NULL DEFAULT 0 CHECK (returned_usable_stock >= 0),
  damaged_stock           INTEGER NOT NULL DEFAULT 0 CHECK (damaged_stock >= 0),
  min_stock_level         INTEGER NOT NULL DEFAULT 5,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard 7 camera models if not present
INSERT INTO inventory_products (device_name, device_type, sku, unit, usable_stock, opening_quantity, opening_stock_set, min_stock_level)
VALUES
  ('2 Channel Live Camera System', '2 Channel Live', 'EE-2CH-LIVE', 'Nos.', 0, 0, false, 5),
  ('2 Channel Recording System', '2 Channel Recording', 'EE-2CH-REC', 'Nos.', 0, 0, false, 5),
  ('4 Channel Live MDVR System', '4 Channel Live', 'EE-4CH-LIVE', 'Nos.', 0, 0, false, 5),
  ('4 Channel Recording MDVR System', '4 Channel Recording', 'EE-4CH-REC', 'Nos.', 0, 0, false, 5),
  ('6 Channel Live Telematics System', '6 Channel Live', 'EE-6CH-LIVE', 'Nos.', 0, 0, false, 5),
  ('6 Channel Recording Telematics System', '6 Channel Recording', 'EE-6CH-REC', 'Nos.', 0, 0, false, 5),
  ('8 Channel Live Enterprise System', '8 Channel Live', 'EE-8CH-LIVE', 'Nos.', 0, 0, false, 5)
ON CONFLICT (device_type) DO UPDATE SET
  sku = EXCLUDED.sku
WHERE inventory_products.sku IS NULL;


-- 2. Ensure MATERIAL_INVENTORY table exists
CREATE TABLE IF NOT EXISTS material_inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                 TEXT UNIQUE,
  material_name       TEXT NOT NULL UNIQUE,
  unit                TEXT NOT NULL,
  current_stock       NUMERIC NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  opening_stock       NUMERIC NOT NULL DEFAULT 0,
  opening_stock_set   BOOLEAN NOT NULL DEFAULT false,
  issued_stock        NUMERIC NOT NULL DEFAULT 0 CHECK (issued_stock >= 0),
  damaged_stock       NUMERIC NOT NULL DEFAULT 0 CHECK (damaged_stock >= 0),
  min_stock_level     NUMERIC NOT NULL DEFAULT 10 CHECK (min_stock_level >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial 11 materials
INSERT INTO material_inventory (material_name, sku, unit, current_stock, opening_stock, opening_stock_set, min_stock_level)
VALUES
  ('Insulation Tape', 'MAT-INSU-TAPE', 'Nos.', 100, 100, true, 20),
  ('Cable Tie – 200 mm', 'MAT-CT-200MM', 'Packets', 50, 50, true, 10),
  ('Cable Tie – 300 mm', 'MAT-CT-300MM', 'Packets', 40, 40, true, 10),
  ('Long Screw', 'MAT-SCREW-LONG', 'Nos.', 500, 500, true, 50),
  ('Small Screw', 'MAT-SCREW-SMALL', 'Nos.', 500, 500, true, 50),
  ('Memory Card', 'MAT-MEM-CARD', 'Nos.', 100, 100, true, 15),
  ('0.5 mm Wire', 'MAT-WIRE-0.5MM', 'Metres', 1000, 1000, true, 100),
  ('5-metre Cable', 'MAT-CBL-5M', 'Nos.', 150, 150, true, 25),
  ('15-metre Cable', 'MAT-CBL-15M', 'Nos.', 50, 50, true, 10),
  ('Camera', 'MAT-CAM-LOOSE', 'Nos.', 50, 50, true, 10),
  ('Display', 'MAT-DISP-LOOSE', 'Nos.', 50, 50, true, 10)
ON CONFLICT (material_name) DO NOTHING;


-- 3. Ensure INVENTORY_DISCREPANCIES table exists
CREATE TABLE IF NOT EXISTS inventory_discrepancies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id            UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  device_type             TEXT NULL,
  declared_qty            NUMERIC NOT NULL DEFAULT 0,
  verified_qty            NUMERIC NOT NULL DEFAULT 0,
  discrepancy_qty         NUMERIC NOT NULL DEFAULT 0,
  discrepancy_type        TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'RESOLVED_ADMIN_APPROVED', 'RESOLVED_WRITTEN_OFF')),
  flagged_by              UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  resolution_notes        TEXT NULL,
  resolved_by             UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  resolved_at             TIMESTAMPTZ NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discrepancies_checklist ON inventory_discrepancies(checklist_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_status ON inventory_discrepancies(status);


-- 4. Ensure JOB_DEVICE_RETURNS table exists
CREATE TABLE IF NOT EXISTS job_device_returns (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id            UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  device_type             TEXT NOT NULL,
  declared_return_qty     INTEGER NOT NULL CHECK (declared_return_qty >= 0),
  declared_by             UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  declared_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                  TEXT NOT NULL DEFAULT 'PENDING_STORE_VERIFICATION'
                          CHECK (status IN ('PENDING_STORE_VERIFICATION', 'VERIFIED_AND_RECONCILED', 'DISCREPANCY_FLAGGED')),
  actual_received_qty     INTEGER NULL CHECK (actual_received_qty IS NULL OR actual_received_qty >= 0),
  accepted_usable_qty     INTEGER NULL CHECK (accepted_usable_qty IS NULL OR accepted_usable_qty >= 0),
  damaged_qty             INTEGER NULL CHECK (damaged_qty IS NULL OR damaged_qty >= 0),
  missing_qty             INTEGER NULL CHECK (missing_qty IS NULL OR missing_qty >= 0),
  verification_remarks    TEXT NULL,
  verified_by             UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  verified_at             TIMESTAMPTZ NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_device_returns_checklist ON job_device_returns(checklist_id);
CREATE INDEX IF NOT EXISTS idx_job_device_returns_status ON job_device_returns(status);
CREATE INDEX IF NOT EXISTS idx_job_device_returns_created ON job_device_returns(created_at);


-- 5. Ensure JOB_MATERIAL_RETURNS table exists
CREATE TABLE IF NOT EXISTS job_material_returns (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  material_id               TEXT NULL,
  material_name             TEXT NOT NULL,
  unit                      TEXT NOT NULL DEFAULT 'Nos.',
  quantity_issued           NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  quantity_used             NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_used >= 0),
  declared_return_qty       NUMERIC NOT NULL DEFAULT 0 CHECK (declared_return_qty >= 0),
  accepted_usable_qty       NUMERIC NOT NULL DEFAULT 0 CHECK (accepted_usable_qty >= 0),
  damaged_qty               NUMERIC NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  missing_qty               NUMERIC NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  status                    TEXT NOT NULL DEFAULT 'PENDING_STORE_VERIFICATION'
                            CHECK (status IN ('PENDING_STORE_VERIFICATION', 'VERIFIED_AND_RECONCILED', 'DISCREPANCY_FLAGGED')),
  declared_by               UUID NULL,
  declared_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by               UUID NULL,
  verified_at               TIMESTAMPTZ NULL,
  verification_remarks      TEXT NULL,
  idempotency_key           TEXT UNIQUE NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_material_returns_checklist ON job_material_returns(checklist_id);
CREATE INDEX IF NOT EXISTS idx_job_material_returns_status ON job_material_returns(status);
CREATE INDEX IF NOT EXISTS idx_job_material_returns_created ON job_material_returns(created_at);


-- 6. Create or Replace UNIFIED STOCK_MOVEMENTS Table (Auditable Inventory Ledger)
CREATE TABLE IF NOT EXISTS stock_movements (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                   TEXT NULL,
  product_id                UUID NULL,
  item_name                 TEXT NOT NULL,
  sku                       TEXT NULL,
  category                  TEXT NOT NULL CHECK (category IN ('Camera Device', 'Installation Material')),
  movement_type             TEXT NOT NULL CHECK (movement_type IN (
                              'OPENING_STOCK',
                              'STOCK_RECEIVED',
                              'STOCK_ISSUED',
                              'USABLE_STOCK_RETURNED',
                              'DAMAGED_STOCK_RECEIVED',
                              'DAMAGED_STOCK_DISPOSITION',
                              'STOCK_ADJUSTMENT',
                              'STOCK_REVERSAL',
                              'RETURNED_USABLE',
                              'RETURNED_DAMAGED'
                            )),
  quantity                  NUMERIC NOT NULL,
  unit                      TEXT NOT NULL DEFAULT 'Nos.',
  balance_before            NUMERIC NULL,
  balance_after             NUMERIC NULL,
  checklist_id              UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  reference_transaction_id  TEXT NULL,
  performed_by              UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  performer_name            TEXT NULL,
  performer_email           TEXT NULL,
  reason_or_remarks         TEXT NULL,
  idempotency_key           TEXT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_category ON stock_movements(category);
CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_name);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_checklist ON stock_movements(checklist_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_idempotency ON stock_movements(idempotency_key);


-- 7. Create RETENTION_CLEANUP_LOGS Table
CREATE TABLE IF NOT EXISTS retention_cleanup_logs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cutoff_timestamp            TIMESTAMPTZ NOT NULL,
  movements_deleted           INTEGER NOT NULL DEFAULT 0,
  device_returns_deleted      INTEGER NOT NULL DEFAULT 0,
  material_returns_deleted    INTEGER NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
  error_message               TEXT NULL,
  executed_by                 TEXT NOT NULL DEFAULT 'SYSTEM_CRON',
  details                     JSONB NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retention_cleanup_logs_run_at ON retention_cleanup_logs(run_at DESC);


-- 8. Enable Row Level Security (RLS) on All Inventory & History Tables
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_device_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_material_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_cleanup_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access to inventory_products" ON inventory_products FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users view inventory_products" ON inventory_products FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to material_inventory" ON material_inventory FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users view material_inventory" ON material_inventory FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to job_device_returns" ON job_device_returns FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users view job_device_returns" ON job_device_returns FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to job_material_returns" ON job_material_returns FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users view job_material_returns" ON job_material_returns FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to stock_movements" ON stock_movements FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users view stock_movements" ON stock_movements FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to retention_cleanup_logs" ON retention_cleanup_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users view retention_cleanup_logs" ON retention_cleanup_logs FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- 9. Automatic 20-Day Retention Cleanup Stored Procedure
-- Rules:
-- 1. Cutoff: created_at < NOW() - INTERVAL '20 days'
-- 2. Records newer than cutoff MUST remain.
-- 3. Pending returns (status = 'PENDING_STORE_VERIFICATION') MUST NEVER be deleted.
-- 4. Verified returns older than 20 days are deleted ONLY IF not tied to open discrepancies.
-- 5. Stock movements older than 20 days are deleted ONLY IF not tied to open discrepancies or pending returns.
-- 6. Authoritative inventory balances (inventory_products, material_inventory) are NEVER modified or recalculated.
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
DECLARE
  v_cutoff TIMESTAMPTZ := NOW() - INTERVAL '20 days';
  v_mov_count INTEGER := 0;
  v_dev_count INTEGER := 0;
  v_mat_count INTEGER := 0;
  v_err TEXT := NULL;
BEGIN
  BEGIN
    -- A. Delete eligible verified device returns strictly older than 20 days
    -- Exclude pending returns and returns associated with open discrepancies
    WITH deleted_dev AS (
      DELETE FROM job_device_returns
      WHERE created_at < v_cutoff
        AND status = 'VERIFIED_AND_RECONCILED'
        AND checklist_id NOT IN (
          SELECT checklist_id FROM inventory_discrepancies WHERE status = 'OPEN' AND checklist_id IS NOT NULL
        )
      RETURNING id
    )
    SELECT COUNT(*) INTO v_dev_count FROM deleted_dev;

    -- B. Delete eligible verified material returns strictly older than 20 days
    -- Exclude pending returns and returns associated with open discrepancies
    WITH deleted_mat AS (
      DELETE FROM job_material_returns
      WHERE created_at < v_cutoff
        AND status = 'VERIFIED_AND_RECONCILED'
        AND checklist_id NOT IN (
          SELECT checklist_id FROM inventory_discrepancies WHERE status = 'OPEN' AND checklist_id IS NOT NULL
        )
      RETURNING id
    )
    SELECT COUNT(*) INTO v_mat_count FROM deleted_mat;

    -- C. Delete eligible stock movements strictly older than 20 days
    -- Exclude movements connected to active checklists with open discrepancies or pending returns
    WITH deleted_mov AS (
      DELETE FROM stock_movements
      WHERE created_at < v_cutoff
        AND (
          checklist_id IS NULL OR (
            checklist_id NOT IN (
              SELECT checklist_id FROM inventory_discrepancies WHERE status = 'OPEN' AND checklist_id IS NOT NULL
              UNION
              SELECT checklist_id FROM job_device_returns WHERE status = 'PENDING_STORE_VERIFICATION'
              UNION
              SELECT checklist_id FROM job_material_returns WHERE status = 'PENDING_STORE_VERIFICATION'
            )
          )
        )
      RETURNING id
    )
    SELECT COUNT(*) INTO v_mov_count FROM deleted_mov;

    -- D. Log successful cleanup
    INSERT INTO retention_cleanup_logs (
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
    INSERT INTO retention_cleanup_logs (
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


-- 10. Attempt pg_cron scheduling if extension is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('inventory_20day_history_cleanup');
    PERFORM cron.schedule('inventory_20day_history_cleanup', '0 3 * * *', 'SELECT cleanup_expired_inventory_history(''PG_CRON'')');
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
