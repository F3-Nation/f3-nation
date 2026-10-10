-- Read-only prod login for the f3-staging-refresh job (F3-65). Run by setup.sh on
-- f3data / f3_prod as an admin login (spuds), through cloud-sql-proxy. Idempotent.
--
-- A plain role made in SQL, not `gcloud sql users create`: built-in Cloud SQL users join
-- cloudsqlsuperuser, and this login must not be able to write anything. The password
-- comes from the environment (STAGING_REFRESH_PW), never argv; it meets the instance's
-- password policy (setup.sh appends Aa9-_ to a hex token).
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
ALTER ROLE staging_refresh SET default_transaction_read_only = on;

-- Read access to the schemas the refresh dumps. Granting needs the owners' rights:
-- public_history is dumped without rows, but pg_dump still needs SELECT to lock
-- its tables. This read-only login does not receive audit helper EXECUTE grants.
-- borrow each owning role just long enough (the pattern that set up spuds on
-- 2026-10-07), including default privileges for ordinary tables created later.
-- audit.enable_tracking removes history reader grants, including defaults:
-- reapply this provisioning after every migration that calls it.
-- A role is borrowed only if the admin login isn't already in it.
DO $$
DECLARE
  schemas text[] := ARRAY(SELECT nspname::text FROM pg_namespace
                          WHERE nspname IN ('public', 'auth', 'drizzle', 'slackbot', 'audit', 'public_history'));
  owners text[];
  borrowed text[] := '{}';
  r text;
  s text;
BEGIN
  SELECT array_agg(DISTINCT o) INTO owners FROM (
    SELECT pg_get_userbyid(c.relowner) AS o FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY(schemas) AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
    UNION SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = ANY(schemas)
  ) x
  -- pg_database_owner (owner of public since PG15) can't have explicit members, and
  -- the admin login owns what it owns through the database anyway.
  WHERE o NOT LIKE 'pg\_%';
  FOREACH r IN ARRAY owners LOOP
    IF NOT pg_has_role(current_user, r, 'USAGE') THEN
      EXECUTE format('GRANT %I TO %I', r, current_user);
      borrowed := borrowed || r;
    END IF;
  END LOOP;
  FOREACH s IN ARRAY schemas LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO staging_refresh', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO staging_refresh', s);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO staging_refresh', s);
    FOREACH r IN ARRAY owners LOOP
      -- Nice to have, not required: without it a table created later needs a re-run of
      -- setup.sh (the refresh then stops with "permission denied" in pg_dump).
      BEGIN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO staging_refresh', r, s);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON SEQUENCES TO staging_refresh', r, s);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE WARNING 'no default privileges for role % in schema %: %', r, s, SQLERRM;
      END;
    END LOOP;
  END LOOP;
  FOREACH r IN ARRAY borrowed LOOP
    EXECUTE format('REVOKE %I FROM %I', r, current_user);
  END LOOP;
  RAISE NOTICE 'owners: %, borrowed and returned: %', owners, borrowed;
END $$;

-- Prove it: readable everything, member of nothing, can't write.
DO $$
DECLARE unreadable text; memberships text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname, ', ') INTO unreadable
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'auth', 'drizzle', 'slackbot', 'audit', 'public_history') AND c.relkind IN ('r', 'p', 'm', 'S')
    AND NOT has_table_privilege('staging_refresh', c.oid, 'SELECT');
  IF unreadable IS NOT NULL THEN
    RAISE EXCEPTION 'staging_refresh cannot read: %', unreadable;
  END IF;
  SELECT string_agg(roleid::regrole::text, ', ') INTO memberships
  FROM pg_auth_members WHERE member = 'staging_refresh'::regrole;
  IF memberships IS NOT NULL THEN
    RAISE EXCEPTION 'staging_refresh must not be a member of any role on prod, but is in: %', memberships;
  END IF;
END $$;
SELECT n.nspname AS schema, count(*) AS objects,
       count(*) FILTER (WHERE has_table_privilege('staging_refresh', c.oid, 'SELECT')) AS readable,
       count(*) FILTER (WHERE has_table_privilege('staging_refresh', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')) AS writable
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'auth', 'drizzle', 'slackbot', 'audit', 'public_history') AND c.relkind IN ('r', 'p', 'm', 'S')
GROUP BY 1 ORDER BY 1;
