-- `codex` mirrors the standalone Codex database's schema. Its tables are owned
-- by the app_codex role, not by the role that runs migrations, and a database
-- can be in one of three states when this runs:
--   * codex absent (fresh dev/CI/test): the first block creates the schema,
--     tables, indexes and constraints. Needs CREATE on the database.
--   * codex present but missing a constraint or index (a database provisioned
--     from the Codex dump): the second block adds what is missing. ALTER TABLE
--     and CREATE INDEX need ownership of the codex tables, which the migration
--     role holds through membership in app_codex (docs/db-migrations.md,
--     "Database roles"). Missing tables are never created here: a table created
--     by the migration role would lack the grants the Codex app relies on, so
--     the block raises and names them instead.
--   * codex fully provisioned (prod): catalog reads only; no DDL runs.
-- Postgres checks privileges before the IF NOT EXISTS short-circuit for
-- CREATE SCHEMA and CREATE INDEX, so every statement is guarded by a catalog
-- lookup (pg_namespace, pg_class, pg_constraint, to_regclass) rather than by
-- IF NOT EXISTS. The last block verifies, and never alters, that every key
-- audit history depends on is present with the right constraint type, so the
-- migration can never be recorded as applied against a schema that lacks one.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'codex') THEN
		RETURN;
	END IF;
	CREATE SCHEMA "codex";
	CREATE TABLE "codex"."admins" (
		"id" serial PRIMARY KEY NOT NULL,
		"email" varchar(255) NOT NULL,
		"created_at" timestamp DEFAULT now() NOT NULL,
		"updated_at" timestamp DEFAULT now() NOT NULL,
		CONSTRAINT "admins_email_unique" UNIQUE("email")
	);
	CREATE TABLE "codex"."entries" (
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
	CREATE TABLE "codex"."entry_references" (
		"id" integer PRIMARY KEY NOT NULL,
		"source_entry_id" text NOT NULL,
		"target_entry_id" text NOT NULL,
		"context" text,
		"created_at" timestamp,
		"updated_at" timestamp,
		CONSTRAINT "unique_source_target" UNIQUE("source_entry_id","target_entry_id")
	);
	CREATE TABLE "codex"."entry_tags" (
		"entry_id" text NOT NULL,
		"tag_id" text NOT NULL,
		CONSTRAINT "entry_tags_pkey" PRIMARY KEY("entry_id","tag_id")
	);
	CREATE TABLE "codex"."references" (
		"id" serial PRIMARY KEY NOT NULL,
		"from_entry_id" integer NOT NULL,
		"to_entry_id" integer NOT NULL,
		"context" varchar,
		"created" timestamp NOT NULL,
		"updated" timestamp NOT NULL
	);
	CREATE TABLE "codex"."tags" (
		"name" text NOT NULL,
		"id" varchar PRIMARY KEY NOT NULL,
		"createdAt" timestamp with time zone DEFAULT now(),
		"updatedAt" timestamp with time zone DEFAULT now(),
		CONSTRAINT "tags_name_unique" UNIQUE("name")
	);
	CREATE TABLE "codex"."user_submissions" (
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
	CREATE INDEX "idx_entry_references_target_entry_id" ON "codex"."entry_references" USING btree ("target_entry_id");
	CREATE INDEX "idx_entry_tags_tag_id" ON "codex"."entry_tags" USING btree ("tag_id");
END $$;
--> statement-breakpoint
DO $$
DECLARE
	missing text;
	spec record;
	existing text;
	columns text;
	bad bigint;
BEGIN
	-- Every table the snapshot declares must already exist (see the header for
	-- why a missing one is an error rather than something to create).
	SELECT string_agg(t.relname, ', ' ORDER BY t.relname)
	INTO missing
	FROM unnest(ARRAY['admins', 'entries', 'entry_references', 'entry_tags', 'references', 'tags', 'user_submissions']) AS t(relname)
	WHERE NOT EXISTS (
		SELECT 1 FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'codex' AND c.relname = t.relname AND c.relkind = 'r'
	);
	IF missing IS NOT NULL THEN
		RAISE EXCEPTION 'codex schema exists but is missing tables: %. Migration 0033 does not create tables inside an existing codex schema; restore them as the schema owner (app_codex) first.', missing;
	END IF;

	-- Add each primary key / unique constraint the snapshot declares when it
	-- is absent. A table whose primary key exists under another name is an
	-- error: adding a second one is impossible and silently skipping it would
	-- fail the verification below with a less specific message.
	FOR spec IN
		SELECT * FROM (VALUES
			('admins', 'admins_pkey', 'p', ARRAY['id']),
			('admins', 'admins_email_unique', 'u', ARRAY['email']),
			('entries', 'entries_pkey', 'p', ARRAY['id']),
			('entry_references', 'entry_references_pkey', 'p', ARRAY['id']),
			('entry_references', 'unique_source_target', 'u', ARRAY['source_entry_id', 'target_entry_id']),
			('entry_tags', 'entry_tags_pkey', 'p', ARRAY['entry_id', 'tag_id']),
			('references', 'references_pkey', 'p', ARRAY['id']),
			('tags', 'tags_pkey', 'p', ARRAY['id']),
			('tags', 'tags_name_unique', 'u', ARRAY['name']),
			('user_submissions', 'user_submissions_pkey', 'p', ARRAY['id'])
		) AS v(tbl, conname, contype, cols)
	LOOP
		IF spec.contype = 'p' THEN
			SELECT c.conname INTO existing FROM pg_constraint c
			WHERE c.conrelid = format('codex.%I', spec.tbl)::regclass AND c.contype = 'p';
		ELSE
			SELECT c.conname INTO existing FROM pg_constraint c
			WHERE c.conrelid = format('codex.%I', spec.tbl)::regclass AND c.contype = 'u' AND c.conname = spec.conname;
		END IF;
		IF existing = spec.conname THEN
			CONTINUE;
		END IF;
		IF existing IS NOT NULL THEN
			RAISE EXCEPTION 'codex.% has primary key % but migration 0033 expects %. Rename it as the schema owner (ALTER TABLE codex.% RENAME CONSTRAINT % TO %) and rerun.',
				spec.tbl, existing, spec.conname, spec.tbl, existing, spec.conname;
		END IF;

		-- ADD PRIMARY KEY / UNIQUE fails on NULL or duplicate values with an
		-- error that names neither the table nor the rows; check first so the
		-- operator knows what to repair.
		SELECT string_agg(format('%I', c), ', ') INTO columns FROM unnest(spec.cols) AS c;
		IF spec.contype = 'p' THEN
			EXECUTE format('SELECT count(*) FROM codex.%I WHERE %s',
				spec.tbl, (SELECT string_agg(format('%I IS NULL', c), ' OR ') FROM unnest(spec.cols) AS c))
			INTO bad;
			IF bad > 0 THEN
				RAISE EXCEPTION 'codex.%: % row(s) have NULL in (%), so % cannot be added. Fill or delete them as the schema owner, then rerun migration 0033.',
					spec.tbl, bad, columns, spec.conname;
			END IF;
		END IF;
		EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM codex.%I GROUP BY %s HAVING count(*) > 1) AS d', spec.tbl, columns)
		INTO bad;
		IF bad > 0 THEN
			RAISE EXCEPTION 'codex.%: % duplicate value(s) in (%), so % cannot be added. Deduplicate them as the schema owner, then rerun migration 0033.',
				spec.tbl, bad, columns, spec.conname;
		END IF;

		IF spec.contype = 'p' THEN
			EXECUTE format('ALTER TABLE codex.%I ADD CONSTRAINT %I PRIMARY KEY (%s)', spec.tbl, spec.conname, columns);
		ELSE
			EXECUTE format('ALTER TABLE codex.%I ADD CONSTRAINT %I UNIQUE (%s)', spec.tbl, spec.conname, columns);
		END IF;
	END LOOP;

	-- A UNIQUE (entry_id, tag_id) duplicates entry_tags_pkey (Postgres will not
	-- create one beside an identical primary key on a fresh table), and the
	-- Codex app's ON CONFLICT (entry_id, tag_id) infers the primary key index,
	-- so drop it once the primary key is in place.
	IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.entry_tags'::regclass AND conname = 'entry_tags_pkey' AND contype = 'p')
	   AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.entry_tags'::regclass AND conname = 'unique_entry_tag' AND contype = 'u') THEN
		ALTER TABLE codex.entry_tags DROP CONSTRAINT unique_entry_tag;
	END IF;

	IF to_regclass('codex.idx_entry_references_target_entry_id') IS NULL THEN
		CREATE INDEX "idx_entry_references_target_entry_id" ON "codex"."entry_references" USING btree ("target_entry_id");
	END IF;
	IF to_regclass('codex.idx_entry_tags_tag_id') IS NULL THEN
		CREATE INDEX "idx_entry_tags_tag_id" ON "codex"."entry_tags" USING btree ("tag_id");
	END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
	missing text;
BEGIN
	-- Verify (never alter) that every constraint the snapshot declares exists
	-- with the expected type: a same-named CHECK or foreign key must not pass.
	-- pg_constraint is readable without table privileges.
	SELECT string_agg(expected.conname, ', ' ORDER BY expected.conname)
	INTO missing
	FROM (VALUES
		('admins', 'admins_pkey', 'p'),
		('admins', 'admins_email_unique', 'u'),
		('entries', 'entries_pkey', 'p'),
		('entry_references', 'entry_references_pkey', 'p'),
		('entry_references', 'unique_source_target', 'u'),
		('entry_tags', 'entry_tags_pkey', 'p'),
		('references', 'references_pkey', 'p'),
		('tags', 'tags_pkey', 'p'),
		('tags', 'tags_name_unique', 'u'),
		('user_submissions', 'user_submissions_pkey', 'p')
	) AS expected(tbl, conname, contype)
	WHERE NOT EXISTS (
		SELECT 1 FROM pg_constraint c
		JOIN pg_class r ON r.oid = c.conrelid
		WHERE r.relnamespace = 'codex'::regnamespace
		  AND r.relname = expected.tbl
		  AND c.conname = expected.conname
		  AND c.contype = expected.contype
	);
	IF missing IS NOT NULL THEN
		RAISE EXCEPTION 'codex schema is missing constraints required by migration 0033: %', missing;
	END IF;
	IF to_regclass('codex.idx_entry_references_target_entry_id') IS NULL
	   OR to_regclass('codex.idx_entry_tags_tag_id') IS NULL THEN
		RAISE EXCEPTION 'codex schema is missing an index required by migration 0033 (idx_entry_references_target_entry_id, idx_entry_tags_tag_id)';
	END IF;
END $$;
