CREATE TYPE "public"."series_exception" AS ENUM('closed', 'different-time', 'miscellaneous');--> statement-breakpoint
ALTER TABLE "event_instances" ADD COLUMN "series_exception" "series_exception";--> statement-breakpoint
