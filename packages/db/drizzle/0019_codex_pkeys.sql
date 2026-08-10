-- Add primary keys to codex tables that lacked them in the initial schema
-- migration (0018_codex_schema.sql). These are required by audit.enable_tracking
-- which derives row_id from pg_constraint.
--
-- PKs are inferred from the production schema; confirm before merging.
-- Constraints use IF NOT EXISTS so this is safe to re-run against production
-- where the PKs may already exist.
--

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'codex."references"'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE codex."references" ADD CONSTRAINT references_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'codex.entries'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE codex.entries ADD CONSTRAINT entries_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'codex.entry_references'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE codex.entry_references ADD CONSTRAINT entry_references_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- Composite PK: the existing UNIQUE (entry_id, tag_id) is the natural key.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'codex.entry_tags'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE codex.entry_tags ADD CONSTRAINT entry_tags_pkey PRIMARY KEY (entry_id, tag_id);
  END IF;
END $$;

-- tags.name is the only NOT NULL column; id is a nullable varchar.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'codex.tags'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE codex.tags ADD CONSTRAINT tags_pkey PRIMARY KEY (name);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'codex.user_submissions'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE codex.user_submissions ADD CONSTRAINT user_submissions_pkey PRIMARY KEY (id);
  END IF;
END $$;
