-- ============================================================
-- Eagle Eye SafDrive - Bill of Materials (BOM) Management System
-- Migration 015: Configurable BOM by Device Type, Checklists Snapshot, and Material Stock Issuance
-- ============================================================

-- 1. Create DEVICE_BOMS Table (Configurable BOM header per device type)
CREATE TABLE IF NOT EXISTS device_boms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_type     TEXT NOT NULL UNIQUE,
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_configured   BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT NULL,
  created_by      UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  updated_by      UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on device_type for instant lookups
CREATE INDEX IF NOT EXISTS idx_device_boms_type ON device_boms(device_type);

-- 2. Create BOM_ITEMS Table (Per-device minimum material requirements)
CREATE TABLE IF NOT EXISTS bom_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id                UUID NOT NULL REFERENCES device_boms(id) ON DELETE CASCADE,
  material_name         TEXT NOT NULL,
  quantity_per_device   NUMERIC NOT NULL CHECK (quantity_per_device > 0),
  unit                  TEXT NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bom_material UNIQUE (bom_id, material_name)
);

CREATE INDEX IF NOT EXISTS idx_bom_items_bom_id ON bom_items(bom_id);

-- 3. Create MATERIAL_INVENTORY Table (Consumables & installation materials stock)
CREATE TABLE IF NOT EXISTS material_inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_name       TEXT NOT NULL UNIQUE,
  unit                TEXT NOT NULL,
  current_stock       NUMERIC NOT NULL DEFAULT 500 CHECK (current_stock >= 0),
  issued_stock        NUMERIC NOT NULL DEFAULT 0 CHECK (issued_stock >= 0),
  min_stock_level     NUMERIC NOT NULL DEFAULT 20 CHECK (min_stock_level >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_material_inv_name ON material_inventory(material_name);

-- 4. Create MATERIAL_STOCK_TRANSACTIONS Table (Auditable material movements)
CREATE TABLE IF NOT EXISTS material_stock_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id         UUID NOT NULL REFERENCES material_inventory(id) ON DELETE CASCADE,
  material_name       TEXT NOT NULL,
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN ('OPENING_STOCK', 'STOCK_RECEIVED', 'STOCK_ISSUED', 'STOCK_ADJUSTMENT')),
  quantity            NUMERIC NOT NULL,
  unit                TEXT NOT NULL,
  checklist_id        UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  performed_by        UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  reason_or_remarks   TEXT NULL,
  idempotency_key     TEXT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mat_tx_material_id ON material_stock_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_mat_tx_checklist_id ON material_stock_transactions(checklist_id);
CREATE INDEX IF NOT EXISTS idx_mat_tx_created ON material_stock_transactions(created_at DESC);

-- 5. Add BOM Snapshot and Material Issuance columns to INSTALLATION_CHECKLISTS
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS bom_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS material_issuance_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (material_issuance_status IN ('PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'NOT_APPLICABLE')),
  ADD COLUMN IF NOT EXISTS material_issued_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS material_issued_by UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inst_material_issuance ON installation_checklists(material_issuance_status);

-- 6. Trigger for updated_at timestamps
DO $$ BEGIN
  CREATE TRIGGER update_device_boms_updated_at
    BEFORE UPDATE ON device_boms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_bom_items_updated_at
    BEFORE UPDATE ON bom_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_material_inventory_updated_at
    BEFORE UPDATE ON material_inventory
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 7. Seed Initial Materials into MATERIAL_INVENTORY
INSERT INTO material_inventory (material_name, unit, current_stock, min_stock_level)
VALUES
  ('Insulation Tape', 'Nos.', 500, 20),
  ('Cable Tie – 200 mm', 'Packet', 500, 20),
  ('Cable Tie – 300 mm', 'Packet', 500, 20),
  ('Screw (Long)', 'Nos.', 2000, 100),
  ('Screw (Small)', 'Nos.', 2000, 100),
  ('Memory Card', 'No.', 300, 15),
  ('0.5 mm wire', 'Metres', 5000, 200),
  ('5-metre Cable', 'Nos.', 500, 25),
  ('15-metre Cable', 'No.', 300, 15)
ON CONFLICT (material_name) DO NOTHING;

-- 8. Seed Confirmed 7 Device Types into DEVICE_BOMS
INSERT INTO device_boms (device_type, version, is_configured, notes)
VALUES
  ('2 Channel Live', 1, true, 'Default business-confirmed minimum required BOM configuration'),
  ('2 Channel Recording', 1, true, 'Default business-confirmed minimum required BOM configuration'),
  ('4 Channel Live', 1, true, 'Default business-confirmed minimum required BOM configuration'),
  ('4 Channel Recording', 1, true, 'Default business-confirmed minimum required BOM configuration'),
  ('6 Channel Live', 1, true, 'Default business-confirmed minimum required BOM configuration'),
  ('6 Channel Recording', 1, true, 'Default business-confirmed minimum required BOM configuration'),
  ('8 Channel Live', 1, true, 'Default business-confirmed minimum required BOM configuration')
ON CONFLICT (device_type) DO NOTHING;

-- 9. Seed Per-Device BOM Items for each device type
DO $$
DECLARE
  b_rec RECORD;
BEGIN
  FOR b_rec IN SELECT id, device_type FROM device_boms LOOP
    INSERT INTO bom_items (bom_id, material_name, quantity_per_device, unit, sort_order)
    VALUES
      (b_rec.id, 'Insulation Tape', 2, 'Nos.', 1),
      (b_rec.id, 'Cable Tie – 200 mm', 1, 'Packet', 2),
      (b_rec.id, 'Cable Tie – 300 mm', 1, 'Packet', 3),
      (b_rec.id, 'Screw (Long)', 12, 'Nos.', 4),
      (b_rec.id, 'Screw (Small)', 12, 'Nos.', 5),
      (b_rec.id, 'Memory Card', 1, 'No.', 6),
      (b_rec.id, '0.5 mm wire', 20, 'Metres', 7),
      (b_rec.id, '5-metre Cable', 3, 'Nos.', 8),
      (b_rec.id, '15-metre Cable', 1, 'No.', 9)
    ON CONFLICT (bom_id, material_name) DO NOTHING;
  END LOOP;
END $$;

-- 10. Enable Row Level Security (RLS)
ALTER TABLE device_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_stock_transactions ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access
DO $$ BEGIN
  CREATE POLICY "Service role full access to device_boms" ON device_boms FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to bom_items" ON bom_items FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to material_inventory" ON material_inventory FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Service role full access to material_stock_transactions" ON material_stock_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated read access for staff
DO $$ BEGIN
  CREATE POLICY "Staff can view device_boms" ON device_boms FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view bom_items" ON bom_items FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view material_inventory" ON material_inventory FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff can view material_stock_transactions" ON material_stock_transactions FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
