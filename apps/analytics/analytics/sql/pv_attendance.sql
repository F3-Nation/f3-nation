WITH RECURSIVE params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
org_ancestors(source_id, ancestor_id, ancestor_type, visited) AS (
    SELECT id, id, org_type, [id]
    FROM pg.public.orgs
    UNION ALL
    SELECT a.source_id, parent.id, parent.org_type, list_append(a.visited, parent.id)
    FROM org_ancestors a
    JOIN pg.public.orgs child ON child.id = a.ancestor_id
    JOIN pg.public.orgs parent ON parent.id = child.parent_id
    WHERE NOT list_contains(a.visited, parent.id) AND len(a.visited) < 20
),
org_chain AS (
    SELECT source_id,
           MAX(ancestor_id) FILTER (WHERE ancestor_type = 'ao')::INTEGER AS ao_org_id,
           MAX(ancestor_id) FILTER (WHERE ancestor_type = 'region')::INTEGER AS region_org_id
    FROM org_ancestors
    GROUP BY source_id
),
eligible_events AS (
    SELECT ei.id, ei.start_date, c.ao_org_id, c.region_org_id
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
           list(DISTINCT t.id ORDER BY t.id) AS types,
           list(DISTINCT t.event_category ORDER BY t.event_category)
               FILTER (WHERE t.event_category IS NOT NULL) AS categories
    FROM pg.public.event_instances_x_event_types x
    JOIN pg.public.event_types t ON t.id = x.event_type_id
    JOIN eligible_events e ON e.id = x.event_instance_id
    GROUP BY x.event_instance_id
),
event_tags AS (
    SELECT x.event_instance_id AS event_id,
           list(DISTINCT t.id ORDER BY t.id) AS tags
    FROM pg.public.event_tags_x_event_instances x
    JOIN pg.public.event_tags t ON t.id = x.event_tag_id
    JOIN eligible_events e ON e.id = x.event_instance_id
    GROUP BY x.event_instance_id
),
valid_attendance AS (
    SELECT a.id, a.user_id, a.event_instance_id, e.start_date, e.ao_org_id, e.region_org_id
    FROM pg.public.attendance a
    JOIN pg.public.users u ON u.id = a.user_id
    JOIN eligible_events e ON e.id = a.event_instance_id
    WHERE a.is_planned = false
      AND u.email IS NOT NULL
      AND regexp_matches(CAST(u.email AS VARCHAR), '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
),
attendance_flags AS (
    SELECT a.id AS attendance_id,
           COALESCE(bool_or(t.type = 'Q'), false)::INTEGER AS q_ind,
           COALESCE(bool_or(t.type IN ('Co-Q', 'CoQ')), false)::INTEGER AS coq_ind
    FROM valid_attendance a
    LEFT JOIN pg.public.attendance_x_attendance_types x ON x.attendance_id = a.id
    LEFT JOIN pg.public.attendance_types t ON t.id = x.attendance_type_id
    GROUP BY a.id
)
SELECT p.refreshed_at, a.id, a.user_id, a.event_instance_id,
       f.q_ind, f.coq_ind, a.start_date, a.ao_org_id, a.region_org_id,
       COALESCE(et.tags, []::INTEGER[]) AS tags,
       COALESCE(ty.types, []::INTEGER[]) AS types,
       COALESCE(ty.categories, []::VARCHAR[]) AS categories
FROM valid_attendance a
JOIN attendance_flags f ON f.attendance_id = a.id
LEFT JOIN event_types ty ON ty.event_id = a.event_instance_id
LEFT JOIN event_tags et ON et.event_id = a.event_instance_id
CROSS JOIN params p
ORDER BY a.start_date, a.event_instance_id, a.id
