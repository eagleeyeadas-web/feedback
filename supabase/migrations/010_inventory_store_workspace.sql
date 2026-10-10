-- ============================================================
-- Migration 010: Consolidated Store Manager Inventory Workspace
-- Tables: inventory_products, inventory_transactions, job_device_returns
-- ============================================================

-- 1. Ensure inventory_products exists with standard columns
CREATE TABLE IF NOT EXISTS inventory_products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name             TEXT NOT NULL,
  device_type             TEXT NOT NULL UNIQUE,
  sku                     TEXT NULL,
  opening_quantity        INTEGER NOT NULL DEFAULT 50,
  usable_stock            INTEGER NOT NULL DEFAULT 50 CHECK (usable_stock >= 0),
  reserved_stock          INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  issued_stock            INTEGER NOT NULL DEFAULT 0 CHECK (issued_stock >= 0),
  returned_usable_stock   INTEGER NOT NULL DEFAULT 0 CHECK (returned_usable_stock >= 0),
  damaged_stock           INTEGER NOT NULL DEFAULT 0 CHECK (damaged_stock >= 0),
  min_stock_level         INTEGER NOT NULL DEFAULT 5,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard 7 device types
INSERT INTO inventory_products (device_name, device_type, usable_stock, opening_quantity)
VALUES
  ('2 Channel Live Camera System', '2 Channel Live', 50, 50),
  ('2 Channel Recording System', '2 Channel Recording', 50, 50),
  ('4 Channel Live MDVR System', '4 Channel Live', 50, 50),
  ('4 Channel Recording MDVR System', '4 Channel Recording', 50, 50),
  ('6 Channel Live Telematics System', '6 Channel Live', 50, 50),
  ('6 Channel Recording Telematics System', '6 Channel Recording', 50, 50),
  ('8 Channel Live Enterprise System', '8 Channel Live', 50, 50)
ON CONFLICT (device_type) DO NOTHING;

-- 2. Ensure inventory_transactions exists
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id                UUID NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  transaction_type          TEXT NOT NULL CHECK (transaction_type IN (
                              'OPENING_STOCK',
                              'STOCK_RECEIVED',
                              'STOCK_ISSUED',
                              'USABLE_STOCK_RETURNED',
                              'DAMAGED_STOCK_RECEIVED',
                              'DAMAGED_STOCK_DISPOSITION',
                              'STOCK_ADJUSTMENT',
                              'STOCK_REVERSAL'
                            )),
  quantity                  INTEGER NOT NULL,
  checklist_id              UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  performed_by              UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  reason_or_remarks         TEXT NULL,
  reference_transaction_id  UUID NULL,
  idempotency_key           TEXT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_tx_product_id ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_checklist_id ON inventory_transactions(checklist_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON inventory_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_inv_tx_created ON inventory_transactions(created_at DESC);

-- 3. Ensure job_device_returns exists
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

-- 4. RLS policies
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_device_returns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access to inventory_products" ON inventory_products FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to inventory_transactions" ON inventory_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to job_device_returns" ON job_device_returns FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
