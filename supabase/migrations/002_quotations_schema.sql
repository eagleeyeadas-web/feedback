-- ============================================================
-- Eagle Eye SafDrive - Quotation Generator Schema Migration
-- ============================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. QUOTATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS quotations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_number    TEXT UNIQUE NOT NULL,
  
  -- Customer Details
  customer_name       TEXT NOT NULL,
  contact_person      TEXT,
  address             TEXT,
  phone_number        TEXT,
  gst_number          TEXT,
  
  -- Dates & Tax Setup
  quotation_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  gst_applicable      BOOLEAN NOT NULL DEFAULT TRUE,
  gst_type            TEXT NOT NULL DEFAULT 'CGST_SGST' CHECK (gst_type IN ('CGST_SGST', 'IGST', 'NONE')),
  
  -- Financial Summary
  subtotal            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cgst_pct            DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  cgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  sgst_pct            DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  sgst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  igst_pct            DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  igst_amount         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  net_amount          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  
  -- Editable Terms & Conditions
  terms_conditions    TEXT[] DEFAULT ARRAY[
    '100% payment in advance is required along with a valid Purchase Order (PO) to confirm the order.',
    'Payments are non-refundable once the order has been confirmed and processing has begun.',
    'SIM card procurement, activation, and recharge/data charges shall be under the customer''s scope.',
    'Delivery timelines are estimates only and subject to stock availability.',
    'Products/services provided are subject to "3 years replacement warranty against manufacturing defects".',
    'This warranty does not cover normal wear and tear, misuse, or damage caused by improper handling.'
  ],
  
  -- Technical Specification Options (Page 2)
  include_tech_specs  BOOLEAN NOT NULL DEFAULT FALSE,
  tech_spec_template  TEXT DEFAULT 'default',
  
  -- Generated PDF Path
  pdf_path            TEXT,
  
  -- Metadata
  created_by          UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. QUOTATION ITEMS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS quotation_items (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id        UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  sno                 INTEGER NOT NULL,
  item_description    TEXT NOT NULL,
  hsn_sac             TEXT,
  qty                 DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  uom                 TEXT NOT NULL DEFAULT 'Nos',
  rate                DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_pct        DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  discount_amount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_quotations_number ON quotations(quotation_number);
CREATE INDEX IF NOT EXISTS idx_quotations_customer_name ON quotations(customer_name);
CREATE INDEX IF NOT EXISTS idx_quotations_date ON quotations(quotation_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);

-- ============================================================
-- 4. UPDATED_AT TRIGGER
-- ============================================================
CREATE TRIGGER update_quotations_updated_at
  BEFORE UPDATE ON quotations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to quotations"
  ON quotations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access to quotation_items"
  ON quotation_items FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 6. FUNCTION: Generate Quotation Number (CQS/XXXXX)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_quotation_number()
RETURNS TEXT AS $$
DECLARE
  seq_num INTEGER;
  new_id TEXT;
BEGIN
  -- Sequence starts with base offset 230 so first generated is CQS/00231
  SELECT COUNT(*) INTO seq_num FROM quotations;
  new_id := 'CQS/' || LPAD((seq_num + 231)::TEXT, 5, '0');
  
  -- Prevent duplicates if already exists
  WHILE EXISTS (SELECT 1 FROM quotations WHERE quotation_number = new_id) LOOP
    seq_num := seq_num + 1;
    new_id := 'CQS/' || LPAD((seq_num + 231)::TEXT, 5, '0');
  END LOOP;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;
