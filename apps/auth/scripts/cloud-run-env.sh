#!/usr/bin/env bash
#
# Manage Cloud Run secrets and environment variables for apps/auth.
# Modeled after apps/me/scripts/cloud-run-env.sh.
#
# Usage:
#   bash apps/auth/scripts/cloud-run-env.sh --env staging
#   bash apps/auth/scripts/cloud-run-env.sh --env prod
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
ENV=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$ENV" ]]; then
  echo "Usage: $0 --env <staging|prod>"
  exit 1
fi

# ---------------------------------------------------------------------------
# Environment config
# ---------------------------------------------------------------------------
case "$ENV" in
  staging)
    PROJECT="f3-auth-staging"
    SERVICE="f3-auth"
    REGION="us-east1"
    SA="f3-auth-sa@${PROJECT}.iam.gserviceaccount.com"
    ;;
  prod)
    PROJECT="f3-auth"
    SERVICE="f3-auth"
    REGION="us-east1"
    SA="f3-auth-sa@${PROJECT}.iam.gserviceaccount.com"
    ;;
  *)
    echo "Invalid env: $ENV (use staging or prod)"
    exit 1
    ;;
esac

echo "=== Deploying secrets for $ENV (project: $PROJECT) ==="

# ---------------------------------------------------------------------------
# Secret-backed env vars (stored in GCP Secret Manager)
# ---------------------------------------------------------------------------
declare -A SECRET_MAP=(
  ["DATABASE_URL"]="${DATABASE_URL:-}"
  ["NEXTAUTH_SECRET"]="${NEXTAUTH_SECRET:-}"
  ["SENDGRID_API_KEY"]="${SENDGRID_API_KEY:-}"
  ["F3_API_KEY"]="${F3_API_KEY:-}"
)

for SECRET_NAME in "${!SECRET_MAP[@]}"; do
  SECRET_VALUE="${SECRET_MAP[$SECRET_NAME]}"
  if [[ -z "$SECRET_VALUE" ]]; then
    echo "Warning: $SECRET_NAME is empty, skipping"
    continue
  fi

  # Create secret if it doesn't exist
  if ! gcloud secrets describe "$SECRET_NAME" --project="$PROJECT" &>/dev/null; then
    echo "Creating secret: $SECRET_NAME"
    echo -n "$SECRET_VALUE" | gcloud secrets create "$SECRET_NAME" \
      --project="$PROJECT" \
      --data-file=- \
      --replication-policy=automatic
  else
    echo "Updating secret: $SECRET_NAME"
    echo -n "$SECRET_VALUE" | gcloud secrets versions add "$SECRET_NAME" \
      --project="$PROJECT" \
      --data-file=-
  fi

  # Grant access to the Cloud Run service account
  gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
    --project="$PROJECT" \
    --member="serviceAccount:$SA" \
    --role="roles/secretmanager.secretAccessor" \
    --quiet
done

# ---------------------------------------------------------------------------
# Build the --update-secrets and --set-env-vars flags
# ---------------------------------------------------------------------------
SECRET_FLAGS=""
for SECRET_NAME in "${!SECRET_MAP[@]}"; do
  if [[ -n "${SECRET_MAP[$SECRET_NAME]}" ]]; then
    SECRET_FLAGS="${SECRET_FLAGS}${SECRET_NAME}=${SECRET_NAME}:latest,"
  fi
done
SECRET_FLAGS="${SECRET_FLAGS%,}" # trim trailing comma

# Plain env vars
PLAIN_VARS="NEXTAUTH_URL=${NEXTAUTH_URL:-},F3_API_BASE_URL=${F3_API_BASE_URL:-},EMAIL_FROM=${EMAIL_FROM:-},NODE_ENV=production"

echo ""
echo "Updating Cloud Run service: $SERVICE"

gcloud run services update "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --update-secrets="$SECRET_FLAGS" \
  --set-env-vars="$PLAIN_VARS"

echo ""
echo "✅ Done! Secrets and env vars updated for $ENV."
