-- ============================================================
-- Eagle Eye SafDrive - Activity-Triggered Cleanup & Distributed State
-- Migration 012: Persistent Cleanup Tracking and Concurrency Control
-- ============================================================

-- 1. Create table to track system cleanup state and concurrency locking
CREATE TABLE IF NOT EXISTS system_cleanup_state (
  id                      TEXT PRIMARY KEY,
  last_successful_run_at  TIMESTAMPTZ NULL,
  last_run_started_at     TIMESTAMPTZ NULL,
  last_run_status         TEXT NOT NULL DEFAULT 'IDLE' CHECK (last_run_status IN ('IDLE', 'RUNNING', 'COMPLETED', 'FAILED')),
  last_run_summary        JSONB NULL,
  last_error              TEXT NULL,
  locked_until            TIMESTAMPTZ NULL,
  triggered_by_user_id    UUID NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial record for the centralized 20-day cleanup job
INSERT INTO system_cleanup_state (id, last_run_status)
VALUES ('centralized_20day_cleanup', 'IDLE')
ON CONFLICT (id) DO NOTHING;

-- 2. Row Level Security (RLS) policies
ALTER TABLE system_cleanup_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role full access to system_cleanup_state"
    ON system_cleanup_state FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Authenticated users read system_cleanup_state"
    ON system_cleanup_state FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Stored Procedure: Atomic Lock Acquisition & 24-Hour Cooldown Verification
-- Prevents race conditions from multiple concurrent tabs or users
CREATE OR REPLACE FUNCTION claim_cleanup_lock(
  p_user_id UUID DEFAULT NULL,
  p_cooldown_hours INT DEFAULT 24
)
RETURNS TABLE (
  claimed BOOLEAN,
  reason TEXT,
  last_successful_run_at TIMESTAMPTZ,
  locked_until TIMESTAMPTZ
) AS $$
DECLARE
  v_rec RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_lock_duration INTERVAL := INTERVAL '10 minutes';
BEGIN
  -- Ensure record exists
  INSERT INTO system_cleanup_state (id, last_run_status)
  VALUES ('centralized_20day_cleanup', 'IDLE')
  ON CONFLICT (id) DO NOTHING;

  -- Lock record for atomic evaluation across concurrent transactions
  SELECT * INTO v_rec
  FROM system_cleanup_state
  WHERE id = 'centralized_20day_cleanup'
  FOR UPDATE;

  -- Condition A: Check if another session currently holds the active lock
  IF v_rec.locked_until IS NOT NULL AND v_rec.locked_until > v_now THEN
    RETURN QUERY SELECT FALSE, 'CLEANUP_ALREADY_RUNNING', v_rec.last_successful_run_at, v_rec.locked_until;
    RETURN;
  END IF;

  -- Condition B: Check if 24 hours have elapsed since the last successful run
  IF v_rec.last_successful_run_at IS NOT NULL AND v_rec.last_successful_run_at > (v_now - (p_cooldown_hours || ' hours')::INTERVAL) THEN
    RETURN QUERY SELECT FALSE, 'COOLDOWN_ACTIVE', v_rec.last_successful_run_at, v_rec.locked_until;
    RETURN;
  END IF;

  -- Condition C: Eligible! Claim atomic lock
  UPDATE system_cleanup_state
  SET 
    last_run_status = 'RUNNING',
    last_run_started_at = v_now,
    locked_until = v_now + v_lock_duration,
    triggered_by_user_id = p_user_id,
    updated_at = v_now
  WHERE id = 'centralized_20day_cleanup';

  RETURN QUERY SELECT TRUE, 'LOCK_ACQUIRED', v_rec.last_successful_run_at, (v_now + v_lock_duration);
END;
$$ LANGUAGE plpgsql;

-- 4. Stored Procedure: Release Lock & Update Result
CREATE OR REPLACE FUNCTION release_cleanup_lock(
  p_success BOOLEAN,
  p_summary JSONB DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF p_success THEN
    UPDATE system_cleanup_state
    SET 
      last_run_status = 'COMPLETED',
      last_successful_run_at = NOW(),
      locked_until = NULL,
      last_run_summary = p_summary,
      last_error = NULL,
      updated_at = NOW()
    WHERE id = 'centralized_20day_cleanup';
  ELSE
    UPDATE system_cleanup_state
    SET 
      last_run_status = 'FAILED',
      locked_until = NULL,
      last_error = p_error,
      updated_at = NOW()
    WHERE id = 'centralized_20day_cleanup';
  END IF;
END;
$$ LANGUAGE plpgsql;
