SET LOCAL lock_timeout = '3s';--> statement-breakpoint

-- ao_count is carried by every organization type except the leaf (ao) and the
-- root (nation). It is the number of active AOs in the organization's subtree,
-- reached only through active intermediate organizations; the organization's
-- own is_active is not checked. Depth is capped at 20 levels and every walk
-- carries a path array so a parent cycle terminates.
--
-- Any migration that recreates the org_type enum must re-issue these functions
-- with CREATE OR REPLACE so sessions do not keep plans that reference the old
-- enum type.

-- Count-carrying ancestors (and self) of the given organizations.
CREATE OR REPLACE FUNCTION public.org_ao_count_targets(seed_ids integer[])
RETURNS integer[]
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE up (id, parent_id, org_type, depth, path) AS (
    SELECT o.id, o.parent_id, o.org_type::text, 1, ARRAY[o.id]
    FROM public.orgs o
    WHERE o.id = ANY (seed_ids)
    UNION ALL
    SELECT p.id, p.parent_id, p.org_type::text, u.depth + 1, u.path || p.id
    FROM up u
    JOIN public.orgs p ON p.id = u.parent_id
    WHERE u.depth <= 20 AND p.id <> ALL (u.path)
  )
  SELECT array_agg(DISTINCT u.id)
  FROM up u
  WHERE u.org_type NOT IN ('ao', 'nation')
$$;--> statement-breakpoint

-- Read-only: the count each target should hold. NULL targets every
-- count-carrying organization. Compare with orgs.ao_count to audit drift.
CREATE OR REPLACE FUNCTION public.org_ao_count_expected(target_ids integer[] DEFAULT NULL)
RETURNS TABLE (org_id integer, expected integer)
LANGUAGE sql
STABLE
AS $$
  WITH RECURSIVE targets AS (
    SELECT o.id
    FROM public.orgs o
    WHERE o.org_type::text NOT IN ('ao', 'nation')
      AND (target_ids IS NULL OR o.id = ANY (target_ids))
  ),
  subtree (root_id, id, org_type, is_active, depth, path) AS (
    SELECT t.id, c.id, c.org_type::text, c.is_active, 1, ARRAY[t.id, c.id]
    FROM targets t
    JOIN public.orgs c ON c.parent_id = t.id
    UNION ALL
    SELECT s.root_id, c.id, c.org_type::text, c.is_active, s.depth + 1, s.path || c.id
    FROM subtree s
    JOIN public.orgs c ON c.parent_id = s.id
    WHERE s.is_active AND s.org_type <> 'ao' AND s.depth < 20 AND c.id <> ALL (s.path)
  )
  SELECT
    t.id,
    COALESCE(count(s.id) FILTER (WHERE s.org_type = 'ao' AND s.is_active), 0)::integer
  FROM targets t
  LEFT JOIN subtree s ON s.root_id = t.id
  GROUP BY t.id
$$;--> statement-breakpoint

-- Recomputes ao_count for the count-carrying ancestors of seed_ids (NULL: every
-- count-carrying organization) and returns how many rows changed. Rows are
-- locked in id order before counting, so the count runs on a snapshot that
-- includes concurrently committed AOs and two recounts cannot deadlock.
CREATE OR REPLACE FUNCTION public.recount_org_ao_counts(seed_ids integer[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  target_ids integer[];
  changed integer;
BEGIN
  IF seed_ids IS NULL THEN
    SELECT array_agg(o.id) INTO target_ids
    FROM public.orgs o
    WHERE o.org_type::text NOT IN ('ao', 'nation');
  ELSE
    target_ids := public.org_ao_count_targets(seed_ids);
  END IF;

  IF target_ids IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM 1
  FROM public.orgs o
  WHERE o.id = ANY (target_ids)
  ORDER BY o.id
  FOR NO KEY UPDATE;

  UPDATE public.orgs o
  SET ao_count = e.expected
  FROM public.org_ao_count_expected(target_ids) e
  WHERE o.id = e.org_id
    AND o.ao_count IS DISTINCT FROM e.expected;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;--> statement-breakpoint

-- Fires after any change to an organization. Only a new or deleted row, or a
-- change to parent_id, is_active, or org_type, can alter a count; the recount's
-- own ao_count writes and ordinary edits exit before doing any work.
CREATE OR REPLACE FUNCTION public.update_org_ao_counts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  seeds integer[];
BEGIN
  IF COALESCE(NULLIF(current_setting('app.disable_ao_count_trigger', TRUE), '')::boolean, FALSE) THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    seeds := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    seeds := ARRAY[OLD.parent_id];
  ELSE
    IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
       AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
       AND NEW.org_type::text = OLD.org_type::text THEN
      RETURN NULL;
    END IF;
    -- The new chain (from the row itself) and the old chain (from its old parent).
    seeds := ARRAY[NEW.id, OLD.parent_id];
  END IF;

  PERFORM public.recount_org_ao_counts(seeds);
  RETURN NULL;
END;
$$;--> statement-breakpoint

DO $$
DECLARE
  corrected integer;
BEGIN
  corrected := public.recount_org_ao_counts();
  RAISE NOTICE 'ao_count backfill corrected % organization(s)', corrected;
END;
$$;
