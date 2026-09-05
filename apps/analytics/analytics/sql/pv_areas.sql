WITH params AS (SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date),
area_rows AS (
    SELECT area.id AS area_id, COALESCE(area.name, CAST(area.id AS VARCHAR)) AS area_name,
           sector.id AS sector_id, COALESCE(sector.name, CAST(sector.id AS VARCHAR)) AS sector_name,
           area.logo_url, area.is_active
    FROM pg.public.orgs area
    LEFT JOIN pg.public.orgs sector ON sector.id = area.parent_id AND sector.org_type = 'sector'
    WHERE area.org_type = 'area'
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
SELECT area_id, area_name, sector_id, sector_name, logo_url, is_active, regions
FROM area_values
ORDER BY area_name, area_id
