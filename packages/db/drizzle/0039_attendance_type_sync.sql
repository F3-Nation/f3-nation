SET LOCAL lock_timeout = '3s';--> statement-breakpoint

-- attendance.attendance_type is derived from the attendance_x_attendance_types
-- link rows while both exist (ADR 0007). Writers still write only link rows,
-- and the trigger below keeps the column in step with them. A record holding
-- several types takes the highest by the precedence Q, then Co-Q, then PAX;
-- a record with no link rows is pax.
--
-- Types are matched by attendance_types.type, the same lookup the API uses,
-- because test databases don't guarantee production's fixed ids (1 PAX, 2 Q,
-- 3 Co-Q). Any other type name counts as pax.
--
-- The trigger, both functions and the backfill procedure are dropped together
-- with the link tables once every writer sets the column itself.

-- VOLATILE, not STABLE: each call takes a fresh snapshot, so when an UPDATE
-- below waits on a row lock held by a concurrent link-row writer, the value is
-- recomputed from that writer's committed link rows rather than a stale view.
CREATE OR REPLACE FUNCTION public.attendance_type_from_links(target_attendance_id integer)
RETURNS public.attendance_type
LANGUAGE sql
VOLATILE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN bool_or(t.type = 'Q') THEN 'q'
    WHEN bool_or(t.type = 'Co-Q') THEN 'co_q'
    ELSE 'pax'
  END::public.attendance_type
  FROM public.attendance_x_attendance_types x
  JOIN public.attendance_types t ON t.id = x.attendance_type_id
  WHERE x.attendance_id = target_attendance_id
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.attendance_type_from_links(integer) FROM PUBLIC;--> statement-breakpoint

-- SECURITY DEFINER: a login that may write link rows but not update
-- attendance would otherwise have its link-row writes fail. It writes only
-- the attendance_type of the records whose link rows changed, and only when
-- the value differs, so unchanged records get no audit-history entry.
--
-- On a link row removed by the cascade from a deleted attendance record, the
-- parent is already gone and the UPDATE matches nothing.
CREATE OR REPLACE FUNCTION public.sync_attendance_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  affected integer[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    affected := ARRAY[NEW.attendance_id];
  ELSIF TG_OP = 'DELETE' THEN
    affected := ARRAY[OLD.attendance_id];
  ELSE
    IF NEW.attendance_id = OLD.attendance_id
       AND NEW.attendance_type_id = OLD.attendance_type_id THEN
      RETURN NULL;
    END IF;
    affected := ARRAY[NEW.attendance_id, OLD.attendance_id];
  END IF;

  UPDATE public.attendance a
  SET attendance_type = public.attendance_type_from_links(a.id)
  WHERE a.id = ANY (affected)
    AND a.attendance_type IS DISTINCT FROM public.attendance_type_from_links(a.id);

  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.sync_attendance_type() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER sync_attendance_type
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_x_attendance_types
FOR EACH ROW EXECUTE FUNCTION public.sync_attendance_type();--> statement-breakpoint

-- Sets attendance_type on records that existed before the trigger. Run it by
-- hand after this migration, outside a transaction block, because it commits
-- after each batch:
--
--   CALL public.backfill_attendance_type();
--
-- The column's 'pax' default is already right for every record without a Q or
-- Co-Q link row, so only those records are visited, in ranges of
-- batch_size attendance ids. Records the trigger has already set are skipped,
-- so the procedure can be stopped and run again. Each changed record gets one
-- audit-history entry and a new `updated` timestamp.
--
-- No SET clause and no SECURITY DEFINER: either would forbid the COMMIT, so
-- every name is schema-qualified instead.
CREATE OR REPLACE PROCEDURE public.backfill_attendance_type(batch_size integer DEFAULT 10000)
LANGUAGE plpgsql
AS $$
DECLARE
  last_id integer := 0;
  max_id integer;
  changed integer;
  total integer := 0;
BEGIN
  IF batch_size IS NULL OR batch_size < 1 THEN
    RAISE EXCEPTION 'batch_size must be a positive integer, got %', batch_size;
  END IF;

  SELECT max(x.attendance_id) INTO max_id
  FROM public.attendance_x_attendance_types x;

  WHILE last_id < COALESCE(max_id, 0) LOOP
    UPDATE public.attendance a
    SET attendance_type = public.attendance_type_from_links(a.id)
    WHERE a.id IN (
        SELECT x.attendance_id
        FROM public.attendance_x_attendance_types x
        JOIN public.attendance_types t ON t.id = x.attendance_type_id
        WHERE t.type IN ('Q', 'Co-Q')
          AND x.attendance_id > last_id
          AND x.attendance_id <= last_id + batch_size
      )
      AND a.attendance_type IS DISTINCT FROM public.attendance_type_from_links(a.id);
    GET DIAGNOSTICS changed = ROW_COUNT;
    total := total + changed;
    last_id := last_id + batch_size;
    COMMIT;
  END LOOP;

  RAISE NOTICE 'attendance_type backfill updated % record(s)', total;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON PROCEDURE public.backfill_attendance_type(integer) FROM PUBLIC;
