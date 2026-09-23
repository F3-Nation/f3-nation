WITH params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
q_data AS (
    SELECT a.event_instance_id,
           STRING_AGG(u.f3_name, ', ' ORDER BY u.f3_name) AS q_names
    FROM pg.public.attendance a
    JOIN pg.public.attendance_x_attendance_types axat ON a.id = axat.attendance_id
    JOIN pg.public.attendance_types atype ON axat.attendance_type_id = atype.id
    JOIN pg.public.users u ON a.user_id = u.id
    WHERE atype.type = 'Q'
    GROUP BY a.event_instance_id
)
SELECT COALESCE(q_data.q_names, 'No Q Listed') AS q_who,
       rl.name AS region_name, ao.name AS ao_name, ei.start_date, ei.start_time
FROM pg.public.event_instances ei
JOIN pg.public.orgs ao ON ei.org_id = ao.id
JOIN pg.public.orgs rl ON ao.parent_id = rl.id
LEFT JOIN q_data ON ei.id = q_data.event_instance_id
CROSS JOIN params p
WHERE ei.pax_count IS NULL
  AND ei.start_date <= p.as_of_date
  AND ei.is_active = TRUE
ORDER BY ei.start_date DESC
