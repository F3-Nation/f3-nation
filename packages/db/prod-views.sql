-- The views staging and prod have that no migration creates. CI's
-- migrate-check job (src/migrate-check.ts) creates them, as a superuser,
-- after the base commit's migrations and before the branch's new ones, so a
-- migration that changes or drops something they depend on fails in CI, as it
-- would on deploy. Views created here are given to the schema owner.
--
-- Keep this in step with the databases: the inventory query in
-- docs/db-migrations.md ("Views created outside the migrations") lists them.
--   - A view is created by hand in staging or prod: add its definition
--     (`pg_get_viewdef`), saying which environments have it.
--   - A migration drops one: remove it here in the same PR.

-- Prod only: the pg_stat_statements extension installs two views in public,
-- pg_stat_statements and pg_stat_statements_info. Staging doesn't have it.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA public;
