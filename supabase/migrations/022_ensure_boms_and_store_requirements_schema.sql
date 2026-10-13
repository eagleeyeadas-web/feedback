-- ============================================================
-- Eagle Eye SafDrive - Comprehensive BOM & Store Requirements Schema
-- Migration 022: Idempotent creation of device_boms, bom_items,
--                material_inventory, inventory_products, store_material_requirements,
--                and installation_checklists enhancement columns.
-- ============================================================

-- 1. Ensure installation_checklists has all required workflow columns
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS device_configurations JSONB NULL,
  ADD COLUMN IF NOT EXISTS bom_snapshot JSONB NULL,
  ADD COLUMN IF NOT EXISTS salesperson_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS material_issuance_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS service_engineer_id UUID NULL,
  ADD COLUMN IF NOT EXISTS booking_end_date TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_inst_device_configurations ON installation_checklists USING GIN (device_configurations);
CREATE INDEX IF NOT EXISTS idx_inst_salesperson ON installation_checklists (salesperson_name);
CREATE INDEX IF NOT EXISTS idx_inst_issuance_status ON installation_checklists (material_issuance_status);

-- 2. Create or Update INVENTORY_PRODUCTS Table (Camera Devices)
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

-- Seed standard 7 camera device models if not exists
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

-- 3. Create or Update MATERIAL_INVENTORY Table (Installation Materials & Consumables)
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

-- 4. Create or Update DEVICE_BOMS Table (BOM Header per Device Type)
CREATE TABLE IF NOT EXISTS device_boms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_type     TEXT NOT NULL UNIQUE,
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_configured   BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT NULL,
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

-- 5. Create or Update BOM_ITEMS Table (Linking to MATERIAL_INVENTORY Product IDs)
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
      (b_rec.id, m_ct_200, 'Cable Tie – 200 mm', 1, 'Packets', 2),
      (b_rec.id, m_ct_300, 'Cable Tie – 300 mm', 1, 'Packets', 3),
      (b_rec.id, m_screw_long, 'Long Screw', 12, 'Nos.', 4),
      (b_rec.id, m_screw_small, 'Small Screw', 12, 'Nos.', 5),
      (b_rec.id, m_wire_05, '0.5 mm Wire', 20, 'Metres', 7),
      (b_rec.id, m_cbl_5m, '5-metre Cable', 3, 'Nos.', 8),
      (b_rec.id, m_cbl_15m, '15-metre Cable', 1, 'Nos.', 9)
    ON CONFLICT (bom_id, material_name) DO UPDATE SET
      material_id = EXCLUDED.material_id,
      quantity_per_device = EXCLUDED.quantity_per_device,
      unit = EXCLUDED.unit;

    -- Add Memory Card for all models EXCEPT 8 Channel Live
    IF b_rec.device_type != '8 Channel Live' THEN
      INSERT INTO bom_items (bom_id, material_id, material_name, quantity_per_device, unit, sort_order)
      VALUES (b_rec.id, m_memory_card, 'Memory Card', 1, 'Nos.', 6)
      ON CONFLICT (bom_id, material_name) DO UPDATE SET
        material_id = EXCLUDED.material_id,
        quantity_per_device = EXCLUDED.quantity_per_device,
        unit = EXCLUDED.unit;
    ELSE
      -- Ensure 8 Channel Live does NOT have Memory Card
      DELETE FROM bom_items WHERE bom_id = b_rec.id AND material_name ILIKE '%memory card%';
    END IF;
  END LOOP;
END $$;

-- 6. Create STORE_MATERIAL_REQUIREMENTS Table
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
  device_items              JSONB NOT NULL DEFAULT '[]'::jsonb,
  bom_snapshot              JSONB NULL,
  material_items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  material_issuance_status  TEXT NOT NULL DEFAULT 'PENDING',
  devices_issuance_status   TEXT NOT NULL DEFAULT 'PENDING',
  status                    TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  has_shortage              BOOLEAN NOT NULL DEFAULT false,
  shortage_count            INTEGER NOT NULL DEFAULT 0,
  shortage_details          JSONB NULL,
  material_issued_at        TIMESTAMPTZ NULL,
  material_issued_by        UUID NULL,
  salesperson_name          TEXT NULL,
  service_engineer          TEXT NULL,
  service_assistant         TEXT NULL,
  expected_arrival_date     DATE NULL,
  expected_arrival_time     TEXT NULL,
  installation_duration     TEXT NULL,
  submission_date           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes                     TEXT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_store_req_checklist UNIQUE (checklist_id)
);

CREATE INDEX IF NOT EXISTS idx_store_req_checklist_id ON store_material_requirements(checklist_id);
CREATE INDEX IF NOT EXISTS idx_store_req_number ON store_material_requirements(checklist_number);
CREATE INDEX IF NOT EXISTS idx_store_req_job_type ON store_material_requirements(job_type);
CREATE INDEX IF NOT EXISTS idx_store_req_status ON store_material_requirements(status);
