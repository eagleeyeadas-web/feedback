-- ============================================================
-- Eagle Eye SafDrive - Customer Feedback Management System
-- Supabase PostgreSQL Schema Migration
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. FEEDBACK TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS feedback (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feedback_id     TEXT UNIQUE NOT NULL,  -- Human-readable ID like EE-20260928-XXXX
  
  -- Customer Details
  customer_name   TEXT NOT NULL,
  phone_number    TEXT NOT NULL,
  company_name    TEXT,
  email           TEXT,
  
  -- Vehicle Details
  vehicle_number  TEXT,
  imei_number     TEXT NOT NULL,
  vehicle_type    TEXT NOT NULL,
  
  -- Service Details
  product_service TEXT NOT NULL,
  service_date    DATE NOT NULL,
  technician      TEXT NOT NULL,
  
  -- Ratings (1-5)
  rating_product_quality      INTEGER NOT NULL CHECK (rating_product_quality BETWEEN 1 AND 5),
  rating_installation         INTEGER NOT NULL CHECK (rating_installation BETWEEN 1 AND 5),
  rating_performance          INTEGER NOT NULL CHECK (rating_performance BETWEEN 1 AND 5),
  rating_professionalism      INTEGER NOT NULL CHECK (rating_professionalism BETWEEN 1 AND 5),
  rating_support              INTEGER NOT NULL CHECK (rating_support BETWEEN 1 AND 5),
  average_rating              DECIMAL(3,2) GENERATED ALWAYS AS (
    (rating_product_quality + rating_installation + rating_performance + rating_professionalism + rating_support)::DECIMAL / 5
  ) STORED,
  
  -- Issue Resolution
  issue_resolved  TEXT NOT NULL CHECK (issue_resolved IN ('Yes', 'Partially', 'No')),
  
  -- Comments
  improvement_suggestions TEXT,
  additional_comments     TEXT,
  
  -- Signature
  signature_path  TEXT NOT NULL,
  
  -- PDF
  pdf_path        TEXT,
  
  -- Metadata
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address      TEXT,
  user_agent      TEXT,
  
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. ADMIN USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================
CREATE INDEX idx_feedback_feedback_id ON feedback(feedback_id);
CREATE INDEX idx_feedback_customer_name ON feedback(customer_name);
CREATE INDEX idx_feedback_phone_number ON feedback(phone_number);
CREATE INDEX idx_feedback_vehicle_number ON feedback(vehicle_number);
CREATE INDEX idx_feedback_imei_number ON feedback(imei_number);
CREATE INDEX idx_feedback_service_date ON feedback(service_date);
CREATE INDEX idx_feedback_technician ON feedback(technician);
CREATE INDEX idx_feedback_product_service ON feedback(product_service);
CREATE INDEX idx_feedback_issue_resolved ON feedback(issue_resolved);
CREATE INDEX idx_feedback_submitted_at ON feedback(submitted_at DESC);
CREATE INDEX idx_feedback_average_rating ON feedback(average_rating);

-- ============================================================
-- 4. UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_feedback_updated_at
  BEFORE UPDATE ON feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Policy: Allow insert from service role (backend) only
CREATE POLICY "Service role can insert feedback"
  ON feedback FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Allow select from service role (backend) only
CREATE POLICY "Service role can select feedback"
  ON feedback FOR SELECT
  TO service_role
  USING (true);

-- Policy: Allow update from service role (backend) only
CREATE POLICY "Service role can update feedback"
  ON feedback FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Admin users - only service role can manage
CREATE POLICY "Service role can manage admin_users"
  ON admin_users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated admin users can read their own record
CREATE POLICY "Admin users can read own record"
  ON admin_users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- ============================================================
-- 6. STORAGE BUCKETS
-- ============================================================
-- Run these in the Supabase dashboard or via API:
--
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('signatures', 'signatures', false);
--
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('pdfs', 'pdfs', false);
--
-- Storage Policies for signatures bucket:
-- CREATE POLICY "Service role full access to signatures"
--   ON storage.objects FOR ALL
--   TO service_role
--   USING (bucket_id = 'signatures')
--   WITH CHECK (bucket_id = 'signatures');
--
-- Storage Policies for pdfs bucket:
-- CREATE POLICY "Service role full access to pdfs"
--   ON storage.objects FOR ALL
--   TO service_role
--   USING (bucket_id = 'pdfs')
--   WITH CHECK (bucket_id = 'pdfs');

-- ============================================================
-- 7. FUNCTION: Generate Feedback ID
-- ============================================================
CREATE OR REPLACE FUNCTION generate_feedback_id()
RETURNS TEXT AS $$
DECLARE
  today_str TEXT;
  seq_num INTEGER;
  new_id TEXT;
BEGIN
  today_str := TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD');
  
  SELECT COUNT(*) + 1 INTO seq_num
  FROM feedback
  WHERE feedback_id LIKE 'EE-' || today_str || '-%';
  
  new_id := 'EE-' || today_str || '-' || LPAD(seq_num::TEXT, 4, '0');
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;
