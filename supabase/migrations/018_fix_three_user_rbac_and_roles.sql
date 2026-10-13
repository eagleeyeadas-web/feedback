-- ============================================================
-- Eagle Eye SafDrive - RBAC & Three-User Authentication Fix
-- Migration 018: Authoritative Role Constraint, Account Sync & RLS
-- ============================================================

-- 1. Drop existing outdated check constraint on admin_users table
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

-- 2. Add authoritative check constraint supporting Departmental & Admin roles
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('SALES', 'TECHNICAL', 'STORE_MANAGER', 'ADMIN', 'admin', 'sales', 'technical', 'store_manager'));

-- 3. Synchronize existing accounts with their authoritative operational roles
UPDATE admin_users SET role = 'SALES', is_active = true WHERE email = 'sales@gmail.com';
UPDATE admin_users SET role = 'TECHNICAL', is_active = true WHERE email = 'tech@gmail.com';
UPDATE admin_users SET role = 'STORE_MANAGER', is_active = true WHERE email = 'store@gmail.com';
UPDATE admin_users SET role = 'ADMIN', is_active = true WHERE email IN ('eagleeye@gmail.com', 'admin@eagleeyesafdrive.com');

-- 4. Ensure records exist in admin_users for any existing auth.users accounts
INSERT INTO admin_users (id, email, full_name, role, is_active)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', 'Sales Executive'), 'SALES', true
FROM auth.users
WHERE email = 'sales@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'SALES', is_active = true, updated_at = NOW();

INSERT INTO admin_users (id, email, full_name, role, is_active)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', 'Service Engineer'), 'TECHNICAL', true
FROM auth.users
WHERE email = 'tech@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'TECHNICAL', is_active = true, updated_at = NOW();

INSERT INTO admin_users (id, email, full_name, role, is_active)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', 'Store Manager'), 'STORE_MANAGER', true
FROM auth.users
WHERE email = 'store@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'STORE_MANAGER', is_active = true, updated_at = NOW();

-- 5. Enable Row Level Security (RLS) on admin_users
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- 6. Strict RLS Policies for admin_users
DROP POLICY IF EXISTS "Users can read own profile" ON admin_users;
CREATE POLICY "Users can read own profile"
  ON admin_users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Service role full access on admin_users" ON admin_users;
CREATE POLICY "Service role full access on admin_users"
  ON admin_users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Revoke unauthorized mutations from public and authenticated roles
REVOKE INSERT, UPDATE, DELETE ON admin_users FROM authenticated;
REVOKE ALL ON admin_users FROM anon;
GRANT SELECT ON admin_users TO authenticated;
