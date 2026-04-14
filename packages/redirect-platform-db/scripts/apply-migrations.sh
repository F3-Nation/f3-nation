#!/usr/bin/env bash
#
# F3R5_002 — apply Neon schema migrations for f3-redirect-platform
#
# Applies the three SQL files from packages/redirect-platform-db in order:
#   1. drizzle/0000_careful_black_cat.sql        (schema — tables, indexes, enums)
#   2. sql/0001_roles_and_grants.sql             (4 Postgres roles with scoped GRANTs and append-only REVOKEs)
#   3. sql/0002_trigger_enforce_verified_binding.sql (BEFORE INSERT OR UPDATE trigger)
#
# IMPORTANT: this script is for first-time bootstrap only. Subsequent schema
# changes go through Drizzle migrations in the normal PR flow.
#
# Usage:
#   export NEON_PLATFORM_ADMIN_URL="postgresql://redirect_platform_admin:...@host/platform?sslmode=require"
#   export NEON_RUNTIME_PASSWORD="..."
#   export NEON_RECONCILER_PASSWORD="..."
#   export NEON_ADMIN_UI_PASSWORD="..."
#   ./apply-migrations.sh [--dry-run]
#
# The NEON_PLATFORM_ADMIN_URL must already have the platform admin role created
# (Neon auto-creates the initial role when you provision the project — use that
# one as platform admin). The other three role passwords are injected into
# 0001_roles_and_grants.sql at apply time, replacing the CHANGE_ME_BEFORE_APPLY
# sentinel strings — no secrets are committed to the repo.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo '')"
if [[ -z "$REPO_ROOT" ]]; then
  echo "ERROR: must be run from inside the f3-nation monorepo" >&2
  exit 1
fi

DB_PACKAGE_DIR="$REPO_ROOT/packages/redirect-platform-db"
SCHEMA_SQL="$DB_PACKAGE_DIR/drizzle/0000_careful_black_cat.sql"
ROLES_SQL="$DB_PACKAGE_DIR/sql/0001_roles_and_grants.sql"
TRIGGER_SQL="$DB_PACKAGE_DIR/sql/0002_trigger_enforce_verified_binding.sql"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# --- validate env ---
: "${NEON_PLATFORM_ADMIN_URL:?NEON_PLATFORM_ADMIN_URL env var is required}"
: "${NEON_RUNTIME_PASSWORD:?NEON_RUNTIME_PASSWORD env var is required}"
: "${NEON_RECONCILER_PASSWORD:?NEON_RECONCILER_PASSWORD env var is required}"
: "${NEON_ADMIN_UI_PASSWORD:?NEON_ADMIN_UI_PASSWORD env var is required}"

if [[ "$NEON_PLATFORM_ADMIN_URL" != postgresql://* ]]; then
  echo "ERROR: NEON_PLATFORM_ADMIN_URL must start with postgresql://" >&2
  exit 1
fi
if [[ "$NEON_PLATFORM_ADMIN_URL" != *"sslmode=require"* ]]; then
  echo "ERROR: NEON_PLATFORM_ADMIN_URL must include sslmode=require" >&2
  exit 1
fi

# --- validate files exist ---
for f in "$SCHEMA_SQL" "$ROLES_SQL" "$TRIGGER_SQL"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing SQL file: $f" >&2
    exit 1
  fi
done

# --- verify psql is available ---
if ! command -v psql &> /dev/null; then
  echo "ERROR: psql not found in PATH. Install postgresql-client." >&2
  exit 1
fi

# --- test connection ---
echo ">>> testing connection as platform admin..."
if ! psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -c "SELECT current_user, version();" > /dev/null; then
  echo "ERROR: could not connect to Neon as platform admin" >&2
  exit 1
fi
echo "    connection OK"

# --- build a temporary roles SQL with real passwords injected ---
# NEVER commit or log the contents of this file. It's written to a temp path
# with 0600 permissions and deleted via trap on exit.
TMP_ROLES_SQL="$(mktemp -t f3r5-roles-XXXXXX.sql)"
chmod 600 "$TMP_ROLES_SQL"
trap 'rm -f "$TMP_ROLES_SQL"' EXIT

# sed-substitute CHANGE_ME_BEFORE_APPLY with the real passwords. Order matters
# because the roles are created in a specific order in the SQL file.
# Using a here-doc approach with sed that reads each CHANGE_ME_BEFORE_APPLY in
# order and replaces with the next password in the expected sequence.
#
# Expected order in 0001_roles_and_grants.sql:
#   1. redirect_runtime      → NEON_RUNTIME_PASSWORD
#   2. redirect_reconciler   → NEON_RECONCILER_PASSWORD
#   3. redirect_admin_ui     → NEON_ADMIN_UI_PASSWORD
#   4. redirect_platform_admin → (already exists in Neon, we SET its password)
#
# We use awk to replace sequentially to avoid order-dependent sed quirks.

awk -v pw1="$NEON_RUNTIME_PASSWORD" \
    -v pw2="$NEON_RECONCILER_PASSWORD" \
    -v pw3="$NEON_ADMIN_UI_PASSWORD" \
    'BEGIN { n=0 }
     /CHANGE_ME_BEFORE_APPLY/ {
       n++
       if (n==1) sub(/CHANGE_ME_BEFORE_APPLY/, pw1)
       else if (n==2) sub(/CHANGE_ME_BEFORE_APPLY/, pw2)
       else if (n==3) sub(/CHANGE_ME_BEFORE_APPLY/, pw3)
     }
     { print }' "$ROLES_SQL" > "$TMP_ROLES_SQL"

# Sanity check: no sentinels remaining in the temp file
if grep -q "CHANGE_ME_BEFORE_APPLY" "$TMP_ROLES_SQL"; then
  echo "ERROR: 0001_roles_and_grants.sql has unexpected CHANGE_ME_BEFORE_APPLY count — manual review needed" >&2
  exit 1
fi
echo ">>> role passwords injected into temp SQL (file: $TMP_ROLES_SQL, perms 0600)"

# --- dry run mode prints what would happen and stops ---
if [[ "$DRY_RUN" == true ]]; then
  echo ""
  echo "=== DRY RUN — no changes will be applied ==="
  echo "Would apply, in order:"
  echo "  1. $SCHEMA_SQL ($(wc -l < "$SCHEMA_SQL") lines)"
  echo "  2. $TMP_ROLES_SQL (generated from $ROLES_SQL with real passwords)"
  echo "  3. $TRIGGER_SQL ($(wc -l < "$TRIGGER_SQL") lines)"
  echo ""
  echo "Target: $(psql "$NEON_PLATFORM_ADMIN_URL" -Atc 'SELECT current_database() || '"'"' on '"'"' || version()')"
  exit 0
fi

# --- apply in order ---
echo ""
echo ">>> applying schema (step 1/3)..."
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -f "$SCHEMA_SQL"
echo "    schema applied"

echo ""
echo ">>> applying roles and grants (step 2/3)..."
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -f "$TMP_ROLES_SQL"
echo "    roles and grants applied"

echo ""
echo ">>> applying verified-binding trigger (step 3/3)..."
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -f "$TRIGGER_SQL"
echo "    trigger applied"

# --- verify the installation ---
echo ""
echo ">>> verifying..."

echo "  - roles exist:"
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT rolname FROM pg_roles WHERE rolname IN ('redirect_runtime','redirect_reconciler','redirect_admin_ui') ORDER BY rolname;"

echo "  - trigger installed:"
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT trigger_name FROM information_schema.triggers WHERE trigger_name='trg_rcd_verified_binding';"

echo "  - tables present:"
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('region_custom_domains','org_region_bindings','org_domain_quota','domain_blocklist','region_custom_domain_events','reconciler_leases') ORDER BY table_name;"

echo "  - partial unique index intact:"
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT indexname FROM pg_indexes WHERE tablename='region_custom_domains' AND indexname='uniq_locked_hostname';"

echo "  - redirect_runtime column-level grants:"
psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT column_name FROM information_schema.column_privileges WHERE grantee='redirect_runtime' AND table_name='region_custom_domains' ORDER BY column_name;"

echo "  - append-only check: redirect_reconciler should NOT have UPDATE on region_custom_domain_events:"
UPDATE_CHECK=$(psql "$NEON_PLATFORM_ADMIN_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT has_table_privilege('redirect_reconciler','region_custom_domain_events','UPDATE');")
if [[ "$UPDATE_CHECK" == "t" ]]; then
  echo "    FAIL: redirect_reconciler has UPDATE on region_custom_domain_events — append-only REVOKE missing!" >&2
  exit 1
else
  echo "    OK (append-only enforced)"
fi

echo ""
echo "=== F3R5_002 apply complete ==="
echo ""
echo "Next steps:"
echo "  1. Run F3R5_005 bootstrap-secrets.sh to populate GCP Secret Manager with the same connection strings"
echo "  2. Deploy Cloud Run services (F3R5_004) and verify they can connect"
echo "  3. Smoke test: attempt to insert a row into region_custom_domains with an unverified binding — should raise check_violation from the trigger"
