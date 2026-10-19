-- ============================================================
-- Eagle Eye SafDrive - HR Role & Availability Overrides Migration
-- Migration 038: Add HR role, Technician Availability Overrides Schema
-- ============================================================

-- 1. Update admin_users role check constraint to include HR
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN (
    'ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR', 'HR', 'SUPER_ADMIN',
    'admin', 'sales', 'technical', 'store_manager', 'coordinator', 'hr', 'super_admin'
  ));

-- 2. Synchronize HR account role if existing
UPDATE admin_users SET role = 'HR', is_active = true WHERE email = 'hr@gmail.com';

-- 3. Create technician_availability_overrides Table
-- Tracks manual Available / Unavailable status overrides by HR for service engineers
CREATE TABLE IF NOT EXISTS technician_availability_overrides (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_id                 UUID NOT NULL,
  engineer_name               TEXT NOT NULL,
  manual_status               TEXT NOT NULL CHECK (manual_status IN ('Available', 'Unavailable')),
  reason                      TEXT NOT NULL,
  effective_start_datetime    TIMESTAMPTZ NOT NULL,
  effective_end_datetime      TIMESTAMPTZ NULL,
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  
  -- Audit and Metadata
  created_by                  UUID NULL,
  created_by_email            TEXT NULL,
  created_by_role             TEXT NOT NULL DEFAULT 'HR',
  
  -- Reversal / Expiry Information
  reversal_reason             TEXT NULL,
  reversed_at                 TIMESTAMPTZ NULL,
  reversed_by                 UUID NULL,
  reversed_by_email           TEXT NULL,
  
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_avail_overrides_eng_active
  ON technician_availability_overrides(engineer_id, is_active);

CREATE INDEX IF NOT EXISTS idx_avail_overrides_name_active
  ON technician_availability_overrides(engineer_name, is_active);

CREATE INDEX IF NOT EXISTS idx_avail_overrides_dates
  ON technician_availability_overrides(effective_start_datetime, effective_end_datetime);

-- 5. Enable RLS
ALTER TABLE technician_availability_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full management on technician_availability_overrides" ON technician_availability_overrides;
CREATE POLICY "Service role has full management on technician_availability_overrides"
  ON technician_availability_overrides FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view availability overrides" ON technician_availability_overrides;
CREATE POLICY "Authenticated users can view availability overrides"
  ON technician_availability_overrides FOR SELECT
  TO authenticated
  USING (true);
