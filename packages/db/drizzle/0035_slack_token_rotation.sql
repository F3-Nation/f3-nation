ALTER TABLE "slack_spaces" ADD COLUMN "bot_id" varchar;--> statement-breakpoint
ALTER TABLE "slack_spaces" ADD COLUMN "bot_user_id" varchar;--> statement-breakpoint
ALTER TABLE "slack_spaces" ADD COLUMN "bot_scopes" varchar;--> statement-breakpoint
ALTER TABLE "slack_spaces" ADD COLUMN "bot_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "slack_spaces" ADD COLUMN "bot_refresh_token_encrypted" text;