-- ============================================================================
-- Migration 021: Exclude Memory Card from 8 Channel Live BOM
-- Requirement: 8 Channel Live does not require a Memory Card for installation.
-- When Sales selects 8 Channel Live, Memory Card is excluded from the BOM entirely.
-- Memory Card remains in material_inventory for other device types that require it.
-- ============================================================================

DO $$
DECLARE
  v_8ch_bom_id UUID;
BEGIN
  -- 1. Locate the BOM ID for '8 Channel Live'
  SELECT id INTO v_8ch_bom_id
  FROM device_boms
  WHERE LOWER(TRIM(device_type)) = '8 channel live'
  LIMIT 1;

  -- 2. Remove Memory Card from bom_items for '8 Channel Live'
  IF v_8ch_bom_id IS NOT NULL THEN
    DELETE FROM bom_items
    WHERE bom_id = v_8ch_bom_id
      AND LOWER(TRIM(material_name)) = 'memory card';
  END IF;

  -- Memory Card in material_inventory is deliberately preserved for all other device types.
END $$;
