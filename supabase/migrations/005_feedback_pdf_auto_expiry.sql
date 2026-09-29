-- ============================================================
-- Eagle Eye SafDrive - Customer Feedback PDF 10-Day Auto Expiry Migration
-- ============================================================

-- Add pdf_expires_at column to feedback table if not already present
ALTER TABLE feedback 
ADD COLUMN IF NOT EXISTS pdf_expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 days');

-- Safely initialize pdf_expires_at for any existing feedback records based on submitted_at
UPDATE feedback 
SET pdf_expires_at = submitted_at + INTERVAL '10 days'
WHERE pdf_expires_at IS NULL OR pdf_expires_at = submitted_at;

-- Create index on pdf_expires_at for performant cleanup queries
CREATE INDEX IF NOT EXISTS idx_feedback_pdf_expires_at ON feedback(pdf_expires_at);
