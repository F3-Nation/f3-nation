-- `codex` is a separately-provisioned schema (owned by app_codex, granted to
-- group_readonly / group_developers_codex) that already exists in prod with
-- every table, primary key and constraint below (applied as app_codex on
-- 2026-09-22). The migration role does not own those tables, so nothing here
-- may touch an existing object: CREATE SCHEMA / CREATE TABLE use IF NOT EXISTS
-- (no-op when present), and the two indexes are created only if absent via a
-- to_regclass check — plain CREATE INDEX IF NOT EXISTS checks table ownership
-- *before* the existence short-circuit and would fail as a non-owner. Requires
-- CREATE on the database (for CREATE SCHEMA IF NOT EXISTS) and CREATE on schema
-- codex. Supported states: codex fully absent (fresh dev/CI/test → bootstrapped)
-- or fully present (prod → no-op). Partial provisioning is not reconciled.
CREATE SCHEMA IF NOT EXISTS "codex";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."entries" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"definition" text NOT NULL,
	"type" text NOT NULL,
	"aliases" jsonb,
	"video_link" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"mentioned_entries" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."entry_references" (
	"id" integer PRIMARY KEY NOT NULL,
	"source_entry_id" text NOT NULL,
	"target_entry_id" text NOT NULL,
	"context" text,
	"created_at" timestamp,
	"updated_at" timestamp,
	CONSTRAINT "unique_source_target" UNIQUE("source_entry_id","target_entry_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."entry_tags" (
	"entry_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "entry_tags_pkey" PRIMARY KEY("entry_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."references" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_entry_id" integer NOT NULL,
	"to_entry_id" integer NOT NULL,
	"context" varchar,
	"created" timestamp NOT NULL,
	"updated" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."tags" (
	"name" text NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now(),
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."user_submissions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "codex"."user_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"submission_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"submitter_name" text,
	"submitter_email" text,
	"status" text NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"rejection_reason" text,
	"admin_notes" text
);
--> statement-breakpoint
DO $$
BEGIN
	IF to_regclass('codex.idx_entry_references_target_entry_id') IS NULL THEN
		CREATE INDEX "idx_entry_references_target_entry_id" ON "codex"."entry_references" USING btree ("target_entry_id");
	END IF;
	IF to_regclass('codex.idx_entry_tags_tag_id') IS NULL THEN
		CREATE INDEX "idx_entry_tags_tag_id" ON "codex"."entry_tags" USING btree ("tag_id");
	END IF;
END $$;