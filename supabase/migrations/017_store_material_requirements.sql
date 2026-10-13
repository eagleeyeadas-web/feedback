-- ============================================================
-- Eagle Eye SafDrive - Store Manager Material Requirements
-- Migration 017: Persisted Store Manager Material Requirements & Checklist Integration
-- ============================================================

-- 1. Create STORE_MATERIAL_REQUIREMENTS Table
CREATE TABLE IF NOT EXISTS store_material_requirements (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  checklist_number          TEXT NOT NULL,
  client_name               TEXT NOT NULL,
  client_mobile             TEXT NOT NULL,
  client_location           TEXT NOT NULL,
  google_maps_location      TEXT NULL,
  job_type                  TEXT NOT NULL DEFAULT 'Installation' CHECK (job_type IN ('Installation', 'Service')),
  device_type               TEXT NOT NULL,
  number_of_devices         INTEGER NOT NULL DEFAULT 1 CHECK (number_of_devices > 0),
  number_of_vehicles        INTEGER NOT NULL DEFAULT 1 CHECK (number_of_vehicles > 0),
  device_configurations     JSONB NOT NULL DEFAULT '[]'::jsonb,
  bom_snapshot              JSONB NULL,
  material_items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  material_issuance_status  TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (material_issuance_status IN ('PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'NOT_APPLICABLE')),
  status                    TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                            CHECK (status IN ('PENDING_REVIEW', 'READY_FOR_ISSUANCE', 'SHORTAGE_FLAGGED', 'ISSUED', 'NOT_APPLICABLE')),
  has_shortage              BOOLEAN NOT NULL DEFAULT false,
  shortage_count            INTEGER NOT NULL DEFAULT 0,
  shortage_details          JSONB NULL,
  material_issued_at        TIMESTAMPTZ NULL,
  material_issued_by        UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  submission_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                     TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_store_req_checklist UNIQUE (checklist_id)
);

-- Indexes for lightning fast querying and filtering
CREATE INDEX IF NOT EXISTS idx_store_req_checklist_id ON store_material_requirements(checklist_id);
CREATE INDEX IF NOT EXISTS idx_store_req_number ON store_material_requirements(checklist_number);
CREATE INDEX IF NOT EXISTS idx_store_req_job_type ON store_material_requirements(job_type);
CREATE INDEX IF NOT EXISTS idx_store_req_status ON store_material_requirements(status);
CREATE INDEX IF NOT EXISTS idx_store_req_issuance ON store_material_requirements(material_issuance_status);
CREATE INDEX IF NOT EXISTS idx_store_req_created ON store_material_requirements(created_at DESC);

-- Trigger for updated_at
DO $$ BEGIN
  CREATE TRIGGER update_store_material_requirements_updated_at
    BEFORE UPDATE ON store_material_requirements
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enable Row Level Security (RLS)
ALTER TABLE store_material_requirements ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$ BEGIN
  CREATE POLICY "Service role full access to store_material_requirements"
    ON store_material_requirements FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated staff read access
DO $$ BEGIN
  CREATE POLICY "Staff can view store_material_requirements"
    ON store_material_requirements FOR SELECT TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill initial records from existing installation_checklists
INSERT INTO store_material_requirements (
  checklist_id,
  checklist_number,
  client_name,
  client_mobile,
  client_location,
  google_maps_location,
  job_type,
  device_type,
  number_of_devices,
  number_of_vehicles,
  device_configurations,
  bom_snapshot,
  material_items,
  material_issuance_status,
  status,
  has_shortage,
  shortage_count,
  material_issued_at,
  material_issued_by,
  submission_date,
  created_at,
  updated_at
)
SELECT
  c.id,
  c.checklist_number,
  c.client_name,
  c.client_mobile,
  c.client_location,
  c.google_maps_location,
  COALESCE(c.installation_or_service, 'Installation'),
  c.device_type,
  c.number_of_devices,
  COALESCE(c.number_of_vehicles, c.number_of_devices),
  COALESCE(c.device_configurations, '[]'::jsonb),
  CASE WHEN COALESCE(c.installation_or_service, 'Installation') = 'Installation' THEN c.bom_snapshot ELSE NULL END,
  COALESCE(
    CASE WHEN COALESCE(c.installation_or_service, 'Installation') = 'Installation' AND c.bom_snapshot IS NOT NULL
      THEN c.bom_snapshot->'items'
      ELSE '[]'::jsonb
    END,
    '[]'::jsonb
  ),
  COALESCE(
    CASE WHEN COALESCE(c.installation_or_service, 'Installation') = 'Service' THEN 'NOT_APPLICABLE' ELSE c.material_issuance_status END,
    'PENDING'
  ),
  CASE
    WHEN COALESCE(c.installation_or_service, 'Installation') = 'Service' THEN 'NOT_APPLICABLE'
    WHEN c.material_issuance_status = 'ISSUED' THEN 'ISSUED'
    ELSE 'PENDING_REVIEW'
  END,
  false,
  0,
  c.material_issued_at,
  c.material_issued_by,
  c.created_at,
  c.created_at,
  c.updated_at
FROM installation_checklists c
ON CONFLICT (checklist_id) DO NOTHING;
