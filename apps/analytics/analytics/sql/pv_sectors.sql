WITH params AS (SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date),
sector_rows AS (
    SELECT sector.id AS sector_id, COALESCE(sector.name, CAST(sector.id AS VARCHAR)) AS sector_name,
           sector.logo_url, sector.is_active
    FROM pg.public.orgs sector
    WHERE sector.org_type = 'sector'
),
sector_values AS (
    SELECT s.*,
           COALESCE((SELECT list(struct_pack(area_id := a.id,
                                             area_name := COALESCE(a.name, CAST(a.id AS VARCHAR)),
                                             is_active := a.is_active)
                                 ORDER BY COALESCE(a.name, CAST(a.id AS VARCHAR)), a.id)
                    FROM pg.public.orgs a
                    WHERE a.org_type = 'area' AND a.parent_id = s.sector_id),
                    []::STRUCT(area_id INTEGER, area_name VARCHAR, is_active BOOLEAN)[]) AS areas
    FROM sector_rows s
)
SELECT sector_id, sector_name, logo_url, is_active, areas
FROM sector_values
ORDER BY sector_name, sector_id
