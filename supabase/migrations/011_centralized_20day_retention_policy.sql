-- ============================================================
-- Eagle Eye SafDrive - Centralized 20-Day Retention Policy Migration
-- Migration 011: 20-Day Auto Cleanup for Quotation & Feedback Attachments
-- ============================================================

-- 1. QUOTATIONS: Update default retention to 20 days
ALTER TABLE quotations
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '20 days');

-- Extend expiry for existing unexpired quotations to match the 20-day policy from created_at
UPDATE quotations
SET expires_at = created_at + INTERVAL '20 days'
WHERE created_at IS NOT NULL
  AND (expires_at IS NULL OR expires_at < created_at + INTERVAL '20 days');

CREATE INDEX IF NOT EXISTS idx_quotations_expires_at ON quotations(expires_at);

-- 2. FEEDBACK: Ensure pdf_expires_at exists and defaults to 20 days
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'feedback' AND column_name = 'pdf_expires_at'
  ) THEN
    ALTER TABLE feedback ADD COLUMN pdf_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '20 days');
  ELSE
    ALTER TABLE feedback ALTER COLUMN pdf_expires_at SET DEFAULT (NOW() + INTERVAL '20 days');
  END IF;
END $$;

-- Update existing feedback records to reflect 20 days from submitted_at
UPDATE feedback
SET pdf_expires_at = COALESCE(submitted_at, created_at, NOW()) + INTERVAL '20 days'
WHERE pdf_path IS NOT NULL
  AND (pdf_expires_at IS NULL OR pdf_expires_at < COALESCE(submitted_at, created_at, NOW()) + INTERVAL '20 days');

CREATE INDEX IF NOT EXISTS idx_feedback_pdf_expires_at ON feedback(pdf_expires_at);

-- 3. FEEDBACK SIGNATURES: Allow signature_path to be NULL when attachment expires after 20 days
ALTER TABLE feedback ALTER COLUMN signature_path DROP NOT NULL;

