ALTER TABLE "update_requests" ALTER COLUMN "event_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."update_requests" ALTER COLUMN "request_type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."request_type";--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('create_ao_and_location_and_event', 'create_event', 'edit_event', 'edit_ao_and_location', 'move_ao_to_different_region', 'move_ao_to_new_location', 'move_ao_to_different_location', 'move_event_to_different_ao', 'move_event_to_new_location', 'delete_event', 'delete_ao', 'edit');--> statement-breakpoint
ALTER TABLE "public"."update_requests" ALTER COLUMN "request_type" SET DATA TYPE "public"."request_type" USING "request_type"::"public"."request_type";