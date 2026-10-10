-- ============================================================
-- Eagle Eye SafDrive - Device Carry & Completion Schema Migration
-- Migration 010: Mandatory Device Carry Form & Post-Installation Completion Form
-- ============================================================

-- 1. ADD CARRY_STATUS COLUMN TO INSTALLATION_CHECKLISTS IF NOT EXISTS
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS carry_status TEXT NOT NULL DEFAULT 'NOT_RECORDED'
  CHECK (carry_status IN ('NOT_RECORDED', 'RECORDED', 'DISCREPANCY'));

-- 2. CREATE JOB_DEVICE_CARRY_RECORDS TABLE
CREATE TABLE IF NOT EXISTS job_device_carry_records (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  technician_user_id        UUID NOT NULL REFERENCES admin_users(id),
  technician_name           TEXT NULL,
  status                    TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'AUDITED', 'DISCREPANCY')),
  remarks                   TEXT NULL,
  submitted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carry_records_checklist ON job_device_carry_records(checklist_id);
CREATE INDEX IF NOT EXISTS idx_carry_records_tech ON job_device_carry_records(technician_user_id);

-- 3. CREATE JOB_DEVICE_CARRY_ITEMS TABLE
CREATE TABLE IF NOT EXISTS job_device_carry_items (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  carry_record_id           UUID NOT NULL REFERENCES job_device_carry_records(id) ON DELETE CASCADE,
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  device_type               TEXT NOT NULL,
  quantity_issued           INTEGER NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  quantity_carried          INTEGER NOT NULL DEFAULT 0 CHECK (quantity_carried >= 0),
  discrepancy_quantity      INTEGER NOT NULL DEFAULT 0,
  discrepancy_reason        TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carry_items_record ON job_device_carry_items(carry_record_id);
CREATE INDEX IF NOT EXISTS idx_carry_items_checklist ON job_device_carry_items(checklist_id);

-- 4. CREATE TECHNICAL_INSTALLATION_REPORT_ITEMS TABLE
CREATE TABLE IF NOT EXISTS technical_installation_report_items (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id                 UUID NOT NULL REFERENCES technical_installation_reports(id) ON DELETE CASCADE,
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  device_type               TEXT NOT NULL,
  quantity_carried          INTEGER NOT NULL DEFAULT 0 CHECK (quantity_carried >= 0),
  quantity_installed        INTEGER NOT NULL DEFAULT 0 CHECK (quantity_installed >= 0),
  quantity_to_return        INTEGER NOT NULL DEFAULT 0 CHECK (quantity_to_return >= 0),
  quantity_damaged          INTEGER NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  quantity_missing          INTEGER NOT NULL DEFAULT 0 CHECK (quantity_missing >= 0),
  discrepancy_reason        TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tech_report_items_report ON technical_installation_report_items(report_id);
CREATE INDEX IF NOT EXISTS idx_tech_report_items_checklist ON technical_installation_report_items(checklist_id);

-- 5. ROW LEVEL SECURITY POLICIES
ALTER TABLE job_device_carry_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_device_carry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE technical_installation_report_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to job_device_carry_records" ON job_device_carry_records;
CREATE POLICY "Service role full access to job_device_carry_records" ON job_device_carry_records FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to job_device_carry_items" ON job_device_carry_items;
CREATE POLICY "Service role full access to job_device_carry_items" ON job_device_carry_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to technical_installation_report_items" ON technical_installation_report_items;
CREATE POLICY "Service role full access to technical_installation_report_items" ON technical_installation_report_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated view policies for all admin users
DROP POLICY IF EXISTS "Authenticated users can view carry records" ON job_device_carry_records;
CREATE POLICY "Authenticated users can view carry records" ON job_device_carry_records FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view carry items" ON job_device_carry_items;
CREATE POLICY "Authenticated users can view carry items" ON job_device_carry_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view report items" ON technical_installation_report_items;
CREATE POLICY "Authenticated users can view report items" ON technical_installation_report_items FOR SELECT TO authenticated USING (true);
