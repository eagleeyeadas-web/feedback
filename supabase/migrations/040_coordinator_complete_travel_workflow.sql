-- Migration: 040_coordinator_complete_travel_workflow.sql
-- Description: Complete Coordinator travel, accommodation (online/offline), return-ticket tasks, and audit tracking for Eagle Eye SafDrive

-- 1. Add outbound travel detailed columns
ALTER TABLE coordinator_bookings
  ADD COLUMN IF NOT EXISTS outbound_method TEXT NOT NULL DEFAULT 'Government bus',
  ADD COLUMN IF NOT EXISTS outbound_operator TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_boarding_point TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_departure_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_arrival_location TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_estimated_arrival_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_fare NUMERIC(10,2) NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS outbound_currency TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS outbound_booked_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_booked_by_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_notes TEXT NULL;

-- 2. Add room booking online/offline detailed columns
ALTER TABLE coordinator_bookings
  ADD COLUMN IF NOT EXISTS accommodation_type TEXT NOT NULL DEFAULT 'Online booking',
  ADD COLUMN IF NOT EXISTS hotel_platform TEXT NULL,
  ADD COLUMN IF NOT EXISTS hotel_address TEXT NULL,
  ADD COLUMN IF NOT EXISTS hotel_contact TEXT NULL,
  ADD COLUMN IF NOT EXISTS number_of_occupants INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS price_per_night NUMERIC(10,2) NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_cost NUMERIC(10,2) NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS offline_contact_person TEXT NULL,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'Pending',
  ADD COLUMN IF NOT EXISTS payment_method TEXT NULL,
  ADD COLUMN IF NOT EXISTS offline_notes TEXT NULL;

-- 3. Add return-ticket task and return journey detailed columns
ALTER TABLE coordinator_bookings
  ADD COLUMN IF NOT EXISTS return_task_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_method TEXT NOT NULL DEFAULT 'Government bus',
  ADD COLUMN IF NOT EXISTS return_operator TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_boarding_point TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_departure_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_arrival_location TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_estimated_arrival_time TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_fare NUMERIC(10,2) NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS return_currency TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS return_booked_by TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_booked_by_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_urgency TEXT NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS actual_completion_datetime TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS report_submission_datetime TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS booking_issue_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_notes TEXT NULL;

-- 4. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_coord_outbound_method ON coordinator_bookings(outbound_method);
CREATE INDEX IF NOT EXISTS idx_coord_accommodation_type ON coordinator_bookings(accommodation_type);
CREATE INDEX IF NOT EXISTS idx_coord_return_method ON coordinator_bookings(return_method);
CREATE INDEX IF NOT EXISTS idx_coord_return_task_id ON coordinator_bookings(return_task_id);
CREATE INDEX IF NOT EXISTS idx_coord_return_urgency ON coordinator_bookings(return_urgency);
