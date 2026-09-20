WITH params AS (SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date),
territory_rows AS (
    SELECT territory.id AS territory_id,
           COALESCE(territory.name, CAST(territory.id AS VARCHAR)) AS territory_name,
           sector.id AS sector_id,
           COALESCE(sector.name, CAST(sector.id AS VARCHAR)) AS sector_name,
           territory.logo_url, territory.is_active
    FROM pg.public.orgs territory
    LEFT JOIN pg.public.orgs sector ON sector.id = territory.parent_id AND sector.org_type = 'sector'
    WHERE territory.org_type = 'territory'
),
territory_values AS (
    SELECT t.*,
           COALESCE((SELECT list(struct_pack(area_id := a.id,
                                             area_name := COALESCE(a.name, CAST(a.id AS VARCHAR)),
                                             is_active := a.is_active)
                                 ORDER BY COALESCE(a.name, CAST(a.id AS VARCHAR)), a.id)
                    FROM pg.public.orgs a
                    WHERE a.org_type = 'area' AND a.parent_id = t.territory_id),
                    []::STRUCT(area_id INTEGER, area_name VARCHAR, is_active BOOLEAN)[]) AS areas
    FROM territory_rows t
)
SELECT territory_id, territory_name, sector_id, sector_name, logo_url, is_active, areas
FROM territory_values CROSS JOIN params
ORDER BY territory_name, territory_id
