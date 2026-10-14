-- ============================================================
-- Eagle Eye SafDrive - Coordinator Workspace Migration
-- Migration 027: Role Update, Travel & Room Booking Management Schema
-- ============================================================

-- 1. Update admin_users role check constraint to include COORDINATOR
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'COORDINATOR', 'SUPER_ADMIN', 'admin', 'sales', 'technical', 'store_manager', 'coordinator', 'super_admin'));

-- 2. Synchronize coordinator account role if already existing
UPDATE admin_users SET role = 'COORDINATOR', is_active = true WHERE email = 'coordinator@gmail.com';

-- 3. Create coordinator_bookings Table
-- Holds travel (bus/other) and accommodation (hotel/room) booking records linked to installation checklists
CREATE TABLE IF NOT EXISTS coordinator_bookings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id                UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  
  -- Overall Coordinator Booking Workflow Status
  booking_status              TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (booking_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'NOT_REQUIRED')),
  
  -- Section 1: Travel Booking
  travel_required             BOOLEAN NOT NULL DEFAULT false,
  travel_type                 TEXT NOT NULL DEFAULT 'Bus' CHECK (travel_type IN ('Bus', 'Other')),
  departure_city              TEXT NULL,
  destination                 TEXT NULL,
  travel_datetime             TIMESTAMPTZ NULL,
  ticket_reference            TEXT NULL,
  travel_notes                TEXT NULL,
  
  -- Section 2: Room / Accommodation Booking
  accommodation_required      BOOLEAN NOT NULL DEFAULT false,
  hotel_name                  TEXT NULL,
  check_in_date               DATE NULL,
  check_out_date              DATE NULL,
  number_of_rooms             INTEGER NULL DEFAULT 1 CHECK (number_of_rooms IS NULL OR number_of_rooms > 0),
  hotel_booking_reference     TEXT NULL,
  accommodation_notes         TEXT NULL,
  
  -- Section 3: Personnel & Operational Notes
  assigned_engineer           TEXT NULL,
  additional_personnel        TEXT NULL,
  coordinator_notes           TEXT NULL,
  
  -- Audit & Metadata
  created_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  completed_at                TIMESTAMPTZ NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Guarantee 1 booking record per checklist (prevents duplicate booking records on retry)
  CONSTRAINT unique_checklist_coordinator_booking UNIQUE (checklist_id)
);

-- 4. Create coordinator_booking_audit_logs Table
-- Detailed audit trail for tracking status changes, booking edits, and coordinator user IDs
CREATE TABLE IF NOT EXISTS coordinator_booking_audit_logs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                  UUID NOT NULL REFERENCES coordinator_bookings(id) ON DELETE CASCADE,
  checklist_id                UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  action                      TEXT NOT NULL, -- e.g. CREATED, UPDATED, STATUS_CHANGED, COMPLETED, NOT_REQUIRED
  previous_status             TEXT NULL,
  new_status                  TEXT NOT NULL,
  changed_by                  UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  changed_by_email            TEXT NULL,
  notes                       TEXT NULL,
  snapshot                    JSONB NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Indexes for fast lookup and filtering
CREATE INDEX IF NOT EXISTS idx_coord_booking_checklist_id ON coordinator_bookings(checklist_id);
CREATE INDEX IF NOT EXISTS idx_coord_booking_status ON coordinator_bookings(booking_status);
CREATE INDEX IF NOT EXISTS idx_coord_booking_updated_at ON coordinator_bookings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coord_audit_checklist_id ON coordinator_booking_audit_logs(checklist_id);
CREATE INDEX IF NOT EXISTS idx_coord_audit_created_at ON coordinator_booking_audit_logs(created_at DESC);

-- 6. Trigger for updated_at on coordinator_bookings
DROP TRIGGER IF EXISTS update_coordinator_bookings_updated_at ON coordinator_bookings;
CREATE TRIGGER update_coordinator_bookings_updated_at
  BEFORE UPDATE ON coordinator_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 7. Enable Row Level Security
ALTER TABLE coordinator_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordinator_booking_audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role full access
DROP POLICY IF EXISTS "Service role full access to coordinator_bookings" ON coordinator_bookings;
CREATE POLICY "Service role full access to coordinator_bookings"
  ON coordinator_bookings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to coordinator_booking_audit_logs" ON coordinator_booking_audit_logs;
CREATE POLICY "Service role full access to coordinator_booking_audit_logs"
  ON coordinator_booking_audit_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated staff policies: COORDINATOR and ADMIN can manage bookings
DROP POLICY IF EXISTS "Coordinators and Admins can view bookings" ON coordinator_bookings;
CREATE POLICY "Coordinators and Admins can view bookings"
  ON coordinator_bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('COORDINATOR', 'ADMIN', 'SUPER_ADMIN', 'coordinator', 'admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Coordinators and Admins can insert bookings" ON coordinator_bookings;
CREATE POLICY "Coordinators and Admins can insert bookings"
  ON coordinator_bookings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('COORDINATOR', 'ADMIN', 'SUPER_ADMIN', 'coordinator', 'admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Coordinators and Admins can update bookings" ON coordinator_bookings;
CREATE POLICY "Coordinators and Admins can update bookings"
  ON coordinator_bookings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('COORDINATOR', 'ADMIN', 'SUPER_ADMIN', 'coordinator', 'admin', 'super_admin')
    )
  );

-- Audit log read policy
DROP POLICY IF EXISTS "Coordinators and Admins can view audit logs" ON coordinator_booking_audit_logs;
CREATE POLICY "Coordinators and Admins can view audit logs"
  ON coordinator_booking_audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
        AND admin_users.role IN ('COORDINATOR', 'ADMIN', 'SUPER_ADMIN', 'coordinator', 'admin', 'super_admin')
    )
  );
