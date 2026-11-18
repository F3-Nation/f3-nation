SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
-- The bot must already use the isolated store. Keep the audit trigger enabled:
-- its snapshots of this update are sanitized in the same transaction below.
CREATE FUNCTION pg_temp.strip_strava_metadata(value jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  IF value IS NULL OR value = 'null'::jsonb THEN RETURN value; END IF;
  IF jsonb_typeof(value) <> 'object' THEN
    RAISE EXCEPTION 'Strava migration requires object or null metadata';
  END IF;
  RETURN coalesce((SELECT jsonb_object_agg(key, val)
    FROM jsonb_each(value) AS fields(key, val)
    WHERE left(key, 7) <> 'strava_'), '{}'::jsonb);
END $$;
--> statement-breakpoint
DO $$
DECLARE source record;
BEGIN
  -- Validate only bundles that need importing. A newer connection for the same
  -- user wins even if legacy token values differ or are incomplete.
  FOR source IN
    SELECT u.id, u.meta FROM public.users u
    WHERE NOT EXISTS (SELECT 1 FROM public.user_strava_credentials c WHERE c.user_id = u.id)
    ORDER BY u.id
  LOOP
    -- The cursor predates reconnects that commit while an earlier insert waits.
    -- Recheck before validating legacy data that no longer needs importing.
    IF EXISTS (SELECT 1 FROM public.user_strava_credentials c WHERE c.user_id = source.id) THEN
      CONTINUE;
    END IF;
    PERFORM pg_temp.strip_strava_metadata(source.meta);
    IF source.meta IS NULL OR source.meta = 'null'::jsonb THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(source.meta) k WHERE left(k, 7) = 'strava_') THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(source.meta->'strava_access_token') IS DISTINCT FROM 'string'
       OR coalesce(length(source.meta->>'strava_access_token'), 0) = 0
       OR jsonb_typeof(source.meta->'strava_refresh_token') IS DISTINCT FROM 'string'
       OR coalesce(length(source.meta->>'strava_refresh_token'), 0) = 0
       OR jsonb_typeof(source.meta->'strava_athlete_id') IS DISTINCT FROM 'number'
       OR jsonb_typeof(source.meta->'strava_expires_at') IS DISTINCT FROM 'number'
       OR coalesce(source.meta->>'strava_athlete_id', '') !~ '^[1-9][0-9]*$'
       OR coalesce(source.meta->>'strava_expires_at', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Strava migration found an incomplete legacy bundle';
    END IF;
    BEGIN
      INSERT INTO public.user_strava_credentials(user_id, athlete_id, access_token, refresh_token, expires_at)
      VALUES(source.id, (source.meta->>'strava_athlete_id')::bigint,
        source.meta->>'strava_access_token', source.meta->>'strava_refresh_token',
        (source.meta->>'strava_expires_at')::bigint)
      ON CONFLICT (user_id) DO NOTHING;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'Strava migration found conflicting athlete ownership';
      WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RAISE EXCEPTION 'Strava migration found invalid legacy identifiers or expiry';
    END;
  END LOOP;
END $$;
--> statement-breakpoint
UPDATE public.users SET meta = pg_temp.strip_strava_metadata(meta)
WHERE meta IS DISTINCT FROM pg_temp.strip_strava_metadata(meta);
--> statement-breakpoint
-- These workspace-specific columns are obsolete; user metadata was the bot's
-- authoritative legacy store. Do not guess ownership by importing stale copies.
UPDATE public.slack_users SET strava_access_token = NULL, strava_refresh_token = NULL,
  strava_expires_at = NULL, strava_athlete_id = NULL
WHERE strava_access_token IS NOT NULL OR strava_refresh_token IS NOT NULL
  OR strava_expires_at IS NOT NULL OR strava_athlete_id IS NOT NULL;
--> statement-breakpoint
WITH sanitized AS (
  SELECT id,
    CASE WHEN old_row ? 'meta' THEN jsonb_set(old_row, '{meta}', pg_temp.strip_strava_metadata(old_row->'meta')) ELSE old_row END AS old_row,
    CASE WHEN new_row ? 'meta' THEN jsonb_set(new_row, '{meta}', pg_temp.strip_strava_metadata(new_row->'meta')) ELSE new_row END AS new_row
  FROM public_history.users
)
UPDATE public_history.users h SET old_row = s.old_row, new_row = s.new_row
FROM sanitized s WHERE h.id = s.id
AND (h.old_row IS DISTINCT FROM s.old_row OR h.new_row IS DISTINCT FROM s.new_row);
--> statement-breakpoint
DROP FUNCTION pg_temp.strip_strava_metadata(jsonb);
