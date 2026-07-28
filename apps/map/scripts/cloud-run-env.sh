#!/usr/bin/env bash
set -euo pipefail

# Push secrets and env vars to GCP Cloud Run for the f3-map service.
#
# Usage:
#   bash apps/map/scripts/cloud-run-env.sh --env staging
#   bash apps/map/scripts/cloud-run-env.sh --env prod
#
# Each environment is a separate GCP project. Secret names are identical in both
# projects; isolation comes from the project boundary.
#
# This script:
#   1. Creates/updates secrets in GCP Secret Manager
#   2. Updates the Cloud Run service to reference those secrets as env vars
#
# Requires:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - apps/map/.env.cloud-run.prod / apps/map/.env.cloud-run.staging populated

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Environment -> GCP project mapping
# ---------------------------------------------------------------------------
declare -A PROJECT_MAP=(
  [staging]="f3-map-app-staging"
  [prod]="f3-map-app"
)

SERVICE_NAME="f3-map"
REGION="us-central1"

# Env vars that map to GCP secrets (var name -> secret ID).
# Only genuinely sensitive values go here.
declare -A SECRET_MAP=(
  [API_KEY]="API_KEY"
  [AUTH_SECRET]="AUTH_SECRET"
  [DATABASE_URL]="DATABASE_URL"
  [EMAIL_SERVER]="EMAIL_SERVER"
  [F3_GOOGLE_API_KEY]="F3_GOOGLE_API_KEY"
  [F3_MAP_API_KEY]="F3_MAP_API_KEY"
  [NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED]="NOTIFY_WEBHOOK_URLS_COMMA_SEPARATED"
  [SUPER_ADMIN_API_KEY]="SUPER_ADMIN_API_KEY"
  [TEST_DATABASE_URL]="TEST_DATABASE_URL"
)

# Per-environment env vars read from the env file (not sensitive, set as plain
# Cloud Run env vars).
ENV_FILE_VARS=(
  AUTH_URL
  EMAIL_ADMIN_DESTINATIONS
  EMAIL_FROM
  EMAIL_REGION_IN_A_BOX_CC
  F3_ADMIN_URL
  F3_API_BASE_URL
  F3_CHANNEL
  F3_MAP_BASE_URL
  NEXT_PUBLIC_API_URL
  NEXT_PUBLIC_CHANNEL
  NEXT_PUBLIC_GA_MEASUREMENT_ID
  NEXT_PUBLIC_MAP_URL
)

# Plain env vars (hardcoded, same across environments).
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

# Source the env file.
set -a
source "$ENV_FILE"
set +a

echo "Environment:  $ENV_NAME"
echo "GCP Project:  $PROJECT"
echo "Service:      $SERVICE_NAME"
echo "Region:       $REGION"
echo "Env file:     $(cd "$(dirname "$ENV_FILE")" && pwd -P)/$(basename "$ENV_FILE")"
echo ""

# ---------------------------------------------------------------------------
# Push secrets to Secret Manager
# ---------------------------------------------------------------------------
push_secret() {
  local var="$1" secret_id="$2" value="$3" project="$4" sa_email="$5"
  echo " [$var] Processing secret $secret_id..."

  if [[ -z "$value" ]]; then
    echo " [$var] Value not in environment. Skipping."
    return 0
  fi

  # Create secret if it doesn't exist.
  echo " [$var] Checking if secret exists."
  if ! gcloud secrets describe "$secret_id" --project "$project" &>/dev/null; then
    echo " [$var] Secret $secret_id does not exist. Creating."
    gcloud secrets create "$secret_id" --project "$project" --replication-policy="automatic" 2>/dev/null || true
    echo -n "$value" | gcloud secrets versions add "$secret_id" --project "$project" --data-file=-

    echo " [$var] Granting access to Cloud Run service account."
    gcloud secrets add-iam-policy-binding "$secret_id" \
      --project "$project" \
      --member "serviceAccount:${sa_email}" \
      --role "roles/secretmanager.secretAccessor" \
      --quiet > /dev/null || echo " [$var] WARNING: Failed to bind $secret_id"

    return 0
  fi

  echo " [$var] Secret already exists. Checking if update is needed."
  existing="$(gcloud secrets versions access latest --secret="$secret_id" --project "$project" 2>/dev/null)" || existing=""

  if [[ "$existing" == "$value" ]]; then
    echo " [$var] Value is unchanged. No action."
    return 0
  fi

  echo " [$var] Updating secret."
  echo -n "$value" | gcloud secrets versions add "$secret_id" --project "$project" --data-file=-

  # Delete all previous versions (keep only the one we just created).
  latest="$(gcloud secrets versions list "$secret_id" --project "$project" \
    --filter="state=ENABLED" --sort-by="~createTime" --limit=1 --format='value(name)' 2>/dev/null)"
  while IFS= read -r ver; do
    [[ -z "$ver" || "$ver" == "$latest" ]] && continue
    echo " [$var] Destroying old version: $ver"
    gcloud secrets versions destroy "$ver" --secret="$secret_id" --project="$project" --quiet 2>/dev/null || true
  done < <(gcloud secrets versions list "$secret_id" --project "$project" \
    --filter="state!=DESTROYED" --format='value(name)' 2>/dev/null)
}

echo ""
echo "Preparing Cloud Run service account email for granting secret permissions."

SA_EMAIL="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT" \
  --region "$REGION" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)" || SA_EMAIL=""

if [[ -z "$SA_EMAIL" ]]; then
  echo "Service $SERVICE_NAME not found in project $PROJECT. Defaulting to default Compute Engine service account."
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
  SA_EMAIL="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

# Run secret pushes in parallel.
PIDS=()
echo "Pushing secrets to GCP Secret Manager..."
for var in "${!SECRET_MAP[@]}"; do
  push_secret "$var" "${SECRET_MAP[$var]}" "${!var:-}" "$PROJECT" "$SA_EMAIL" &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid"; done

# ---------------------------------------------------------------------------
# Update Cloud Run service with env vars and secret references
# ---------------------------------------------------------------------------
echo ""
echo "Updating Cloud Run service env vars and secret references..."

UPDATE_ARGS=()

# Plain env vars (hardcoded).
for var in "${!PLAIN_VARS[@]}"; do
  echo " [$var] Setting to ${PLAIN_VARS[$var]}"
  UPDATE_ARGS+=("${var}=${PLAIN_VARS[$var]}")
done

# Per-environment env vars (from env file, not secrets).
for var in "${ENV_FILE_VARS[@]}"; do
  value="${!var:-}"
  echo " [$var] Setting to $value"
  [[ -n "$value" ]] && UPDATE_ARGS+=("${var}=${value}")
done

# Secret-backed env vars.
SECRET_ARGS=()
for var in "${!SECRET_MAP[@]}"; do
  secret_id="${SECRET_MAP[$var]}"
  echo " [$var] Mapping to secret $secret_id"
  SECRET_ARGS+=("${var}=${secret_id}:latest")
done

# ---------------------------------------------------------------------------
# Build the Cloud Run update command
# ---------------------------------------------------------------------------

echo ""
echo "Pushing updates to Cloud Run service $SERVICE_NAME in project $PROJECT."
gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT" \
  --region "$REGION" \
  --update-env-vars "^::^$(printf '%s::' "${UPDATE_ARGS[@]}" | sed 's/::$//')" \
  --update-secrets "$(IFS=,; echo "${SECRET_ARGS[*]}")" \
  --quiet

echo ""
echo "Done! Service $SERVICE_NAME in $PROJECT updated."
