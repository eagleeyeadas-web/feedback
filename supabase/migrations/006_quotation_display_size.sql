-- ============================================================
-- Eagle Eye SafDrive - Quotation Display Size Migration
-- ============================================================

-- Add display_size column to quotations table if not already present
ALTER TABLE quotations 
ADD COLUMN IF NOT EXISTS display_size TEXT DEFAULT '10-inch';

-- Update existing records to default '10-inch' if null
UPDATE quotations 
SET display_size = '10-inch' 
WHERE display_size IS NULL;
