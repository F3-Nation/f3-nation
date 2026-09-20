WITH params AS (SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date),
ao_rows AS (
    SELECT ao.id AS ao_id, COALESCE(ao.name, CAST(ao.id AS VARCHAR)) AS ao_name,
           region.id AS region_id, COALESCE(region.name, CAST(region.id AS VARCHAR)) AS region_name,
           ao.logo_url, ao.is_active, p.refreshed_at
    FROM pg.public.orgs ao
    LEFT JOIN pg.public.orgs region ON region.id = ao.parent_id AND region.org_type = 'region'
    CROSS JOIN params p
    WHERE ao.org_type = 'ao'
),
eligible_events AS (
    SELECT ei.id AS event_instance_id, ei.org_id
    FROM pg.public.event_instances ei
    WHERE ei.is_active = true AND ei.pax_count IS NOT NULL
),
ao_values AS (
    SELECT a.*,
           COALESCE((SELECT list(struct_pack(type_id := x.id, type_name := x.type_name)
                                 ORDER BY x.type_name, x.id)
                    FROM (SELECT DISTINCT et.id, COALESCE(et.name, CAST(et.id AS VARCHAR)) AS type_name
                          FROM eligible_events e
                          JOIN pg.public.event_instances_x_event_types eit ON eit.event_instance_id = e.event_instance_id
                          JOIN pg.public.event_types et ON et.id = eit.event_type_id
                          WHERE e.org_id = a.ao_id) x),
                    []::STRUCT(type_id INTEGER, type_name VARCHAR)[]) AS types,
           COALESCE((SELECT list(struct_pack(tag_id := x.id, tag_name := x.tag_name)
                                 ORDER BY x.tag_name, x.id)
                    FROM (SELECT DISTINCT t.id, COALESCE(t.name, CAST(t.id AS VARCHAR)) AS tag_name
                          FROM eligible_events e
                          JOIN pg.public.event_tags_x_event_instances eti ON eti.event_instance_id = e.event_instance_id
                          JOIN pg.public.event_tags t ON t.id = eti.event_tag_id
                          WHERE e.org_id = a.ao_id) x),
                    []::STRUCT(tag_id INTEGER, tag_name VARCHAR)[]) AS tags
    FROM ao_rows a
)
SELECT refreshed_at, ao_id, ao_name, region_id, region_name, logo_url, is_active, types, tags
FROM ao_values
ORDER BY ao_name, ao_id
