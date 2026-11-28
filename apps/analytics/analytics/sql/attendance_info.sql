WITH params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
)
SELECT a.id, a.user_id, a.event_instance_id, CAST(a.meta AS JSON) AS attendance_meta,
       a.created, a.updated,
       CAST(a.attendance_type = 'q' AS DOUBLE) AS q_ind,
       CAST(a.attendance_type = 'co_q' AS DOUBLE) AS coq_ind,
       u.f3_name, u.home_region_id, hr.name AS home_region_name,
       u.avatar_url, u.status AS user_statusa, ei.start_date
FROM pg.public.attendance a
LEFT JOIN pg.public.users u ON a.user_id = u.id
LEFT JOIN pg.public.orgs hr ON u.home_region_id = hr.id
LEFT JOIN pg.public.event_instances ei ON a.event_instance_id = ei.id
CROSS JOIN params p
WHERE a.is_planned = FALSE
