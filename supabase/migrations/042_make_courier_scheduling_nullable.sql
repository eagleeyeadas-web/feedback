-- ============================================================
-- Eagle Eye SafDrive - Product Courier Optional Scheduling Migration
-- Migration 042: Make Expected Arrival Date and Technician Scheduling Nullable
--                for Product Couriered Orders while Enforcing Strictly for
--                Technician Carries Jobs
-- ============================================================

-- 1. Ensure columns exist on installation_checklists
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'Technician Carries',
  ADD COLUMN IF NOT EXISTS courier_dispatch_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS is_courier_dispatched BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS courier_dispatch_id UUID NULL,
  ADD COLUMN IF NOT EXISTS completion_type TEXT NULL,
  ADD COLUMN IF NOT EXISTS completed_by_user_id UUID NULL,
  ADD COLUMN IF NOT EXISTS completed_by_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS actual_completion_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS completion_notes TEXT NULL;

-- 2. Make scheduling and technician columns nullable
--    and drop fake default dates/times so couriered checklists
--    are not assigned artificial schedule dates.
ALTER TABLE installation_checklists ALTER COLUMN expected_arrival_date DROP NOT NULL;
ALTER TABLE installation_checklists ALTER COLUMN expected_arrival_date DROP DEFAULT;

ALTER TABLE installation_checklists ALTER COLUMN expected_arrival_time DROP NOT NULL;
ALTER TABLE installation_checklists ALTER COLUMN expected_arrival_time DROP DEFAULT;

ALTER TABLE installation_checklists ALTER COLUMN installation_duration DROP NOT NULL;
ALTER TABLE installation_checklists ALTER COLUMN installation_duration DROP DEFAULT;

ALTER TABLE installation_checklists ALTER COLUMN service_engineer DROP NOT NULL;
ALTER TABLE installation_checklists ALTER COLUMN service_engineer DROP DEFAULT;

ALTER TABLE installation_checklists ALTER COLUMN service_assistant DROP NOT NULL;
ALTER TABLE installation_checklists ALTER COLUMN service_assistant DROP DEFAULT;

-- 3. Ensure delivery_method constraint
ALTER TABLE installation_checklists DROP CONSTRAINT IF EXISTS installation_checklists_delivery_method_check;
ALTER TABLE installation_checklists ADD CONSTRAINT installation_checklists_delivery_method_check
  CHECK (delivery_method IN ('Technician Carries', 'Product Couriered'));

-- 4. Conditional constraint distinguishing Product Couriered from Technician Carries
--    For 'Technician Carries': expected_arrival_date and service_engineer MUST be present
--    For 'Product Couriered': expected_arrival_date and service_engineer are legitimately optional (can be NULL)
ALTER TABLE installation_checklists DROP CONSTRAINT IF EXISTS chk_installation_schedule_by_delivery_method;
ALTER TABLE installation_checklists ADD CONSTRAINT chk_installation_schedule_by_delivery_method
  CHECK (
    delivery_method = 'Product Couriered'
    OR (
      delivery_method = 'Technician Carries'
      AND expected_arrival_date IS NOT NULL
      AND service_engineer IS NOT NULL
      AND TRIM(service_engineer) != ''
    )
  );

-- 5. Update installation_status constraint to support courier lifecycle stages
ALTER TABLE installation_checklists DROP CONSTRAINT IF EXISTS installation_checklists_installation_status_check;
ALTER TABLE installation_checklists ADD CONSTRAINT installation_checklists_installation_status_check
  CHECK (installation_status IN (
    'Pending',
    'Assigned',
    'In Progress',
    'Completed',
    'Cancelled',
    'Awaiting Technician Assignment',
    'Awaiting Schedule',
    'Ready for Installation',
    'Courier Pending',
    'Awaiting Customer Confirmation',
    'Installation Required',
    'Site Work Completed'
  ));

-- 6. Indexes for courier queries
CREATE INDEX IF NOT EXISTS idx_inst_delivery_method ON installation_checklists (delivery_method);
CREATE INDEX IF NOT EXISTS idx_inst_courier_dispatch_status ON installation_checklists (courier_dispatch_status);
