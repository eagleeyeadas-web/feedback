-- ==============================================================================
-- Migration 045: Standardize Sales Installation Status to 3 Options
-- ('Assigned', 'Assign Later', 'Completed') and Store Materials Cleanup
-- ==============================================================================

-- 1. Safely migrate existing installation_status values in installation_checklists
-- Completed items remain Completed
UPDATE installation_checklists
SET installation_status = 'Completed'
WHERE installation_status IN ('Completed', 'Site Work Completed')
   OR actual_completion_datetime IS NOT NULL;

-- If not completed and no service engineer is assigned, set to 'Assign Later'
UPDATE installation_checklists
SET installation_status = 'Assign Later'
WHERE (installation_status NOT IN ('Completed') OR installation_status IS NULL)
  AND (service_engineer IS NULL OR TRIM(service_engineer) = '' OR service_engineer = 'None')
  AND installation_status != 'Completed';

-- If not completed and a service engineer is assigned, set to 'Assigned'
UPDATE installation_checklists
SET installation_status = 'Assigned'
WHERE installation_status NOT IN ('Completed', 'Assign Later')
  AND service_engineer IS NOT NULL 
  AND TRIM(service_engineer) != ''
  AND service_engineer != 'None';

-- Catch-all for any remaining invalid statuses
UPDATE installation_checklists
SET installation_status = 'Assign Later'
WHERE installation_status NOT IN ('Assigned', 'Assign Later', 'Completed');

-- 2. Update default and CHECK constraint on installation_checklists
ALTER TABLE installation_checklists 
  ALTER COLUMN installation_status SET DEFAULT 'Assigned';

ALTER TABLE installation_checklists 
  DROP CONSTRAINT IF EXISTS installation_checklists_installation_status_check;

ALTER TABLE installation_checklists 
  ADD CONSTRAINT installation_checklists_installation_status_check 
  CHECK (installation_status IN ('Assigned', 'Assign Later', 'Completed'));

-- 2b. Update delivery method schedule constraint to allow Assign Later without engineer or arrival date
ALTER TABLE installation_checklists 
  DROP CONSTRAINT IF EXISTS chk_installation_schedule_by_delivery_method;

ALTER TABLE installation_checklists 
  ADD CONSTRAINT chk_installation_schedule_by_delivery_method 
  CHECK (
    delivery_method = 'Product Couriered'
    OR installation_status = 'Assign Later'
    OR (
      delivery_method = 'Technician Carries'
      AND expected_arrival_date IS NOT NULL
      AND service_engineer IS NOT NULL
      AND TRIM(service_engineer) != ''
    )
  );

-- 3. Safely deactivate obsolete installation materials from active list
-- Preserves existing records, current stock, and transaction history
UPDATE material_inventory
SET is_active = false,
    updated_at = NOW()
WHERE material_name IN ('Display', 'Airtel M2M 4G SIM Card');

-- 4. Ensure stock_movements deletion policy allows authenticated / service role cleanup
DO $$ BEGIN
  CREATE POLICY "Allow delete on stock_movements for service role" 
  ON stock_movements FOR DELETE TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
