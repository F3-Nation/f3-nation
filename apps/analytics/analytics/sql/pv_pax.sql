WITH params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
user_base AS (
    SELECT u.id AS user_id,
           COALESCE(NULLIF(u.f3_name, ''), CAST(u.id AS VARCHAR)) AS f3_name,
           u.home_region_id,
           u.avatar_url,
           u.status,
           CASE
             WHEN json_type(CAST(u.meta AS JSON), '$.start_date_override') IN
                  ('VARCHAR', 'BIGINT', 'UBIGINT', 'DOUBLE', 'BOOLEAN')
               THEN json_extract_string(CAST(u.meta AS JSON), '$.start_date_override')
           END AS start_date_override
    FROM pg.public.users u
    WHERE u.email IS NOT NULL
      AND regexp_matches(u.email, '^[^\s@]+@[^\s@]+\.[^\s@]+$')
),
eligible_events AS (
    SELECT ei.id AS event_id,
           CASE WHEN direct.org_type = 'region' THEN direct.id
                WHEN direct.org_type = 'ao' AND parent.org_type = 'region' THEN parent.id END AS region_id,
           CASE WHEN direct.org_type = 'ao' AND parent.org_type = 'region' THEN direct.id END AS ao_id,
           CASE WHEN direct.org_type = 'ao' AND parent.org_type = 'region' THEN
                COALESCE(direct.name, CAST(direct.id AS VARCHAR)) END AS ao_name
    FROM pg.public.event_instances ei
    JOIN pg.public.orgs direct ON direct.id = ei.org_id
    LEFT JOIN pg.public.orgs parent ON parent.id = direct.parent_id
    WHERE ei.is_active = true AND ei.pax_count IS NOT NULL
),
observed AS (
    SELECT DISTINCT a.user_id, e.event_id, e.region_id, e.ao_id, e.ao_name
    FROM pg.public.attendance a
    JOIN eligible_events e ON e.event_id = a.event_instance_id
    WHERE a.user_id IS NOT NULL AND a.is_planned = false AND e.region_id IS NOT NULL
),
region_values AS (
    SELECT u.*, hr.name AS home_region_name,
           COALESCE((SELECT list(struct_pack(region_org_id := x.region_org_id, region_name := x.region_name)
                                 ORDER BY x.region_name, x.region_org_id)
                     FROM (SELECT DISTINCT o.region_id AS region_org_id,
                                           COALESCE(r.name, CAST(r.id AS VARCHAR)) AS region_name
                           FROM observed o JOIN pg.public.orgs r ON r.id = o.region_id
                           WHERE o.user_id = u.user_id) x),
                    []::STRUCT(region_org_id INTEGER, region_name VARCHAR)[]) AS regions,
           COALESCE((SELECT list(struct_pack(ao_org_id := x.ao_org_id, ao_name := x.ao_name)
                                 ORDER BY x.ao_name, x.ao_org_id)
                     FROM (SELECT DISTINCT ao_id AS ao_org_id, ao_name FROM observed
                           WHERE user_id = u.user_id AND ao_id IS NOT NULL) x),
                    []::STRUCT(ao_org_id INTEGER, ao_name VARCHAR)[]) AS aos
    FROM user_base u LEFT JOIN pg.public.orgs hr ON hr.id = u.home_region_id
)
SELECT p.refreshed_at, r.user_id, r.f3_name, r.home_region_id, r.home_region_name,
       r.avatar_url, r.status, r.start_date_override, r.regions, r.aos,
       COALESCE((SELECT list(struct_pack(type_id := x.id, type_name := x.name) ORDER BY x.name, x.id)
                 FROM (SELECT DISTINCT et.id, COALESCE(et.name, CAST(et.id AS VARCHAR)) AS name
                       FROM observed o JOIN pg.public.event_instances_x_event_types xt ON xt.event_instance_id = o.event_id
                       JOIN pg.public.event_types et ON et.id = xt.event_type_id WHERE o.user_id = r.user_id) x),
                []::STRUCT(type_id INTEGER, type_name VARCHAR)[]) AS types,
       COALESCE((SELECT list(struct_pack(tag_id := x.id, tag_name := x.name) ORDER BY x.name, x.id)
                 FROM (SELECT DISTINCT t.id, COALESCE(t.name, CAST(t.id AS VARCHAR)) AS name
                       FROM observed o JOIN pg.public.event_tags_x_event_instances xt ON xt.event_instance_id = o.event_id
                       JOIN pg.public.event_tags t ON t.id = xt.event_tag_id WHERE o.user_id = r.user_id) x),
                []::STRUCT(tag_id INTEGER, tag_name VARCHAR)[]) AS tags
FROM region_values r CROSS JOIN params p
ORDER BY r.f3_name, r.user_id
