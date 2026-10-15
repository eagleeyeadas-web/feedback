-- ============================================================
-- Eagle Eye SafDrive - Job Device Carry Tables
-- Migration 033: Create job_device_carry_records and job_device_carry_items
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_device_carry_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.installation_checklists(id) ON DELETE CASCADE,
  technician_user_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  technician_name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'AUDITED', 'DISCREPANCY')),
  remarks TEXT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carry_records_checklist ON public.job_device_carry_records(checklist_id);
CREATE INDEX IF NOT EXISTS idx_carry_records_tech ON public.job_device_carry_records(technician_user_id);

CREATE TABLE IF NOT EXISTS public.job_device_carry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carry_record_id UUID NOT NULL REFERENCES public.job_device_carry_records(id) ON DELETE CASCADE,
  checklist_id UUID NOT NULL REFERENCES public.installation_checklists(id) ON DELETE CASCADE,
  device_type TEXT NOT NULL,
  quantity_issued INTEGER NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  quantity_carried INTEGER NOT NULL DEFAULT 0 CHECK (quantity_carried >= 0),
  discrepancy_quantity INTEGER NOT NULL DEFAULT 0,
  discrepancy_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carry_items_record ON public.job_device_carry_items(carry_record_id);
CREATE INDEX IF NOT EXISTS idx_carry_items_checklist ON public.job_device_carry_items(checklist_id);

-- Enable RLS
ALTER TABLE public.job_device_carry_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_device_carry_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to job_device_carry_records" ON public.job_device_carry_records;
CREATE POLICY "Service role full access to job_device_carry_records"
  ON public.job_device_carry_records FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access to job_device_carry_items" ON public.job_device_carry_items;
CREATE POLICY "Service role full access to job_device_carry_items"
  ON public.job_device_carry_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow read carry records for authenticated" ON public.job_device_carry_records;
CREATE POLICY "Allow read carry records for authenticated"
  ON public.job_device_carry_records FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read carry items for authenticated" ON public.job_device_carry_items;
CREATE POLICY "Allow read carry items for authenticated"
  ON public.job_device_carry_items FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
