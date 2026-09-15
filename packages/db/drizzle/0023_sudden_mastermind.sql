-- `codex` is a separately-provisioned schema (owned by app_codex) that already
-- exists in prod. Every statement uses IF NOT EXISTS so this is safe to run
-- whether codex is absent (fresh dev/CI/test — bootstraps it) or already present
-- (no-op). The migration role must hold CREATE on the codex schema for the
-- already-present case. The column comments below are guarded so a pre-existing
-- table that lacks those columns can't abort the run. Reconciling a *partially*
-- provisioned table (missing columns/constraints) is intentionally out of scope
-- — codex is all-or-nothing in practice. Structure mirrors the pg_dump.
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
	"id" text NOT NULL,
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
	"id" integer NOT NULL,
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
	CONSTRAINT "unique_entry_tag" UNIQUE("entry_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."references" (
	"id" serial NOT NULL,
	"from_entry_id" integer NOT NULL,
	"to_entry_id" integer NOT NULL,
	"context" varchar,
	"created" timestamp NOT NULL,
	"updated" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."tags" (
	"name" text NOT NULL,
	"id" varchar,
	"createdAt" timestamp with time zone DEFAULT now(),
	"updatedAt" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "codex"."user_submissions" (
	"id" integer GENERATED ALWAYS AS IDENTITY (sequence name "codex"."user_submissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE INDEX IF NOT EXISTS "idx_entry_references_target_entry_id" ON "codex"."entry_references" USING btree ("target_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_entry_tags_tag_id" ON "codex"."entry_tags" USING btree ("tag_id");--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'codex' AND table_name = 'user_submissions' AND column_name = 'rejection_reason') THEN
		COMMENT ON COLUMN "codex"."user_submissions"."rejection_reason" IS 'Admin''s reason for rejecting the submission';
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'codex' AND table_name = 'user_submissions' AND column_name = 'admin_notes') THEN
		COMMENT ON COLUMN "codex"."user_submissions"."admin_notes" IS 'Internal admin notes about the submission';
	END IF;
END $$;
