-- Enable audit history only for the explicitly listed public tables.
-- Application-level user and source attribution is configured separately.
-- Custom migration: history stays outside Drizzle's mirrored source schema.
CREATE SCHEMA audit;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  pk_cols text[] := TG_ARGV[0]::text[];
  ignore_cols text[] := TG_ARGV[1]::text[];
  redact_cols text[] := TG_ARGV[2]::text[];
  old_j jsonb;
  new_j jsonb;
  row_j jsonb;
  rid text;
  uid integer;
  uid_raw text;
  col text;
  changed boolean;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_j := to_jsonb(OLD); END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN new_j := to_jsonb(NEW); END IF;
  -- Column names are frozen in trigger arguments. Refuse stale masking after
  -- a rename/drop instead of retaining the sensitive value under a new name.
  row_j := COALESCE(new_j, old_j);
  -- Frozen key names must still identify every component, including after DDL.
  FOREACH col IN ARRAY pk_cols LOOP
    IF (row_j ->> col) IS NULL THEN
      RAISE EXCEPTION 'audit.log_change: primary key column missing';
    END IF;
  END LOOP;
  FOREACH col IN ARRAY redact_cols LOOP
    IF NOT (row_j ? col) THEN
      RAISE EXCEPTION 'audit.log_change: redacted column missing';
    END IF;
  END LOOP;
  IF TG_OP = 'UPDATE' AND (old_j - ignore_cols) = (new_j - ignore_cols) THEN
    RETURN NULL;
  END IF;

  -- Identity uses the unredacted NEW row for I/U and OLD for D. A PK-changing
  -- UPDATE uses the new key; enable_tracking rejects PK masking.
  SELECT string_agg(CASE WHEN cardinality(pk_cols) > 1
    THEN replace(replace(row_j ->> c, E'\\', E'\\\\'), ':', E'\\:')
    ELSE row_j ->> c END, ':' ORDER BY ord)
  INTO rid FROM unnest(pk_cols) WITH ORDINALITY AS k(c, ord);

  FOREACH col IN ARRAY redact_cols LOOP
    changed := TG_OP = 'UPDATE' AND (old_j -> col) IS DISTINCT FROM (new_j -> col);
    IF old_j IS NOT NULL THEN
      old_j := jsonb_set(old_j, ARRAY[col], '"[redacted]"'::jsonb);
    END IF;
    IF new_j IS NOT NULL THEN
      new_j := jsonb_set(new_j, ARRAY[col], to_jsonb(
        CASE WHEN changed THEN '[redacted: changed]'::text ELSE '[redacted]'::text END));
    END IF;
  END LOOP;

  -- Unsigned decimal attribution contract: specs/database-audit-history.md AC-29.
  uid_raw := current_setting('app.user_id', true);
  IF uid_raw ~ '^[0-9]{1,10}$' THEN
    IF uid_raw::bigint <= 2147483647 THEN uid := uid_raw::integer; END IF;
  END IF;

  EXECUTE format('INSERT INTO %I.%I (row_id, op, changed_by, changed_via, old_row, new_row)
    VALUES ($1, $2, $3, $4, $5, $6)', TG_TABLE_SCHEMA || '_history', TG_TABLE_NAME)
    USING rid, left(TG_OP, 1), uid, NULLIF(current_setting('app.source', true), ''), old_j, new_j;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A driver may log PostgreSQL DETAIL/CONTEXT. Do not propagate a constraint's
  -- failing-row detail or a trigger's message, which can contain raw secrets.
  -- Preserve the SQLSTATE (including retryable failures), but not its payload.
  RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'Audit history capture failed';
END
$$;
REVOKE ALL ON FUNCTION audit.log_change() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION audit.enable_tracking(
  target regclass, ignore_cols text[] DEFAULT ARRAY[]::text[],
  redact_cols text[] DEFAULT ARRAY[]::text[]
) RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  tbl text;
  sch text;
  owner_id oid;
  hist_schema text;
  hist oid;
  seq oid;
  pk_cols text[];
  col text;
  grantee text;
  column_grant record;
BEGIN
  SELECT c.relname, n.nspname, c.relowner INTO tbl, sch, owner_id
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = target AND c.relkind = 'r' AND NOT c.relispartition;
  IF tbl IS NULL OR sch IN ('pg_catalog', 'information_schema', 'audit')
     OR sch LIKE 'pg\_%' OR sch LIKE '%\_history' THEN
    RAISE EXCEPTION 'audit.enable_tracking: unsupported source table';
  END IF;
  -- Operators act as the migration owner. Source ownership alone is not an
  -- authorization grant to execute this helper (EXECUTE is revoked below).
  IF owner_id <> (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'audit.enable_tracking: source must be owned by current role';
  END IF;
  IF octet_length(sch || '_history') > 63 OR octet_length('zz_audit_' || tbl) > 63 THEN
    RAISE EXCEPTION 'audit.enable_tracking: identifier too long';
  END IF;
  -- Serialize reconfiguration and establish the boundary for future writes.
  EXECUTE format('LOCK TABLE %s IN SHARE ROW EXCLUSIVE MODE', target);
  SELECT array_agg(a.attname::text ORDER BY k.ord) INTO pk_cols
    FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.conrelid = target AND c.contype = 'p';
  IF pk_cols IS NULL THEN RAISE EXCEPTION 'audit.enable_tracking: table has no primary key'; END IF;
  IF ignore_cols IS NULL OR redact_cols IS NULL THEN
    RAISE EXCEPTION 'audit.enable_tracking: options must be non-null arrays';
  END IF;
  FOREACH col IN ARRAY (ignore_cols || redact_cols) LOOP
    IF col IS NULL OR NOT EXISTS (SELECT FROM pg_attribute
      WHERE attrelid = target AND attname = col AND attnum > 0 AND NOT attisdropped) THEN
      RAISE EXCEPTION 'audit.enable_tracking: unknown option column';
    END IF;
  END LOOP;
  IF ignore_cols && redact_cols THEN RAISE EXCEPTION 'audit.enable_tracking: ignore/redact overlap'; END IF;
  IF pk_cols && redact_cols THEN RAISE EXCEPTION 'audit.enable_tracking: cannot redact primary key'; END IF;
  IF pk_cols && ignore_cols THEN RAISE EXCEPTION 'audit.enable_tracking: cannot ignore primary key'; END IF;

  hist_schema := sch || '_history';
  IF NOT EXISTS (SELECT FROM pg_namespace WHERE nspname = hist_schema) THEN
    EXECUTE format('CREATE SCHEMA %I', hist_schema);
  ELSIF (SELECT nspowner FROM pg_namespace WHERE nspname = hist_schema) <> owner_id THEN
    RAISE EXCEPTION 'audit.enable_tracking: history schema owner mismatch';
  END IF;
  hist := to_regclass(format('%I.%I', hist_schema, tbl));
  IF hist IS NULL THEN
    EXECUTE format('CREATE TABLE %I.%I (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      row_id text NOT NULL, op char(1) NOT NULL
        CONSTRAINT audit_history_op CHECK (op IN (''I'', ''U'', ''D'')),
      changed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
      changed_by integer, changed_via text, old_row jsonb, new_row jsonb
    )', hist_schema, tbl);
    hist := to_regclass(format('%I.%I', hist_schema, tbl));
    EXECUTE format('COMMENT ON TABLE %I.%I IS %L', hist_schema, tbl, 'audit-history-v1');
    EXECUTE format('CREATE INDEX ON %I.%I (row_id, changed_at)', hist_schema, tbl);
    EXECUTE format('CREATE INDEX ON %I.%I (changed_at)', hist_schema, tbl);
  ELSE
    -- Never silently adopt an unrelated or structurally modified relation.
    IF NOT EXISTS (SELECT FROM pg_class WHERE oid = hist AND relkind = 'r'
      AND relowner = owner_id AND relpersistence = 'p'
      AND NOT relrowsecurity AND NOT relispartition)
      OR EXISTS (SELECT FROM pg_rewrite WHERE ev_class = hist)
      OR obj_description(hist, 'pg_class') IS DISTINCT FROM 'audit-history-v1'
      OR (SELECT array_agg(attname::text || ':' || atttypid::regtype::text || ':' || attnotnull::text
        ORDER BY attnum) FROM pg_attribute WHERE attrelid = hist AND attnum > 0 AND NOT attisdropped)
        IS DISTINCT FROM ARRAY['id:bigint:true', 'row_id:text:true', 'op:character:true',
          'changed_at:timestamp with time zone:true', 'changed_by:integer:false',
          'changed_via:text:false', 'old_row:jsonb:false', 'new_row:jsonb:false']
      OR NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid = hist AND attname = 'id' AND attidentity = 'a')
      OR NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = hist AND contype = 'p' AND conkey = ARRAY[1]::smallint[])
      OR NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = hist
        AND conname = 'audit_history_op' AND contype = 'c' AND convalidated
        AND pg_get_expr(conbin, conrelid) = '(op = ANY (ARRAY[''I''::bpchar, ''U''::bpchar, ''D''::bpchar]))')
      OR EXISTS (SELECT FROM pg_constraint WHERE conrelid = hist AND contype NOT IN ('p', 'n')
        AND NOT (contype = 'c' AND conname = 'audit_history_op'))
      OR NOT EXISTS (SELECT FROM pg_attrdef WHERE adrelid = hist AND adnum = 4
        AND pg_get_expr(adbin, adrelid) = 'transaction_timestamp()')
      OR NOT EXISTS (SELECT FROM pg_index WHERE indrelid = hist AND indisvalid AND indisready
        AND NOT indisunique AND indpred IS NULL AND indexprs IS NULL AND indkey::text = '2 4')
      OR NOT EXISTS (SELECT FROM pg_index WHERE indrelid = hist AND indisvalid AND indisready
        AND NOT indisunique AND indpred IS NULL AND indexprs IS NULL AND indkey::text = '4')
      OR (SELECT count(*) FROM pg_index WHERE indrelid = hist) <> 3
      OR EXISTS (SELECT FROM pg_trigger WHERE tgrelid = hist AND NOT tgisinternal)
    THEN RAISE EXCEPTION 'audit.enable_tracking: incompatible history object'; END IF;
  END IF;

  -- Remove inherited/default ACL grants too; schema separation alone is not ACL isolation.
  FOR grantee IN SELECT DISTINCT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE c.oid = hist AND x.grantee <> owner_id
  LOOP EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM %s', hist_schema, tbl, grantee); END LOOP;
  EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC', hist_schema, tbl);
  -- Table-level REVOKE does not remove grants made on individual columns.
  FOR column_grant IN
    SELECT DISTINCT a.attname,
      CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee
    FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE a.attrelid = hist AND a.attnum > 0 AND NOT a.attisdropped AND x.grantee <> owner_id
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE %I.%I FROM %s',
      column_grant.attname, hist_schema, tbl, column_grant.grantee);
  END LOOP;
  seq := pg_get_serial_sequence(format('%I.%I', hist_schema, tbl), 'id')::regclass;
  FOR grantee IN SELECT DISTINCT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE c.oid = seq AND x.grantee <> owner_id
  LOOP EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %s', seq::regclass, grantee); END LOOP;
  FOR grantee IN SELECT DISTINCT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END
    FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
    WHERE n.nspname = hist_schema AND x.grantee <> owner_id AND x.privilege_type = 'CREATE'
  LOOP EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM %s', hist_schema, grantee); END LOOP;
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', hist_schema);
  -- Reader access is granted separately by the database operator.
  IF EXISTS (SELECT FROM pg_trigger WHERE tgrelid = target AND tgname = 'zz_audit_' || tbl
    AND tgfoid <> 'audit.log_change()'::regprocedure) THEN
    RAISE EXCEPTION 'audit.enable_tracking: incompatible existing trigger';
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', 'zz_audit_' || tbl, target);
  EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %s
    FOR EACH ROW EXECUTE FUNCTION audit.log_change(%L, %L, %L)',
    'zz_audit_' || tbl, target, pk_cols::text, ignore_cols::text, redact_cols::text);
END
$$;
REVOKE ALL ON FUNCTION audit.enable_tracking(regclass, text[], text[]) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION audit.disable_tracking(target regclass) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE tbl text;
BEGIN
  SELECT relname INTO STRICT tbl FROM pg_class WHERE oid = target;
  IF EXISTS (SELECT FROM pg_trigger WHERE tgrelid = target AND tgname = 'zz_audit_' || tbl
    AND tgfoid <> 'audit.log_change()'::regprocedure) THEN
    RAISE EXCEPTION 'audit.disable_tracking: incompatible existing trigger';
  END IF;
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', 'zz_audit_' || tbl, target);
END
$$;
REVOKE ALL ON FUNCTION audit.disable_tracking(regclass) FROM PUBLIC;
--> statement-breakpoint
-- Also remove explicit function grants inherited from global default ACLs.
DO $$
DECLARE entry record;
BEGIN
  FOR entry IN SELECT p.oid::regprocedure AS signature,
    CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS grantee
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN LATERAL aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid=x.grantee
    WHERE n.nspname='audit' AND x.grantee <> p.proowner
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', entry.signature, entry.grantee); END LOOP;
END $$;
--> statement-breakpoint
-- Explicit allowlist. Join tables without updated use empty ignore options.
SELECT audit.enable_tracking('public.users', ARRAY['updated']);
SELECT audit.enable_tracking('public.roles', ARRAY['updated']);
SELECT audit.enable_tracking('public.permissions', ARRAY['updated']);
SELECT audit.enable_tracking('public.api_keys', ARRAY['updated'], ARRAY['key']);
SELECT audit.enable_tracking('public.roles_x_users_x_org');
SELECT audit.enable_tracking('public.roles_x_permissions');
SELECT audit.enable_tracking('public.roles_x_api_keys_x_org');
SELECT audit.enable_tracking('public.orgs', ARRAY['updated', 'ao_count']);
SELECT audit.enable_tracking('public.positions', ARRAY['updated']);
SELECT audit.enable_tracking('public.positions_x_orgs_x_users');
SELECT audit.enable_tracking('public.orgs_x_slack_spaces');
SELECT audit.enable_tracking('public.locations', ARRAY['updated']);
SELECT audit.enable_tracking('public.events', ARRAY['updated']);
SELECT audit.enable_tracking('public.event_instances', ARRAY['updated']);
SELECT audit.enable_tracking('public.event_types', ARRAY['updated']);
SELECT audit.enable_tracking('public.event_tags', ARRAY['updated']);
SELECT audit.enable_tracking('public.events_x_event_types');
SELECT audit.enable_tracking('public.event_tags_x_events');
SELECT audit.enable_tracking('public.event_instances_x_event_types');
SELECT audit.enable_tracking('public.event_tags_x_event_instances');
SELECT audit.enable_tracking('public.attendance', ARRAY['updated']);
SELECT audit.enable_tracking('public.attendance_types', ARRAY['updated']);
SELECT audit.enable_tracking('public.attendance_x_attendance_types');
SELECT audit.enable_tracking('public.achievements', ARRAY['updated']);
SELECT audit.enable_tracking('public.achievements_x_users');
-- Currently transported as request metadata, not used to authorize requests.
-- Mask the UUID defensively: retaining it is unnecessary for change history.
SELECT audit.enable_tracking('public.update_requests', ARRAY['updated'], ARRAY['token']);
