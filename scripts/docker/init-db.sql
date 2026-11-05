-- The main database (f3nation) is created automatically via POSTGRES_DB.
-- This script creates the test database used by automated tests.
CREATE DATABASE f3nation_test;
-- Mark POSTGRES_DB (the local development database, normally f3nation), not
-- f3nation_test. This metadata survives schema resets. Never mark shared data.
DO $$ BEGIN
  EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), 'f3-disposable-local-v1');
END $$;
