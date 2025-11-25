ALTER TABLE "event_instances" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_private" boolean DEFAULT false NOT NULL;