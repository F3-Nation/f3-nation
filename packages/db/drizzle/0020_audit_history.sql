-- Audit history: sister-schema design
-- Covers issues #520 (created/updated by), #664 (audit foundation),
-- #665 (changed_by via app.user_id GUC), #667 (changed_via via app.source GUC).
--
-- Schema layout
-- ─────────────
-- audit            : helper functions only (no data tables)
-- public_history   : history tables mirroring public.*
-- auth_history     : history tables mirroring auth.*
-- <x>_history      : history tables for any future schema x
--
-- Each history table has the same name as its source table and lives in the
-- sister schema, preserving schema-level access control independently per
-- schema.  The functions in audit.* are the only cross-schema dependency.
--
-- How to audit a new table: one line in a future custom migration:
--   SELECT audit.enable_tracking('<schema>.<table>'::regclass, ARRAY['updated']);
--   -- or with custom options:
--   SELECT audit.enable_tracking(
--     '<schema>.<table>'::regclass,
--     ARRAY['updated'],           -- ignore_cols (no-op suppression)
--     ARRAY['secret_col']         -- redact_cols (stripped from snapshots)
--   );

-- ─── Schemas ──────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS audit;

-- ─── Generic trigger function ─────────────────────────────────────────────────
--
-- Attached AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW on every audited table.
--
-- TG_ARGV[0]: comma-separated PK column names (derived by enable_tracking)
-- TG_ARGV[1]: columns to exclude from the no-op comparison (empty = no suppression)
-- TG_ARGV[2]: columns to strip from stored old_row/new_row snapshots
--             (use for secrets/hashes that must not enter the audit trail)
--
-- No-op suppression: an UPDATE whose non-bookkeeping columns are unchanged
-- produces no history row.  This prevents noise from cascaded ao_count
-- updates and bare timestamp touches.
--
-- Attribution (NULL until follow-up issues land):
--   app.user_id  → integer user id (changed_by)   — wired in #665
--   app.source   → originating app  (changed_via)  — wired in #667

CREATE OR REPLACE FUNCTION audit.log_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  pk_cols     text[]  := string_to_array(TG_ARGV[0], ',');
  -- Table-specific columns to exclude from the no-op comparison.
  -- Pass the table's timestamp column (e.g. 'updated', 'updated_at', '"updatedAt"').
  ignore_cols text[]  := CASE
                           WHEN TG_NARGS > 1 AND TG_ARGV[1] <> ''
                           THEN string_to_array(TG_ARGV[1], ',')
                           ELSE ARRAY[]::text[]
                         END;
  -- Columns stripped from stored snapshots (secrets, hashes, tokens).
  redact_cols text[]  := CASE
                           WHEN TG_NARGS > 2 AND TG_ARGV[2] <> ''
                           THEN string_to_array(TG_ARGV[2], ',')
                           ELSE ARRAY[]::text[]
                         END;
  old_j   jsonb;
  new_j   jsonb;
  row_j   jsonb;
  rid     text;
  uid     integer;
  uid_raw text;
  via     text;
  _col    text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN new_j := to_jsonb(NEW); END IF;

  -- Suppress no-op UPDATEs: ignore_cols should include the table's timestamp
  -- column (e.g. 'updated', 'updated_at') plus any derived columns like ao_count.
  IF TG_OP = 'UPDATE'
     AND (old_j - ignore_cols) = (new_j - ignore_cols) THEN
    RETURN NULL;
  END IF;

  -- Replace sensitive column values with sentinels; new_row signals a change.
  FOREACH _col IN ARRAY redact_cols LOOP
    IF old_j IS NOT NULL THEN
      old_j := jsonb_set(old_j, ARRAY[_col], '"[redacted]"', true);
    END IF;
    IF new_j IS NOT NULL THEN
      -- Compare original OLD/NEW rows (not post-redaction old_j/new_j).
      new_j := jsonb_set(new_j, ARRAY[_col],
        CASE WHEN TG_OP = 'UPDATE'
                  AND to_jsonb(OLD) -> _col IS DISTINCT FROM to_jsonb(NEW) -> _col
             THEN '"[redacted: changed]"'::jsonb
             ELSE '"[redacted]"'::jsonb END, true);
    END IF;
  END LOOP;

  -- Build colon-joined row_id from PK columns in declared order.
  row_j := COALESCE(new_j, old_j);
  SELECT string_agg(row_j ->> c, ':' ORDER BY ord)
    INTO rid
    FROM unnest(pk_cols) WITH ORDINALITY AS t(c, ord);

  -- changed_by: reject malformed and out-of-range values before casting.
  -- Nested IF guarantees regex fires before bigint cast (no short-circuit in SQL AND).
  uid_raw := current_setting('app.user_id', true);
  IF uid_raw ~ '^\d{1,10}$' THEN
    IF uid_raw::bigint <= 2147483647 THEN
      uid := uid_raw::integer;
    END IF;
  END IF;

  -- changed_via: originating app; NULL when unset.
  via := NULLIF(current_setting('app.source', true), '');

  -- Insert into the sister schema: <source_schema>_history.<table_name>
  EXECUTE format(
    'INSERT INTO %I.%I (row_id, op, changed_by, changed_via, old_row, new_row)
     VALUES ($1, $2, $3, $4, $5, $6)',
    TG_TABLE_SCHEMA || '_history',
    TG_TABLE_NAME)
  USING rid, left(TG_OP, 1), uid, via, old_j, new_j;

  RETURN NULL;
END
$$;

-- Prevent direct invocation; the trigger mechanism bypasses this restriction.
REVOKE EXECUTE ON FUNCTION audit.log_change() FROM PUBLIC;

-- ─── enable_tracking / disable_tracking helpers ───────────────────────────────

CREATE OR REPLACE FUNCTION audit.enable_tracking(
  target        regclass,
  ignore_cols   text[] DEFAULT ARRAY[]::text[],
  redact_cols   text[] DEFAULT ARRAY[]::text[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  tbl         text := (SELECT relname FROM pg_class WHERE oid = target);
  sch         text := (SELECT nspname FROM pg_namespace
                        WHERE oid = (SELECT relnamespace FROM pg_class WHERE oid = target));
  hist_schema text := sch || '_history';
  pk          text;
BEGIN
  -- Auto-derive PK columns from pg_constraint (column order preserved).
  SELECT string_agg(a.attname, ',' ORDER BY k.ord)
    INTO pk
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = target AND c.contype = 'p';

  IF pk IS NULL THEN
    RAISE EXCEPTION 'audit.enable_tracking: % has no primary key', target;
  END IF;

  -- Create the sister schema for this source schema if it does not exist.
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', hist_schema);

  -- Create the history table (same name as source, different schema).
  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS %I.%I (
      id          bigserial     PRIMARY KEY,
      row_id      text,
      op          char(1)       NOT NULL,
      changed_at  timestamptz   NOT NULL DEFAULT now(),
      changed_by  integer,      -- users.id; NO FK (history must survive user deletes)
      changed_via text,         -- originating app (map/admin/me/slackbot/...)
      old_row     jsonb,        -- NULL on INSERT; redacted cols already stripped
      new_row     jsonb         -- NULL on DELETE; redacted cols already stripped
    )
  $f$, hist_schema, tbl);

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.%I (row_id, changed_at)',
    tbl || '_row_idx', hist_schema, tbl);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.%I (changed_at)',
    tbl || '_changed_at_idx', hist_schema, tbl);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I.%I (changed_by) WHERE changed_by IS NOT NULL',
    tbl || '_changed_by_idx', hist_schema, tbl);

  -- Trigger name is table-scoped so no schema prefix needed.
  -- Named zz_audit_* to sort after same-timing triggers (e.g. set_updated_*).
  EXECUTE format(
    'DROP TRIGGER IF EXISTS %I ON %s',
    'zz_audit_' || tbl, target);
  EXECUTE format(
    'CREATE TRIGGER %I
     AFTER INSERT OR UPDATE OR DELETE ON %s
     FOR EACH ROW EXECUTE FUNCTION audit.log_change(%L, %L, %L)',
    'zz_audit_' || tbl, target, pk,
    COALESCE(array_to_string(ignore_cols, ','), ''),
    COALESCE(array_to_string(redact_cols, ','), ''));
END
$$;

-- Drop trigger only; history table and data are preserved.
CREATE OR REPLACE FUNCTION audit.disable_tracking(target regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  tbl text := (SELECT relname FROM pg_class WHERE oid = target);
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS %I ON %s',
    'zz_audit_' || tbl, target);
END
$$;

-- ─── Enable tracking: public schema (26 tables → public_history.*) ────────────
--
-- Excluded (deliberate):
--   auth_*                – covered separately below with per-column redaction
--   slack_spaces          – high-frequency bot sync + bot_token in rows
--   slack_users           – high-frequency sync + Strava tokens
--   expansions, expansions_x_users, alembic_version – outside core domain

-- Users & roles
SELECT audit.enable_tracking('public.users'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.roles'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.permissions'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.roles_x_permissions'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.roles_x_users_x_org'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.api_keys'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.roles_x_api_keys_x_org'::regclass, ARRAY['updated']);

-- Org hierarchy — ao_count also excluded: cascaded by update_org_ao_counts_trigger
SELECT audit.enable_tracking('public.orgs'::regclass, ARRAY['updated', 'ao_count']);

-- Locations & events
SELECT audit.enable_tracking('public.locations'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.events'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.event_instances'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.event_types'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.event_tags'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.positions'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.achievements'::regclass, ARRAY['updated']);

-- Attendance
SELECT audit.enable_tracking('public.attendance'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.attendance_types'::regclass, ARRAY['updated']);

-- Update requests (PK is a uuid → row_id will be the uuid text)
SELECT audit.enable_tracking('public.update_requests'::regclass, ARRAY['updated']);

-- Join tables (composite PKs → row_id is colon-joined integer values)
SELECT audit.enable_tracking('public.events_x_event_types'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.event_tags_x_events'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.event_instances_x_event_types'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.event_tags_x_event_instances'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.attendance_x_attendance_types'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.achievements_x_users'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.positions_x_orgs_x_users'::regclass, ARRAY['updated']);
SELECT audit.enable_tracking('public.orgs_x_slack_spaces'::regclass, ARRAY['updated']);

-- ─── Enable tracking: auth tables (→ auth_history.*) ───────
--
-- Excluded:
--   oauth_access_tokens      – every login writes a row; contains live tokens
--   oauth_refresh_tokens     – same; very high churn
--   oauth_authorization_codes – extremely short-lived, contain the code itself
--   email_mfa_codes          – short-lived, contain live OTP codes
--
-- oauth_clients: low-churn config (registered apps); client_secret_hash is
-- redacted so the hash never enters auth_history, but rotation events (and
-- all other field changes) are still recorded.
SELECT audit.enable_tracking(
  'auth.oauth_clients'::regclass,
  redact_cols => ARRAY['client_secret_hash']  -- client_secret_hash replaced with sentinel
);

-- ─── Enable tracking: codex schema (→ codex_history.*) ───────────────────────
-- Only codex.admins has a confirmed primary key in the dump; the other tables
-- have no PK constraint and cannot be tracked until PKs are added to them.

SELECT audit.enable_tracking('codex.admins'::regclass, ARRAY['updated_at']);
