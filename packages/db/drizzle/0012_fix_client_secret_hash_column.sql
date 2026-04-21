DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'oauth_clients'
      AND column_name = 'client_secret'
  ) THEN
    ALTER TABLE "auth"."oauth_clients" RENAME COLUMN "client_secret" TO "client_secret_hash";
  END IF;
END $$;
