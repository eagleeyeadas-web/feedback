-- ============================================================
-- Eagle Eye SafDrive - Quotation Automatic 20-Day Permanent Deletion
-- Migration 050: Automatic 20-Day Permanent Deletion & Retention Policy
-- ============================================================

-- 1. Ensure quotations table has 20-day expires_at default
ALTER TABLE quotations
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '20 days');

-- 2. Create index on expires_at for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_quotations_expires_at ON quotations(expires_at);

-- 3. Ensure foreign key constraint from quotation_items to quotations has ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'quotation_items_quotation_id_fkey'
      AND table_name = 'quotation_items'
  ) THEN
    ALTER TABLE quotation_items
      ADD CONSTRAINT quotation_items_quotation_id_fkey
      FOREIGN KEY (quotation_id) REFERENCES quotations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Ensure quotation_sequence table exists to guarantee monotonic sequence numbering
CREATE TABLE IF NOT EXISTS quotation_sequence (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  last_value  BIGINT NOT NULL DEFAULT 276,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row_check CHECK (id = 1)
);

-- Initialize quotation_sequence with highest current number if empty
INSERT INTO quotation_sequence (id, last_value, updated_at)
VALUES (1, 276, NOW())
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on quotation_sequence
ALTER TABLE quotation_sequence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'quotation_sequence' AND policyname = 'Service role full access to quotation_sequence'
  ) THEN
    CREATE POLICY "Service role full access to quotation_sequence"
      ON quotation_sequence FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
