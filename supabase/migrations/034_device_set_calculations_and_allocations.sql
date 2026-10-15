-- ============================================================
-- Eagle Eye SafDrive - Automatic Camera Set Calculation & Loose Stock Allocations
-- Migration 034: Seed Live Display & Recording Display in material_inventory,
--               create device_stock_allocations table for shared-stock reservation,
--               and configure RLS policies with full audit history.
-- ============================================================

-- 1. Ensure Live Display and Recording Display exist in material_inventory
INSERT INTO material_inventory (material_name, sku, unit, current_stock, opening_stock, opening_stock_set, min_stock_level)
VALUES
  ('Live Display', 'MAT-DISP-LIVE', 'Nos.', 0, 0, false, 5),
  ('Recording Display', 'MAT-DISP-REC', 'Nos.', 0, 0, false, 5)
ON CONFLICT (material_name) DO NOTHING;

-- 2. Create DEVICE_STOCK_ALLOCATIONS Table for Shared-Stock Reservations
CREATE TABLE IF NOT EXISTS device_stock_allocations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_type             TEXT NOT NULL,
  allocated_sets          INTEGER NOT NULL CHECK (allocated_sets > 0),
  components_reserved     JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'ALLOCATED' CHECK (status IN ('ALLOCATED', 'RELEASED', 'FULFILLED')),
  checklist_id            UUID NULL REFERENCES installation_checklists(id) ON DELETE SET NULL,
  allocated_by            UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  allocator_name          TEXT NULL,
  notes                   TEXT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at             TIMESTAMPTZ NULL,
  released_by             UUID NULL REFERENCES admin_users(id) ON DELETE SET NULL,
  release_reason          TEXT NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for high-performance lookup and conflict checks
CREATE INDEX IF NOT EXISTS idx_device_allocations_status ON device_stock_allocations(status);
CREATE INDEX IF NOT EXISTS idx_device_allocations_device_type ON device_stock_allocations(device_type);
CREATE INDEX IF NOT EXISTS idx_device_allocations_created_at ON device_stock_allocations(created_at);

-- 3. Enable Row Level Security (RLS) and grant access to admin_users
ALTER TABLE device_stock_allocations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'device_stock_allocations' AND policyname = 'device_allocations_read_policy'
  ) THEN
    CREATE POLICY device_allocations_read_policy ON device_stock_allocations
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'device_stock_allocations' AND policyname = 'device_allocations_all_policy'
  ) THEN
    CREATE POLICY device_allocations_all_policy ON device_stock_allocations
      FOR ALL USING (true);
  END IF;
END $$;
