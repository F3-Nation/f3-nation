WITH RECURSIVE params AS (SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date),
area_ancestors(area_id, ancestor_id, ancestor_name, ancestor_type, visited) AS (
    SELECT id, id, COALESCE(name, CAST(id AS VARCHAR)), org_type, [id]
    FROM pg.public.orgs WHERE org_type = 'area'
    UNION ALL
    SELECT a.area_id, parent.id, COALESCE(parent.name, CAST(parent.id AS VARCHAR)), parent.org_type,
           list_append(a.visited, parent.id)
    FROM area_ancestors a
    JOIN pg.public.orgs child ON child.id = a.ancestor_id
    JOIN pg.public.orgs parent ON parent.id = child.parent_id
    WHERE NOT list_contains(a.visited, parent.id) AND len(a.visited) < 20
),
area_rows AS (
    SELECT area.id AS area_id, COALESCE(area.name, CAST(area.id AS VARCHAR)) AS area_name,
           MAX(a.ancestor_id) FILTER (WHERE a.ancestor_type = 'sector')::INTEGER AS sector_id,
           MAX(a.ancestor_name) FILTER (WHERE a.ancestor_type = 'sector') AS sector_name,
           MAX(a.ancestor_id) FILTER (WHERE a.ancestor_type = 'territory')::INTEGER AS territory_id,
           MAX(a.ancestor_name) FILTER (WHERE a.ancestor_type = 'territory') AS territory_name,
           area.logo_url, area.is_active
    FROM pg.public.orgs area
    JOIN area_ancestors a ON a.area_id = area.id
    WHERE area.org_type = 'area'
    GROUP BY area.id, area.name, area.logo_url, area.is_active
),
area_values AS (
    SELECT a.*,
           COALESCE((SELECT list(struct_pack(region_id := r.id,
                                             region_name := COALESCE(r.name, CAST(r.id AS VARCHAR)),
                                             is_active := r.is_active)
                                 ORDER BY COALESCE(r.name, CAST(r.id AS VARCHAR)), r.id)
                    FROM pg.public.orgs r
                    WHERE r.org_type = 'region' AND r.parent_id = a.area_id),
                    []::STRUCT(region_id INTEGER, region_name VARCHAR, is_active BOOLEAN)[]) AS regions
    FROM area_rows a
)
SELECT area_id, area_name, sector_id, sector_name, territory_id, territory_name, logo_url, is_active, regions
FROM area_values
ORDER BY area_name, area_id
