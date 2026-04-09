#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# generate-env.sh — Pull staging secrets from GCP and generate .env for local dev
# =============================================================================
#
# Usage:
#   bash scripts/generate-env.sh          # Generate .env from staging secrets
#   bash scripts/generate-env.sh --dry-run # Show what would be generated
#
# Prerequisites:
#   - gcloud CLI authenticated (gcloud auth login)
#   - Access to f3-authentication-staging GCP project
#   - jq installed (brew install jq)
#
# This script:
#   1. Pulls secrets from GCP Secret Manager (staging project only — never prod)
#   2. Generates a root .env with sane local-dev defaults
#   3. Symlinks .env.local into each app directory
#
# The generated .env uses:
#   - Staging database via Cloud SQL Auth Proxy (localhost:5432)
#   - Staging API/Auth URLs for any cross-service calls
#   - Local dev server URLs for NEXT_PUBLIC_* vars
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Configuration -----------------------------------------------------------

# Always pull from staging — never production
GCP_PROJECT="f3-authentication-staging"

# GCP secret name → env var mapping
# Format: "gcp-secret-name:ENV_VAR_NAME"
SECRET_MAP=(
  "database-user:DATABASE_USER"
  "database-password:DATABASE_PASSWORD"
  "database-name:DATABASE_NAME"
  "database-host:DATABASE_HOST"
  "auth-secret:AUTH_SECRET"
  "auth-jwt-private-key:AUTH_JWT_PRIVATE_KEY"
  "api-key:API_KEY"
  "sendgrid-api-key:SENDGRID_API_KEY"
)

# Static env vars for local development (not pulled from GCP)
# These are sane defaults — override in .env.local if needed
STATIC_VARS=(
  "NODE_ENV=development"
  ""
  "# -- Database (via Cloud SQL Auth Proxy on localhost:5432) --"
  "# DATABASE_URL is constructed from the secrets above"
  ""
  "# -- Local dev server URLs --"
  "NEXT_PUBLIC_API_URL=http://localhost:3001"
  "NEXT_PUBLIC_MAP_URL=http://localhost:3000"
  "NEXT_PUBLIC_AUTH_URL=http://localhost:3004"
  "NEXT_PUBLIC_CHANNEL=local"
  ""
  "# -- Email --"
  "EMAIL_FROM=noreply@f3nation.com"
  "EMAIL_ADMIN_DESTINATIONS=dev@f3nation.com"
  ""
  "# -- Notifications (disabled locally) --"
  "# NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED="
)

# Apps that need a symlinked .env.local
APPS=(api map auth)

# --- Parse flags -------------------------------------------------------------

DRY_RUN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown argument: $1"; echo "Usage: $0 [--dry-run]"; exit 1 ;;
  esac
done

# --- Preflight checks --------------------------------------------------------

if ! command -v gcloud &>/dev/null; then
  echo "Error: gcloud CLI not found. Install: brew install google-cloud-sdk"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "Error: jq not found. Install: brew install jq"
  exit 1
fi

# Verify GCP auth
if ! gcloud auth print-identity-token &>/dev/null 2>&1; then
  echo "Error: Not authenticated with GCP. Run: gcloud auth login"
  exit 1
fi

# Verify project access
if ! gcloud secrets list --project="$GCP_PROJECT" --limit=1 &>/dev/null 2>&1; then
  echo "Error: Cannot access secrets in project '$GCP_PROJECT'."
  echo "Ask a team lead to grant you 'Secret Manager Secret Accessor' role."
  exit 1
fi

echo "Pulling secrets from GCP project: $GCP_PROJECT"
echo ""

# --- Pull secrets from GCP ---------------------------------------------------

declare -A SECRETS

for mapping in "${SECRET_MAP[@]}"; do
  gcp_name="${mapping%%:*}"
  env_name="${mapping##*:}"

  value=$(gcloud secrets versions access latest \
    --secret="$gcp_name" \
    --project="$GCP_PROJECT" 2>/dev/null) || {
    echo "  WARN: Secret '$gcp_name' not found — skipping $env_name"
    continue
  }

  SECRETS[$env_name]="$value"
  echo "  OK: $gcp_name → $env_name"
done

# --- Construct derived values ------------------------------------------------

DB_USER="${SECRETS[DATABASE_USER]:-postgres}"
DB_PASS="${SECRETS[DATABASE_PASSWORD]:-}"
DB_NAME="${SECRETS[DATABASE_NAME]:-f3data}"

# Cloud SQL Proxy connects on localhost:5432
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
TEST_DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}_test"

# SendGrid SMTP from API key
SENDGRID_KEY="${SECRETS[SENDGRID_API_KEY]:-}"
EMAIL_SERVER="smtp://apikey:${SENDGRID_KEY}@smtp.sendgrid.net:587"

# Super admin API key (same as API_KEY for local dev)
SUPER_ADMIN_API_KEY="${SECRETS[API_KEY]:-}"

echo ""

# --- Generate .env file ------------------------------------------------------

ENV_FILE="$REPO_ROOT/.env"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY RUN — would generate $ENV_FILE with:"
  echo "---"
fi

{
  echo "# ============================================================================="
  echo "# F3 Nation — Local Development Environment"
  echo "# ============================================================================="
  echo "# Auto-generated by scripts/generate-env.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# Source: GCP project '$GCP_PROJECT' (staging — never production)"
  echo "# ============================================================================="
  echo ""

  # Static vars
  for line in "${STATIC_VARS[@]}"; do
    echo "$line"
  done
  echo ""

  # Database
  echo "# -- Database credentials (from GCP Secret Manager) --"
  echo "DATABASE_URL=$DATABASE_URL"
  echo "TEST_DATABASE_URL=$TEST_DATABASE_URL"
  echo ""

  # Auth-specific individual DB fields (auth app parses these separately)
  echo "# -- Auth app DB fields (parsed individually, not from DATABASE_URL) --"
  echo "DATABASE_HOST=localhost"
  echo "DATABASE_USER=$DB_USER"
  echo "DATABASE_PASSWORD=$DB_PASS"
  echo "DATABASE_NAME=$DB_NAME"
  echo ""

  # Secrets
  echo "# -- Secrets (from GCP Secret Manager) --"
  echo "AUTH_SECRET=${SECRETS[AUTH_SECRET]:-}"
  echo "API_KEY=${SECRETS[API_KEY]:-}"
  echo "SUPER_ADMIN_API_KEY=$SUPER_ADMIN_API_KEY"
  echo "SENDGRID_API_KEY=${SECRETS[SENDGRID_API_KEY]:-}"
  echo "EMAIL_SERVER=$EMAIL_SERVER"
  echo ""

  # JWT key (may contain newlines — wrap in quotes)
  echo "# -- Auth JWT private key (PEM format, newlines escaped) --"
  jwt_key="${SECRETS[AUTH_JWT_PRIVATE_KEY]:-}"
  if [[ -n "$jwt_key" ]]; then
    # Escape literal newlines for .env compatibility
    escaped_key=$(echo "$jwt_key" | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')
    echo "AUTH_JWT_PRIVATE_KEY=\"$escaped_key\""
  else
    echo "# AUTH_JWT_PRIVATE_KEY=  (not found in GCP)"
  fi
  echo ""

  # GCS — placeholder (not in staging secrets, needs manual setup)
  echo "# -- Google Cloud Storage (set manually if needed for logo uploads) --"
  echo "# GOOGLE_LOGO_BUCKET_PRIVATE_KEY="
  echo "# GOOGLE_LOGO_BUCKET_CLIENT_EMAIL="
  echo "# GOOGLE_LOGO_BUCKET_BUCKET_NAME="
  echo ""

  # Auth app specific
  echo "# -- Auth app URLs --"
  echo "NEXTAUTH_URL=http://localhost:3004"

} > >(if [[ "$DRY_RUN" == "true" ]]; then cat; else tee "$ENV_FILE" > /dev/null; fi)

if [[ "$DRY_RUN" == "true" ]]; then
  echo "---"
  echo ""
  echo "Would create symlinks:"
  for app in "${APPS[@]}"; do
    echo "  apps/$app/.env.local → ../../.env"
  done
  echo ""
  echo "Dry run complete — no files written."
  exit 0
fi

echo "Generated: $ENV_FILE"
echo ""

# --- Symlink into app directories --------------------------------------------

echo "Creating symlinks:"
for app in "${APPS[@]}"; do
  app_dir="$REPO_ROOT/apps/$app"
  link_path="$app_dir/.env.local"

  if [[ ! -d "$app_dir" ]]; then
    echo "  SKIP: apps/$app (directory not found)"
    continue
  fi

  # Remove existing .env.local if it's not already our symlink
  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    echo "  BACKUP: apps/$app/.env.local → apps/$app/.env.local.bak"
    mv "$link_path" "${link_path}.bak"
  fi

  ln -sf "../../.env" "$link_path"
  echo "  OK: apps/$app/.env.local → ../../.env"
done

echo ""
echo "Done! Local dev environment is ready."
echo ""
echo "Next steps:"
echo "  1. Start the Cloud SQL proxy:  pnpm db:proxy"
echo "  2. Run migrations:             pnpm db:migrate"
echo "  3. Start dev servers:           pnpm dev"
echo ""
echo "All apps share the root .env via symlinks."
echo "To override a specific app, edit apps/<app>/.env.local directly (break the symlink)."
