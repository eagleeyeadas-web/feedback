-- ============================================================
-- Eagle Eye SafDrive - Update Service Engineers & Remove Assistant
-- Migration 026: Single Service Engineer (Mathi, Guna, Sakthivel, Kamalesh)
-- ============================================================

-- 1. Ensure service_assistant in installation_checklists is optional/nullable
ALTER TABLE installation_checklists
  ALTER COLUMN service_assistant DROP NOT NULL;

-- 2. Upsert the four authorized service engineers preserving existing primary keys
INSERT INTO service_engineers (id, name, role, email, is_active)
VALUES
  ('e1000000-0000-0000-0000-000000000001', 'Mathi', 'Service Engineer', 'mathi@eagleeyesafdrive.com', true)
ON CONFLICT (name) DO UPDATE
SET role = 'Service Engineer', is_active = true, updated_at = NOW();

INSERT INTO service_engineers (id, name, role, email, is_active)
VALUES
  ('e1000000-0000-0000-0000-000000000002', 'Kamalesh', 'Service Engineer', 'kamalesh@eagleeyesafdrive.com', true)
ON CONFLICT (name) DO UPDATE
SET role = 'Service Engineer', is_active = true, updated_at = NOW();

INSERT INTO service_engineers (id, name, role, email, is_active)
VALUES
  ('e1000000-0000-0000-0000-000000000004', 'Sakthivel', 'Service Engineer', 'sakthivel@eagleeyesafdrive.com', true)
ON CONFLICT (name) DO UPDATE
SET role = 'Service Engineer', is_active = true, updated_at = NOW();

INSERT INTO service_engineers (id, name, role, email, is_active)
VALUES
  ('e1000000-0000-0000-0000-000000000006', 'Guna', 'Service Engineer', 'guna@eagleeyesafdrive.com', true)
ON CONFLICT (name) DO UPDATE
SET role = 'Service Engineer', is_active = true, updated_at = NOW();

-- 3. Deactivate any non-authorized engineers so only the 4 active engineers are queryable
UPDATE service_engineers
SET
  is_active = false,
  updated_at = NOW()
WHERE name NOT IN ('Mathi', 'Guna', 'Sakthivel', 'Kamalesh');
