WITH params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
attendance_type_aggregate AS (
    SELECT x.attendance_id,
           SUM(CASE WHEN t.type = 'Q' THEN 1 ELSE 0 END) AS q_ind,
           SUM(CASE WHEN t.type = 'Co-Q' THEN 1 ELSE 0 END) AS coq_ind
    FROM pg.public.attendance_x_attendance_types x
    JOIN pg.public.attendance_types t ON t.id = x.attendance_type_id
    GROUP BY x.attendance_id
)
SELECT a.id, a.user_id, a.event_instance_id, a.meta AS attendance_meta,
       a.created, a.updated, att.q_ind, att.coq_ind,
       u.f3_name, u.home_region_id, hr.name AS home_region_name,
       u.avatar_url, u.status AS user_statusa, ei.start_date
FROM pg.public.attendance a
LEFT JOIN attendance_type_aggregate att ON a.id = att.attendance_id
LEFT JOIN pg.public.users u ON a.user_id = u.id
LEFT JOIN pg.public.orgs hr ON u.home_region_id = hr.id
LEFT JOIN pg.public.event_instances ei ON a.event_instance_id = ei.id
CROSS JOIN params p
WHERE a.is_planned = FALSE
