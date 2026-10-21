-- ==============================================================================
-- Migration 043: Simplify Installation Status to Exactly Two Options
-- ('Assigned', 'Completed')
-- ==============================================================================

-- 1. Safely migrate existing legacy status values in installation_checklists
UPDATE installation_checklists
SET installation_status = 'Completed'
WHERE installation_status = 'Site Work Completed';

UPDATE installation_checklists
SET installation_status = 'Assigned'
WHERE installation_status NOT IN ('Assigned', 'Completed');

-- 2. Set column default to 'Assigned'
ALTER TABLE installation_checklists 
  ALTER COLUMN installation_status SET DEFAULT 'Assigned';

-- 3. Replace constraint with strict two-option check
ALTER TABLE installation_checklists 
  DROP CONSTRAINT IF EXISTS installation_checklists_installation_status_check;

ALTER TABLE installation_checklists 
  ADD CONSTRAINT installation_checklists_installation_status_check 
  CHECK (installation_status IN ('Assigned', 'Completed'));
