SET LOCAL lock_timeout = '3s';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class
    WHERE oid = 'public.slack_users'::regclass
      AND pg_catalog.pg_has_role(current_user, relowner, 'USAGE')
  ) THEN
    RAISE EXCEPTION 'Slack identity migration requires table-owner privileges on public.slack_users';
  END IF;
END $$;
--> statement-breakpoint
LOCK TABLE public.slack_users IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  duplicate_group record;
  updated_trigger_mode text;
  conflict_count integer;
BEGIN
  -- Freeze the candidate set so validation and repair use the same mapping.
  CREATE TEMP TABLE slack_identity_legacy_targets ON COMMIT DROP AS
  SELECT legacy.id, min(space.team_id) AS team_id
  FROM public.slack_users AS legacy
  JOIN public.users AS member ON member.id = legacy.user_id
  JOIN public.orgs_x_slack_spaces AS mapping ON mapping.org_id = member.home_region_id
  JOIN public.slack_spaces AS space ON space.id = mapping.slack_space_id
  WHERE legacy.slack_team_id = 'NOT FOUND'
  GROUP BY legacy.id
  HAVING count(DISTINCT space.team_id) = 1
    AND min(space.team_id) <> 'NOT FOUND';

  SELECT count(*) INTO conflict_count
  FROM public.slack_users AS legacy
  LEFT JOIN pg_temp.slack_identity_legacy_targets AS target ON target.id = legacy.id
  WHERE legacy.slack_team_id = 'NOT FOUND'
    AND (target.id IS NULL OR EXISTS (
      SELECT 1 FROM public.slack_users AS existing
      WHERE existing.slack_id = legacy.slack_id AND existing.slack_team_id = target.team_id
    ));
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Slack legacy workspace reconciliation requires manual resolution'
      USING DETAIL = format('%s unresolved legacy identities', conflict_count),
            HINT = 'Verify home-region workspace mappings and destination collisions before retrying.';
  END IF;

  SELECT tgenabled::text INTO updated_trigger_mode
  FROM pg_catalog.pg_trigger
  WHERE tgrelid = 'public.slack_users'::regclass
    AND tgname = 'set_updated_slack_users'
    AND NOT tgisinternal;

  -- Integration repair preserves profile timestamps and the trigger's original mode.
  IF updated_trigger_mode IN ('O', 'R', 'A') THEN
    ALTER TABLE public.slack_users DISABLE TRIGGER set_updated_slack_users;
  END IF;

  UPDATE public.slack_users AS legacy
  SET slack_team_id = target.team_id
  FROM pg_temp.slack_identity_legacy_targets AS target
  WHERE legacy.id = target.id;

  SELECT count(*) INTO conflict_count FROM (
    SELECT 1
    FROM public.slack_users
    GROUP BY slack_id, slack_team_id
    HAVING count(*) > 1
      AND (
        count(DISTINCT user_id) > 1
        OR count(*) FILTER (WHERE
          strava_access_token IS NOT NULL
          OR strava_refresh_token IS NOT NULL
          OR strava_expires_at IS NOT NULL
          OR strava_athlete_id IS NOT NULL
          OR meta IS NOT NULL
        ) > 1
      )
  ) AS conflicting_groups;
  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Slack identity reconciliation requires manual resolution'
      USING DETAIL = format('%s ambiguous (slack_id, slack_team_id) groups', conflict_count),
            HINT = 'Resolve groups with distinct user_id or more than one data-bearing row, then rerun.';
  END IF;

  FOR duplicate_group IN
    SELECT
      array_agg(id ORDER BY
        (user_id IS NOT NULL) DESC,
        (strava_access_token IS NOT NULL
          OR strava_refresh_token IS NOT NULL
          OR strava_expires_at IS NOT NULL
          OR strava_athlete_id IS NOT NULL
          OR meta IS NOT NULL) DESC,
        id
      ) AS row_ids,
      (array_agg(id) FILTER (WHERE
        strava_access_token IS NOT NULL
        OR strava_refresh_token IS NOT NULL
        OR strava_expires_at IS NOT NULL
        OR strava_athlete_id IS NOT NULL
        OR meta IS NOT NULL
      ))[1] AS donor_id
    FROM public.slack_users
    GROUP BY slack_id, slack_team_id
    HAVING count(*) > 1
  LOOP
    IF duplicate_group.donor_id IS NOT NULL
      AND duplicate_group.donor_id <> duplicate_group.row_ids[1] THEN
      UPDATE public.slack_users AS survivor
      SET (strava_access_token, strava_refresh_token, strava_expires_at, strava_athlete_id, meta) = (
        SELECT strava_access_token, strava_refresh_token, strava_expires_at, strava_athlete_id, meta
        FROM public.slack_users
        WHERE id = duplicate_group.donor_id
      )
      WHERE survivor.id = duplicate_group.row_ids[1];
    END IF;

    DELETE FROM public.slack_users
    WHERE id = ANY(duplicate_group.row_ids)
      AND id <> duplicate_group.row_ids[1];
  END LOOP;

  CASE updated_trigger_mode
    WHEN 'O' THEN ALTER TABLE public.slack_users ENABLE TRIGGER set_updated_slack_users;
    WHEN 'R' THEN ALTER TABLE public.slack_users ENABLE REPLICA TRIGGER set_updated_slack_users;
    WHEN 'A' THEN ALTER TABLE public.slack_users ENABLE ALWAYS TRIGGER set_updated_slack_users;
    ELSE NULL;
  END CASE;
END $$;
--> statement-breakpoint
ALTER TABLE "slack_users" ADD CONSTRAINT "uq_slack_users_slack_id_team_id" UNIQUE("slack_id","slack_team_id");
