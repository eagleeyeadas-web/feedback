-- ============================================================
-- Eagle Eye SafDrive - Salesperson Tracking & Store Copy Schema
-- Migration 020: Salesperson Name, Store Manager copy fields
-- ============================================================

-- 1. Add salesperson_name to installation_checklists
ALTER TABLE installation_checklists 
ADD COLUMN IF NOT EXISTS salesperson_name TEXT NULL;

-- 2. Add salesperson and job assignment fields to store_material_requirements
ALTER TABLE store_material_requirements 
ADD COLUMN IF NOT EXISTS salesperson_name TEXT NULL;

ALTER TABLE store_material_requirements 
ADD COLUMN IF NOT EXISTS service_engineer TEXT NULL;

ALTER TABLE store_material_requirements 
ADD COLUMN IF NOT EXISTS service_assistant TEXT NULL;

ALTER TABLE store_material_requirements 
ADD COLUMN IF NOT EXISTS expected_arrival_date TEXT NULL;

ALTER TABLE store_material_requirements 
ADD COLUMN IF NOT EXISTS expected_arrival_time TEXT NULL;

ALTER TABLE store_material_requirements 
ADD COLUMN IF NOT EXISTS installation_duration TEXT NULL;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_chk_salesperson ON installation_checklists(salesperson_name);
CREATE INDEX IF NOT EXISTS idx_store_req_salesperson ON store_material_requirements(salesperson_name);
