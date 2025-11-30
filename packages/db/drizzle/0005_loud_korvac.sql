CREATE TYPE "public"."achievement_cadence" AS ENUM('weekly', 'monthly', 'quarterly', 'yearly', 'lifetime');--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "auto_award" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "auto_cadence" "achievement_cadence";--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "auto_threshold_type" varchar;--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "auto_threshold" integer;--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "auto_filters" json;--> statement-breakpoint
ALTER TABLE "achievements" ADD COLUMN "meta" json;--> statement-breakpoint
ALTER TABLE "event_instances" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_tags" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- ALTER TABLE "orgs" ADD COLUMN "ao_count" integer DEFAULT 0; -- removing broken command. It is already applied in the db (0004) but not in the schema.json
ALTER TABLE "positions" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
