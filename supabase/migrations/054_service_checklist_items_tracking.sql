-- ============================================================
-- Eagle Eye SafDrive - Service Checklist & Stock Issuance Tracking
-- Migration 054: Add service_items to installation_checklists and
--                store_material_requirements for dedicated service parts tracking.
-- ============================================================

-- 1. Add service_items column to installation_checklists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'installation_checklists'
      AND column_name = 'service_items'
  ) THEN
    ALTER TABLE public.installation_checklists
      ADD COLUMN service_items JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- 2. Add service_items column to store_material_requirements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'store_material_requirements'
      AND column_name = 'service_items'
  ) THEN
    ALTER TABLE public.store_material_requirements
      ADD COLUMN service_items JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_inst_chk_job_type ON public.installation_checklists(installation_or_service);
CREATE INDEX IF NOT EXISTS idx_store_req_job_type ON public.store_material_requirements(job_type);

-- 4. Update stock_movements check constraint to include SERVICE_DEVICE_ISSUED and SERVICE_MATERIAL_ISSUED
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'OPENING_STOCK',
    'STOCK_RECEIVED',
    'STOCK_ISSUED',
    'SERVICE_DEVICE_ISSUED',
    'SERVICE_MATERIAL_ISSUED',
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
