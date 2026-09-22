-- `codex` is a separately-provisioned schema (owned by app_codex, granted to
-- group_readonly / group_developers_codex) that already exists in prod with
-- every table, primary key and constraint below (applied as app_codex on
-- 2026-09-22). The migration role does not own those objects, so nothing here
-- may touch an existing one. Postgres runs the privilege check *before* the
-- IF NOT EXISTS short-circuit for CREATE SCHEMA (needs CREATE on the database)
-- and CREATE INDEX (needs table ownership), so those two are guarded with
-- catalog lookups (pg_namespace / to_regclass) instead; CREATE TABLE IF NOT
-- EXISTS only needs CREATE on the schema and is used as-is. Supported states:
-- codex fully absent (fresh dev/CI/test → bootstrapped) or fully present
-- (prod → no-op, verified as app_codex in a rolled-back transaction). Partial
-- provisioning is not reconciled.
DO $$
BEGIN
	-- CREATE SCHEMA IF NOT EXISTS checks CREATE-on-database *before* the existence
	-- short-circuit, so guard on pg_namespace to stay a true no-op when present.
	IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'codex') THEN
		CREATE SCHEMA "codex";
	END IF;
END $$;
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