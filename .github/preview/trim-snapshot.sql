-- Trim the sanitized dev snapshot down to what the map needs, for previews
-- labeled `preview-snapshot` (see preview-env.yml). Runs after
-- `pnpm db:load:snapshot` and before `pnpm db:seed:local`.
--
-- Previews are public and the local API keys are in the repo, so keep only
-- the org tree, locations, events and their types. Drop every person except
-- the seeded dev users, and keep event instances near today so the database
-- fits the sidecar's in-memory volume and restores quickly on cold start.
BEGIN;
DELETE FROM positions_x_orgs_x_users;
DELETE FROM attendance;
DELETE FROM achievements_x_users;
DELETE FROM expansions_x_users;
DELETE FROM slack_users;
DELETE FROM auth_accounts;
DELETE FROM roles_x_users_x_org
  WHERE user_id IN (SELECT id FROM users WHERE email NOT LIKE 'dev-%@f3local.dev');
DELETE FROM users
  WHERE email NOT LIKE 'dev-%@f3local.dev'
    AND id NOT IN (SELECT owner_id FROM api_keys WHERE owner_id IS NOT NULL);
DELETE FROM event_instances
  WHERE start_date < CURRENT_DATE - 7 OR start_date > CURRENT_DATE + 60;
-- The audit triggers copied every deleted row into public_history; clear it so
-- the removed people don't come back through the history tables.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public_history' LOOP
    EXECUTE format('TRUNCATE public_history.%I', t);
  END LOOP;
END $$;
COMMIT;
VACUUM FULL;
