WITH params AS (
    SELECT ?::TIMESTAMPTZ AS refreshed_at, ?::DATE AS as_of_date
),
eligible_orgs AS (
    SELECT DISTINCT id
    FROM pg.public.orgs
),
events AS (
    SELECT ei.id, ei.description, ei.preblast, CAST(ei.preblast_rich AS JSON) AS preblast_rich,
           ei.backblast, CAST(ei.backblast_rich AS JSON) AS backblast_rich,
           CAST(ei.meta AS JSON) AS meta
    FROM pg.public.event_instances ei
    JOIN eligible_orgs o ON o.id = ei.org_id
    WHERE ei.is_active = true AND ei.pax_count IS NOT NULL
      AND CASE
        WHEN json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') IS NULL THEN false
        WHEN json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') = 'NULL' THEN false
        WHEN json_type(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault') <> 'BOOLEAN'
          THEN error('exclude_from_pax_vault must be boolean')
        ELSE COALESCE(json_extract(CAST(ei.meta AS JSON), '$.exclude_from_pax_vault')::BOOLEAN, false)
      END = false
)
SELECT e.id AS event_id, e.description, e.preblast, e.preblast_rich,
       e.backblast, e.backblast_rich, e.meta, p.refreshed_at
FROM events e
CROSS JOIN params p
ORDER BY e.id
