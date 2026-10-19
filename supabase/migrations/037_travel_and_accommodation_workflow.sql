-- Migration: 037_travel_and_accommodation_workflow.sql
-- Description: Separate statuses and data fields for Outbound Travel, Accommodation, Room Extensions, and Return Tickets in Eagle Eye SafDrive Coordinator Workspace

-- 1. Add outbound, accommodation extension, and return travel columns to coordinator_bookings
ALTER TABLE coordinator_bookings
  -- Outbound Ticket Booking
  ADD COLUMN IF NOT EXISTS outbound_status TEXT NOT NULL DEFAULT 'Required',
  ADD COLUMN IF NOT EXISTS outbound_mode TEXT NOT NULL DEFAULT 'Bus',
  ADD COLUMN IF NOT EXISTS outbound_departure_datetime TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS outbound_origin TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_destination TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_ticket_reference TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_attachment_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS outbound_attachment_name TEXT NULL,

  -- Accommodation & Room Extension
  ADD COLUMN IF NOT EXISTS accommodation_status TEXT NOT NULL DEFAULT 'Required',
  ADD COLUMN IF NOT EXISTS initial_check_out_date DATE NULL,
  ADD COLUMN IF NOT EXISTS extra_nights INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accommodation_attachment_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS accommodation_attachment_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS accommodation_history JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Return Ticket Booking
  ADD COLUMN IF NOT EXISTS return_status TEXT NOT NULL DEFAULT 'Not Yet Required',
  ADD COLUMN IF NOT EXISTS return_mode TEXT NOT NULL DEFAULT 'Bus',
  ADD COLUMN IF NOT EXISTS return_departure_datetime TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS return_origin TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_destination TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_ticket_reference TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_attachment_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_attachment_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS return_task_created BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS return_task_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS return_task_completed BOOLEAN NOT NULL DEFAULT false;

-- 2. Create indexes for efficient querying and notifications
CREATE INDEX IF NOT EXISTS idx_coord_outbound_status ON coordinator_bookings(outbound_status);
CREATE INDEX IF NOT EXISTS idx_coord_accommodation_status ON coordinator_bookings(accommodation_status);
CREATE INDEX IF NOT EXISTS idx_coord_return_status ON coordinator_bookings(return_status);
CREATE INDEX IF NOT EXISTS idx_coord_return_task_created ON coordinator_bookings(return_task_created);
