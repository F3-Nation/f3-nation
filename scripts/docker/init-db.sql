-- The development database is created automatically via POSTGRES_DB.
-- Local setup also replays this file for existing compose-owned volumes.
SELECT 'CREATE DATABASE f3nation_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'f3nation_test')\gexec

-- Mark only the compose-owned development and test databases. These comments
-- survive schema resets; URL-selected databases are never marked here.
COMMENT ON DATABASE f3nation_test IS 'f3-disposable-local-v1';
DO $$ BEGIN
  EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), 'f3-disposable-local-v1');
END $$;
