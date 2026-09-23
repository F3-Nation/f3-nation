-- Operator-led rollback for 0023 (and, when applied, the AO-count migration 0026);
-- migrations 0024 and 0025 are unrelated and untouched. Not part of the forward
-- migration directory.
-- Removing an enum value requires recreating the type, so unlike the forward
-- migration this rewrites both tables and recreates dependent views.
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
-- Views over org_type (e.g. event_instance_expanded) block the type swap and are
-- managed outside this repository, so capture them from the catalog, drop them,
-- and recreate them afterwards with the same definition, owner, and grants.
CREATE TEMP TABLE org_type_dependent_views ON COMMIT DROP AS
WITH RECURSIVE dependent (oid, depth) AS (
  SELECT r.ev_class, 1
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  WHERE d.classid = 'pg_rewrite'::regclass
    AND ((d.refclassid = 'pg_type'::regclass AND d.refobjid = 'public.org_type'::regtype)
      OR (d.refclassid = 'pg_class'::regclass
        AND (d.refobjid, d.refobjsubid) IN (
          SELECT attrelid, attnum FROM pg_attribute
          WHERE attrelid IN ('public.orgs'::regclass, 'public.positions'::regclass)
            AND attname = 'org_type')))
  UNION
  SELECT r.ev_class, dependent.depth + 1
  FROM dependent
  JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = dependent.oid
    AND d.classid = 'pg_rewrite'::regclass
  JOIN pg_rewrite r ON r.oid = d.objid
  WHERE r.ev_class <> dependent.oid AND dependent.depth < 20
)
SELECT c.oid, c.relkind, max(dependent.depth) AS depth,
       format('%I.%I', n.nspname, c.relname) AS name,
       pg_get_userbyid(c.relowner) AS owner, c.relacl, c.reloptions,
       obj_description(c.oid, 'pg_class') AS comment,
       NULL::text AS definition
FROM dependent
JOIN pg_class c ON c.oid = dependent.oid
JOIN pg_namespace n ON n.oid = c.relnamespace
GROUP BY c.oid, n.nspname;
DO $$
DECLARE
  v record;
  caller_search_path text := current_setting('search_path');
BEGIN
  IF EXISTS (SELECT 1 FROM org_type_dependent_views WHERE relkind <> 'v')
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM org_type_dependent_views))
    OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class IN (SELECT oid FROM org_type_dependent_views) AND rulename <> '_RETURN')
    OR EXISTS (SELECT 1 FROM pg_description WHERE objoid IN (SELECT oid FROM org_type_dependent_views) AND objsubid <> 0)
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid IN (SELECT oid FROM org_type_dependent_views) AND attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'org_type has a dependent materialized view, or a view with triggers, rules, column comments, or column grants; recreate it by hand';
  END IF;
  -- Schema-qualify every name in the captured definitions.
  PERFORM set_config('search_path', 'pg_catalog', true);
  UPDATE org_type_dependent_views SET definition = pg_get_viewdef(oid);
  PERFORM set_config('search_path', caller_search_path, true);
  FOR v IN SELECT * FROM org_type_dependent_views ORDER BY depth DESC LOOP
    RAISE NOTICE 'Dropping dependent view % for recreation', v.name;
    EXECUTE format('DROP VIEW %s', v.name);
  END LOOP;
END $$;
DROP INDEX public.idx_orgs_org_type;
ALTER TABLE public.orgs ALTER COLUMN org_type TYPE text;
ALTER TABLE public.positions ALTER COLUMN org_type TYPE text;
DROP TYPE public.org_type;
CREATE TYPE public.org_type AS ENUM ('ao', 'region', 'area', 'sector', 'nation');
ALTER TABLE public.orgs ALTER COLUMN org_type TYPE public.org_type USING org_type::public.org_type;
ALTER TABLE public.positions ALTER COLUMN org_type TYPE public.org_type USING org_type::public.org_type;
CREATE INDEX idx_orgs_org_type ON public.orgs USING btree (org_type enum_ops);
DO $$
DECLARE
  v record;
  g record;
BEGIN
  FOR v IN SELECT * FROM org_type_dependent_views ORDER BY depth LOOP
    EXECUTE format('CREATE VIEW %s%s AS %s', v.name,
      CASE WHEN v.reloptions IS NULL THEN '' ELSE format(' WITH (%s)', array_to_string(v.reloptions, ', ')) END,
      v.definition);
    EXECUTE format('ALTER VIEW %s OWNER TO %I', v.name, v.owner);
    IF v.relacl IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON %s FROM PUBLIC, %I', v.name, v.owner);
      FOR g IN
        SELECT a.grantee, a.privilege_type, a.is_grantable
        FROM aclexplode(v.relacl) a
      LOOP
        EXECUTE format('GRANT %s ON %s TO %s%s', g.privilege_type, v.name,
          CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END,
          CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
      END LOOP;
    END IF;
    IF v.comment IS NOT NULL THEN
      EXECUTE format('COMMENT ON VIEW %s IS %L', v.name, v.comment);
    END IF;
    RAISE NOTICE 'Recreated dependent view %', v.name;
  END LOOP;
END $$;
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
