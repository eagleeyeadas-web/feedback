-- ============================================================
-- Eagle Eye SafDrive - Engineer Availability and Booking System
-- Migration 013: Main Service Engineers, Availability Tracking & Concurrency-Safe Booking
-- ============================================================

-- 1. CREATE SERVICE_ENGINEERS TABLE (Persistent, Stable IDs)
CREATE TABLE IF NOT EXISTS service_engineers (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                      TEXT NOT NULL UNIQUE,
  role                      TEXT NOT NULL DEFAULT 'Service Engineer',
  phone                     TEXT NULL,
  email                     TEXT NULL,
  is_active                 BOOLEAN NOT NULL DEFAULT true,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the 5 main service engineers with deterministic stable UUIDs if not existing
INSERT INTO service_engineers (id, name, role, email)
VALUES
  ('e1000000-0000-0000-0000-000000000001', 'Mathi', 'Service Engineer', 'mathi@eagleeyesafdrive.com'),
  ('e1000000-0000-0000-0000-000000000002', 'Kamalesh', 'Service Engineer', 'kamalesh@eagleeyesafdrive.com'),
  ('e1000000-0000-0000-0000-000000000003', 'Dhinagaran', 'Service Engineer', 'dhinagaran@eagleeyesafdrive.com'),
  ('e1000000-0000-0000-0000-000000000004', 'Sakthivel', 'Service Engineer', 'sakthivel@eagleeyesafdrive.com'),
  ('e1000000-0000-0000-0000-000000000005', 'Mithun', 'Service Engineer', 'mithun@eagleeyesafdrive.com')
ON CONFLICT (name) DO UPDATE
SET updated_at = NOW();

-- 2. ALTER INSTALLATION_CHECKLISTS TO PERSIST STABLE ENGINEER_ID & BOOKING_END_DATE
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS service_engineer_id UUID NULL REFERENCES service_engineers(id),
  ADD COLUMN IF NOT EXISTS booking_end_date DATE NULL;

CREATE INDEX IF NOT EXISTS idx_inst_service_eng_id ON installation_checklists(service_engineer_id);
CREATE INDEX IF NOT EXISTS idx_inst_booking_dates ON installation_checklists(expected_arrival_date, booking_end_date);

-- 3. CREATE ENGINEER_BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS engineer_bookings (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  engineer_id              UUID NOT NULL REFERENCES service_engineers(id) ON DELETE CASCADE,
  engineer_name            TEXT NOT NULL,
  checklist_id             UUID NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  checklist_number         TEXT NOT NULL,
  booking_start_date       DATE NOT NULL,
  booking_end_date         DATE NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'ASSIGNED'
                           CHECK (status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RELEASED')),
  created_by               UUID NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bookings_engineer ON engineer_bookings(engineer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_checklist ON engineer_bookings(checklist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON engineer_bookings(booking_start_date, booking_end_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON engineer_bookings(status);

-- 4. ATOMIC CONCURRENCY-SAFE RESERVATION FUNCTION WITH ADVISORY LOCKING
CREATE OR REPLACE FUNCTION book_engineer_atomic(
  p_engineer_id UUID,
  p_checklist_id UUID,
  p_checklist_number TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict RECORD;
  v_booking_id UUID;
  v_engineer_name TEXT;
BEGIN
  -- Validate dates
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid date range: start and end dates are required.');
  END IF;

  IF p_end_date < p_start_date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid date range: end date cannot be before start date.');
  END IF;

  -- Verify engineer exists
  SELECT name INTO v_engineer_name FROM service_engineers WHERE id = p_engineer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Service engineer not found.');
  END IF;

  -- Acquire transaction-level advisory lock on engineer ID to serialize concurrent bookings
  PERFORM pg_advisory_xact_lock(hashtext('engineer_booking_' || p_engineer_id::text));

  -- Check for existing overlapping active booking
  -- Overlap condition for inclusive dates [startA, endA] and [startB, endB]:
  -- startA <= endB AND endA >= startB
  SELECT id, checklist_number, booking_start_date, booking_end_date, status
  INTO v_conflict
  FROM engineer_bookings
  WHERE engineer_id = p_engineer_id
    AND status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
    AND booking_start_date <= p_end_date
    AND booking_end_date >= p_start_date
    AND (p_checklist_id IS NULL OR checklist_id IS DISTINCT FROM p_checklist_id)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Engineer ' || v_engineer_name || ' is already booked for ' || v_conflict.checklist_number ||
               ' from ' || to_char(v_conflict.booking_start_date, 'YYYY-MM-DD') ||
               ' to ' || to_char(v_conflict.booking_end_date, 'YYYY-MM-DD') || '.',
      'conflict', jsonb_build_object(
        'checklist_number', v_conflict.checklist_number,
        'booking_start_date', v_conflict.booking_start_date,
        'booking_end_date', v_conflict.booking_end_date
      )
    );
  END IF;

  -- Release/update any prior booking for this checklist
  IF p_checklist_id IS NOT NULL THEN
    DELETE FROM engineer_bookings WHERE checklist_id = p_checklist_id;
  END IF;

  -- Insert new booking atomically
  INSERT INTO engineer_bookings (
    engineer_id,
    engineer_name,
    checklist_id,
    checklist_number,
    booking_start_date,
    booking_end_date,
    status,
    created_by
  )
  VALUES (
    p_engineer_id,
    v_engineer_name,
    p_checklist_id,
    p_checklist_number,
    p_start_date,
    p_end_date,
    'ASSIGNED',
    p_created_by
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'engineer_id', p_engineer_id,
    'engineer_name', v_engineer_name,
    'booking_start_date', p_start_date,
    'booking_end_date', p_end_date
  );
END;
$$;
