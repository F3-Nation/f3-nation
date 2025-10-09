ALTER TABLE "event_tags" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;