WITH
params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
event_source AS (
    SELECT ei.*,
           CASE
             WHEN json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') IN ('BOOLEAN', 'NULL')
               THEN COALESCE(json_extract(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault')::BOOLEAN, false)
             ELSE false
           END AS excluded
    FROM pg.public.event_instances ei
    WHERE ei.is_active = true AND ei.pax_count IS NOT NULL
),
eligible_events AS (
    SELECT e.id AS event_id, e.name AS event_name, e.start_date::DATE AS event_date,
           CASE WHEN direct.org_type = 'ao' THEN direct.id END AS ao_id,
           CASE WHEN direct.org_type = 'ao'
                THEN COALESCE(direct.name, CAST(direct.id AS VARCHAR)) END AS ao_name
    FROM event_source e
    JOIN pg.public.orgs direct ON direct.id = e.org_id
    WHERE NOT e.excluded
),
actual_attendance AS (
    SELECT DISTINCT a.user_id, e.event_id, e.event_name, e.event_date, e.ao_id, e.ao_name,
           u.f3_name, u.avatar_url, u.home_region_id
    FROM pg.public.attendance a
    JOIN eligible_events e ON e.event_id = a.event_instance_id
    JOIN pg.public.users u ON u.id = a.user_id
    WHERE a.is_planned = false
      AND u.email IS NOT NULL
      AND regexp_matches(CAST(u.email AS VARCHAR), '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
),
latest_identity AS (
    SELECT user_id,
           COALESCE(NULLIF(f3_name, ''), CAST(user_id AS VARCHAR)) AS f3_name,
           avatar_url,
           home_region_id,
           row_number() OVER (PARTITION BY user_id ORDER BY event_date DESC, event_id DESC) AS identity_rank
    FROM actual_attendance
),
latest_events AS (
    SELECT user_id, event_name AS last_event_name, ao_name AS last_event_ao_name,
           ao_id AS last_event_ao_org_id,
           row_number() OVER (PARTITION BY user_id ORDER BY event_date DESC, event_id DESC) AS event_rank
    FROM actual_attendance
),
lifetime AS (
    SELECT a.user_id,
           ANY_VALUE(a.home_region_id ORDER BY a.event_date DESC, a.event_id DESC) AS home_region_id,
           COUNT(DISTINCT a.event_id)::INTEGER AS total_events,
           MIN(a.event_date) AS first_event_date,
           MAX(a.event_date) AS last_event_date,
           date_diff('day', MAX(a.event_date), p.as_of_date)::INTEGER AS days_since_last_event,
           date_diff('day', MIN(a.event_date), p.as_of_date)::INTEGER AS days_since_first_event,
           COUNT(DISTINCT a.event_id) FILTER (WHERE a.event_date >= p.as_of_date - INTERVAL 30 DAY)::INTEGER AS events_last30,
           COUNT(DISTINCT a.event_id) FILTER (WHERE a.event_date >= p.as_of_date - INTERVAL 90 DAY)::INTEGER AS events_last90,
           COUNT(DISTINCT a.ao_id) FILTER (WHERE a.event_date >= p.as_of_date - INTERVAL 90 DAY AND a.ao_id IS NOT NULL)::INTEGER AS unique_aos_last_90,
           COUNT(DISTINCT a.event_id)::DOUBLE * 30 /
             GREATEST(1, date_diff('day', MIN(a.event_date), p.as_of_date)) AS avg_lifetime_per_month
    FROM actual_attendance a CROSS JOIN params p
    GROUP BY a.user_id, p.as_of_date
),
candidates AS (
    SELECT * FROM lifetime WHERE days_since_last_event BETWEEN 14 AND 90
),
co_attendance_pairs AS (
    SELECT a.user_id, b.user_id AS bestie_user_id, COUNT(DISTINCT a.event_id)::INTEGER AS co_attendance_count
    FROM actual_attendance a
    JOIN actual_attendance b ON b.event_id = a.event_id AND b.user_id <> a.user_id
    JOIN candidates c ON c.user_id = a.user_id
    GROUP BY a.user_id, b.user_id
),
besties AS (
    SELECT x.user_id,
           COALESCE(
             list(struct_pack(user_id := x.bestie_user_id,
                              f3_name := i.f3_name,
                              avatar_url := i.avatar_url,
                              co_attendance_count := x.co_attendance_count)
                  ORDER BY x.co_attendance_count DESC, x.bestie_user_id ASC)[:3],
             []::STRUCT(user_id INTEGER, f3_name VARCHAR, avatar_url VARCHAR, co_attendance_count INTEGER)[]
           ) AS bestie_list
    FROM co_attendance_pairs x
    LEFT JOIN latest_identity i ON i.user_id = x.bestie_user_id AND i.identity_rank = 1
    GROUP BY x.user_id
),
classified AS (
    SELECT c.user_id, c.home_region_id, i.f3_name, i.avatar_url,
           CASE
             WHEN c.total_events <= 6 AND c.days_since_last_event >= 14 AND c.days_since_first_event <= 90 THEN 'New PAX Drop'
             WHEN c.total_events >= 100 AND c.avg_lifetime_per_month >= 4 AND c.days_since_last_event >= 21 THEN 'Veteran Drift'
             WHEN c.total_events >= 50 AND c.avg_lifetime_per_month >= 2
                  AND c.events_last90 / 3.0 <= 0.5 AND c.days_since_last_event BETWEEN 30 AND 120
                  AND c.unique_aos_last_90 <= 2 THEN 'Seasonal'
             WHEN c.total_events BETWEEN 7 AND 99 AND c.days_since_last_event BETWEEN 21 AND 45 THEN 'Soft Drift'
             WHEN c.days_since_last_event < 14 THEN 'Active'
             ELSE 'Inactive'
           END AS kotter_status,
           c.total_events, CAST(c.first_event_date AS VARCHAR) AS first_event_date,
           c.days_since_last_event, CAST(c.last_event_date AS VARCHAR) AS last_event_date,
           e.last_event_name, e.last_event_ao_name, e.last_event_ao_org_id,
           COALESCE(
             b.bestie_list,
             []::STRUCT(user_id INTEGER, f3_name VARCHAR, avatar_url VARCHAR, co_attendance_count INTEGER)[]
           ) AS bestie_list
    FROM candidates c
    JOIN latest_identity i ON i.user_id = c.user_id AND i.identity_rank = 1
    JOIN latest_events e ON e.user_id = c.user_id AND e.event_rank = 1
    LEFT JOIN besties b ON b.user_id = c.user_id
)
SELECT user_id, home_region_id, f3_name, avatar_url, kotter_status, total_events,
       first_event_date, days_since_last_event, last_event_date, last_event_name,
       last_event_ao_name, last_event_ao_org_id, bestie_list
FROM classified
ORDER BY days_since_last_event ASC, f3_name ASC
