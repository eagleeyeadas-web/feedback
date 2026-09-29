-- ============================================================
-- Eagle Eye SafDrive - Quotation Sequence Reclaim Migration
-- ============================================================

-- Function to atomically delete a quotation and reclaim its sequence number if it is the latest
CREATE OR REPLACE FUNCTION delete_quotation_and_reclaim_number(p_quotation_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_q_no TEXT;
  v_pdf_path TEXT;
  v_seq_num BIGINT;
  v_curr_last BIGINT;
  v_reclaimed BOOLEAN := FALSE;
BEGIN
  -- 1. Fetch quotation number and pdf_path for the given ID with row lock
  SELECT quotation_number, pdf_path INTO v_q_no, v_pdf_path
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Quotation record not found');
  END IF;

  -- 2. Extract numeric sequence from 'CQS/XXXXX'
  IF v_q_no ~ '^CQS/[0-9]+$' THEN
    v_seq_num := SUBSTRING(v_q_no FROM 5)::BIGINT;
  ELSE
    v_seq_num := NULL;
  END IF;

  -- 3. Lock sequence counter row
  SELECT last_value INTO v_curr_last
  FROM quotation_sequence
  WHERE id = 1
  FOR UPDATE;

  -- 4. Delete quotation record (items cascade deleted via foreign key)
  DELETE FROM quotations WHERE id = p_quotation_id;

  -- 5. Check if deleted quotation sequence equals current last_value
  IF v_seq_num IS NOT NULL AND v_curr_last IS NOT NULL AND v_seq_num = v_curr_last THEN
    -- Step back sequence counter by 1 (minimum floor 238)
    UPDATE quotation_sequence
    SET last_value = GREATEST(last_value - 1, 238),
        updated_at = NOW()
    WHERE id = 1
    RETURNING last_value INTO v_curr_last;
    
    v_reclaimed := TRUE;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'quotation_number', v_q_no,
    'pdf_path', v_pdf_path,
    'reclaimed', v_reclaimed,
    'new_last_value', v_curr_last
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
