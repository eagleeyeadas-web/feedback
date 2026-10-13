-- ============================================================
-- Eagle Eye SafDrive - Inventory and Installation BOM Update
-- Migration 019: Camera Devices, Installation Materials, Configurable BOM with Product IDs,
--               Stock Availability, Atomic Material Issuing, and Auditable Ledger
-- ============================================================

-- 1. Create or Update INVENTORY_PRODUCTS Table (Camera Devices)
CREATE TABLE IF NOT EXISTS inventory_products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                     TEXT UNIQUE,
  device_name             TEXT NOT NULL,
  device_type             TEXT NOT NULL UNIQUE,
  unit                    TEXT NOT NULL DEFAULT 'Nos.',
  opening_quantity        INTEGER NOT NULL DEFAULT 0,
  opening_stock_set       BOOLEAN NOT NULL DEFAULT false,
  usable_stock            INTEGER NOT NULL DEFAULT 0 CHECK (usable_stock >= 0),
  reserved_stock          INTEGER NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0),
  issued_stock            INTEGER NOT NULL DEFAULT 0 CHECK (issued_stock >= 0),
  returned_usable_stock   INTEGER NOT NULL DEFAULT 0 CHECK (returned_usable_stock >= 0),
  damaged_stock           INTEGER NOT NULL DEFAULT 0 CHECK (damaged_stock >= 0),
  min_stock_level         INTEGER NOT NULL DEFAULT 5,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard 7 camera device models if not exists (opening stock defaults to 0; Store Manager enters actual opening count)
INSERT INTO inventory_products (device_name, device_type, sku, unit, usable_stock, opening_quantity, opening_stock_set, min_stock_level)
VALUES
  ('2 Channel Live Camera System', '2 Channel Live', 'EE-2CH-LIVE', 'Nos.', 0, 0, false, 5),
  ('2 Channel Recording System', '2 Channel Recording', 'EE-2CH-REC', 'Nos.', 0, 0, false, 5),
  ('4 Channel Live MDVR System', '4 Channel Live', 'EE-4CH-LIVE', 'Nos.', 0, 0, false, 5),
  ('4 Channel Recording MDVR System', '4 Channel Recording', 'EE-4CH-REC', 'Nos.', 0, 0, false, 5),
  ('6 Channel Live Telematics System', '6 Channel Live', 'EE-6CH-LIVE', 'Nos.', 0, 0, false, 5),
  ('6 Channel Recording Telematics System', '6 Channel Recording', 'EE-6CH-REC', 'Nos.', 0, 0, false, 5),
  ('8 Channel Live Enterprise System', '8 Channel Live', 'EE-8CH-LIVE', 'Nos.', 0, 0, false, 5)
ON CONFLICT (device_type) DO UPDATE SET
  sku = EXCLUDED.sku,
  unit = EXCLUDED.unit
WHERE inventory_products.sku IS NULL;


-- 2. Create or Update MATERIAL_INVENTORY Table (Installation Materials & Consumables)
CREATE TABLE IF NOT EXISTS material_inventory (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                 TEXT UNIQUE,
  material_name       TEXT NOT NULL UNIQUE,
  unit                TEXT NOT NULL,
  current_stock       NUMERIC NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  opening_stock       NUMERIC NOT NULL DEFAULT 0,
  opening_stock_set   BOOLEAN NOT NULL DEFAULT false,
  issued_stock        NUMERIC NOT NULL DEFAULT 0 CHECK (issued_stock >= 0),
  min_stock_level     NUMERIC NOT NULL DEFAULT 10 CHECK (min_stock_level >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial 9 inventory materials with exact business opening stock (DO NOT add on top if already existing!)
INSERT INTO material_inventory (material_name, sku, unit, current_stock, opening_stock, opening_stock_set, min_stock_level)
VALUES
  ('Insulation Tape', 'MAT-INSU-TAPE', 'Nos.', 100, 100, true, 20),
  ('Cable Tie – 200 mm', 'MAT-CT-200MM', 'Packets', 50, 50, true, 10),
  ('Cable Tie – 300 mm', 'MAT-CT-300MM', 'Packets', 40, 40, true, 10),
  ('Long Screw', 'MAT-SCREW-LONG', 'Nos.', 500, 500, true, 50),
  ('Small Screw', 'MAT-SCREW-SMALL', 'Nos.', 500, 500, true, 50),
  ('Memory Card', 'MAT-MEM-CARD', 'Nos.', 100, 100, true, 15),
  ('0.5 mm Wire', 'MAT-WIRE-0.5MM', 'Metres', 1000, 1000, true, 100),
  ('5-metre Cable', 'MAT-CBL-5M', 'Nos.', 150, 150, true, 25),
  ('15-metre Cable', 'MAT-CBL-15M', 'Nos.', 50, 50, true, 10)
ON CONFLICT (material_name) DO NOTHING;


-- 3. Create or Update DEVICE_BOMS Table (BOM Header per Device Type)
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

-- Seed BOM headers for all 7 standard camera models
INSERT INTO device_boms (device_type, version, is_configured, notes)
VALUES
  ('2 Channel Live', 1, true, 'Initial business-confirmed minimum required BOM configuration'),
  ('2 Channel Recording', 1, true, 'Initial business-confirmed minimum required BOM configuration'),
  ('4 Channel Live', 1, true, 'Initial business-confirmed minimum required BOM configuration'),
  ('4 Channel Recording', 1, true, 'Initial business-confirmed minimum required BOM configuration'),
  ('6 Channel Live', 1, true, 'Initial business-confirmed minimum required BOM configuration'),
  ('6 Channel Recording', 1, true, 'Initial business-confirmed minimum required BOM configuration'),
  ('8 Channel Live', 1, true, 'Initial business-confirmed minimum required BOM configuration')
ON CONFLICT (device_type) DO NOTHING;


-- 4. Create or Update BOM_ITEMS Table (Linking to MATERIAL_INVENTORY Product IDs)
CREATE TABLE IF NOT EXISTS bom_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id                UUID NOT NULL REFERENCES device_boms(id) ON DELETE CASCADE,
  material_id           UUID NULL REFERENCES material_inventory(id) ON DELETE CASCADE,
  material_name         TEXT NOT NULL,
  quantity_per_device   NUMERIC NOT NULL CHECK (quantity_per_device > 0),
  unit                  TEXT NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bom_material UNIQUE (bom_id, material_name)
);

-- Populate BOM items linked to material_inventory.id for each device type
DO $$
DECLARE
  b_rec RECORD;
  m_insulation_tape UUID;
  m_ct_200 UUID;
  m_ct_300 UUID;
  m_screw_long UUID;
  m_screw_small UUID;
  m_memory_card UUID;
  m_wire_05 UUID;
  m_cbl_5m UUID;
  m_cbl_15m UUID;
BEGIN
  SELECT id INTO m_insulation_tape FROM material_inventory WHERE material_name = 'Insulation Tape' LIMIT 1;
  SELECT id INTO m_ct_200 FROM material_inventory WHERE material_name = 'Cable Tie – 200 mm' LIMIT 1;
  SELECT id INTO m_ct_300 FROM material_inventory WHERE material_name = 'Cable Tie – 300 mm' LIMIT 1;
  SELECT id INTO m_screw_long FROM material_inventory WHERE material_name = 'Long Screw' LIMIT 1;
  SELECT id INTO m_screw_small FROM material_inventory WHERE material_name = 'Small Screw' LIMIT 1;
  SELECT id INTO m_memory_card FROM material_inventory WHERE material_name = 'Memory Card' LIMIT 1;
  SELECT id INTO m_wire_05 FROM material_inventory WHERE material_name = '0.5 mm Wire' LIMIT 1;
  SELECT id INTO m_cbl_5m FROM material_inventory WHERE material_name = '5-metre Cable' LIMIT 1;
  SELECT id INTO m_cbl_15m FROM material_inventory WHERE material_name = '15-metre Cable' LIMIT 1;

  FOR b_rec IN SELECT id, device_type FROM device_boms LOOP
    INSERT INTO bom_items (bom_id, material_id, material_name, quantity_per_device, unit, sort_order)
    VALUES
      (b_rec.id, m_insulation_tape, 'Insulation Tape', 2, 'Nos.', 1),
      (b_rec.id, m_ct_200, 'Cable Tie – 200 mm', 1, 'Packet', 2),
      (b_rec.id, m_ct_300, 'Cable Tie – 300 mm', 1, 'Packet', 3),
      (b_rec.id, m_screw_long, 'Long Screw', 12, 'Nos.', 4),
      (b_rec.id, m_screw_small, 'Small Screw', 12, 'Nos.', 5),
      (b_rec.id, m_memory_card, 'Memory Card', 1, 'No.', 6),
      (b_rec.id, m_wire_05, '0.5 mm Wire', 20, 'Metres', 7),
      (b_rec.id, m_cbl_5m, '5-metre Cable', 3, 'Nos.', 8),
      (b_rec.id, m_cbl_15m, '15-metre Cable', 1, 'No.', 9)
    ON CONFLICT (bom_id, material_name) DO UPDATE SET
      material_id = EXCLUDED.material_id,
      quantity_per_device = EXCLUDED.quantity_per_device,
      unit = EXCLUDED.unit;
  END LOOP;
END $$;


-- 5. Create Auditable Ledgers: INVENTORY_TRANSACTIONS and MATERIAL_STOCK_TRANSACTIONS
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id                UUID NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  device_type               TEXT NOT NULL,
  transaction_type          TEXT NOT NULL CHECK (transaction_type IN (
                              'OPENING_STOCK',
                              'STOCK_RECEIVED',
                              'STOCK_ISSUED',
                              'USABLE_STOCK_RETURNED',
                              'DAMAGED_STOCK_RECEIVED',
                              'DAMAGED_STOCK_DISPOSITION',
                              'STOCK_ADJUSTMENT',
                              'STOCK_REVERSAL'
                            )),
  quantity                  INTEGER NOT NULL,
  previous_balance          INTEGER NULL,
  new_balance               INTEGER NULL,
  checklist_id              UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  performed_by              UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  performer_email           TEXT NULL,
  supplier                  TEXT NULL,
  purchase_ref              TEXT NULL,
  unit_cost                 NUMERIC NULL,
  received_date             DATE NULL,
  reason_or_remarks         TEXT NULL,
  idempotency_key           TEXT NULL UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_stock_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id         UUID NOT NULL REFERENCES material_inventory(id) ON DELETE CASCADE,
  material_name       TEXT NOT NULL,
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN (
                        'OPENING_STOCK',
                        'STOCK_RECEIVED',
                        'STOCK_ISSUED',
                        'STOCK_ADJUSTMENT',
                        'STOCK_RETURN'
                      )),
  quantity            NUMERIC NOT NULL,
  previous_balance    NUMERIC NULL,
  new_balance         NUMERIC NULL,
  unit                TEXT NOT NULL,
  checklist_id        UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  performed_by        UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  performer_email     TEXT NULL,
  reason_or_remarks   TEXT NULL,
  idempotency_key     TEXT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- 6. Create or Update STORE_MATERIAL_REQUIREMENTS Table
CREATE TABLE IF NOT EXISTS store_material_requirements (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id                UUID NOT NULL UNIQUE REFERENCES installation_checklists(id) ON DELETE CASCADE,
  checklist_number            TEXT NOT NULL,
  client_name                 TEXT NOT NULL,
  client_mobile               TEXT NOT NULL,
  client_location             TEXT NOT NULL,
  google_maps_location        TEXT NULL,
  job_type                    TEXT NOT NULL CHECK (job_type IN ('Installation', 'Service')),
  device_type                 TEXT NOT NULL,
  number_of_devices           INTEGER NOT NULL DEFAULT 1,
  number_of_vehicles          INTEGER NOT NULL DEFAULT 1,
  device_configurations       JSONB NULL DEFAULT '[]'::jsonb,
  device_items                JSONB NULL DEFAULT '[]'::jsonb,
  bom_snapshot                JSONB NULL,
  material_items              JSONB NULL DEFAULT '[]'::jsonb,
  material_issuance_status    TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (material_issuance_status IN ('PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'NOT_APPLICABLE')),
  devices_issuance_status     TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (devices_issuance_status IN ('PENDING', 'PARTIALLY_ISSUED', 'ISSUED', 'NOT_APPLICABLE')),
  status                      TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                              CHECK (status IN ('PENDING_REVIEW', 'READY_FOR_ISSUANCE', 'SHORTAGE_FLAGGED', 'ISSUED', 'NOT_APPLICABLE')),
  has_shortage                BOOLEAN NOT NULL DEFAULT false,
  shortage_count              INTEGER NOT NULL DEFAULT 0,
  shortage_details            JSONB NULL,
  material_issued_at          TIMESTAMPTZ NULL,
  material_issued_by          UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  submission_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                       TEXT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Defensive ALTER TABLE statements for pre-existing tables
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS opening_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_products ADD COLUMN IF NOT EXISTS opening_stock_set BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE material_inventory ADD COLUMN IF NOT EXISTS opening_stock NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE material_inventory ADD COLUMN IF NOT EXISTS opening_stock_set BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS material_id UUID NULL REFERENCES material_inventory(id) ON DELETE CASCADE;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS previous_balance INTEGER NULL;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS new_balance INTEGER NULL;
ALTER TABLE material_stock_transactions ADD COLUMN IF NOT EXISTS previous_balance NUMERIC NULL;
ALTER TABLE material_stock_transactions ADD COLUMN IF NOT EXISTS new_balance NUMERIC NULL;
ALTER TABLE store_material_requirements ADD COLUMN IF NOT EXISTS device_items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE store_material_requirements ADD COLUMN IF NOT EXISTS devices_issuance_status TEXT DEFAULT 'PENDING';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_store_req_chk_id ON store_material_requirements(checklist_id);
CREATE INDEX IF NOT EXISTS idx_store_req_job_type ON store_material_requirements(job_type);
CREATE INDEX IF NOT EXISTS idx_store_req_issuance ON store_material_requirements(material_issuance_status);
CREATE INDEX IF NOT EXISTS idx_store_req_shortage ON store_material_requirements(has_shortage);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_material_requirements ENABLE ROW LEVEL SECURITY;

-- Service role full access
DO $$ BEGIN
  CREATE POLICY "Service role full access on inventory_products" ON inventory_products FOR ALL TO service_role USING (true) WITH CHECK (true);
  CREATE POLICY "Service role full access on material_inventory" ON material_inventory FOR ALL TO service_role USING (true) WITH CHECK (true);
  CREATE POLICY "Service role full access on device_boms" ON device_boms FOR ALL TO service_role USING (true) WITH CHECK (true);
  CREATE POLICY "Service role full access on bom_items" ON bom_items FOR ALL TO service_role USING (true) WITH CHECK (true);
  CREATE POLICY "Service role full access on inventory_transactions" ON inventory_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  CREATE POLICY "Service role full access on material_stock_transactions" ON material_stock_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
  CREATE POLICY "Service role full access on store_material_requirements" ON store_material_requirements FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated staff read access
DO $$ BEGIN
  CREATE POLICY "Staff read inventory_products" ON inventory_products FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Staff read material_inventory" ON material_inventory FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Staff read device_boms" ON device_boms FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Staff read bom_items" ON bom_items FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Staff read inventory_transactions" ON inventory_transactions FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Staff read material_stock_transactions" ON material_stock_transactions FOR SELECT TO authenticated USING (true);
  CREATE POLICY "Staff read store_material_requirements" ON store_material_requirements FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
