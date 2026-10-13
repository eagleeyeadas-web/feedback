-- ============================================================
-- Eagle Eye SafDrive - Migration 024
-- Final BOM, Extra Device Material Usage & Returned Stock Schema
-- ============================================================

-- 1. Add final_bom_snapshot, actual_materials_used, and actual_materials_returned to installation_checklists
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS final_bom_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS actual_materials_used JSONB NULL,
  ADD COLUMN IF NOT EXISTS actual_materials_returned JSONB NULL,
  ADD COLUMN IF NOT EXISTS material_return_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE';

-- 2. Add material_items and final_bom to technical_installation_reports
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'technical_installation_reports') THEN
    ALTER TABLE technical_installation_reports
      ADD COLUMN IF NOT EXISTS material_items JSONB NULL,
      ADD COLUMN IF NOT EXISTS final_bom JSONB NULL;
  END IF;
END $$;

-- 3. Add damaged_stock to material_inventory if not exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'material_inventory') THEN
    ALTER TABLE material_inventory
      ADD COLUMN IF NOT EXISTS damaged_stock NUMERIC NOT NULL DEFAULT 0 CHECK (damaged_stock >= 0);
  END IF;
END $$;

-- 4. Create job_material_returns table for tracking physical material returns from site
CREATE TABLE IF NOT EXISTS job_material_returns (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  material_id               TEXT NULL,
  material_name             TEXT NOT NULL,
  unit                      TEXT NOT NULL,
  quantity_issued           NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  quantity_used             NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_used >= 0),
  declared_return_qty       NUMERIC NOT NULL DEFAULT 0 CHECK (declared_return_qty >= 0),
  accepted_usable_qty       NUMERIC NOT NULL DEFAULT 0 CHECK (accepted_usable_qty >= 0),
  damaged_qty               NUMERIC NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  missing_qty               NUMERIC NOT NULL DEFAULT 0 CHECK (missing_qty >= 0),
  status                    TEXT NOT NULL DEFAULT 'PENDING_STORE_VERIFICATION' CHECK (status IN ('PENDING_STORE_VERIFICATION', 'VERIFIED_AND_RECONCILED', 'DISCREPANCY_FLAGGED')),
  declared_by               UUID NULL,
  declared_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_by               UUID NULL,
  verified_at               TIMESTAMPTZ NULL,
  verification_remarks      TEXT NULL,
  idempotency_key           TEXT UNIQUE NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_material_returns_checklist ON job_material_returns(checklist_id);
CREATE INDEX IF NOT EXISTS idx_job_material_returns_status ON job_material_returns(status);

-- 5. Enable RLS and add policies
ALTER TABLE job_material_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on job_material_returns" ON job_material_returns;
CREATE POLICY "Service role full access on job_material_returns"
  ON job_material_returns FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view job_material_returns" ON job_material_returns;
CREATE POLICY "Authenticated users can view job_material_returns"
  ON job_material_returns FOR SELECT
  TO authenticated
  USING (true);
