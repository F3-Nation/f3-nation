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
# shellcheck source=lib/gcloud-env-vars.sh
source "$SCRIPT_DIR/lib/gcloud-env-vars.sh"

# ---------------------------------------------------------------------------
# Environment → GCP project mapping
# ---------------------------------------------------------------------------
declare -A PROJECT_MAP=(
  [staging]="f3-authentication-staging"
  [prod]="f3-authentication"
)

SERVICE_NAME="f3-auth"
REGION="us-central1"

# Env vars that map to GCP secrets (var name → secret ID).
# Only genuinely sensitive values go here.
declare -A SECRET_MAP=(
  [DATABASE_HOST]="database-host"
  [DATABASE_USER]="database-user"
  [DATABASE_PASSWORD]="database-password"
  [DATABASE_NAME]="database-name"
  [AUTH_SECRET]="auth-secret"
  [AUTH_JWT_PRIVATE_KEY]="auth-jwt-private-key"
  [EMAIL_SERVER]="email-server"
  [API_KEY]="api-key"
)

# Per-environment env vars read from the env file (not sensitive, set as plain
# Cloud Run env vars)
ENV_FILE_VARS=(
  NEXTAUTH_URL
  NEXT_PUBLIC_AUTH_URL
  NEXT_PUBLIC_API_URL
  EMAIL_FROM
  APPS_DIRECTORY_URL
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

# Source the env file. APPS_DIRECTORY_URL is removed from the service when
# the file leaves it out, so drop any value the calling shell exported first:
# otherwise that value, not the file's, would be applied.
unset APPS_DIRECTORY_URL
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
push_secret() {
  local var="$1" secret_id="$2" value="$3" project="$4" sa_email="$5"
  echo " [$var] Processing secret $secret_id..."

  if [[ -z "$value" ]]; then
    echo " [$var] Value not in environment. Skipping."
    return 0
  fi

  # Create secret if it doesn't exist
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

  # Delete all previous versions (keep only the one we just created)
  latest="$(gcloud secrets versions list "$secret_id" --project "$project" \
    --filter="state=ENABLED" --sort-by="~createTime" --limit=1 --format='value(name)' 2>/dev/null)"
  while IFS= read -r ver; do
    [[ -z "$ver" || "$ver" == "$latest" ]] && continue
    echo " [$var] Destroying old version: $ver"
    gcloud secrets versions destroy "$ver" --secret="$secret_id" --project "$project" --quiet 2>/dev/null || true
  done < <(gcloud secrets versions list "$secret_id" --project "$project" \
    --filter="state!=DESTROYED" --format='value(name)' 2>/dev/null)
}

# ---------------------------------------------------------------------------
# Build the plain env-var argument first, so a value join_env_vars rejects
# stops the script before any secret version is added or destroyed.
# ---------------------------------------------------------------------------
echo ""
echo "Preparing Cloud Run env vars..."

UPDATE_ARGS=()
REMOVE_ARGS=()

# Plain env vars (hardcoded)
for var in "${!PLAIN_VARS[@]}"; do
  echo " [$var] Setting to ${PLAIN_VARS[$var]}"
  UPDATE_ARGS+=("${var}=${PLAIN_VARS[$var]}")
done

# Per-environment env vars (from env file, not secrets)
for var in "${ENV_FILE_VARS[@]}"; do
  value="${!var:-}"
  if [[ -n "$value" ]]; then
    echo " [$var] Setting to $value"
    UPDATE_ARGS+=("${var}=${value}")
  elif [[ "$var" == "APPS_DIRECTORY_URL" ]]; then
    # Optional with a default in code. Cloud Run keeps a variable that is
    # left out of --update-env-vars, so remove it explicitly or deleting it
    # from the env file would leave an old "off" or URL in place.
    echo " [$var] Unset, removing from the service"
    REMOVE_ARGS+=("$var")
  else
    echo " [$var] Unset, leaving the service's value as is"
  fi
done

# "|" instead of a comma join so a comma inside EMAIL_FROM stays in the value
# (see lib/gcloud-env-vars.sh).
ENV_VARS_ARG="$(join_env_vars "|" "${UPDATE_ARGS[@]}")"

# Get the Cloud Run service account email to grant it access to secrets. If the service doesn't exist yet, we'll default to the Compute Engine default service account, which is what Cloud Run
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

# Run secret pushes in parallel
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

# Secret-backed env vars
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
REMOVE_FLAGS=()
if [[ ${#REMOVE_ARGS[@]} -gt 0 ]]; then
  REMOVE_FLAGS=(--remove-env-vars "$(IFS=,; echo "${REMOVE_ARGS[*]}")")
fi
gcloud run services update "$SERVICE_NAME" \
    --project "$PROJECT" \
    --region "$REGION" \
    --update-env-vars "$ENV_VARS_ARG" \
    ${REMOVE_FLAGS[@]+"${REMOVE_FLAGS[@]}"} \
    --update-secrets "$(IFS=,; echo "${SECRET_ARGS[*]}")" \
    --quiet

echo ""
echo "Done! Service $SERVICE_NAME in $PROJECT updated."
