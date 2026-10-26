-- ============================================================
-- Eagle Eye SafDrive - Courier Checklist Later Assignment & Extra Device Issuance
-- Migration 055: Extra Backup Device Issuance Workflow & Ledger Movement Type
-- ============================================================

-- 1. Add issuance tracking columns to pre_installation_backup_declarations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pre_installation_backup_declarations'
      AND column_name = 'issuance_status'
  ) THEN
    ALTER TABLE public.pre_installation_backup_declarations
      ADD COLUMN issuance_status TEXT NOT NULL DEFAULT 'Pending'
      CHECK (issuance_status IN ('Pending', 'Partially Issued', 'Issued', 'Rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pre_installation_backup_declarations'
      AND column_name = 'issued_by'
  ) THEN
    ALTER TABLE public.pre_installation_backup_declarations
      ADD COLUMN issued_by UUID NULL REFERENCES public.admin_users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pre_installation_backup_declarations'
      AND column_name = 'issued_at'
  ) THEN
    ALTER TABLE public.pre_installation_backup_declarations
      ADD COLUMN issued_at TIMESTAMPTZ NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pre_installation_backup_declarations'
      AND column_name = 'issuance_history'
  ) THEN
    ALTER TABLE public.pre_installation_backup_declarations
      ADD COLUMN issuance_history JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- 2. Add extra_devices_issuance_status to store_material_requirements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'store_material_requirements'
      AND column_name = 'extra_devices_issuance_status'
  ) THEN
    ALTER TABLE public.store_material_requirements
      ADD COLUMN extra_devices_issuance_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE';
  END IF;
END $$;

-- 3. Update stock_movements movement_type CHECK constraint to include EXTRA_BACKUP_ISSUED
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (movement_type IN (
    'OPENING_STOCK',
    'STOCK_RECEIVED',
    'STOCK_ISSUED',
    'EXTRA_BACKUP_ISSUED',
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

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_backup_decl_issuance_status
  ON public.pre_installation_backup_declarations(issuance_status);
