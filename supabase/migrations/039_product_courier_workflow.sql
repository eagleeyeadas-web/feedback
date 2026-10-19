-- ============================================================
-- Eagle Eye SafDrive - Product Courier Workflow Migration
-- Migration 039: Product Couriered Delivery Method, Courier Dispatches,
--                Stock Issuance Ledger, and Multi-Stage Lifecycle
-- ============================================================

-- 1. Enhance INSTALLATION_CHECKLISTS with Delivery Method and Courier Status
ALTER TABLE installation_checklists
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'Technician Carries',
  ADD COLUMN IF NOT EXISTS courier_dispatch_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS is_courier_dispatched BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS courier_dispatch_id UUID NULL;

-- Make scheduling and technician columns nullable so couriered checklists can be created prior to scheduling
ALTER TABLE installation_checklists ALTER COLUMN expected_arrival_date DROP NOT NULL;
ALTER TABLE installation_checklists ALTER COLUMN expected_arrival_time DROP NOT NULL;
ALTER TABLE installation_checklists ALTER COLUMN service_engineer DROP NOT NULL;

-- Update delivery_method constraint
ALTER TABLE installation_checklists DROP CONSTRAINT IF EXISTS installation_checklists_delivery_method_check;
ALTER TABLE installation_checklists ADD CONSTRAINT installation_checklists_delivery_method_check
  CHECK (delivery_method IN ('Technician Carries', 'Product Couriered'));

-- Update installation_status constraint to support courier lifecycle stages
ALTER TABLE installation_checklists DROP CONSTRAINT IF EXISTS installation_checklists_installation_status_check;
ALTER TABLE installation_checklists ADD CONSTRAINT installation_checklists_installation_status_check
  CHECK (installation_status IN (
    'Pending',
    'Assigned',
    'In Progress',
    'Completed',
    'Cancelled',
    'Awaiting Technician Assignment',
    'Awaiting Schedule',
    'Ready for Installation',
    'Courier Pending',
    'Site Work Completed'
  ));

CREATE INDEX IF NOT EXISTS idx_inst_delivery_method ON installation_checklists (delivery_method);
CREATE INDEX IF NOT EXISTS idx_inst_courier_dispatch_status ON installation_checklists (courier_dispatch_status);


-- 2. Enhance STORE_MATERIAL_REQUIREMENTS with Delivery Method and Courier Status
ALTER TABLE store_material_requirements
  ADD COLUMN IF NOT EXISTS delivery_method TEXT NOT NULL DEFAULT 'Technician Carries',
  ADD COLUMN IF NOT EXISTS courier_dispatch_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN IF NOT EXISTS is_courier_dispatched BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_store_req_delivery_method ON store_material_requirements (delivery_method);
CREATE INDEX IF NOT EXISTS idx_store_req_courier_status ON store_material_requirements (courier_dispatch_status);


-- 3. Update STOCK_MOVEMENTS to support courier dispatch and returns
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'OPENING_STOCK',
    'STOCK_RECEIVED',
    'STOCK_ISSUED',
    'USABLE_STOCK_RETURNED',
    'DAMAGED_STOCK_RECEIVED',
    'DAMAGED_STOCK_DISPOSITION',
    'STOCK_ADJUSTMENT',
    'STOCK_REVERSAL',
    'RETURNED_USABLE',
    'RETURNED_DAMAGED',
    'COURIER_DISPATCH',
    'COURIER_RETURN',
    'COURIER_EXCEPTION'
  ));


-- 4. Create COURIER_DISPATCHES Table
CREATE TABLE IF NOT EXISTS courier_dispatches (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id                UUID NOT NULL REFERENCES installation_checklists(id) ON DELETE CASCADE,
  checklist_number            TEXT NOT NULL,
  client_name                 TEXT NOT NULL,
  client_mobile               TEXT NULL,
  client_location             TEXT NULL,
  job_type                    TEXT NOT NULL DEFAULT 'Installation' CHECK (job_type IN ('Installation', 'Service')),
  courier_company             TEXT NOT NULL,
  tracking_number             TEXT NOT NULL,
  dispatch_date               DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery_date      DATE NULL,
  actual_delivery_date        TIMESTAMPTZ NULL,
  delivery_status             TEXT NOT NULL DEFAULT 'Dispatched'
                              CHECK (delivery_status IN (
                                'Not Dispatched',
                                'Dispatched',
                                'In Transit',
                                'Delivered',
                                'Delivery Exception',
                                'Cancelled'
                              )),
  dispatched_by               UUID NULL,
  dispatched_by_name          TEXT NULL,
  delivery_notes              TEXT NULL,
  delivery_confirmation_details JSONB NULL,
  dispatched_items            JSONB NOT NULL DEFAULT '[]'::jsonb,
  exception_reason            TEXT NULL,
  exception_date              TIMESTAMPTZ NULL,
  returned_to_store           BOOLEAN NOT NULL DEFAULT false,
  returned_items              JSONB NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courier_dispatches_checklist ON courier_dispatches(checklist_id);
CREATE INDEX IF NOT EXISTS idx_courier_dispatches_number ON courier_dispatches(checklist_number);
CREATE INDEX IF NOT EXISTS idx_courier_dispatches_status ON courier_dispatches(delivery_status);
CREATE INDEX IF NOT EXISTS idx_courier_dispatches_tracking ON courier_dispatches(tracking_number);
CREATE INDEX IF NOT EXISTS idx_courier_dispatches_created ON courier_dispatches(created_at DESC);


-- 5. Row Level Security Policies
ALTER TABLE courier_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to courier_dispatches" ON courier_dispatches;
CREATE POLICY "Service role full access to courier_dispatches"
  ON courier_dispatches FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated staff read courier_dispatches" ON courier_dispatches;
CREATE POLICY "Authenticated staff read courier_dispatches"
  ON courier_dispatches FOR SELECT
  TO authenticated
  USING (true);
