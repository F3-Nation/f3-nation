WITH params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
type_aggregate AS (
    SELECT x.event_instance_id,
           SUM(CASE WHEN t.name = 'Bootcamp' THEN 1 ELSE 0 END) AS bootcamp_ind,
           SUM(CASE WHEN t.name = 'Run' THEN 1 ELSE 0 END) AS run_ind,
           SUM(CASE WHEN t.name = 'Ruck' THEN 1 ELSE 0 END) AS ruck_ind,
           SUM(CASE WHEN t.event_category = 'first_f' THEN 1 ELSE 0 END) AS first_f_ind,
           SUM(CASE WHEN t.event_category = 'second_f' THEN 1 ELSE 0 END) AS second_f_ind,
           SUM(CASE WHEN t.event_category = 'third_f' THEN 1 ELSE 0 END) AS third_f_ind,
           LIST(t.name ORDER BY t.name) AS all_types
    FROM pg.public.event_instances_x_event_types x
    JOIN pg.public.event_types t ON t.id = x.event_type_id
    GROUP BY x.event_instance_id
),
tag_aggregate AS (
    SELECT x.event_instance_id,
           SUM(CASE WHEN t.name = 'Pre-Workout' THEN 1 ELSE 0 END) AS pre_workout_ind,
           SUM(CASE WHEN t.name = 'Off-The-Books' THEN 1 ELSE 0 END) AS off_the_books_ind,
           SUM(CASE WHEN t.name = 'VQ' THEN 1 ELSE 0 END) AS vq_ind,
           SUM(CASE WHEN t.name = 'Convergence' THEN 1 ELSE 0 END) AS convergence_ind,
           LIST(t.name ORDER BY t.name) AS all_tags
    FROM pg.public.event_tags_x_event_instances x
    JOIN pg.public.event_tags t ON t.id = x.event_tag_id
    GROUP BY x.event_instance_id
)
SELECT ei.id, ei.org_id, ei.location_id, ei.series_id, ei.highlight,
       ei.start_date, ei.end_date, ei.start_time, ei.end_time, ei.name,
       ei.description, ei.pax_count, ei.fng_count, ei.preblast, ei.backblast,
       CAST(ei.meta AS JSON) AS meta, ei.created, ei.updated,
       e.name AS series_name, e.description AS series_description,
       o0.id AS ao_org_id, o0.name AS ao_name, o0.description AS ao_description,
       o0.logo_url AS ao_logo_url, o0.website AS ao_website, CAST(o0.meta AS JSON) AS ao_meta,
       COALESCE(o1.id, o2.id) AS region_org_id,
       COALESCE(o1.name, o2.name) AS region_name,
       COALESCE(o1.description, o2.description) AS region_description,
       COALESCE(o1.logo_url, o2.logo_url) AS region_logo_url,
       COALESCE(o1.website, o2.website) AS region_website,
       CAST(COALESCE(o1.meta, o2.meta) AS JSON) AS region_meta,
       o3.id AS area_org_id, o3.name AS area_name,
       o4.id AS territory_org_id, o4.name AS territory_name,
       o5.id AS sector_org_id, o5.name AS sector_name,
       l.name AS location_name, l.description AS location_description,
       l.latitude AS location_latitude, l.longitude AS location_longitude,
       tc.bootcamp_ind, tc.run_ind, tc.ruck_ind, tc.first_f_ind,
       tc.second_f_ind, tc.third_f_ind,
       ta.pre_workout_ind, ta.off_the_books_ind, ta.vq_ind, ta.convergence_ind,
       tc.all_types, ta.all_tags
FROM pg.public.event_instances ei
LEFT JOIN pg.public.events e ON ei.series_id = e.id
LEFT JOIN pg.public.orgs o0 ON ei.org_id = o0.id AND o0.org_type = 'ao'
LEFT JOIN pg.public.orgs o1 ON ei.org_id = o1.id AND o1.org_type = 'region'
LEFT JOIN pg.public.orgs o2 ON o0.parent_id = o2.id AND o2.org_type = 'region'
LEFT JOIN pg.public.orgs o3 ON COALESCE(o1.parent_id, o2.parent_id) = o3.id AND o3.org_type = 'area'
LEFT JOIN pg.public.orgs o4 ON o3.parent_id = o4.id AND o4.org_type = 'territory'
LEFT JOIN pg.public.orgs o5 ON COALESCE(o4.parent_id, o3.parent_id) = o5.id AND o5.org_type = 'sector'
LEFT JOIN pg.public.locations l ON ei.location_id = l.id
LEFT JOIN type_aggregate tc ON ei.id = tc.event_instance_id
LEFT JOIN tag_aggregate ta ON ei.id = ta.event_instance_id
CROSS JOIN params p
WHERE ei.pax_count IS NOT NULL AND ei.is_active = TRUE
