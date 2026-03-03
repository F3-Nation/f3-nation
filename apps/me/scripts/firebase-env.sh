#!/usr/bin/env bash
set -euo pipefail

# Push secrets from .env.firebase to GCP Secret Manager for Firebase App Hosting.
# Usage: ./scripts/firebase-env.sh [--project <project-id>]
#
# Requires:
#   - gcloud CLI authenticated
#   - .env.firebase populated in this directory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.firebase"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.firebase.sample and populate it."
  exit 1
fi

SECRET_VARS=(
  "NEXT_PUBLIC_SITE_URL"
  "ENVIRONMENT"
  "OAUTH_CLIENT_ID"
  "OAUTH_CLIENT_SECRET"
  "OAUTH_REDIRECT_URI"
  "AUTH_PROVIDER_URL"
  "SESSION_SECRET"
  "F3_API_KEY"
  "F3_API_BASE_URL"
  "GCS_BUCKET"
  "GCS_CREDENTIALS"
)

SECRET_IDS=(
  "next-public-site-url"
  "environment"
  "oauth-client-id"
  "oauth-client-secret"
  "oauth-redirect-uri"
  "auth-provider-url"
  "session-secret"
  "f3-api-key"
  "f3-api-base-url"
  "gcs-bucket"
  "gcs-credentials"
)

# Parse optional --project flag
PROJECT_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_FLAG="--project $2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Source the env file
set -a
source "$ENV_FILE"
set +a

echo "Pushing secrets to GCP Secret Manager..."

for i in "${!SECRET_VARS[@]}"; do
  var="${SECRET_VARS[$i]}"
  secret_id="${SECRET_IDS[$i]}"
  value="${!var:-}"

  if [[ -z "$value" ]]; then
    echo "  SKIP: $var (empty)"
    continue
  fi

  # Create secret if it doesn't exist
  if ! gcloud secrets describe "$secret_id" $PROJECT_FLAG &>/dev/null; then
    echo "  CREATE: $secret_id"
    gcloud secrets create "$secret_id" $PROJECT_FLAG --replication-policy="automatic" 2>/dev/null || true
  fi

  # Add new version
  echo "  UPDATE: $secret_id"
  echo -n "$value" | gcloud secrets versions add "$secret_id" $PROJECT_FLAG --data-file=-
done

echo "Done! All secrets have been pushed."
