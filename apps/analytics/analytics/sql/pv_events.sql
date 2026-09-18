WITH RECURSIVE params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
org_ancestors(source_id, ancestor_id, ancestor_name, ancestor_type, visited) AS (
    SELECT id, id, COALESCE(name, CAST(id AS VARCHAR)), org_type, [id]
    FROM pg.public.orgs
    UNION ALL
    SELECT a.source_id, parent.id, COALESCE(parent.name, CAST(parent.id AS VARCHAR)), parent.org_type,
           list_append(a.visited, parent.id)
    FROM org_ancestors a
    JOIN pg.public.orgs child ON child.id = a.ancestor_id
    JOIN pg.public.orgs parent ON parent.id = child.parent_id
    WHERE NOT list_contains(a.visited, parent.id) AND len(a.visited) < 20
),
org_chain AS (
    SELECT source_id,
           MAX(ancestor_id) FILTER (WHERE ancestor_type = 'ao')::INTEGER AS ao_org_id,
           MAX(ancestor_name) FILTER (WHERE ancestor_type = 'ao') AS ao_name,
           MAX(ancestor_id) FILTER (WHERE ancestor_type = 'region')::INTEGER AS region_org_id,
           MAX(ancestor_name) FILTER (WHERE ancestor_type = 'region') AS region_name,
           MAX(ancestor_id) FILTER (WHERE ancestor_type = 'area')::INTEGER AS area_org_id,
           MAX(ancestor_name) FILTER (WHERE ancestor_type = 'area') AS area_name,
           MAX(ancestor_id) FILTER (WHERE ancestor_type = 'sector')::INTEGER AS sector_org_id,
           MAX(ancestor_name) FILTER (WHERE ancestor_type = 'sector') AS sector_name,
           MAX(ancestor_id) FILTER (WHERE ancestor_type = 'territory')::INTEGER AS territory_org_id,
           MAX(ancestor_name) FILTER (WHERE ancestor_type = 'territory') AS territory_name
    FROM org_ancestors GROUP BY source_id
),
events AS (
    SELECT ei.*, c.* EXCLUDE (source_id)
    FROM pg.public.event_instances ei
    JOIN org_chain c ON c.source_id = ei.org_id
    WHERE ei.is_active = true AND ei.pax_count IS NOT NULL
      AND CASE
        WHEN json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') IS NULL THEN false
        WHEN json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') = 'NULL' THEN false
        WHEN json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') <> 'BOOLEAN'
          THEN error('exclude_from_pax_vault must be boolean')
        ELSE COALESCE(json_extract(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault')::BOOLEAN, false)
      END = false
),
event_types AS (
    SELECT x.event_instance_id AS event_id,
           bool_or(t.event_category = 'first_f')::INTEGER AS first_f_ind,
           bool_or(t.event_category = 'second_f')::INTEGER AS second_f_ind,
           bool_or(t.event_category = 'third_f')::INTEGER AS third_f_ind,
           list(struct_pack(id := t.id, name := t.name, description := t.description,
                            event_category := t.event_category)
                ORDER BY t.name, t.id) AS types
    FROM pg.public.event_instances_x_event_types x
    JOIN pg.public.event_types t ON t.id = x.event_type_id
    JOIN events e ON e.id = x.event_instance_id
    GROUP BY x.event_instance_id
),
event_tags AS (
    SELECT x.event_instance_id AS event_id,
           list(struct_pack(id := t.id, name := t.name, description := t.description)
                ORDER BY t.name, t.id) AS tags
    FROM pg.public.event_tags_x_event_instances x
    JOIN pg.public.event_tags t ON t.id = x.event_tag_id
    JOIN events e ON e.id = x.event_instance_id
    GROUP BY x.event_instance_id
),
valid_attendance AS (
    SELECT a.*, u.f3_name, u.avatar_url
    FROM pg.public.attendance a
    JOIN pg.public.users u ON u.id = a.user_id
    WHERE u.email IS NOT NULL
      AND regexp_matches(CAST(u.email AS VARCHAR), '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
),
attendance_users_grouped AS (
    SELECT a.event_instance_id AS event_id, a.user_id, max(a.f3_name) AS f3_name,
           max(a.avatar_url) AS avatar_url,
           bool_or(a.is_planned = false) AS attended,
           bool_or(a.is_planned = true) AS planned,
           bool_or(a.is_planned = false AND aty.type = 'Q')::INTEGER AS q_ind,
           bool_or(a.is_planned = false AND aty.type IN ('Co-Q', 'CoQ'))::INTEGER AS coq_ind
    FROM valid_attendance a
    JOIN events e ON e.id = a.event_instance_id
    LEFT JOIN pg.public.attendance_x_attendance_types ax ON ax.attendance_id = a.id
    LEFT JOIN pg.public.attendance_types aty ON aty.id = ax.attendance_type_id
    GROUP BY a.event_instance_id, a.user_id
),
attendance_users AS (
    SELECT a.*,
           max(a.planned) OVER (PARTITION BY a.event_id) AS event_has_planned
    FROM attendance_users_grouped a
),
attendance_lists AS (
    SELECT a.event_id,
           list(struct_pack(user_id := a.user_id, f3_name := a.f3_name,
                            q_ind := COALESCE(a.q_ind, 0), coq_ind := COALESCE(a.coq_ind, 0),
                            avatar_url := a.avatar_url, attended := COALESCE(a.attended, false),
                            ghost := (a.attended AND NOT a.planned AND a.event_has_planned),
                            fartsack := (a.planned AND NOT a.attended))
                ORDER BY a.f3_name, a.user_id) AS attendance
    FROM attendance_users a
    GROUP BY a.event_id
)
SELECT p.refreshed_at, e.id AS event_id, e.start_date AS event_date, e.name AS event_name,
       e.pax_count, e.fng_count,
       e.ao_org_id, e.ao_name, e.region_org_id, e.region_name,
       e.area_org_id, e.area_name, e.territory_org_id, e.territory_name, e.sector_org_id, e.sector_name,
       COALESCE(et.first_f_ind, 0) AS first_f_ind, COALESCE(et.second_f_ind, 0) AS second_f_ind,
       COALESCE(et.third_f_ind, 0) AS third_f_ind,
       COALESCE(et.types, []::STRUCT(id INTEGER, name VARCHAR, description VARCHAR, event_category VARCHAR)[]) AS types,
       COALESCE(eg.tags, []::STRUCT(id INTEGER, name VARCHAR, description VARCHAR)[]) AS tags,
       COALESCE(al.attendance, []::STRUCT(user_id INTEGER, f3_name VARCHAR, q_ind INTEGER, coq_ind INTEGER,
                                           avatar_url VARCHAR, attended BOOLEAN, ghost BOOLEAN, fartsack BOOLEAN)[]) AS attendance
FROM events e
LEFT JOIN event_types et ON et.event_id = e.id
LEFT JOIN event_tags eg ON eg.event_id = e.id
LEFT JOIN attendance_lists al ON al.event_id = e.id
CROSS JOIN params p
ORDER BY e.start_date, e.id
