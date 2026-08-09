-- Codex schema: faithful replica of the production schema so all environments
-- have these tables before the audit migration runs.
-- Production already has these; IF NOT EXISTS makes this idempotent.
-- Constraints are inline so they apply only on first creation (the entire
-- CREATE TABLE statement is skipped if the table already exists).
--
-- Sequences are managed in guarded DO blocks: if the sequence doesn't already
-- exist it is created and attached, and setval() syncs it to the current
-- max(id) so a partial-existing-schema case never causes a duplicate-key error.

CREATE SCHEMA IF NOT EXISTS codex;

-- ─── admins ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS codex.admins (
  id         integer                                   NOT NULL,
  email      character varying(255)                    NOT NULL,
  created_at timestamp without time zone DEFAULT now() NOT NULL,
  updated_at timestamp without time zone DEFAULT now() NOT NULL,
  CONSTRAINT admins_pkey         PRIMARY KEY (id),
  CONSTRAINT admins_email_unique UNIQUE (email)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'codex' AND sequencename = 'admins_id_seq') THEN
    CREATE SEQUENCE codex.admins_id_seq
      AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
    ALTER SEQUENCE codex.admins_id_seq OWNED BY codex.admins.id;
    ALTER TABLE codex.admins ALTER COLUMN id SET DEFAULT nextval('codex.admins_id_seq'::regclass);
  END IF;
  -- Always sync: guard-only checks sequence existence, not whether it is ahead of MAX(id).
  PERFORM setval('codex.admins_id_seq',
    GREATEST((SELECT last_value FROM codex.admins_id_seq),
             COALESCE((SELECT MAX(id) FROM codex.admins), 0)) + 1, false);
END $$;

-- ─── references ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS codex."references" (
  id            integer           NOT NULL,
  from_entry_id integer           NOT NULL,
  to_entry_id   integer           NOT NULL,
  context       character varying,
  created       timestamp without time zone NOT NULL,
  updated       timestamp without time zone NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'codex' AND sequencename = 'codex_references_id_seq') THEN
    CREATE SEQUENCE codex.codex_references_id_seq
      AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
    ALTER SEQUENCE codex.codex_references_id_seq OWNED BY codex."references".id;
    ALTER TABLE codex."references" ALTER COLUMN id SET DEFAULT nextval('codex.codex_references_id_seq'::regclass);
  END IF;
  PERFORM setval('codex.codex_references_id_seq',
    GREATEST((SELECT last_value FROM codex.codex_references_id_seq),
             COALESCE((SELECT MAX(id) FROM codex."references"), 0)) + 1, false);
END $$;

-- ─── entries (text PK, no sequence) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS codex.entries (
  id                text NOT NULL,
  title             text NOT NULL,
  definition        text NOT NULL,
  type              text NOT NULL,
  aliases           jsonb,
  video_link        text,
  created_at        timestamp without time zone NOT NULL,
  updated_at        timestamp without time zone NOT NULL,
  mentioned_entries jsonb
);

-- ─── entry_references ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS codex.entry_references (
  id               integer NOT NULL,
  source_entry_id  text    NOT NULL,
  target_entry_id  text    NOT NULL,
  context          text,
  created_at       timestamp without time zone,
  updated_at       timestamp without time zone,
  CONSTRAINT unique_source_target UNIQUE (source_entry_id, target_entry_id)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'codex' AND sequencename = 'entry_references_id_seq') THEN
    CREATE SEQUENCE codex.entry_references_id_seq
      AS integer START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
    ALTER SEQUENCE codex.entry_references_id_seq OWNED BY codex.entry_references.id;
    ALTER TABLE codex.entry_references ALTER COLUMN id SET DEFAULT nextval('codex.entry_references_id_seq'::regclass);
  END IF;
  PERFORM setval('codex.entry_references_id_seq',
    GREATEST((SELECT last_value FROM codex.entry_references_id_seq),
             COALESCE((SELECT MAX(id) FROM codex.entry_references), 0)) + 1, false);
END $$;

-- ─── entry_tags (no sequence) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS codex.entry_tags (
  entry_id text NOT NULL,
  tag_id   text NOT NULL,
  CONSTRAINT unique_entry_tag UNIQUE (entry_id, tag_id)
);

-- ─── tags (no sequence) ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS codex.tags (
  name        text             NOT NULL,
  id          character varying,
  "createdAt" timestamp with time zone DEFAULT now(),
  "updatedAt" timestamp with time zone DEFAULT now()
);

-- ─── user_submissions (GENERATED ALWAYS AS IDENTITY) ─────────────────────────

CREATE TABLE IF NOT EXISTS codex.user_submissions (
  id               integer                  NOT NULL,
  submission_type  text                     NOT NULL,
  data             jsonb                    NOT NULL,
  submitter_name   text,
  submitter_email  text,
  status           text                     NOT NULL,
  "timestamp"      timestamp with time zone NOT NULL,
  created_at       timestamp with time zone NOT NULL,
  updated_at       timestamp with time zone NOT NULL,
  rejection_reason text,
  admin_notes      text
);
-- Attach identity generator only if not already present; setval syncs to max.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'codex' AND c.relname = 'user_submissions'
      AND a.attname = 'id' AND a.attidentity <> ''
  ) THEN
    ALTER TABLE codex.user_submissions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
      SEQUENCE NAME codex.user_submissions_id_seq
      START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );
  END IF;
  PERFORM setval('codex.user_submissions_id_seq',
    GREATEST((SELECT last_value FROM codex.user_submissions_id_seq),
             COALESCE((SELECT MAX(id) FROM codex.user_submissions), 0)) + 1, false);
END $$;

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_entry_references_target_entry_id
  ON codex.entry_references USING btree (target_entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag_id
  ON codex.entry_tags USING btree (tag_id);
