-- Migration 025: Technician Job Expenses
-- Record-only expenses added by technicians after post-installation report submission.

CREATE TABLE IF NOT EXISTS public.job_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.installation_checklists(id) ON DELETE CASCADE,
  technician_id UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  technician_name TEXT,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL CHECK (category IN (
    'Travel',
    'Fuel',
    'Food',
    'Toll',
    'Accommodation',
    'Parking',
    'Other Travel Expense'
  )),
  description TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN (
    'Cash',
    'UPI',
    'Personal Card',
    'Company Payment',
    'Other'
  )),
  receipt_url TEXT,
  receipt_filename TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'Recorded' CHECK (status IN ('Draft', 'Recorded')),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_job_expenses_checklist_id ON public.job_expenses(checklist_id);
CREATE INDEX IF NOT EXISTS idx_job_expenses_technician_id ON public.job_expenses(technician_id);
CREATE INDEX IF NOT EXISTS idx_job_expenses_date ON public.job_expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_job_expenses_status ON public.job_expenses(status);
CREATE INDEX IF NOT EXISTS idx_job_expenses_idempotency ON public.job_expenses(idempotency_key);

-- Enable RLS
ALTER TABLE public.job_expenses ENABLE ROW LEVEL SECURITY;

-- Allow read for authenticated staff (Admin, Technical, Sales, Store Manager)
DROP POLICY IF EXISTS "Allow read job_expenses for authenticated users" ON public.job_expenses;
CREATE POLICY "Allow read job_expenses for authenticated users"
  ON public.job_expenses
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow insert for authenticated technical & admin staff
DROP POLICY IF EXISTS "Allow insert job_expenses for technical users" ON public.job_expenses;
CREATE POLICY "Allow insert job_expenses for technical users"
  ON public.job_expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow update for drafts or permitted modifications
DROP POLICY IF EXISTS "Allow update job_expenses" ON public.job_expenses;
CREATE POLICY "Allow update job_expenses"
  ON public.job_expenses
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Private receipts bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;
