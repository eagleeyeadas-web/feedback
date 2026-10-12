-- ============================================================
-- Eagle Eye SafDrive - RBAC & Role Constraint Fix
-- Migration 014: Update admin_users role constraint and synchronize role records
-- ============================================================

-- 1. Drop outdated role check constraint on admin_users table
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;

-- 2. Add updated check constraint supporting operational & admin roles
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check
  CHECK (role IN ('ADMIN', 'SALES', 'TECHNICAL', 'STORE_MANAGER', 'SUPER_ADMIN', 'admin', 'super_admin'));

-- 3. Synchronize existing accounts with their authoritative operational roles
UPDATE admin_users SET role = 'SALES' WHERE email = 'sales@gmail.com';
UPDATE admin_users SET role = 'TECHNICAL' WHERE email = 'tech@gmail.com';
UPDATE admin_users SET role = 'STORE_MANAGER' WHERE email = 'store@gmail.com';
UPDATE admin_users SET role = 'SUPER_ADMIN' WHERE email = 'eagleeye@gmail.com';
UPDATE admin_users SET role = 'ADMIN' WHERE email = 'admin@eagleeyesafdrive.com';

-- 4. Enable Row Level Security (RLS) on all core operational tables
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE installation_checklists ENABLE ROW LEVEL SECURITY;

-- 5. Strict RLS Policies for admin_users
DROP POLICY IF EXISTS "Authenticated users can read their own profile" ON admin_users;
CREATE POLICY "Authenticated users can read their own profile"
  ON admin_users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Service role has full management on admin_users" ON admin_users;
CREATE POLICY "Service role has full management on admin_users"
  ON admin_users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
