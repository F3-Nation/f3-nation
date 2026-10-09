-- Staging login for the f3-staging-refresh job (F3-65). Run by setup.sh on
-- f3data-nonprod / f3_staging as an admin login (spuds), through cloud-sql-proxy.
-- Idempotent. The password comes from the environment (STAGING_REFRESH_PW).
--
-- The refresh truncates, loads, drops and re-adds FKs, and analyzes staging's tables,
-- which takes their owners' rights: staging_refresh is made a member of every role
-- that owns a table, sequence or schema in public / auth / slackbot / drizzle (on
-- 2026-10-07: tackle, dev_generic, app_auth). Re-run after a migration adds a schema
-- owned by a new role. Plus CREATE on the database for the refresh_keep* holding
-- schemas staging-api-keys / staging-slack create.
--
-- Gotcha (2026-10-07): a GRANT fails with "role X is a member of role Y" when the
-- membership would be circular (tackle was a member of spuds). staging_refresh is new,
-- so nobody should be a member of it; if that error appears, someone is.
\set ON_ERROR_STOP on
\getenv pw STAGING_REFRESH_PW
\getenv pwset STAGING_REFRESH_PW_SET

-- Set the password only when the login is new or setup.sh just generated a new one
-- (its secret was missing). Re-setting the same password on a re-run is refused by
-- Cloud SQL's password policy ("should not reuse recent passwords").
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staging_refresh') AS role_is_new,
  :'pwset' = '1' AS pw_is_new \gset
\if :role_is_new
SELECT format('CREATE ROLE staging_refresh LOGIN PASSWORD %L', :'pw') \gexec
\elif :pw_is_new
SELECT format('ALTER ROLE staging_refresh WITH LOGIN PASSWORD %L', :'pw') \gexec
\endif
-- An admin login that isn't a superuser can't even say NOSUPERUSER, so check the
-- attributes instead of setting them.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'staging_refresh'
             AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'staging_refresh has superuser-level attributes; it must be a plain login';
  END IF;
END $$;

DO $$
DECLARE r text; skipped text[] := '{}'; granted text[] := '{}';
BEGIN
  FOR r IN
    SELECT DISTINCT o FROM (
      SELECT pg_get_userbyid(c.relowner) AS o FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'auth', 'slackbot', 'drizzle') AND c.relkind IN ('r', 'p', 'm', 'S')
      UNION SELECT pg_get_userbyid(nspowner) FROM pg_namespace
      WHERE nspname IN ('public', 'auth', 'slackbot', 'drizzle')
    ) x
  LOOP
    -- Never superuser-level roles: membership there is far more than a refresh needs.
    IF r IN ('postgres', 'cloudsqlsuperuser', 'cloudsqladmin', 'pg_database_owner') OR r LIKE 'pg\_%' THEN
      skipped := skipped || r;
    ELSIF NOT pg_has_role('staging_refresh', r, 'USAGE') THEN
      EXECUTE format('GRANT %I TO staging_refresh', r);
      granted := granted || r;
    END IF;
  END LOOP;
  EXECUTE format('GRANT CREATE ON DATABASE %I TO staging_refresh', current_database());
  RAISE NOTICE 'granted: %, skipped (superuser-level owners): %', granted, skipped;
END $$;

-- Prove it: staging_refresh owns (through membership) every table it loads.
DO $$
DECLARE unowned text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname || ' (owner ' || pg_get_userbyid(c.relowner) || ')', ', ')
  INTO unowned
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth', 'slackbot') AND c.relkind = 'r'
    AND NOT pg_has_role('staging_refresh', c.relowner, 'USAGE');
  IF unowned IS NOT NULL THEN
    RAISE EXCEPTION 'staging_refresh does not own (through a role) these tables: %', unowned;
  END IF;
END $$;
SELECT r AS owner_role, pg_has_role('staging_refresh', r, 'USAGE') AS staging_refresh_has_it
FROM (SELECT DISTINCT pg_get_userbyid(c.relowner) AS r FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'auth', 'slackbot') AND c.relkind = 'r') x ORDER BY 1;
