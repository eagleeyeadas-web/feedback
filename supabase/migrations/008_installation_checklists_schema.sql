-- ============================================================
-- Eagle Eye SafDrive - Installation Checklist Schema Migration
-- ============================================================

-- 1. Create permanent sequence counter table for Installation Checklists
CREATE TABLE IF NOT EXISTS installation_checklist_sequence (
  date_key    TEXT PRIMARY KEY,  -- Format: 'YYYYMMDD'
  last_value  INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create atomic function to generate next checklist number
-- Format: EE-INST-YYYYMMDD-XXXX (e.g. EE-INST-20261009-0001)
CREATE OR REPLACE FUNCTION generate_next_installation_checklist_number()
RETURNS TEXT AS $$
DECLARE
  today_str TEXT;
  next_val INTEGER;
BEGIN
  -- Get today's date string in IST timezone
  today_str := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  
  -- Atomically upsert row for today and increment sequence
  INSERT INTO installation_checklist_sequence (date_key, last_value, updated_at)
  VALUES (today_str, 1, NOW())
  ON CONFLICT (date_key) DO UPDATE
  SET last_value = installation_checklist_sequence.last_value + 1,
      updated_at = NOW()
  RETURNING last_value INTO next_val;

  RETURN 'EE-INST-' || today_str || '-' || LPAD(next_val::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create INSTALLATION_CHECKLISTS Table
CREATE TABLE IF NOT EXISTS installation_checklists (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_number        TEXT UNIQUE NOT NULL,
  created_by              UUID NOT NULL, -- auth.users / admin_users ID
  
  -- Section 1: Client Details
  client_name             TEXT NOT NULL,
  client_mobile           TEXT NOT NULL,
  client_location         TEXT NOT NULL DEFAULT '',
  google_maps_location    TEXT NULL,
  
  -- Section 2: Device Details
  device_type             TEXT NOT NULL,
  number_of_devices       INTEGER NOT NULL CHECK (number_of_devices > 0),
  number_of_vehicles      INTEGER NOT NULL CHECK (number_of_vehicles > 0),
  extra_devices           BOOLEAN NOT NULL DEFAULT false,
  
  -- Section 3: Extra Device Details (Conditional)
  extra_device_type       TEXT NULL,
  extra_device_count      INTEGER NULL CHECK (extra_device_count IS NULL OR extra_device_count > 0),
  
  -- Section 4: Price & Payment
  confirmed_price         NUMERIC NOT NULL CHECK (confirmed_price >= 0),
  payment_method          TEXT NOT NULL DEFAULT 'UPI',
  advance_received        BOOLEAN NOT NULL DEFAULT false,
  advance_amount          NUMERIC NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
  pending_payment         BOOLEAN NOT NULL DEFAULT false,
  pending_amount          NUMERIC NOT NULL DEFAULT 0 CHECK (pending_amount >= 0),
  
  -- Section 5: Installation Details
  installation_duration   TEXT NOT NULL DEFAULT '1 Day',
  vehicle_type            TEXT NOT NULL DEFAULT 'Truck',
  expected_arrival_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_arrival_time   TIME NOT NULL DEFAULT '10:00:00',
  installation_or_service TEXT NOT NULL CHECK (installation_or_service IN ('Installation', 'Service')),
  
  -- Section 6: Installation Team
  service_engineer        TEXT NOT NULL DEFAULT '',
  service_assistant       TEXT NOT NULL DEFAULT '',
  
  -- Section 7: Final Confirmation & Status
  installation_status     TEXT NOT NULL DEFAULT 'Pending' CHECK (installation_status IN ('Pending', 'Assigned', 'In Progress', 'Completed', 'Cancelled')),
  payment_status          TEXT NOT NULL DEFAULT 'Pending' CHECK (payment_status IN ('Paid', 'Partially Paid', 'Pending')),
  remarks                 TEXT NULL,
  client_confirmation     TEXT NOT NULL DEFAULT 'Confirmed' CHECK (client_confirmation IN ('Confirmed', 'Not Confirmed')),
  
  -- Timestamps
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Indexes for fast searching and filtering
CREATE INDEX IF NOT EXISTS idx_inst_checklist_number ON installation_checklists(checklist_number);
CREATE INDEX IF NOT EXISTS idx_inst_client_name ON installation_checklists(client_name);
CREATE INDEX IF NOT EXISTS idx_inst_client_mobile ON installation_checklists(client_mobile);
CREATE INDEX IF NOT EXISTS idx_inst_installation_status ON installation_checklists(installation_status);
CREATE INDEX IF NOT EXISTS idx_inst_payment_status ON installation_checklists(payment_status);
CREATE INDEX IF NOT EXISTS idx_inst_created_at ON installation_checklists(created_at DESC);

-- 5. Trigger for updated_at
DROP TRIGGER IF EXISTS update_installation_checklists_updated_at ON installation_checklists;
CREATE TRIGGER update_installation_checklists_updated_at
  BEFORE UPDATE ON installation_checklists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 6. Row Level Security
ALTER TABLE installation_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_checklist_sequence ENABLE ROW LEVEL SECURITY;

-- Allow service_role (backend API) full access to installation_checklists
DROP POLICY IF EXISTS "Service role full access to installation_checklists" ON installation_checklists;
CREATE POLICY "Service role full access to installation_checklists"
  ON installation_checklists FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow service_role full access to sequence
DROP POLICY IF EXISTS "Service role full access to installation_checklist_sequence" ON installation_checklist_sequence;
CREATE POLICY "Service role full access to installation_checklist_sequence"
  ON installation_checklist_sequence FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated admins can SELECT installation_checklists
DROP POLICY IF EXISTS "Admins can view installation_checklists" ON installation_checklists;
CREATE POLICY "Admins can view installation_checklists"
  ON installation_checklists FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
    )
  );

-- Authenticated admins can INSERT installation_checklists
DROP POLICY IF EXISTS "Admins can insert installation_checklists" ON installation_checklists;
CREATE POLICY "Admins can insert installation_checklists"
  ON installation_checklists FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
    )
  );

-- Authenticated admins can UPDATE installation_checklists
DROP POLICY IF EXISTS "Admins can update installation_checklists" ON installation_checklists;
CREATE POLICY "Admins can update installation_checklists"
  ON installation_checklists FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
    )
  );

-- Authenticated admins can DELETE installation_checklists
DROP POLICY IF EXISTS "Admins can delete installation_checklists" ON installation_checklists;
CREATE POLICY "Admins can delete installation_checklists"
  ON installation_checklists FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.is_active = true
    )
  );
