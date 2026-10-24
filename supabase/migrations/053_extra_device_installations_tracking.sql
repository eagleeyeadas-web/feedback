-- ============================================================
-- Eagle Eye SafDrive - Extra Device Installations Tracking
-- Migration 053: Persistent tracking of extra loose device & material
--                installations for other customers or original customer.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.additional_customer_installations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id                UUID NOT NULL REFERENCES public.installation_checklists(id) ON DELETE CASCADE,
  checklist_number            TEXT NULL,
  original_customer_name      TEXT NOT NULL,
  submitting_user_id          UUID NULL REFERENCES public.admin_users(id) ON DELETE SET NULL,
  technician_id               UUID NULL REFERENCES public.admin_users(id) ON DELETE SET NULL,
  technician_name             TEXT NULL,
  recipient_customer_type     TEXT NOT NULL CHECK (recipient_customer_type IN ('SAME_CUSTOMER', 'ANOTHER_CUSTOMER')),
  recipient_customer_name     TEXT NOT NULL,
  recipient_mobile            TEXT NULL,
  installation_location       TEXT NULL,
  maps_link                   TEXT NULL,
  installation_date           DATE NOT NULL,
  device_configuration        TEXT NULL,
  components_used             JSONB NOT NULL DEFAULT '[]'::jsonb,
  materials_used              JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                       TEXT NULL,
  recipient_checklist_id      UUID NULL REFERENCES public.installation_checklists(id) ON DELETE SET NULL,
  recipient_checklist_number  TEXT NULL,
  status                      TEXT NOT NULL DEFAULT 'COMPLETED',
  report_id                   UUID NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_add_cust_inst_checklist ON public.additional_customer_installations(checklist_id);
CREATE INDEX IF NOT EXISTS idx_add_cust_inst_recipient_chk ON public.additional_customer_installations(recipient_checklist_id);
CREATE INDEX IF NOT EXISTS idx_add_cust_inst_tech ON public.additional_customer_installations(technician_id);
CREATE INDEX IF NOT EXISTS idx_add_cust_inst_date ON public.additional_customer_installations(installation_date);
CREATE INDEX IF NOT EXISTS idx_add_cust_inst_recipient_type ON public.additional_customer_installations(recipient_customer_type);

-- Row Level Security
ALTER TABLE public.additional_customer_installations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'additional_customer_installations' AND policyname = 'add_cust_inst_select_policy'
  ) THEN
    CREATE POLICY add_cust_inst_select_policy ON public.additional_customer_installations
      FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'additional_customer_installations' AND policyname = 'add_cust_inst_all_policy'
  ) THEN
    CREATE POLICY add_cust_inst_all_policy ON public.additional_customer_installations
      FOR ALL USING (true);
  END IF;
END $$;
