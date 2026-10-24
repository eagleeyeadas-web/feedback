-- ============================================================
-- Eagle Eye SafDrive - Service Engineer Management
-- Migration 051: Service Engineer Management (HR Workspace)
-- ============================================================

-- 1. Ensure employee_id and audit columns exist on service_engineers
ALTER TABLE service_engineers
  ADD COLUMN IF NOT EXISTS employee_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_by UUID NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID NULL;

-- 2. Helpful indexes for performance
CREATE INDEX IF NOT EXISTS idx_service_engineers_active ON service_engineers(is_active);
CREATE INDEX IF NOT EXISTS idx_service_engineers_name_lower ON service_engineers(LOWER(name));
