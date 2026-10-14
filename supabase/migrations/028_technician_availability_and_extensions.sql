-- ============================================================
-- Eagle Eye SafDrive - Technician Availability & Schedule Extensions
-- Migration 028: Complete Technician Availability, Scheduling, Rest, Leave & Extension Approval System
-- ============================================================

-- 1. Extend installation_checklists with separate Original vs Current schedule and Actual execution timestamps
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS original_expected_arrival_date DATE NULL,
  ADD COLUMN IF NOT EXISTS original_expected_arrival_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS original_installation_duration TEXT NULL,
  ADD COLUMN IF NOT EXISTS original_booking_end_date DATE NULL,
  ADD COLUMN IF NOT EXISTS current_expected_arrival_date DATE NULL,
  ADD COLUMN IF NOT EXISTS current_expected_arrival_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS current_installation_duration TEXT NULL,
  ADD COLUMN IF NOT EXISTS current_booking_end_date DATE NULL,
  ADD COLUMN IF NOT EXISTS schedule_revision_number INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_last_updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS actual_start_datetime TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS actual_completion_datetime TIMESTAMPTZ NULL;

-- Backfill original and current schedule columns for existing checklists
UPDATE installation_checklists
SET
  original_expected_arrival_date = COALESCE(original_expected_arrival_date, expected_arrival_date),
  original_expected_arrival_time = COALESCE(original_expected_arrival_time, expected_arrival_time::TEXT),
  original_installation_duration = COALESCE(original_installation_duration, installation_duration),
  original_booking_end_date = COALESCE(original_booking_end_date, booking_end_date, expected_arrival_date),
  current_expected_arrival_date = COALESCE(current_expected_arrival_date, expected_arrival_date),
  current_expected_arrival_time = COALESCE(current_expected_arrival_time, expected_arrival_time::TEXT),
  current_installation_duration = COALESCE(current_installation_duration, installation_duration),
  current_booking_end_date = COALESCE(current_booking_end_date, booking_end_date, expected_arrival_date),
  schedule_last_updated_at = COALESCE(schedule_last_updated_at, updated_at)
WHERE original_expected_arrival_date IS NULL OR current_expected_arrival_date IS NULL;

-- Indexes for fast date range filtering
CREATE INDEX IF NOT EXISTS idx_inst_current_dates ON installation_checklists(current_expected_arrival_date, current_booking_end_date);
CREATE INDEX IF NOT EXISTS idx_inst_actual_completion ON installation_checklists(actual_completion_datetime);

-- 2. Extend coordinator_bookings with review flags for schedule revisions
ALTER TABLE coordinator_bookings
  ADD COLUMN IF NOT EXISTS schedule_flagged_for_review BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS schedule_review_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS schedule_flagged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS return_travel_date_affected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accommodation_dates_affected BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_coord_flagged_review ON coordinator_bookings(schedule_flagged_for_review);

-- 3. Create schedule_extension_requests Table
CREATE TABLE IF NOT EXISTS schedule_extension_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id                UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  technician_user_id          UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  technician_name             TEXT NULL,
  requested_completion_date   DATE NOT NULL,
  requested_return_travel_date DATE NULL,
  additional_working_days     INTEGER NOT NULL DEFAULT 1 CHECK (additional_working_days >= 0),
  rest_day_requested          BOOLEAN NOT NULL DEFAULT false,
  requested_rest_date         DATE NULL,
  reason                      TEXT NOT NULL,
  notes                       TEXT NULL,
  status                      TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  coordinator_decision_notes  TEXT NULL,
  decided_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  decided_at                  TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_req_checklist ON schedule_extension_requests(checklist_id);
CREATE INDEX IF NOT EXISTS idx_ext_req_status ON schedule_extension_requests(status);
CREATE INDEX IF NOT EXISTS idx_ext_req_created_at ON schedule_extension_requests(created_at DESC);

-- 4. Create rest_day_requests Table
CREATE TABLE IF NOT EXISTS rest_day_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_id                 UUID NOT NULL REFERENCES service_engineers(id) ON DELETE CASCADE,
  engineer_name               TEXT NOT NULL,
  checklist_id                UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  checklist_number            TEXT NULL,
  rest_start_date             DATE NOT NULL,
  rest_end_date               DATE NOT NULL,
  reason                      TEXT NOT NULL,
  notes                       TEXT NULL,
  status                      TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  coordinator_decision_notes  TEXT NULL,
  decided_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  decided_at                  TIMESTAMPTZ NULL,
  created_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rest_req_engineer ON rest_day_requests(engineer_id);
CREATE INDEX IF NOT EXISTS idx_rest_req_dates ON rest_day_requests(rest_start_date, rest_end_date);
CREATE INDEX IF NOT EXISTS idx_rest_req_status ON rest_day_requests(status);

-- 5. Create leave_requests Table
CREATE TABLE IF NOT EXISTS leave_requests (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_id                 UUID NOT NULL REFERENCES service_engineers(id) ON DELETE CASCADE,
  engineer_name               TEXT NOT NULL,
  leave_start_date            DATE NOT NULL,
  leave_end_date              DATE NOT NULL,
  leave_type                  TEXT NOT NULL DEFAULT 'Casual',
  reason                      TEXT NOT NULL,
  notes                       TEXT NULL,
  status                      TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  coordinator_decision_notes  TEXT NULL,
  decided_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  decided_at                  TIMESTAMPTZ NULL,
  created_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leave_req_engineer ON leave_requests(engineer_id);
CREATE INDEX IF NOT EXISTS idx_leave_req_dates ON leave_requests(leave_start_date, leave_end_date);
CREATE INDEX IF NOT EXISTS idx_leave_req_status ON leave_requests(status);

-- 6. Create schedule_revision_history Table
CREATE TABLE IF NOT EXISTS schedule_revision_history (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id                UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  revision_number             INTEGER NOT NULL DEFAULT 1,
  previous_schedule           JSONB NOT NULL,
  new_schedule                JSONB NOT NULL,
  reason                      TEXT NOT NULL,
  changed_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  changed_by_email            TEXT NULL,
  changed_by_role             TEXT NULL,
  related_extension_id        UUID NULL REFERENCES schedule_extension_requests(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sched_hist_checklist ON schedule_revision_history(checklist_id);
CREATE INDEX IF NOT EXISTS idx_sched_hist_created ON schedule_revision_history(created_at DESC);

-- 7. Create app_notifications Table
CREATE TABLE IF NOT EXISTS app_notifications (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_role                 TEXT NULL,
  target_user_id              UUID NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  title                       TEXT NOT NULL,
  message                     TEXT NOT NULL,
  type                        TEXT NOT NULL DEFAULT 'INFO',
  checklist_id                UUID NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  checklist_number            TEXT NULL,
  metadata                    JSONB NULL,
  is_read                     BOOLEAN NOT NULL DEFAULT false,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_target_role ON app_notifications(target_role, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_target_user ON app_notifications(target_user_id, is_read);

-- 8. Enable Row Level Security
ALTER TABLE schedule_extension_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rest_day_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_revision_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;

-- Service Role Full Access Policies
DROP POLICY IF EXISTS "Service role full access to schedule_extension_requests" ON schedule_extension_requests;
CREATE POLICY "Service role full access to schedule_extension_requests" ON schedule_extension_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to rest_day_requests" ON rest_day_requests;
CREATE POLICY "Service role full access to rest_day_requests" ON rest_day_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to leave_requests" ON leave_requests;
CREATE POLICY "Service role full access to leave_requests" ON leave_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to schedule_revision_history" ON schedule_revision_history;
CREATE POLICY "Service role full access to schedule_revision_history" ON schedule_revision_history FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to app_notifications" ON app_notifications;
CREATE POLICY "Service role full access to app_notifications" ON app_notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated Staff Policies
-- Coordinator & Admin can view and manage all requests and revisions
DROP POLICY IF EXISTS "Coordinators and Admins can manage extension requests" ON schedule_extension_requests;
CREATE POLICY "Coordinators and Admins can manage extension requests"
  ON schedule_extension_requests FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('COORDINATOR', 'ADMIN', 'SUPER_ADMIN', 'coordinator', 'admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('COORDINATOR', 'ADMIN', 'SUPER_ADMIN', 'coordinator', 'admin', 'super_admin')
    )
  );

-- Technical staff can insert extension requests for their checklists
DROP POLICY IF EXISTS "Technicians can insert extension requests" ON schedule_extension_requests;
CREATE POLICY "Technicians can insert extension requests"
  ON schedule_extension_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('TECHNICAL', 'technical')
    )
  );

DROP POLICY IF EXISTS "Technicians can view extension requests" ON schedule_extension_requests;
CREATE POLICY "Technicians can view extension requests"
  ON schedule_extension_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('TECHNICAL', 'technical')
    )
  );
