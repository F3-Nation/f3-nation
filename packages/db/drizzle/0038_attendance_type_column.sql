SET LOCAL lock_timeout = '3s';--> statement-breakpoint
CREATE TYPE "public"."attendance_type" AS ENUM('pax', 'q', 'co_q');--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "attendance_type" "attendance_type" DEFAULT 'pax' NOT NULL;