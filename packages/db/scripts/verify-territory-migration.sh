#!/usr/bin/env bash
# Rehearse the territory migration using synthetic data restored from a real
# pg_dump archive, then rehearse the rollback's Drizzle journal reconciliation and Territory recovery
# with the repository's real migration runner (needs node and installed deps).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
container="${TERRITORY_TEST_CONTAINER:-f3-postgres}"
source_db="territory_923_source_$$_test"
restore_db="territory_923_restore_$$_test"
journal_trap_db="territory_923_journal_trap_$$_test"
journal_recovery_db="territory_923_journal_recovery_$$_test"
journal_reapplied_db="territory_923_journal_reapplied_$$_test"
batch_db="territory_923_batch_$$_test"
misordered_db="territory_923_misordered_$$_test"
# Roles are cluster-wide, so suffix them per run like the databases.
owner_role="territory_view_owner_$$"
reader_role="Territory-Reader-$$"
default_role="territory_default_grantee_$$"
artifact_dir="$(mktemp -d "${TMPDIR:-/tmp}/territory-923.XXXXXX")"

if [[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$container")" != f3-local ]]; then
  echo 'Expected the f3-local Compose PostgreSQL container.' >&2
  exit 1
fi

psql_db() {
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U f3local -d "$1" "${@:2}"
}

cleanup() {
  if [[ -n "${session_pid:-}" ]]; then
    exec 3>&-
    wait "$session_pid" || true
  fi
  docker exec "$container" dropdb -U f3local --if-exists "$misordered_db"
  docker exec "$container" dropdb -U f3local --if-exists "$batch_db"
  docker exec "$container" dropdb -U f3local --if-exists "$journal_reapplied_db"
  docker exec "$container" dropdb -U f3local --if-exists "$journal_recovery_db"
  docker exec "$container" dropdb -U f3local --if-exists "$journal_trap_db"
  docker exec "$container" dropdb -U f3local --if-exists "$restore_db"
  docker exec "$container" dropdb -U f3local --if-exists "$source_db"
  # After the databases, which hold these roles' grants and default privileges.
  for role in "$default_role" "$reader_role" "$owner_role"; do
    docker exec "$container" dropuser -U f3local --if-exists "$role"
  done
}
trap cleanup EXIT

for role in "$owner_role" "$reader_role" "$default_role"; do
  docker exec "$container" createuser -U f3local "$role"
done
docker exec "$container" createdb -U f3local "$source_db"
psql_db "$source_db" -c 'CREATE SCHEMA auth;' > "$artifact_dir/setup.log"
for migration in "$repo_root"/packages/db/drizzle/*.sql; do
  [[ "$(basename "$migration")" == 0023_* ]] && break
  psql_db "$source_db" -1 < "$migration" >> "$artifact_dir/setup.log"
done

psql_db "$source_db" -v owner_role="$owner_role" -v reader_role="$reader_role" \
  >> "$artifact_dir/setup.log" <<'SQL'
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
-- Staging and production carry views over org_type that no migration creates;
-- these mirror their dependency shape (column and enum-literal references, plus a
-- view stacked on top) so a migration that trips over them fails here first.
CREATE VIEW public.event_instance_expanded WITH (security_barrier = false) AS
SELECT ei.id, o0.id AS ao_org_id, COALESCE(o1.id, o2.id) AS region_org_id
FROM event_instances ei
LEFT JOIN orgs o0 ON ei.org_id = o0.id AND o0.org_type = 'ao'::org_type
LEFT JOIN orgs o1 ON ei.org_id = o1.id AND o1.org_type = 'region'::org_type
LEFT JOIN orgs o2 ON o0.parent_id = o2.id AND o2.org_type = 'region'::org_type;
CREATE VIEW public.event_instance_region_counts AS
SELECT region_org_id, count(*) AS events FROM public.event_instance_expanded GROUP BY 1;
CREATE SCHEMA reporting;
CREATE VIEW reporting.position_types WITH (check_option = local, security_invoker = true) AS
SELECT id, org_type FROM positions WHERE org_type IS NOT NULL;
-- Production views are owned by an operator role and granted to named roles.
GRANT SELECT ON event_instances, orgs TO :"owner_role";
ALTER VIEW public.event_instance_expanded OWNER TO :"owner_role";
GRANT SELECT ON public.event_instance_expanded TO PUBLIC, :"reader_role";
COMMENT ON VIEW public.event_instance_expanded IS 'Synthetic fixture';
CREATE SCHEMA verification;
-- The rollback replays grants as each view's owner, so compare grantees and
-- privileges but not grantors; a NULL ACL means the owner-only default.
-- pg_dump reorders view options, so compare them sorted.
CREATE FUNCTION verification.views()
RETURNS TABLE (name text, definition text, acl text, options text, owner text, comment text)
LANGUAGE sql AS $f$
SELECT format('%I.%I', n.nspname, c.relname), pg_get_viewdef(c.oid),
       (SELECT string_agg(e, ',' ORDER BY e) FROM (
          SELECT format('%s=%s%s', a.grantee::regrole, a.privilege_type,
                        CASE WHEN a.is_grantable THEN '*' ELSE '' END) AS e
          FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a) grants),
       (SELECT array_agg(o ORDER BY o) FROM unnest(c.reloptions) o)::text,
       pg_get_userbyid(c.relowner), obj_description(c.oid, 'pg_class')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v' AND n.nspname NOT IN ('pg_catalog', 'information_schema')
$f$;
CREATE TABLE verification.views_before AS SELECT * FROM verification.views();
CREATE TABLE verification.orgs_before AS SELECT to_jsonb(o) AS row FROM orgs o;
CREATE TABLE verification.positions_before AS SELECT to_jsonb(p) AS row FROM positions p;
CREATE TABLE verification.index_before AS
SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_orgs_org_type';
SQL

docker exec "$container" pg_dump -U f3local -Fc "$source_db" > "$artifact_dir/before.dump"
docker exec "$container" createdb -U f3local "$restore_db"
docker exec -i "$container" pg_restore -U f3local -d "$restore_db" --exit-on-error < "$artifact_dir/before.dump"
# Views the rollback recreates must not keep the caller's default privileges.
echo 'ALTER DEFAULT PRIVILEGES FOR ROLE f3local GRANT SELECT ON TABLES TO :"default_role";' \
  | psql_db "$restore_db" -v default_role="$default_role" -q

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
  IF (SELECT count(*) FROM verification.views_before) <> 3 OR EXISTS (
    (SELECT * FROM verification.views_before EXCEPT SELECT * FROM verification.views())
    UNION ALL (SELECT * FROM verification.views() EXCEPT SELECT * FROM verification.views_before)) THEN
    RAISE EXCEPTION 'Dependent view missing or changed';
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
  # Intentionally omit -v ON_ERROR_STOP: the rollback must enforce it itself.
  docker exec -i "$container" psql -X -U f3local -d "${1:-$restore_db}" < "$repo_root/packages/db/scripts/rollback-territory-org-type.sql"
}

# Keep one backend alive across forward and rollback: fresh connections cannot
# detect a stale enum cache or cached PL/pgSQL expressions that still reference
# the old enum OID after rollback recreates the type.
mkfifo "$artifact_dir/session.in"
psql_db "$restore_db" < "$artifact_dir/session.in" > "$artifact_dir/session.log" 2>&1 &
session_pid=$!
exec 3> "$artifact_dir/session.in"

session_step() {
  local marker="$1" statement="$2" attempt
  printf '%s\n\\echo %s\n' "$statement" "$marker" >&3
  for ((attempt = 0; attempt < 100; attempt++)); do
    if grep -qx "$marker" "$artifact_dir/session.log"; then
      return
    fi
    if ! kill -0 "$session_pid" 2>/dev/null; then
      cat "$artifact_dir/session.log" >&2
      return 1
    fi
    sleep 0.1
  done
  echo "Persistent session timed out; see $artifact_dir/session.log" >&2
  return 1
}

verify '{ao,region,area,sector,nation}'
session_step warm "INSERT INTO orgs (id, name, org_type, is_active) VALUES (900002, 'Persistent session fixture', 'sector', true); DELETE FROM orgs WHERE id = 900002;"
# The forward migration must not block writers: it succeeds while another
# session holds the lock ordinary writes take, which any table-level lock
# stronger than that would wait on.
session_step locked 'BEGIN;
LOCK TABLE orgs, positions IN ROW EXCLUSIVE MODE;
SELECT count(*) FROM event_instance_expanded;'
if ! { echo "SET LOCAL lock_timeout = '3s';"; cat "$repo_root/packages/db/drizzle/0023_add_territory_org_type.sql"; } \
  | psql_db "$restore_db" -1 > "$artifact_dir/forward-while-locked.log" 2>&1; then
  echo "Forward migration waited on or failed under a table lock; see $artifact_dir" >&2
  exit 1
fi
session_step unlocked 'COMMIT;'
verify '{ao,region,area,territory,sector,nation}'
# Re-running is a no-op.
forward
session_step forward_ok "INSERT INTO orgs (id, name, org_type, is_active) VALUES (900002, 'Persistent session fixture', 'territory', true); UPDATE orgs SET is_active = false WHERE id = 900002; DELETE FROM orgs WHERE id = 900002;"
verify '{ao,region,area,territory,sector,nation}'
rollback
session_step rollback_ok "INSERT INTO orgs (id, name, org_type, is_active) VALUES (900002, 'Persistent session fixture', 'sector', true); UPDATE orgs SET is_active = false WHERE id = 900002; DELETE FROM orgs WHERE id = 900002;"
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
# Dropping a view loses its column defaults, so the rollback refuses instead.
psql_db "$restore_db" -c "ALTER VIEW reporting.position_types ALTER COLUMN org_type SET DEFAULT 'ao';"
if rollback > "$artifact_dir/rollback-view-default.log" 2>&1; then
  echo 'Rollback unexpectedly accepted a dependent view with a column default' >&2
  exit 1
fi
if ! grep -q 'or column defaults; recreate it by hand' "$artifact_dir/rollback-view-default.log"; then
  echo "Rollback failed for an unexpected reason; see $artifact_dir" >&2
  exit 1
fi
psql_db "$restore_db" -c 'ALTER VIEW reporting.position_types ALTER COLUMN org_type DROP DEFAULT;'
verify '{ao,region,area,territory,sector,nation}'
# Journal rehearsal with the real runner (packages/db/src/migrate.ts). It selects
# pending migrations by comparing each `when` with the NEWEST journal row only,
# so deleting 0023's row after a rollback never makes it run again. The runner
# also exits zero after logging a failure, so assert on its log text and on
# database state rather than its exit code.
db_port="$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')"
db_password="$(docker exec "$container" printenv POSTGRES_PASSWORD)"
migration_count="$(ls "$repo_root"/packages/db/drizzle/*.sql | wc -l | tr -d ' ')"
territory_enum='{ao,region,area,territory,sector,nation}'
legacy_enum='{ao,region,area,sector,nation}'

fail() {
  echo "$1" >&2
  exit 1
}
migration_file() {
  printf '%s\n' "$repo_root"/packages/db/drizzle/"$1"_*.sql
}
migration_when() {
  node -p "require('$repo_root/packages/db/drizzle/meta/_journal.json').entries.find((entry) => entry.tag.startsWith('$1_')).when"
}
# Drizzle's journal hash is the SHA-256 of the exact migration file.
migration_hash() {
  node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$(migration_file "$1")"
}
journal_table() {
  printf 'drizzle."__drizzle_migrations_%s"' "$1"
}
query() {
  psql_db "$1" -Atc "$2"
}
runner_process() {
  # CI must be unset: the runner returns early, still printing success, when set.
  # The DB client reads TEST_DATABASE_URL instead of DATABASE_URL when NODE_ENV is
  # "test", which would migrate whatever database the caller's shell points at.
  (cd "$repo_root/packages/db" && env -u CI -u TEST_DATABASE_URL NODE_ENV=development \
    SKIP_ENV_VALIDATION=1 QUERY_TIMEOUT_MS=0 \
    DATABASE_URL="postgres://f3local:$db_password@localhost:$db_port/$1" \
    node -r esbuild-register src/migrate.ts) > "$2" 2>&1 || true
}
run_runner() {
  local log="$artifact_dir/runner-$1.log"
  runner_process "$1" "$log"
  if ! grep -qx 'Migration done' "$log" || grep -q 'Migration failed' "$log"; then
    fail "Drizzle runner did not complete for $1; see $log"
  fi
}
assert_state() {
  local db="$1" expected_enum="$2" expected_rows="$3"
  [[ "$(query "$db" 'SELECT enum_range(NULL::org_type)')" == "$expected_enum" ]] \
    || fail "$db: org_type is not $expected_enum"
  [[ "$(query "$db" "SELECT count(*) FROM $(journal_table "$db")")" == "$expected_rows" ]] \
    || fail "$db: expected $expected_rows journal rows"
}
journal_has() {
  [[ "$(query "$1" "SELECT count(*) FROM $(journal_table "$1") WHERE created_at = $(migration_when "$2")")" == 1 ]]
}
# The rollback restores update_org_ao_counts() with the old fixed-depth body and
# 0026 replaces it with the depth-agnostic one. Enum and row counts cannot show
# which is live, so assert on the function body.
assert_depth_agnostic_trigger() {
  [[ "$(query "$1" "SELECT pg_get_functiondef('public.update_org_ao_counts'::regproc) ILIKE '%great_grandparent%'")" == f ]] \
    || fail "$1: update_org_ao_counts() is the old fixed-depth trigger"
}
# 0023's exact SQL plus its journal row, for one transaction.
recovery_sql() {
  cat "$(migration_file 0023)"
  printf '\nINSERT INTO %s (hash, created_at) VALUES ('"'%s'"', %s);\n' \
    "$(journal_table "$1")" "$(migration_hash 0023)" "$(migration_when 0023)"
}

# Migrate with the real runner, roll back, and reconcile the journal exactly as
# territory-migration.md step 4 describes (remove the 0023 and 0026 rows only).
rolled_back_journal_db() {
  local db="$1" removed
  run_runner "$db"
  assert_state "$db" "$territory_enum" "$migration_count"
  rollback "$db" > "$artifact_dir/rollback-$db.log" 2>&1
  removed="$(query "$db" "WITH removed AS (DELETE FROM $(journal_table "$db") WHERE (created_at, hash) IN (($(migration_when 0023), '$(migration_hash 0023)'), ($(migration_when 0026), '$(migration_hash 0026)')) RETURNING 1) SELECT count(*) FROM removed")"
  [[ "$removed" == 2 ]] || fail "$db: journal reconciliation removed $removed rows, expected 2"
  assert_state "$db" "$legacy_enum" "$((migration_count - 2))"
}

# Trap: reconciling the journal alone does not bring Territory back. The runner
# skips 0023 (older than the newest remaining row) yet re-runs 0026.
rolled_back_journal_db "$journal_trap_db"
run_runner "$journal_trap_db"
assert_state "$journal_trap_db" "$legacy_enum" "$((migration_count - 1))"
journal_has "$journal_trap_db" 0026 || fail 'Runner did not re-run 0026 after its journal row was removed'
if journal_has "$journal_trap_db" 0023; then
  fail 'Runner unexpectedly re-ran 0023'
fi
assert_depth_agnostic_trigger "$journal_trap_db"

# Recovery: apply 0023's exact SQL and its journal row in one transaction before
# the runner deploys, so the runner then finds only 0026 pending, as originally.
rolled_back_journal_db "$journal_recovery_db"
recovery_sql "$journal_recovery_db" | psql_db "$journal_recovery_db" -1 > "$artifact_dir/recovery.log"
run_runner "$journal_recovery_db"
assert_state "$journal_recovery_db" "$territory_enum" "$migration_count"
assert_depth_agnostic_trigger "$journal_recovery_db"
run_runner "$journal_recovery_db"
assert_state "$journal_recovery_db" "$territory_enum" "$migration_count"
psql_db "$journal_recovery_db" -c "INSERT INTO orgs (id, name, org_type, is_active) VALUES (900003, 'Recovered territory', 'territory', true); DELETE FROM orgs WHERE id = 900003;" > /dev/null

# Out of order: a runner pass already re-applied 0026 before Territory is
# restored. 0023 only adds the enum value, so it leaves 0026's trigger in place.
rolled_back_journal_db "$journal_reapplied_db"
run_runner "$journal_reapplied_db"
recovery_sql "$journal_reapplied_db" | psql_db "$journal_reapplied_db" -1 > "$artifact_dir/recovery-reapplied.log"
run_runner "$journal_reapplied_db"
assert_state "$journal_reapplied_db" "$territory_enum" "$migration_count"
assert_depth_agnostic_trigger "$journal_reapplied_db"

restore_before_dump() {
  docker exec "$container" createdb -U f3local "$1"
  docker exec -i "$container" pg_restore -U f3local -d "$1" --exit-on-error < "$artifact_dir/before.dump"
}

# Staging and production run every pending migration in one transaction on a
# database where org_type is already committed. Only there does Postgres forbid
# using 'territory' before 0023 commits (a type created in the same transaction
# is exempt, so fresh-database runs cannot catch it).
restore_before_dump "$batch_db"
# Negative control: this stage must be able to fail for that reason.
if { cat "$(migration_file 0023)"; echo "SELECT 'territory'::org_type;"; } \
  | psql_db "$batch_db" -1 > "$artifact_dir/batch-negative-control.log" 2>&1; then
  fail 'Using territory in the same transaction as 0023 unexpectedly succeeded'
fi
grep -q 'unsafe use of new value' "$artifact_dir/batch-negative-control.log" \
  || fail "Negative control failed for an unexpected reason; see $artifact_dir"
{
  printf 'CREATE SCHEMA drizzle;\n'
  printf 'CREATE TABLE %s (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);\n' \
    "$(journal_table "$batch_db")"
  for migration in "$repo_root"/packages/db/drizzle/*.sql; do
    prefix="$(basename "$migration" | cut -c1-4)"
    [[ "$prefix" == 0023 ]] && break
    printf 'INSERT INTO %s (hash, created_at) VALUES ('"'%s'"', %s);\n' \
      "$(journal_table "$batch_db")" "$(migration_hash "$prefix")" "$(migration_when "$prefix")"
  done
} | psql_db "$batch_db" -q
pre_batch_rows="$(query "$batch_db" "SELECT count(*) FROM $(journal_table "$batch_db")")"
# Hold a lock 0026 waits on so its lock_timeout fails the batch midway; nothing
# from the batch, 0023 included, may survive.
session_step batch_locked "\\c $batch_db
BEGIN;
LOCK TABLE orgs IN SHARE MODE;"
runner_process "$batch_db" "$artifact_dir/runner-$batch_db-locked.log"
grep -q 'lock timeout' "$artifact_dir/runner-$batch_db-locked.log" \
  || fail "Batch did not fail on 0026's lock timeout; see $artifact_dir"
assert_state "$batch_db" "$legacy_enum" "$pre_batch_rows"
session_step batch_unlocked 'COMMIT;'
run_runner "$batch_db"
assert_state "$batch_db" "$territory_enum" "$migration_count"
assert_depth_agnostic_trigger "$batch_db"
psql_db "$batch_db" -c "INSERT INTO orgs (id, name, org_type, is_active) VALUES (900004, 'Batch territory', 'territory', true); DELETE FROM orgs WHERE id = 900004;" > /dev/null

# 0023 refuses a territory label that already exists in the wrong position,
# since IF NOT EXISTS would otherwise skip it without applying BEFORE.
restore_before_dump "$misordered_db"
psql_db "$misordered_db" -q -c "ALTER TYPE org_type ADD VALUE 'territory';"
if psql_db "$misordered_db" -1 < "$(migration_file 0023)" > "$artifact_dir/misordered.log" 2>&1; then
  fail '0023 accepted a territory label in the wrong position'
fi
grep -q 'org_type labels are not in the expected order' "$artifact_dir/misordered.log" \
  || fail "0023 failed for an unexpected reason; see $artifact_dir"

echo "PASS: forward, rollback, persistent-session writes, forward not blocking writers,"
echo "  idempotent forward, data/index/view preservation (owners, named grants, default"
echo "  privileges, reloptions, non-public schemas), all rollback refusal cases, the"
echo "  Drizzle journal trap and both recovery orderings, the production-shaped batch"
echo "  (negative control, mid-batch failure, success), and misordered-label refusal."
echo "Synthetic artifacts: $artifact_dir"
