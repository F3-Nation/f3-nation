ALTER TABLE "achievements" ALTER COLUMN "auto_filters" SET DATA TYPE jsonb USING "auto_filters"::jsonb;--> statement-breakpoint
ALTER TABLE "achievements" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "attendance" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "event_instances" ALTER COLUMN "preblast_rich" SET DATA TYPE jsonb USING "preblast_rich"::jsonb;--> statement-breakpoint
ALTER TABLE "event_instances" ALTER COLUMN "backblast_rich" SET DATA TYPE jsonb USING "backblast_rich"::jsonb;--> statement-breakpoint
ALTER TABLE "event_instances" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "locations" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "orgs" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "slack_spaces" ALTER COLUMN "settings" SET DATA TYPE jsonb USING "settings"::jsonb;--> statement-breakpoint
ALTER TABLE "slack_users" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "update_requests" ALTER COLUMN "event_meta" SET DATA TYPE jsonb USING "event_meta"::jsonb;--> statement-breakpoint
ALTER TABLE "update_requests" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "meta" SET DATA TYPE jsonb USING "meta"::jsonb;
