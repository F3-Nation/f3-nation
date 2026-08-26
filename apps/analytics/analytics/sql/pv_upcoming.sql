WITH params AS (SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date),
upcoming AS (
    SELECT ei.id AS event_instance_id, ei.start_date, ei.start_time,
           COALESCE(ao.name, CAST(ao.id AS VARCHAR)) AS ao_name, ao.id AS ao_org_id,
           region.id AS region_org_id, l.name AS location_name, COALESCE(ei.name, e.name) AS event_name,
           p.refreshed_at
    FROM pg.public.event_instances ei
    LEFT JOIN pg.public.events e ON e.id = ei.series_id
    LEFT JOIN pg.public.locations l ON l.id = ei.location_id
    LEFT JOIN pg.public.orgs ao ON ao.id = ei.org_id
    LEFT JOIN pg.public.orgs region ON region.id = ao.parent_id AND region.org_type = 'region'
    CROSS JOIN params p
    WHERE ei.is_active = true AND ei.start_date > p.as_of_date
),
event_types AS (
    SELECT eit.event_instance_id,
           string_agg(DISTINCT COALESCE(et.name, CAST(et.id AS VARCHAR)), ', '
                      ORDER BY COALESCE(et.name, CAST(et.id AS VARCHAR))) AS event_type,
           et.event_category
    FROM pg.public.event_instances_x_event_types eit
    JOIN pg.public.event_types et ON et.id = eit.event_type_id
    GROUP BY eit.event_instance_id, et.event_category
),
with_types AS (
    SELECT u.*, t.event_type, t.event_category
    FROM upcoming u
    LEFT JOIN event_types t ON t.event_instance_id = u.event_instance_id
),
with_qs AS (
    SELECT u.*,
           COALESCE((SELECT list(struct_pack(user_id := x.user_id,
                                             f3_name := COALESCE(NULLIF(x.f3_name, ''), CAST(x.user_id AS VARCHAR)),
                                             avatar_url := x.avatar_url)
                                 ORDER BY COALESCE(NULLIF(x.f3_name, ''), CAST(x.user_id AS VARCHAR)), x.user_id)
                    FROM (SELECT DISTINCT a.user_id, usr.f3_name, usr.avatar_url
                          FROM pg.public.attendance a
                          JOIN pg.public.attendance_x_attendance_types ax ON ax.attendance_id = a.id
                          JOIN pg.public.attendance_types att ON att.id = ax.attendance_type_id
                          JOIN pg.public.users usr ON usr.id = a.user_id
                          WHERE a.event_instance_id = u.event_instance_id AND att.type = 'Q') x),
                    []::STRUCT(user_id INTEGER, f3_name VARCHAR, avatar_url VARCHAR)[]) AS q_list
    FROM with_types u
)
SELECT refreshed_at, start_date, start_time, ao_name, ao_org_id, region_org_id, location_name,
       event_name, event_type, event_category, q_list
FROM with_qs
ORDER BY start_date, event_instance_id
