-- ============================================================
-- Eagle Eye SafDrive - Permanent Quotation Sequence Migration
-- ============================================================

-- 1. Create permanent sequence counter table
CREATE TABLE IF NOT EXISTS quotation_sequence (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  last_value  BIGINT NOT NULL DEFAULT 238,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row_check CHECK (id = 1)
);

-- 2. Initialize sequence counter based on existing highest quotation number
DO $$
DECLARE
  max_seq BIGINT;
BEGIN
  -- Extract highest numeric portion from existing 'CQS/XXXXX' numbers
  SELECT MAX(
    CASE 
      WHEN quotation_number ~ '^CQS/[0-9]+$' 
      THEN SUBSTRING(quotation_number FROM 5)::BIGINT
      ELSE 0
    END
  ) INTO max_seq FROM quotations;

  -- Default offset baseline is 238 if max existing is smaller
  IF max_seq IS NULL OR max_seq < 238 THEN
    max_seq := 238;
  END IF;

  -- Upsert sequence counter row
  INSERT INTO quotation_sequence (id, last_value, updated_at)
  VALUES (1, max_seq, NOW())
  ON CONFLICT (id) DO UPDATE
  SET last_value = GREATEST(quotation_sequence.last_value, EXCLUDED.last_value),
      updated_at = NOW();
END $$;

-- 3. Atomic Function: Generate & Reserve Next Quotation Number
CREATE OR REPLACE FUNCTION generate_next_quotation_number()
RETURNS TEXT AS $$
DECLARE
  next_val BIGINT;
BEGIN
  UPDATE quotation_sequence
  SET last_value = last_value + 1,
      updated_at = NOW()
  WHERE id = 1
  RETURNING last_value INTO next_val;

  IF next_val IS NULL THEN
    INSERT INTO quotation_sequence (id, last_value, updated_at)
    VALUES (1, 239, NOW())
    RETURNING last_value INTO next_val;
  END IF;

  RETURN 'CQS/' || LPAD(next_val::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Non-Mutating Function: Peek Next Quotation Number (Form Preview)
CREATE OR REPLACE FUNCTION peek_next_quotation_number()
RETURNS TEXT AS $$
DECLARE
  curr_val BIGINT;
BEGIN
  SELECT last_value INTO curr_val FROM quotation_sequence WHERE id = 1;
  IF curr_val IS NULL THEN
    curr_val := 238;
  END IF;
  RETURN 'CQS/' || LPAD((curr_val + 1)::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Ensure Unique Constraint on quotation_number
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotations_quotation_number_key'
  ) THEN
    ALTER TABLE quotations ADD CONSTRAINT quotations_quotation_number_key UNIQUE (quotation_number);
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
