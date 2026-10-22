-- Migration 049: Fix Technician Expenses Authorization & Row Level Security Policies
-- Ensures technician expenses are strictly private to the authorized technician and administrators.
-- Sales, Coordinator, Store Manager, and unassigned users are forbidden from viewing or modifying expenses.

-- 1. Ensure RLS is enabled on job_expenses
ALTER TABLE public.job_expenses ENABLE ROW LEVEL SECURITY;

-- 2. Drop legacy permissive policies
DROP POLICY IF EXISTS "Allow read job_expenses for authenticated users" ON public.job_expenses;
DROP POLICY IF EXISTS "Allow insert job_expenses for technical users" ON public.job_expenses;
DROP POLICY IF EXISTS "Allow update job_expenses" ON public.job_expenses;
DROP POLICY IF EXISTS "Allow delete job_expenses" ON public.job_expenses;
DROP POLICY IF EXISTS "Strict read job_expenses" ON public.job_expenses;
DROP POLICY IF EXISTS "Strict insert job_expenses" ON public.job_expenses;
DROP POLICY IF EXISTS "Strict update job_expenses" ON public.job_expenses;
DROP POLICY IF EXISTS "Strict delete job_expenses" ON public.job_expenses;

-- 3. Authoritative SELECT Policy: Private to the assigned technician & system administrators
CREATE POLICY "Strict read job_expenses"
  ON public.job_expenses
  FOR SELECT
  TO authenticated
  USING (
    -- Admins have full oversight
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.role IN ('ADMIN', 'SUPER_ADMIN', 'admin', 'super_admin')
        AND admin_users.is_active = true
    )
    OR
    -- Direct owner who recorded the expense
    technician_id = auth.uid()
    OR
    -- Staff technician user
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.email = 'tech@gmail.com'
        AND admin_users.is_active = true
    )
    OR
    -- Assigned service engineer on the associated installation checklist
    EXISTS (
      SELECT 1 FROM public.installation_checklists ic
      WHERE ic.id = job_expenses.checklist_id
        AND (
          ic.service_engineer_id IN (
            SELECT se.id FROM public.service_engineers se WHERE se.email = auth.jwt() ->> 'email'
          )
          OR ic.service_engineer IN (
            SELECT au.full_name FROM public.admin_users au WHERE au.id = auth.uid()
          )
        )
    )
  );

-- 4. Authoritative INSERT Policy: Only authorized technical staff and administrators
CREATE POLICY "Strict insert job_expenses"
  ON public.job_expenses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.role IN ('ADMIN', 'SUPER_ADMIN', 'TECHNICAL', 'admin', 'super_admin', 'technical')
        AND admin_users.is_active = true
    )
  );

-- 5. Authoritative UPDATE Policy: Only the expense creator or administrator
CREATE POLICY "Strict update job_expenses"
  ON public.job_expenses
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.role IN ('ADMIN', 'SUPER_ADMIN', 'admin', 'super_admin')
        AND admin_users.is_active = true
    )
    OR technician_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.email = 'tech@gmail.com'
        AND admin_users.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.role IN ('ADMIN', 'SUPER_ADMIN', 'admin', 'super_admin')
        AND admin_users.is_active = true
    )
    OR technician_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.email = 'tech@gmail.com'
        AND admin_users.is_active = true
    )
  );

-- 6. Authoritative DELETE Policy: Only the expense creator or administrator
CREATE POLICY "Strict delete job_expenses"
  ON public.job_expenses
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.role IN ('ADMIN', 'SUPER_ADMIN', 'admin', 'super_admin')
        AND admin_users.is_active = true
    )
    OR technician_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.admin_users
      WHERE admin_users.id = auth.uid()
        AND admin_users.email = 'tech@gmail.com'
        AND admin_users.is_active = true
    )
  );
