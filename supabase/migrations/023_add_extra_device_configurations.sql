-- ============================================================
-- Eagle Eye SafDrive - Extra Devices Carried Support Migration
-- Migration 023: Support repeatable Extra Device Configurations per checklist
-- ============================================================

-- 1. Add extra_device_configurations JSONB column to installation_checklists
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS extra_device_configurations JSONB NULL;

-- 2. Backfill existing historical records safely
-- If extra_devices is true and extra_device_type is present, convert into extra_device_configurations array
UPDATE installation_checklists
SET extra_device_configurations = jsonb_build_array(
  jsonb_build_object(
    'device_type', extra_device_type,
    'extra_quantity', COALESCE(extra_device_count, 1)
  )
)
WHERE extra_devices = true 
  AND extra_device_type IS NOT NULL 
  AND (extra_device_configurations IS NULL OR extra_device_configurations = '[]'::jsonb);

-- 3. GIN Index on extra_device_configurations for efficient JSON querying
CREATE INDEX IF NOT EXISTS idx_inst_extra_device_configurations ON installation_checklists USING GIN (extra_device_configurations);
