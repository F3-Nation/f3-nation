ALTER TABLE "auth"."oauth_clients" ALTER COLUMN "client_secret_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."oauth_clients" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Scalar API docs OAuth client (public, PKCE-only — no client secret)
INSERT INTO "auth"."oauth_clients" ("id", "name", "client_secret_hash", "redirect_uris", "allowed_origin", "scopes", "is_active", "is_public")
VALUES
  ('scalar-docs', 'Scalar API Docs', NULL, '["https://api.f3nation.com/docs/oauth2-redirect"]', 'https://api.f3nation.com', 'openid profile email', true, true),
  ('scalar-docs-staging', 'Scalar API Docs (Staging)', NULL, '["https://staging.api.f3nation.com/docs/oauth2-redirect"]', 'https://staging.api.f3nation.com', 'openid profile email', true, true)
ON CONFLICT ("id") DO NOTHING;
