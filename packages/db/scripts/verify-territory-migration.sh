#!/usr/bin/env bash
# Rehearse #923 using synthetic data restored from a real pg_dump archive.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
container=f3-postgres
source_db="territory_923_source_$$_test"
restore_db="territory_923_restore_$$_test"
artifact_dir="$(mktemp -d "${TMPDIR:-/tmp}/territory-923.XXXXXX")"

if [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" != f3-local ]]; then
  echo 'Expected the f3-local Compose PostgreSQL container.' >&2
  exit 1
fi

psql_db() {
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U f3local -d "$1" "${@:2}"
}

cleanup() {
  docker exec "$container" dropdb -U f3local --if-exists "$restore_db"
  docker exec "$container" dropdb -U f3local --if-exists "$source_db"
}
trap cleanup EXIT

docker exec "$container" createdb -U f3local "$source_db"
psql_db "$source_db" -c 'CREATE SCHEMA auth;' > "$artifact_dir/setup.log"
for migration in "$repo_root"/packages/db/drizzle/*.sql; do
  [[ "$(basename "$migration")" == 0023_* ]] && break
  psql_db "$source_db" -1 < "$migration" >> "$artifact_dir/setup.log"
done

psql_db "$source_db" >> "$artifact_dir/setup.log" <<'SQL'
INSERT INTO orgs (id, parent_id, name, org_type, is_active, meta)
SELECT n, CASE WHEN n % 5 = 1 THEN NULL ELSE n - 1 END,
       'Synthetic org ' || n,
       (ARRAY['nation','sector','area','region','ao'])[((n-1)%5)+1]::org_type,
       n % 7 <> 0, jsonb_build_object('fixture', n)
FROM generate_series(1, 5000) n;
INSERT INTO positions (name, org_id, org_type, is_active)
SELECT 'Synthetic position ' || n, ((n-1)%5000)+1,
       (ARRAY['ao','region','area','sector','nation',NULL])[((n-1)%6)+1]::org_type,
       n % 7 <> 0
FROM generate_series(1, 6000) n;
CREATE SCHEMA verification;
CREATE TABLE verification.orgs_before AS SELECT to_jsonb(o) AS row FROM orgs o;
CREATE TABLE verification.positions_before AS SELECT to_jsonb(p) AS row FROM positions p;
CREATE TABLE verification.index_before AS
SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_orgs_org_type';
SQL

docker exec "$container" pg_dump -U f3local -Fc "$source_db" > "$artifact_dir/before.dump"
docker exec "$container" createdb -U f3local "$restore_db"
docker exec -i "$container" pg_restore -U f3local -d "$restore_db" --exit-on-error < "$artifact_dir/before.dump"

verify() {
  psql_db "$restore_db" -v expected_order="$1" <<'SQL'
SELECT set_config('verification.expected_order', :'expected_order', false);
DO $$
BEGIN
  IF enum_range(NULL::org_type)::text <> current_setting('verification.expected_order') THEN
    RAISE EXCEPTION 'Enum order mismatch';
  END IF;
  IF EXISTS ((SELECT row FROM verification.orgs_before EXCEPT ALL SELECT to_jsonb(o) FROM orgs o)
    UNION ALL (SELECT to_jsonb(o) FROM orgs o EXCEPT ALL SELECT row FROM verification.orgs_before))
    OR EXISTS ((SELECT row FROM verification.positions_before EXCEPT ALL SELECT to_jsonb(p) FROM positions p)
    UNION ALL (SELECT to_jsonb(p) FROM positions p EXCEPT ALL SELECT row FROM verification.positions_before)) THEN
    RAISE EXCEPTION 'Row data changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes i JOIN verification.index_before b USING (indexdef)
    WHERE i.schemaname = 'public' AND i.indexname = 'idx_orgs_org_type')
    OR NOT (SELECT indisvalid FROM pg_index WHERE indexrelid = 'public.idx_orgs_org_type'::regclass) THEN
    RAISE EXCEPTION 'Index missing, invalid, or changed';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
    AND column_name = 'org_type' AND udt_name = 'org_type'
    AND ((table_name = 'orgs' AND is_nullable = 'NO') OR (table_name = 'positions' AND is_nullable = 'YES'))) <> 2 THEN
    RAISE EXCEPTION 'Column type or nullability changed';
  END IF;
END $$;
SELECT 'preserved' AS result, (SELECT count(*) FROM orgs) AS orgs,
       (SELECT count(*) FROM positions) AS positions;
SQL
}

forward() {
  psql_db "$restore_db" -1 < "$repo_root/packages/db/drizzle/0023_add_territory_org_type.sql"
}
rollback() {
  psql_db "$restore_db" < "$repo_root/packages/db/scripts/rollback-territory-org-type.sql"
}

verify '{ao,region,area,sector,nation}'
forward
verify '{ao,region,area,territory,sector,nation}'
rollback
verify '{ao,region,area,sector,nation}'
forward

for table in orgs positions; do
  psql_db "$restore_db" -c "INSERT INTO $table (id, name, org_type, is_active) VALUES (900001, 'Rollback refusal fixture', 'territory', true);"
  if rollback > "$artifact_dir/rollback-$table.log" 2>&1; then
    echo "Rollback unexpectedly accepted a territory in $table" >&2
    exit 1
  fi
  if ! grep -q 'Cannot roll back org_type while territory values exist' "$artifact_dir/rollback-$table.log"; then
    echo "Rollback failed for an unexpected reason; see $artifact_dir" >&2
    exit 1
  fi
  psql_db "$restore_db" -c "DELETE FROM $table WHERE id = 900001;"
  verify '{ao,region,area,territory,sector,nation}'
done
echo "PASS: forward, rollback, data/index preservation, and both refusal cases. Synthetic artifacts: $artifact_dir"
