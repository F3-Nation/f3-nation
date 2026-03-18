#!/usr/bin/env bash
set -euo pipefail

# Push secrets and env vars to GCP Cloud Run for the f3-auth service.
#
# Usage:
#   bash apps/auth/scripts/cloud-run-env.sh --env staging   # reads .env.cloud-run.staging → project f3-auth-staging
#   bash apps/auth/scripts/cloud-run-env.sh --env prod      # reads .env.cloud-run.prod    → project f3-auth
#
# Each environment is a separate GCP project. Secret names are identical in both
# projects — isolation comes from the project boundary.
#
# This script:
#   1. Creates/updates secrets in GCP Secret Manager
#   2. Updates the Cloud Run service to reference those secrets as env vars
#
# Requires:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - .env.cloud-run.prod / .env.cloud-run.staging populated

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Environment → GCP project mapping
# ---------------------------------------------------------------------------
declare -A PROJECT_MAP=(
  [staging]="f3-authentication-staging"
  [prod]="f3-authentication"
)

SERVICE_NAME="f3-auth"
REGION="us-east1"

# Env vars that map to GCP secrets (var name → secret ID).
# Only genuinely sensitive values go here.
declare -A SECRET_MAP=(
  [DATABASE_HOST]="database-host"
  [DATABASE_USER]="database-user"
  [DATABASE_PASSWORD]="database-password"
  [DATABASE_NAME]="database-name"
  [AUTH_SECRET]="auth-secret"
  [AUTH_JWT_PRIVATE_KEY]="auth-jwt-private-key"
  [SENDGRID_API_KEY]="sendgrid-api-key"
  [API_KEY]="api-key"
)

# Per-environment env vars read from the env file (not sensitive, set as plain
# Cloud Run env vars)
ENV_FILE_VARS=(
  NEXT_PUBLIC_AUTH_URL
  NEXT_PUBLIC_API_URL
  EMAIL_FROM
)

# Plain env vars (hardcoded, same across environments)
declare -A PLAIN_VARS=(
  [NODE_ENV]="production"
)

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
ENV_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: $0 --env <prod|staging>"
      exit 1
      ;;
  esac
done

if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: $0 --env <prod|staging>"
  exit 1
fi

if [[ ! "${PROJECT_MAP[$ENV_NAME]+_}" ]]; then
  echo "Error: Unknown environment '$ENV_NAME'. Must be 'prod' or 'staging'."
  exit 1
fi

PROJECT="${PROJECT_MAP[$ENV_NAME]}"
ENV_FILE="$SCRIPT_DIR/../.env.cloud-run.$ENV_NAME"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found."
  echo "Copy .env.cloud-run.example and populate with $ENV_NAME values."
  exit 1
fi

# Source the env file
set -a
source "$ENV_FILE"
set +a

echo "Environment:  $ENV_NAME"
echo "GCP Project:  $PROJECT"
echo "Service:      $SERVICE_NAME"
echo "Region:       $REGION"
echo "Env file:     $ENV_FILE"
echo ""

# ---------------------------------------------------------------------------
# Push secrets to Secret Manager
# ---------------------------------------------------------------------------
echo "Pushing secrets to GCP Secret Manager..."

push_secret() {
  local var="$1" secret_id="$2" value="$3" project="$4"

  if [[ -z "$value" ]]; then
    echo "  SKIP: $var (empty)"
    return 0
  fi

  # Create secret if it doesn't exist
  if ! gcloud secrets describe "$secret_id" --project "$project" &>/dev/null; then
    echo "  CREATE: $secret_id"
    gcloud secrets create "$secret_id" --project "$project" --replication-policy="automatic" 2>/dev/null || true
    existing=""
  else
    existing="$(gcloud secrets versions access latest --secret="$secret_id" --project "$project" 2>/dev/null)" || existing=""
  fi

  if [[ "$existing" == "$value" ]]; then
    echo "  UNCHANGED: $secret_id"
    return 0
  fi

  echo "  UPDATE: $secret_id"
  echo -n "$value" | gcloud secrets versions add "$secret_id" --project "$project" --data-file=-

  # Delete all previous versions (keep only the one we just created)
  latest="$(gcloud secrets versions list "$secret_id" --project "$project" \
    --filter="state=ENABLED" --sort-by="~createTime" --limit=1 --format='value(name)' 2>/dev/null)"
  while IFS= read -r ver; do
    [[ -z "$ver" || "$ver" == "$latest" ]] && continue
    echo "    DESTROY old version: $ver"
    gcloud secrets versions destroy "$ver" --secret="$secret_id" --project "$project" --quiet 2>/dev/null || true
  done < <(gcloud secrets versions list "$secret_id" --project "$project" \
    --filter="state!=DESTROYED" --format='value(name)' 2>/dev/null)
}

# Run secret pushes in parallel
PIDS=()
for var in "${!SECRET_MAP[@]}"; do
  push_secret "$var" "${SECRET_MAP[$var]}" "${!var:-}" "$PROJECT" &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done

# ---------------------------------------------------------------------------
# Grant Cloud Run service account access to secrets
# ---------------------------------------------------------------------------
echo ""
echo "Granting secret access to Cloud Run service account..."

SA_EMAIL="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT" \
  --region "$REGION" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)" || SA_EMAIL=""

if [[ -z "$SA_EMAIL" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

for var in "${!SECRET_MAP[@]}"; do
  secret_id="${SECRET_MAP[$var]}"
  echo "  Granting access to $secret_id..."
  gcloud secrets add-iam-policy-binding "$secret_id" \
    --project "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" \
    --role "roles/secretmanager.secretAccessor" \
    --quiet > /dev/null || echo "  WARNING: Failed to bind $secret_id"
done

# ---------------------------------------------------------------------------
# Build the Cloud Run update command
# ---------------------------------------------------------------------------
echo ""
echo "Updating Cloud Run service env vars and secret references..."

UPDATE_ARGS=()

# Plain env vars (hardcoded)
for var in "${!PLAIN_VARS[@]}"; do
  UPDATE_ARGS+=("${var}=${PLAIN_VARS[$var]}")
done

# Per-environment env vars (from env file, not secrets)
for var in "${ENV_FILE_VARS[@]}"; do
  value="${!var:-}"
  [[ -n "$value" ]] && UPDATE_ARGS+=("${var}=${value}")
done

# Secret-backed env vars
SECRET_ARGS=()
for var in "${!SECRET_MAP[@]}"; do
  secret_id="${SECRET_MAP[$var]}"
  SECRET_ARGS+=("${var}=${secret_id}:latest")
done

gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT" \
  --region "$REGION" \
  --update-env-vars "$(IFS=,; echo "${UPDATE_ARGS[*]}")" \
  --update-secrets "$(IFS=,; echo "${SECRET_ARGS[*]}")" \
  --quiet

echo ""
echo "Done! Service $SERVICE_NAME in $PROJECT updated."
