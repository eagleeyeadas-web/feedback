-- ============================================================
-- Eagle Eye SafDrive - Business Management System Migration
-- Migration 009: 4-Role RBAC, Inventory, Workflow Stages, Audit Logs
-- ============================================================

-- 1. UPDATE ADMIN_USERS ROLE CONSTRAINT
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

UPDATE admin_users SET role = 'ADMIN' WHERE role IN ('admin', 'super_admin');

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER'));

-- 2. CUSTOMERS TABLE
CREATE TABLE IF NOT EXISTS customers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_name           TEXT NOT NULL,
  client_mobile         TEXT NOT NULL UNIQUE,
  client_location       TEXT NOT NULL DEFAULT '',
  google_maps_location  TEXT NULL,
  company_name          TEXT NULL,
  email                 TEXT NULL,
  created_by            UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(client_name);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(client_mobile);

-- 3. INVENTORY PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS inventory_products (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_name             TEXT NOT NULL,
  device_type             TEXT NOT NULL UNIQUE,
  sku                     TEXT NULL,
  opening_quantity        INTEGER NOT NULL DEFAULT 0,
  usable_stock            INTEGER NOT NULL DEFAULT 0 CHECK (usable_stock >= 0),
  reserved_stock          INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  issued_stock            INTEGER NOT NULL DEFAULT 0 CHECK (issued_stock >= 0),
  returned_usable_stock   INTEGER NOT NULL DEFAULT 0 CHECK (returned_usable_stock >= 0),
  damaged_stock           INTEGER NOT NULL DEFAULT 0 CHECK (damaged_stock >= 0),
  min_stock_level         INTEGER NOT NULL DEFAULT 5,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard 7 device types into inventory_products if not existing
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

-- 4. INVENTORY TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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
  performed_by              UUID NOT NULL REFERENCES admin_users(id),
  reason_or_remarks         TEXT NULL,
  reference_transaction_id  UUID NULL,
  idempotency_key           TEXT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_tx_product_id ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_checklist_id ON inventory_transactions(checklist_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON inventory_transactions(transaction_type);

-- 5. JOB DEVICE ISSUES TABLE (STORE MANAGER STAGE 2)
CREATE TABLE IF NOT EXISTS job_device_issues (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id            UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  device_type             TEXT NOT NULL,
  requested_quantity      INTEGER NOT NULL CHECK (requested_quantity > 0),
  issued_quantity         INTEGER NOT NULL CHECK (issued_quantity >= 0),
  issued_by               UUID NOT NULL REFERENCES admin_users(id),
  received_by_technician  UUID NULL REFERENCES admin_users(id),
  issue_date              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                   TEXT NULL,
  is_extra                BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_device_issues_checklist ON job_device_issues(checklist_id);

-- 6. TECHNICAL INSTALLATION REPORTS TABLE (TECHNICAL STAGE 3)
CREATE TABLE IF NOT EXISTS technical_installation_reports (
  id                            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id                  UUID NOT NULL UNIQUE REFERENCES installation_checklists(id) ON DELETE CASCADE,
  technician_id                 UUID NOT NULL REFERENCES admin_users(id),
  devices_carried_qty           INTEGER NOT NULL CHECK (devices_carried_qty >= 0),
  devices_installed_qty         INTEGER NOT NULL CHECK (devices_installed_qty >= 0),
  devices_unused_qty            INTEGER NOT NULL CHECK (devices_unused_qty >= 0),
  devices_damaged_qty          INTEGER NOT NULL DEFAULT 0 CHECK (devices_damaged_qty >= 0),
  devices_missing_qty          INTEGER NOT NULL DEFAULT 0 CHECK (devices_missing_qty >= 0),
  extra_devices_carried_qty     INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_carried_qty >= 0),
  extra_devices_installed_qty   INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_installed_qty >= 0),
  extra_devices_unused_qty      INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_unused_qty >= 0),
  extra_devices_damaged_qty     INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_damaged_qty >= 0),
  extra_devices_missing_qty     INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_missing_qty >= 0),
  completion_status             TEXT NOT NULL CHECK (completion_status IN ('Completed', 'Partially Completed', 'Issues Encountered')),
  remarks                       TEXT NULL,
  submitted_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tech_reports_checklist ON technical_installation_reports(checklist_id);

-- 7. JOB DEVICE RETURNS TABLE (STAGE 4 DECLARED RETURN & STAGE 5 STORE VERIFICATION)
CREATE TABLE IF NOT EXISTS job_device_returns (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id            UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  device_type             TEXT NOT NULL,
  declared_return_qty     INTEGER NOT NULL CHECK (declared_return_qty >= 0),
  declared_by             UUID NOT NULL REFERENCES admin_users(id),
  declared_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                  TEXT NOT NULL DEFAULT 'PENDING_STORE_VERIFICATION'
                          CHECK (status IN ('PENDING_STORE_VERIFICATION', 'VERIFIED_AND_RECONCILED', 'DISCREPANCY_FLAGGED')),
  actual_received_qty     INTEGER NULL CHECK (actual_received_qty IS NULL OR actual_received_qty >= 0),
  accepted_usable_qty     INTEGER NULL CHECK (accepted_usable_qty IS NULL OR accepted_usable_qty >= 0),
  damaged_qty             INTEGER NULL CHECK (damaged_qty IS NULL OR damaged_qty >= 0),
  missing_qty             INTEGER NULL CHECK (missing_qty IS NULL OR missing_qty >= 0),
  verification_remarks    TEXT NULL,
  verified_by             UUID NULL REFERENCES admin_users(id),
  verified_at             TIMESTAMPTZ NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_device_returns_checklist ON job_device_returns(checklist_id);
CREATE INDEX IF NOT EXISTS idx_job_device_returns_status ON job_device_returns(status);

-- 8. INVENTORY DISCREPANCIES TABLE (STAGE 6 ADMIN RECONCILIATION)
CREATE TABLE IF NOT EXISTS inventory_discrepancies (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id            UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  device_type             TEXT NOT NULL,
  declared_qty            INTEGER NOT NULL,
  verified_qty            INTEGER NOT NULL,
  discrepancy_qty         INTEGER NOT NULL,
  discrepancy_type        TEXT NOT NULL CHECK (discrepancy_type IN ('QUANTITY_MISMATCH', 'UNREPORTED_DAMAGE', 'MISSING_STOCK')),
  status                  TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED_ADMIN_APPROVED', 'RESOLVED_STOCK_ADJUSTED')),
  flagged_by              UUID NOT NULL REFERENCES admin_users(id),
  resolution_notes        TEXT NULL,
  resolved_by             UUID NULL REFERENCES admin_users(id),
  resolved_at             TIMESTAMPTZ NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discrepancies_checklist ON inventory_discrepancies(checklist_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_status ON inventory_discrepancies(status);

-- 9. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id                UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_email             TEXT NULL,
  actor_role              TEXT NULL,
  action                  TEXT NOT NULL,
  target_table            TEXT NOT NULL,
  target_id               TEXT NULL,
  details                 JSONB NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 10. RECONCILIATION STATUS COLUMN ON INSTALLATION CHECKLISTS
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'SALES_CREATED'
  CHECK (reconciliation_status IN (
    'SALES_CREATED',
    'STORE_ISSUED',
    'SITE_WORK_COMPLETED',
    'PENDING_STORE_VERIFICATION',
    'FULLY_RECONCILED',
    'DISCREPANCY_OPEN'
  ));

-- RLS Policies
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_device_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_installation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_device_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to customers" ON customers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to inventory_products" ON inventory_products FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to inventory_transactions" ON inventory_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to job_device_issues" ON job_device_issues FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to technical_installation_reports" ON technical_installation_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to job_device_returns" ON job_device_returns FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to inventory_discrepancies" ON inventory_discrepancies FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access to audit_logs" ON audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
