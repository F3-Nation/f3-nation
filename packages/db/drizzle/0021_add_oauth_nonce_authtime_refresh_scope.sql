ALTER TABLE "auth"."oauth_authorization_codes" ADD COLUMN "nonce" text;--> statement-breakpoint
ALTER TABLE "auth"."oauth_authorization_codes" ADD COLUMN "auth_time" timestamp;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_tokens" ADD COLUMN "scopes" text;--> statement-breakpoint
ALTER TABLE "auth"."oauth_refresh_tokens" ADD COLUMN "auth_time" timestamp;