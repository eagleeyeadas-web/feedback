-- ============================================================
-- Eagle Eye SafDrive - Consolidate Material Catalog & Clean Legacy BOM Items
-- Migration 032: Merge legacy material_inventory items into standard items
--                and remove duplicate legacy items from bom_items.
-- ============================================================

DO $$
BEGIN
  -- 1. Transfer stock balances from legacy duplicate items to standard items
  -- Long Screw
  IF EXISTS (SELECT 1 FROM material_inventory WHERE material_name = 'Screw (Long)') THEN
    UPDATE material_inventory
    SET current_stock = current_stock + COALESCE((SELECT current_stock FROM material_inventory WHERE material_name = 'Screw (Long)'), 0)
    WHERE material_name = 'Long Screw';
    
    DELETE FROM material_inventory WHERE material_name = 'Screw (Long)';
  END IF;

  -- Small Screw
  IF EXISTS (SELECT 1 FROM material_inventory WHERE material_name = 'Screw (Small)') THEN
    UPDATE material_inventory
    SET current_stock = current_stock + COALESCE((SELECT current_stock FROM material_inventory WHERE material_name = 'Screw (Small)'), 0)
    WHERE material_name = 'Small Screw';

    DELETE FROM material_inventory WHERE material_name = 'Screw (Small)';
  END IF;

  -- 0.5 mm Wire
  IF EXISTS (SELECT 1 FROM material_inventory WHERE material_name = '0.5 mm wire') THEN
    UPDATE material_inventory
    SET current_stock = current_stock + COALESCE((SELECT current_stock FROM material_inventory WHERE material_name = '0.5 mm wire'), 0)
    WHERE material_name = '0.5 mm Wire';

    DELETE FROM material_inventory WHERE material_name = '0.5 mm wire';
  END IF;

  -- 2. Clean up legacy bom_items entries
  DELETE FROM bom_items
  WHERE material_name IN ('Screw (Long)', 'Screw (Small)', '0.5 mm wire');

  -- 3. Ensure material_id in bom_items is correctly linked to material_inventory(id)
  UPDATE bom_items b
  SET material_id = m.id
  FROM material_inventory m
  WHERE LOWER(TRIM(b.material_name)) = LOWER(TRIM(m.material_name))
    AND (b.material_id IS NULL OR b.material_id != m.id);

  -- 4. Exclude Memory Card from 8 Channel Live in bom_items
  DELETE FROM bom_items
  WHERE bom_id IN (SELECT id FROM device_boms WHERE LOWER(TRIM(device_type)) = '8 channel live')
    AND LOWER(TRIM(material_name)) = 'memory card';

END $$;
