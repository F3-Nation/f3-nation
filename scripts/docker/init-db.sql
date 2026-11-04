-- The development database is created automatically via POSTGRES_DB.
-- Local setup replays this file on every run; keep all statements idempotent.
SELECT 'CREATE DATABASE f3nation_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'f3nation_test')\gexec

-- Run only through the compose-owned container, connected to its development
-- database: this marks current_database() and the test database as disposable.
-- The database comments survive schema resets.
COMMENT ON DATABASE f3nation_test IS 'f3-disposable-local-v1';
DO $$ BEGIN
  EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), 'f3-disposable-local-v1');
END $$;
