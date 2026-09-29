-- ============================================================
-- Eagle Eye SafDrive - Quotation 10-Day Auto Expiry Migration
-- ============================================================

-- Add expires_at column to quotations if not already present
ALTER TABLE quotations 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 days');

-- Safely initialize expires_at for any existing quotations based on created_at
UPDATE quotations 
SET expires_at = created_at + INTERVAL '10 days'
WHERE expires_at IS NULL OR expires_at = created_at;

-- Create index on expires_at for performant cleanup queries
CREATE INDEX IF NOT EXISTS idx_quotations_expires_at ON quotations(expires_at);
