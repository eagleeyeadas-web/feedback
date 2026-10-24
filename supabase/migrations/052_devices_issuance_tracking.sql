-- ============================================================
-- Eagle Eye SafDrive - Device Issuance Status Tracking
-- Migration 052: Add devices_issuance_status and device issuance audit columns
--               to installation_checklists and store_material_requirements
-- ============================================================

-- 1. Ensure installation_checklists has devices_issuance_status and audit columns
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS devices_issuance_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (devices_issuance_status IN ('PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'NOT_APPLICABLE'));

ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS devices_issued_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS devices_issued_by UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inst_devices_issuance ON installation_checklists(devices_issuance_status);

-- 2. Ensure store_material_requirements has devices_issuance_status and audit columns
ALTER TABLE store_material_requirements
  ADD COLUMN IF NOT EXISTS devices_issuance_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK (devices_issuance_status IN ('PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'NOT_APPLICABLE'));

ALTER TABLE store_material_requirements
  ADD COLUMN IF NOT EXISTS devices_issued_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS devices_issued_by UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_store_req_dev_issuance ON store_material_requirements(devices_issuance_status);
