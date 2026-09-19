-- Operator-led rollback for 0023 (and, when applied, the AO-count migration 0026 that
-- follows it); not part of the forward migration directory.
-- Stop writers and coordinate the old application version before running.
-- Reconcile the migration journal only after successful rollback; see territory-migration.md.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.orgs, public.positions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orgs WHERE org_type::text = 'territory')
    OR EXISTS (SELECT 1 FROM public.positions WHERE org_type::text = 'territory') THEN
    RAISE EXCEPTION 'Cannot roll back org_type while territory values exist in orgs or positions';
  END IF;
END $$;
DROP INDEX public.idx_orgs_org_type;
ALTER TABLE public.orgs ALTER COLUMN org_type TYPE text;
ALTER TABLE public.positions ALTER COLUMN org_type TYPE text;
DROP TYPE public.org_type;
CREATE TYPE public.org_type AS ENUM ('ao', 'region', 'area', 'sector', 'nation');
ALTER TABLE public.orgs ALTER COLUMN org_type TYPE public.org_type USING org_type::public.org_type;
ALTER TABLE public.positions ALTER COLUMN org_type TYPE public.org_type USING org_type::public.org_type;
CREATE INDEX idx_orgs_org_type ON public.orgs USING btree (org_type enum_ops);
-- Refresh cached trigger expressions after replacing the enum's OID.
CREATE OR REPLACE FUNCTION public.update_org_ao_counts()
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
-- The function above is the fixed-depth counter that predates the depth-agnostic
-- AO-count migration (0026). Remove that migration's functions so the database
-- matches the state before it; a no-op when 0026 was never applied.
DROP FUNCTION IF EXISTS public.recount_org_ao_counts(integer[]);
DROP FUNCTION IF EXISTS public.org_ao_count_expected(integer[]);
DROP FUNCTION IF EXISTS public.org_ao_count_targets(integer[]);
COMMIT;
