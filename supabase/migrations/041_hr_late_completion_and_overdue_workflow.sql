-- Migration: 041_hr_late_completion_and_overdue_workflow.sql
-- Description: HR Late-Completion, Overdue Detection, Extension Governance and Separate Timestamp Tracking

-- 1. Distinct schedule, completion, submission and overdue fields on installation_checklists
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS scheduled_start_date DATE NULL,
  ADD COLUMN IF NOT EXISTS scheduled_end_date DATE NULL,
  ADD COLUMN IF NOT EXISTS actual_completion_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS post_installation_submitted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS extension_requested_end_date DATE NULL,
  ADD COLUMN IF NOT EXISTS extension_approved_end_date DATE NULL,
  ADD COLUMN IF NOT EXISTS extension_decision_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS overdue_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS late_completion BOOLEAN DEFAULT FALSE;

-- 2. Mirror fields on coordinator_bookings for unified workspace display
ALTER TABLE coordinator_bookings
  ADD COLUMN IF NOT EXISTS actual_completion_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS post_installation_submitted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS overdue_category TEXT NULL,
  ADD COLUMN IF NOT EXISTS late_completion BOOLEAN DEFAULT FALSE;

-- 3. Overdue Alert Records table for tracking idempotent alerts and resolution state
CREATE TABLE IF NOT EXISTS overdue_alert_records (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id                UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  checklist_number            TEXT NOT NULL,
  category                    TEXT NOT NULL, -- 'Overdue — Extension Not Requested', 'Overdue — Extension Approval Pending', 'Overdue — Extension Rejected', 'Late Completion Recorded'
  scheduled_start_date        DATE NULL,
  scheduled_end_date          DATE NULL,
  actual_completion_at        TIMESTAMPTZ NULL,
  post_installation_submitted_at TIMESTAMPTZ NULL,
  notification_sent           BOOLEAN DEFAULT TRUE,
  resolved                    BOOLEAN DEFAULT FALSE,
  resolved_at                 TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes for fast filtering and deduplication
CREATE INDEX IF NOT EXISTS idx_inst_overdue_category ON installation_checklists(overdue_category);
CREATE INDEX IF NOT EXISTS idx_inst_late_completion ON installation_checklists(late_completion);
CREATE INDEX IF NOT EXISTS idx_overdue_alerts_chk_cat ON overdue_alert_records(checklist_id, category);
CREATE INDEX IF NOT EXISTS idx_overdue_alerts_resolved ON overdue_alert_records(resolved);
CREATE INDEX IF NOT EXISTS idx_overdue_alerts_created_at ON overdue_alert_records(created_at DESC);

-- 5. RLS Policies for overdue_alert_records
ALTER TABLE overdue_alert_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to overdue_alert_records" ON overdue_alert_records;
CREATE POLICY "Service role full access to overdue_alert_records"
  ON overdue_alert_records FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "HR and Coordinators can view overdue alerts" ON overdue_alert_records;
CREATE POLICY "HR and Coordinators can view overdue alerts"
  ON overdue_alert_records FOR SELECT
  TO authenticated
  USING (true);
