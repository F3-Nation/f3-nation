-- Owner-run companion to migration 0027_codex_schema.sql.
--
-- The `codex` schema is externally provisioned and owned by `app_codex`; the
-- Drizzle migration role cannot ALTER its tables. This script installs the
-- primary keys and unique constraint that 0027's snapshot declares (and that
-- 0027's final block verifies) on an ALREADY-EXISTING codex schema. Fresh
-- databases get them from CREATE TABLE in 0027 and never need this file.
--
-- Run as the schema owner, e.g. through the Cloud SQL Auth Proxy:
--   cloud-sql-proxy f3data:us-central1:f3data --port 5433
--   psql -h 127.0.0.1 -p 5433 -U app_codex -d f3_prod -v ON_ERROR_STOP=1 \
--        -c 'BEGIN' -f packages/db/scripts/codex-constraints.sql -c 'ROLLBACK'   -- dry run
--   ...then again with COMMIT.
--
-- Idempotent: every step is guarded, so re-running is a no-op. Applied to
-- prod on 2026-09-22 (user_submissions_pkey first, the rest the same day).
--
-- Preflight: each ADD PRIMARY KEY fails if the column has NULLs or duplicate
-- values, which is the intended safety net. user_submissions had duplicate ids
-- until 2026-09-22 (identity sequence had reset); that repair is recorded in
-- codex.user_submissions_id_remap and is deliberately NOT part of this script.

\echo '--- before'
SELECT c.relname AS tbl,
       EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p') AS has_pk
FROM pg_class c
WHERE c.relnamespace = 'codex'::regnamespace AND c.relkind = 'r'
ORDER BY 1;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.admins'::regclass AND contype = 'p') THEN
    ALTER TABLE codex.admins ADD CONSTRAINT admins_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.entries'::regclass AND contype = 'p') THEN
    ALTER TABLE codex.entries ADD CONSTRAINT entries_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.entry_references'::regclass AND contype = 'p') THEN
    ALTER TABLE codex.entry_references ADD CONSTRAINT entry_references_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- Composite PK on the natural key. The historical UNIQUE (entry_id, tag_id) is
-- redundant with it (Postgres will not even create it next to an identical PK
-- on a fresh table), so it is dropped to keep prod identical to a bootstrapped
-- schema. The Codex app's ON CONFLICT (entry_id, tag_id) infers the PK index.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.entry_tags'::regclass AND contype = 'p') THEN
    ALTER TABLE codex.entry_tags ADD CONSTRAINT entry_tags_pkey PRIMARY KEY (entry_id, tag_id);
  END IF;
END $$;
ALTER TABLE codex.entry_tags DROP CONSTRAINT IF EXISTS unique_entry_tag;

-- Legacy table (empty in prod).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex."references"'::regclass AND contype = 'p') THEN
    ALTER TABLE codex."references" ADD CONSTRAINT references_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- tags.id is the key the Codex app and entry_tags.tag_id use (name is
-- user-editable). ADD PRIMARY KEY sets NOT NULL itself.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.tags'::regclass AND contype = 'p') THEN
    ALTER TABLE codex.tags ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- The Codex app upserts tags with ON CONFLICT (name).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.tags'::regclass AND conname = 'tags_name_unique') THEN
    ALTER TABLE codex.tags ADD CONSTRAINT tags_name_unique UNIQUE (name);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'codex.user_submissions'::regclass AND contype = 'p') THEN
    ALTER TABLE codex.user_submissions ADD CONSTRAINT user_submissions_pkey PRIMARY KEY (id);
  END IF;
END $$;

\echo '--- after (every table must show a PK; tags also tags_name_unique)'
SELECT c.relname AS tbl, k.conname, pg_get_constraintdef(k.oid) AS definition
FROM pg_class c
JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype IN ('p', 'u')
WHERE c.relnamespace = 'codex'::regnamespace AND c.relkind = 'r'
ORDER BY 1, 2;
