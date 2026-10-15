-- ============================================================
-- Eagle Eye SafDrive - Technical Installation Reports Schema
-- Migration 031: Create technical_installation_reports and report items
-- ============================================================

CREATE TABLE IF NOT EXISTS public.technical_installation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL UNIQUE REFERENCES public.installation_checklists(id) ON DELETE CASCADE,
  technician_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  devices_carried_qty INTEGER NOT NULL DEFAULT 0 CHECK (devices_carried_qty >= 0),
  devices_installed_qty INTEGER NOT NULL DEFAULT 0 CHECK (devices_installed_qty >= 0),
  devices_installed_required_qty INTEGER NOT NULL DEFAULT 0 CHECK (devices_installed_required_qty >= 0),
  devices_installed_extra_qty INTEGER NOT NULL DEFAULT 0 CHECK (devices_installed_extra_qty >= 0),
  devices_unused_qty INTEGER NOT NULL DEFAULT 0 CHECK (devices_unused_qty >= 0),
  devices_damaged_qty INTEGER NOT NULL DEFAULT 0 CHECK (devices_damaged_qty >= 0),
  devices_missing_qty INTEGER NOT NULL DEFAULT 0 CHECK (devices_missing_qty >= 0),
  extra_devices_carried_qty INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_carried_qty >= 0),
  extra_devices_installed_qty INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_installed_qty >= 0),
  extra_devices_unused_qty INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_unused_qty >= 0),
  extra_devices_damaged_qty INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_damaged_qty >= 0),
  extra_devices_missing_qty INTEGER NOT NULL DEFAULT 0 CHECK (extra_devices_missing_qty >= 0),
  completion_status TEXT NOT NULL CHECK (completion_status IN ('Completed', 'Partially Completed', 'Issues Encountered', 'Site Work Completed')),
  remarks TEXT NULL,
  material_items JSONB NULL,
  backup_items JSONB NULL,
  final_bom JSONB NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tech_reports_checklist ON public.technical_installation_reports(checklist_id);
CREATE INDEX IF NOT EXISTS idx_tech_reports_tech ON public.technical_installation_reports(technician_id);

CREATE TABLE IF NOT EXISTS public.technical_installation_report_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.technical_installation_reports(id) ON DELETE CASCADE,
  checklist_id UUID NOT NULL REFERENCES public.installation_checklists(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL,
  quantity_carried INTEGER NOT NULL DEFAULT 0 CHECK (quantity_carried >= 0),
  quantity_installed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_installed >= 0),
  quantity_to_return INTEGER NOT NULL DEFAULT 0 CHECK (quantity_to_return >= 0),
  quantity_damaged INTEGER NOT NULL DEFAULT 0 CHECK (quantity_damaged >= 0),
  quantity_missing INTEGER NOT NULL DEFAULT 0 CHECK (quantity_missing >= 0),
  discrepancy_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tech_report_items_report ON public.technical_installation_report_items(report_id);
CREATE INDEX IF NOT EXISTS idx_tech_report_items_checklist ON public.technical_installation_report_items(checklist_id);

-- Enable RLS
ALTER TABLE public.technical_installation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.technical_installation_report_items ENABLE ROW LEVEL SECURITY;

-- Policies for technical_installation_reports
DROP POLICY IF EXISTS "Service role full access to technical_installation_reports" ON public.technical_installation_reports;
CREATE POLICY "Service role full access to technical_installation_reports"
  ON public.technical_installation_reports FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read technical_installation_reports for authenticated users" ON public.technical_installation_reports;
CREATE POLICY "Allow read technical_installation_reports for authenticated users"
  ON public.technical_installation_reports FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert technical_installation_reports for authenticated users" ON public.technical_installation_reports;
CREATE POLICY "Allow insert technical_installation_reports for authenticated users"
  ON public.technical_installation_reports FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update technical_installation_reports for authenticated users" ON public.technical_installation_reports;
CREATE POLICY "Allow update technical_installation_reports for authenticated users"
  ON public.technical_installation_reports FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Policies for technical_installation_report_items
DROP POLICY IF EXISTS "Service role full access to technical_installation_report_items" ON public.technical_installation_report_items;
CREATE POLICY "Service role full access to technical_installation_report_items"
  ON public.technical_installation_report_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read technical_installation_report_items for authenticated users" ON public.technical_installation_report_items;
CREATE POLICY "Allow read technical_installation_report_items for authenticated users"
  ON public.technical_installation_report_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow insert technical_installation_report_items for authenticated users" ON public.technical_installation_report_items;
CREATE POLICY "Allow insert technical_installation_report_items for authenticated users"
  ON public.technical_installation_report_items FOR INSERT TO authenticated WITH CHECK (true);
