-- LOCAL DEV ONLY: creates the `event_instance_expanded` and `attendance_expanded`
-- materialized views that exist in the cloud databases but are not part of the
-- local Drizzle migrations. Several slackbot scripts (weekly_reporting,
-- monthly_reporting, award_achievements) query these views, so apply this once
-- to your local database to run those scripts against seeded data:
--
--   docker exec -i f3-postgres psql -U f3local -d f3nation < apps/slackbot/scripts/sql/local-expanded-views.sql
--
-- The definitions here are a best-effort approximation of the cloud views:
-- close enough for local development, not a source of truth. Re-run after
-- seeding new data, or refresh with:
--   REFRESH MATERIALIZED VIEW event_instance_expanded;
--   REFRESH MATERIALIZED VIEW attendance_expanded;

-- Drop table forms too: SQLAlchemy's create_all can create these as empty tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'event_instance_expanded') THEN
    DROP TABLE event_instance_expanded;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'attendance_expanded') THEN
    DROP TABLE attendance_expanded;
  END IF;
END $$;

DROP MATERIALIZED VIEW IF EXISTS event_instance_expanded;
CREATE MATERIALIZED VIEW event_instance_expanded AS
WITH org_h AS (
  SELECT
    o.id AS org_id,
    CASE WHEN o.org_type = 'ao' THEN o.id END AS ao_id,
    CASE
      WHEN o.org_type = 'region' THEN o.id
      WHEN o.org_type = 'ao' THEN p.id
    END AS region_id
  FROM orgs o
  LEFT JOIN orgs p ON p.id = o.parent_id
)
SELECT
  ei.id,
  ei.org_id,
  ei.location_id,
  ei.series_id,
  ei.highlight,
  ei.start_date,
  ei.end_date,
  ei.start_time,
  ei.end_time,
  ei.name,
  ei.description,
  ei.pax_count,
  ei.fng_count,
  ei.preblast,
  ei.backblast,
  ei.meta,
  ei.created,
  ei.updated,
  s.name AS series_name,
  s.description AS series_description,
  ao.id AS ao_org_id,
  ao.name AS ao_name,
  ao.description AS ao_description,
  ao.logo_url AS ao_logo_url,
  ao.website AS ao_website,
  ao.meta AS ao_meta,
  region.id AS region_org_id,
  region.name AS region_name,
  region.description AS region_description,
  region.logo_url AS region_logo_url,
  region.website AS region_website,
  region.meta AS region_meta,
  area.id AS area_org_id,
  area.name AS area_name,
  sector.id AS sector_org_id,
  sector.name AS sector_name,
  l.name AS location_name,
  l.description AS location_description,
  l.latitude AS location_latitude,
  l.longitude AS location_longitude,
  MAX(CASE WHEN et.name ILIKE '%bootcamp%' THEN 1 ELSE 0 END) AS bootcamp_ind,
  MAX(CASE WHEN et.name ILIKE '%run%' THEN 1 ELSE 0 END) AS run_ind,
  MAX(CASE WHEN et.name ILIKE '%ruck%' THEN 1 ELSE 0 END) AS ruck_ind,
  MAX(CASE WHEN et.event_category = 'first_f' THEN 1 ELSE 0 END) AS first_f_ind,
  MAX(CASE WHEN et.event_category = 'second_f' THEN 1 ELSE 0 END) AS second_f_ind,
  MAX(CASE WHEN et.event_category = 'third_f' THEN 1 ELSE 0 END) AS third_f_ind,
  MAX(CASE WHEN tag.name ILIKE '%pre%workout%' THEN 1 ELSE 0 END) AS pre_workout_ind,
  MAX(CASE WHEN tag.name ILIKE '%off the books%' THEN 1 ELSE 0 END) AS off_the_books_ind,
  MAX(CASE WHEN tag.name ILIKE '%vq%' THEN 1 ELSE 0 END) AS vq_ind,
  MAX(CASE WHEN tag.name ILIKE '%convergence%' THEN 1 ELSE 0 END) AS convergence_ind,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT et.name), NULL) AS all_types,
  ARRAY_REMOVE(ARRAY_AGG(DISTINCT tag.name), NULL) AS all_tags
FROM event_instances ei
LEFT JOIN events s ON s.id = ei.series_id
LEFT JOIN org_h ON org_h.org_id = ei.org_id
LEFT JOIN orgs ao ON ao.id = org_h.ao_id
LEFT JOIN orgs region ON region.id = org_h.region_id
LEFT JOIN orgs area ON area.id = region.parent_id AND area.org_type = 'area'
LEFT JOIN orgs sector ON sector.id = area.parent_id AND sector.org_type = 'sector'
LEFT JOIN locations l ON l.id = ei.location_id
LEFT JOIN event_instances_x_event_types eixt ON eixt.event_instance_id = ei.id
LEFT JOIN event_types et ON et.id = eixt.event_type_id
LEFT JOIN event_tags_x_event_instances tixt ON tixt.event_instance_id = ei.id
LEFT JOIN event_tags tag ON tag.id = tixt.event_tag_id
WHERE ei.is_active
GROUP BY
  ei.id, s.id, ao.id, region.id, area.id, sector.id, l.id;

CREATE UNIQUE INDEX ON event_instance_expanded (id);

DROP MATERIALIZED VIEW IF EXISTS attendance_expanded;
CREATE MATERIALIZED VIEW attendance_expanded AS
SELECT
  a.id,
  a.user_id,
  a.event_instance_id,
  a.meta AS attendance_meta,
  a.created,
  a.updated,
  MAX(CASE WHEN axt.attendance_type_id = 2 THEN 1 ELSE 0 END) AS q_ind,
  MAX(CASE WHEN axt.attendance_type_id = 3 THEN 1 ELSE 0 END) AS coq_ind,
  u.f3_name,
  u.first_name,
  u.last_name,
  u.email,
  u.home_region_id,
  hr.name AS home_region_name,
  u.avatar_url,
  u.status AS user_status,
  ei.start_date
FROM attendance a
JOIN users u ON u.id = a.user_id
JOIN event_instances ei ON ei.id = a.event_instance_id
LEFT JOIN orgs hr ON hr.id = u.home_region_id
LEFT JOIN attendance_x_attendance_types axt ON axt.attendance_id = a.id
WHERE NOT a.is_planned
GROUP BY a.id, u.id, hr.id, ei.id;

CREATE UNIQUE INDEX ON attendance_expanded (id);
