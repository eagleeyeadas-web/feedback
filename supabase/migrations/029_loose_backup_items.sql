-- ============================================================
-- Eagle Eye SafDrive - Separate Extra Loose Devices Migration
-- Migration 029: Pre-installation loose backup item declaration & reconciliation
-- ============================================================

-- 1. Add carry_extra_backup_items column to installation_checklists
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS carry_extra_backup_items BOOLEAN NOT NULL DEFAULT FALSE;

-- Safely backfill from historical extra_devices flag if present
UPDATE installation_checklists
SET carry_extra_backup_items = COALESCE(extra_devices, false)
WHERE carry_extra_backup_items IS NULL OR carry_extra_backup_items = false;

-- 2. Create pre_installation_backup_declarations table
CREATE TABLE IF NOT EXISTS pre_installation_backup_declarations (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  technician_id             UUID NULL,
  technician_name           TEXT NULL,
  has_backup_items          BOOLEAN NOT NULL DEFAULT FALSE,
  no_items_reason           TEXT NULL,
  status                    TEXT NOT NULL DEFAULT 'DECLARED' CHECK (status IN ('DECLARED', 'CORRECTED', 'VERIFIED')),
  declaration_timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  history                   JSONB NULL DEFAULT '[]'::jsonb,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_checklist_backup_decl UNIQUE (checklist_id)
);

CREATE INDEX IF NOT EXISTS idx_backup_decl_checklist ON pre_installation_backup_declarations(checklist_id);
CREATE INDEX IF NOT EXISTS idx_backup_decl_tech ON pre_installation_backup_declarations(technician_id);

-- 3. Create pre_installation_backup_items table for loose items
CREATE TABLE IF NOT EXISTS pre_installation_backup_items (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  declaration_id            UUID NOT NULL REFERENCES pre_installation_backup_declarations(id) ON DELETE CASCADE,
  checklist_id              UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  item_id                   TEXT NOT NULL,
  item_name                 TEXT NOT NULL,
  item_sku                  TEXT NULL,
  quantity                  NUMERIC NOT NULL CHECK (quantity > 0),
  unit                      TEXT NOT NULL DEFAULT 'Nos.',
  quantity_issued           NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  quantity_used             NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_used >= 0),
  quantity_returned         NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  quantity_damaged          NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  quantity_missing          NUMERIC NOT NULL DEFAULT 0 CHECK (quantity_missing >= 0),
  discrepancy_reason        TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_items_decl ON pre_installation_backup_items(declaration_id);
CREATE INDEX IF NOT EXISTS idx_backup_items_checklist ON pre_installation_backup_items(checklist_id);

-- 4. Enable RLS
ALTER TABLE pre_installation_backup_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_installation_backup_items ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS "Service role full access to backup declarations" ON pre_installation_backup_declarations;
CREATE POLICY "Service role full access to backup declarations" ON pre_installation_backup_declarations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to backup items" ON pre_installation_backup_items;
CREATE POLICY "Service role full access to backup items" ON pre_installation_backup_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view backup declarations" ON pre_installation_backup_declarations;
CREATE POLICY "Authenticated users can view backup declarations" ON pre_installation_backup_declarations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can update backup declarations" ON pre_installation_backup_declarations;
CREATE POLICY "Authenticated users can update backup declarations" ON pre_installation_backup_declarations FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can view backup items" ON pre_installation_backup_items;
CREATE POLICY "Authenticated users can view backup items" ON pre_installation_backup_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can update backup items" ON pre_installation_backup_items;
CREATE POLICY "Authenticated users can update backup items" ON pre_installation_backup_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
