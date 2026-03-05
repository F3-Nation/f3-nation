#!/usr/bin/env bash
set -euo pipefail

# Push secrets from .env.firebase.{env} to GCP Secret Manager for Firebase App Hosting.
#
# Usage:
#   bash scripts/firebase-env.sh --env staging   # reads .env.firebase.staging → project f3-me-profile-manager-staging
#   bash scripts/firebase-env.sh --env prod      # reads .env.firebase.prod   → project f3-me-profile-manager
#
# Each environment is a separate GCP/Firebase project with its own backend named "f3-me".
# Secret names are identical in both projects — isolation comes from the project boundary.
#
# Requires:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - .env.firebase.prod / .env.firebase.staging populated

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Environment → GCP project mapping
declare -A PROJECT_MAP=(
  [prod]="f3-me-profile-manager"
  [staging]="f3-me-profile-manager-staging"
)

BACKEND_ID="f3-me"

SECRET_VARS=(
  "NEXT_PUBLIC_SITE_URL"
  "ENVIRONMENT"
  "OAUTH_CLIENT_ID"
  "OAUTH_REDIRECT_URI"
  "F3_API_BASE_URL"
  "OAUTH_CLIENT_SECRET"
  "SESSION_SECRET"
  "F3_API_KEY"
  "GCS_CREDENTIALS"
)

SECRET_IDS=(
  "next-public-site-url"
  "environment"
  "oauth-client-id"
  "oauth-redirect-uri"
  "f3-api-base-url"
  "oauth-client-secret"
  "session-secret"
  "f3-api-key"
  "gcs-credentials"
)

# Parse flags
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
ENV_FILE="$SCRIPT_DIR/../.env.firebase.$ENV_NAME"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found."
  exit 1
fi

# Source the env file
set -a
source "$ENV_FILE"
set +a

echo "Environment:  $ENV_NAME"
echo "GCP Project:  $PROJECT"
echo "Backend:      $BACKEND_ID"
echo "Env file:     $ENV_FILE"
echo ""
echo "Pushing secrets to GCP Secret Manager..."

# Process each secret: create if needed, add version, grant access — in parallel
push_secret() {
  local var="$1"
  local secret_id="$2"
  local value="$3"
  local project="$4"
  local backend="$5"

  # Create secret if it doesn't exist
  if ! gcloud secrets describe "$secret_id" --project "$project" &>/dev/null; then
    echo "  CREATE: $secret_id"
    gcloud secrets create "$secret_id" --project "$project" --replication-policy="automatic" 2>/dev/null || true
    existing=""
  else
    # Fetch current value to compare
    existing="$(gcloud secrets versions access latest --secret="$secret_id" --project "$project" 2>/dev/null)" || existing=""
  fi

  if [[ "$existing" == "$value" ]]; then
    echo "  UNCHANGED: $secret_id"
    return 0
  fi

  # Add new version
  echo "  UPDATE: $secret_id"
  echo -n "$value" | gcloud secrets versions add "$secret_id" --project "$project" --data-file=-

  # Grant the App Hosting backend access (idempotent, fast after first run)
  firebase apphosting:secrets:grantaccess "$secret_id" --project "$project" --backend "$backend" 2>/dev/null || true
}

export -f push_secret
PIDS=()

for i in "${!SECRET_VARS[@]}"; do
  var="${SECRET_VARS[$i]}"
  secret_id="${SECRET_IDS[$i]}"
  value="${!var:-}"

  if [[ -z "$value" ]]; then
    echo "  SKIP: $var (empty)"
    continue
  fi

  push_secret "$var" "$secret_id" "$value" "$PROJECT" "$BACKEND_ID" &
  PIDS+=($!)
done

# Wait for all background jobs
FAILED=0
for pid in "${PIDS[@]}"; do
  wait "$pid" || ((FAILED++))
done

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "Warning: $FAILED secret(s) had errors."
fi

echo ""
echo "Done! Secrets pushed to $PROJECT for backend $BACKEND_ID."
