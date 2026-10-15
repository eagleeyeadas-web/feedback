-- ============================================================
-- Eagle Eye SafDrive - Add Split Columns to Report Items
-- Migration 036: Add quantity_installed_required and quantity_installed_extra
--               to technical_installation_report_items
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'technical_installation_report_items'
  ) THEN
    ALTER TABLE public.technical_installation_report_items
      ADD COLUMN IF NOT EXISTS quantity_installed_required INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS quantity_installed_extra INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
