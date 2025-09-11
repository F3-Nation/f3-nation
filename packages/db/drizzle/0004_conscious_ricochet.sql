ALTER TABLE "orgs" ADD COLUMN "ao_count" integer DEFAULT 0;

-- Custom SQL migration file, put your code below! --

-- Function to update AO counts for regions, areas, and sectors
CREATE OR REPLACE FUNCTION update_org_ao_counts()
RETURNS TRIGGER AS $$
DECLARE
  parent_id_var INTEGER;
  parent_type_var TEXT;
  grandparent_id_var INTEGER;
  grandparent_type_var TEXT;
  great_grandparent_id_var INTEGER;
  great_grandparent_type_var TEXT;
  -- Add flag to check if trigger is enabled
  is_disabled BOOLEAN;
BEGIN
  -- Check if trigger is disabled via the app_config table
  SELECT current_setting('app.disable_ao_count_trigger', TRUE)::BOOLEAN INTO is_disabled;
  IF is_disabled THEN
    RETURN NEW;
  END IF;

  -- Only run calculations when an AO is created, deleted, or its active status changes
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND 
     ((TG_OP = 'INSERT' AND NEW.org_type = 'ao') OR 
      (TG_OP = 'UPDATE' AND (NEW.org_type = 'ao' OR OLD.org_type = 'ao'))) THEN
    
    -- Get the parent org info (typically a region)
    SELECT id, org_type INTO parent_id_var, parent_type_var
    FROM orgs
    WHERE id = COALESCE(NEW.parent_id, OLD.parent_id);
    
    -- Update parent org count (direct children that are AOs)
    IF parent_id_var IS NOT NULL THEN
      UPDATE orgs
      SET ao_count = (
        SELECT COUNT(*)
        FROM orgs
        WHERE parent_id = parent_id_var
          AND org_type = 'ao'
          AND is_active = true
      )
      WHERE id = parent_id_var;
      
      -- Get the grandparent org info (typically an area)
      SELECT id, org_type INTO grandparent_id_var, grandparent_type_var
      FROM orgs
      WHERE id = (
        SELECT parent_id
        FROM orgs
        WHERE id = parent_id_var
      );
      
      -- Update grandparent org count (grandchildren that are AOs)
      IF grandparent_id_var IS NOT NULL THEN
        UPDATE orgs
        SET ao_count = (
          SELECT COUNT(*)
          FROM orgs ao
          JOIN orgs region ON ao.parent_id = region.id
          WHERE region.parent_id = grandparent_id_var
            AND ao.org_type = 'ao'
            AND region.org_type = 'region'
            AND ao.is_active = true
            AND region.is_active = true
        )
        WHERE id = grandparent_id_var;
        
        -- Get the great-grandparent org info (typically a sector)
        SELECT id, org_type INTO great_grandparent_id_var, great_grandparent_type_var
        FROM orgs
        WHERE id = (
          SELECT parent_id
          FROM orgs
          WHERE id = grandparent_id_var
        );
        
        -- Update great-grandparent org count (great-grandchildren that are AOs)
        IF great_grandparent_id_var IS NOT NULL THEN
          UPDATE orgs
          SET ao_count = (
            SELECT COUNT(*)
            FROM orgs ao
            JOIN orgs region ON ao.parent_id = region.id
            JOIN orgs area ON region.parent_id = area.id
            WHERE area.parent_id = great_grandparent_id_var
              AND ao.org_type = 'ao'
              AND region.org_type = 'region'
              AND area.org_type = 'area'
              AND ao.is_active = true
              AND region.is_active = true
              AND area.is_active = true
          )
          WHERE id = great_grandparent_id_var;
        END IF;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger that fires on insert, update, or delete operations on orgs table
DROP TRIGGER IF EXISTS update_org_ao_counts_trigger ON orgs;
CREATE TRIGGER update_org_ao_counts_trigger
AFTER INSERT OR UPDATE OR DELETE ON orgs
FOR EACH ROW
EXECUTE FUNCTION update_org_ao_counts();

-- Function to enable/disable the trigger
CREATE OR REPLACE FUNCTION toggle_ao_count_trigger(disable BOOLEAN)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.disable_ao_count_trigger', disable::TEXT, FALSE);
END;
$$ LANGUAGE plpgsql;

-- Initialize the AO counts for all applicable orgs
DO $$
BEGIN
  -- Update regions (direct parent of AOs)
  UPDATE orgs region
  SET ao_count = (
    SELECT COUNT(*)
    FROM orgs ao
    WHERE ao.parent_id = region.id
      AND ao.org_type = 'ao'
      AND ao.is_active = true
  )
  WHERE region.org_type = 'region';

  -- Update areas (grandparent of AOs)
  UPDATE orgs area
  SET ao_count = (
    SELECT COUNT(*)
    FROM orgs ao
    JOIN orgs region ON ao.parent_id = region.id
    WHERE region.parent_id = area.id
      AND ao.org_type = 'ao'
      AND region.org_type = 'region'
      AND ao.is_active = true
      AND region.is_active = true
  )
  WHERE area.org_type = 'area';

  -- Update sectors (great-grandparent of AOs)
  UPDATE orgs sector
  SET ao_count = (
    SELECT COUNT(*)
    FROM orgs ao
    JOIN orgs region ON ao.parent_id = region.id
    JOIN orgs area ON region.parent_id = area.id
    WHERE area.parent_id = sector.id
      AND ao.org_type = 'ao'
      AND region.org_type = 'region'
      AND area.org_type = 'area'
      AND ao.is_active = true
      AND region.is_active = true
      AND area.is_active = true
  )
  WHERE sector.org_type = 'sector';
END $$;