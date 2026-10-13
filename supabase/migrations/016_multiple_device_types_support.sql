-- ============================================================
-- Eagle Eye SafDrive - Multiple Device Types Support Migration
-- Migration 016: Support repeatable Device Configurations per customer checklist
-- ============================================================

-- 1. Add device_configurations JSONB column to installation_checklists
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS device_configurations JSONB NULL;

-- 2. Backfill existing historical records safely
-- Preserve existing single-device records by wrapping them into a 1-element device_configurations array
UPDATE installation_checklists
SET device_configurations = jsonb_build_array(
  jsonb_build_object(
    'device_type', device_type,
    'number_of_devices', number_of_devices,
    'number_of_vehicles', number_of_vehicles
  )
)
WHERE device_configurations IS NULL;

-- 3. GIN Index on device_configurations for efficient JSON querying
CREATE INDEX IF NOT EXISTS idx_inst_device_configurations ON installation_checklists USING GIN (device_configurations);
