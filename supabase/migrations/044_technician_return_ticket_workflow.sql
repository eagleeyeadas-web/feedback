-- Migration: 044_technician_return_ticket_workflow.sql
-- Description: Adds technician return-ticket booking submission, Coordinator verification, correction request fields, and audit timestamps.

ALTER TABLE coordinator_bookings
  ADD COLUMN IF NOT EXISTS return_booking_date DATE NULL,
  ADD COLUMN IF NOT EXISTS return_submitted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS return_submitted_by UUID NULL,
  ADD COLUMN IF NOT EXISTS return_submitted_by_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_correction_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_correction_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS return_correction_requested_by UUID NULL,
  ADD COLUMN IF NOT EXISTS return_correction_requested_by_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_verified_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS return_verified_by UUID NULL,
  ADD COLUMN IF NOT EXISTS return_verified_by_name TEXT NULL;

-- Create indexes for performance querying
CREATE INDEX IF NOT EXISTS idx_coord_return_submitted_at ON coordinator_bookings(return_submitted_at);
CREATE INDEX IF NOT EXISTS idx_coord_return_verified_at ON coordinator_bookings(return_verified_at);
