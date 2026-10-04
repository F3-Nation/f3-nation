#!/usr/bin/env bash
set -euo pipefail

# Push secrets and env vars to GCP Cloud Run for the f3-auth3 service — #876
# Phase 3's standalone Better Auth deployment. This is a SEPARATE Cloud Run
# service from f3-auth (the existing hand-rolled OAuth2/OIDC server, still
# serving every /api/oauth/* request unconditionally): the phased epic's
# decision was to stand Better Auth up on its own, not flip
# AUTH_USE_BETTER_AUTH on the existing deployment in place.
#
# Kept as a separate script rather than parameterizing cloud-run-env.sh:
# that script's SECRET_MAP drives an unconditional `--update-secrets` on
# every run, so adding BETTER_AUTH_SECRET there would make every future
# f3-auth deploy reference a secret that deployment was never meant to have.
#
# Usage:
#   bash apps/auth/scripts/cloud-run-env-auth3.sh --env staging   # reads .env.cloud-run.auth3.staging → project f3-authentication-staging
#   bash apps/auth/scripts/cloud-run-env-auth3.sh --env prod      # reads .env.cloud-run.auth3.prod    → project f3-authentication
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
#   - .env.cloud-run.auth3.prod / .env.cloud-run.auth3.staging populated
#     (copy .env.cloud-run.example, add AUTH_USE_BETTER_AUTH=true and a
#     generated BETTER_AUTH_SECRET, and point NEXT_PUBLIC_AUTH_URL /
#     NEXTAUTH_URL at auth3's own domain, not the existing auth2 one — the
#     Better Auth token issuer is derived from NEXT_PUBLIC_AUTH_URL, so
#     reusing the existing value would make auth3 mint tokens under an
#     issuer another service also claims)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Environment → GCP project mapping (same projects as f3-auth — Phase 3
# stands up a new co-located service, not new infrastructure isolation)
# ---------------------------------------------------------------------------
declare -A PROJECT_MAP=(
  [staging]="f3-authentication-staging"
  [prod]="f3-authentication"
)

SERVICE_NAME="f3-auth3"
REGION="us-central1"

# Secrets this service OWNS: pushed/rotated here the normal way (create,
# update on change, destroy stale versions). BETTER_AUTH_SECRET is
# auth3-exclusive, so this is the only entry.
declare -A SECRET_MAP=(
  [BETTER_AUTH_SECRET]="better-auth-secret"
)

# Secrets this service only REFERENCES — the SAME secret IDs
# cloud-run-env.sh already created and rotates for f3-auth (same database,
# same mail transport, same API key, just read into a second service).
# These are wired into Cloud Run via --update-secrets below, but this
# script never pushes a value for them: push_secret() would otherwise
# compare this file's copy of the value against the live secret and
# silently rotate (and destroy old versions of) a secret f3-auth also
# depends on, the moment .env.cloud-run.auth3.* drifts from the canonical
# value. AUTH_SECRET is included even though auth3 only runs Better Auth:
# apps/auth/src/env.ts requires it unconditionally (NextAuth's own env
# validation runs regardless of AUTH_USE_BETTER_AUTH), so omitting it would
# fail every request that loads the env module, not just NextAuth's code
# paths.
declare -A REFERENCED_SECRET_MAP=(
  [AUTH_SECRET]="auth-secret"
  [DATABASE_HOST]="database-host"
  [DATABASE_USER]="database-user"
  [DATABASE_PASSWORD]="database-password"
  [DATABASE_NAME]="database-name"
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
)

# Plain env vars (hardcoded, same across environments)
declare -A PLAIN_VARS=(
  [NODE_ENV]="production"
  [AUTH_USE_BETTER_AUTH]="true"
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
ENV_FILE="$SCRIPT_DIR/../.env.cloud-run.auth3.$ENV_NAME"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found."
  echo "Copy .env.cloud-run.example and populate with $ENV_NAME values for auth3 (see this script's header comment)."
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
push_secret() {
  local var="$1" secret_id="$2" value="$3" project="$4" sa_email="$5"
  echo " [$var] Processing secret $secret_id..."

  # Create secret if it doesn't exist
  echo " [$var] Checking if secret exists."
  if ! gcloud secrets describe "$secret_id" --project "$project" &>/dev/null; then
    if [[ -z "$value" ]]; then
      echo " [$var] Value not in environment. Skipping."
      return 0
    fi

    echo " [$var] Secret $secret_id does not exist. Creating."
    gcloud secrets create "$secret_id" --project "$project" --replication-policy="automatic" 2>/dev/null || true
    echo -n "$value" | gcloud secrets versions add "$secret_id" --project "$project" --data-file=-

    echo " [$var] Granting access to Cloud Run service account."
    gcloud secrets add-iam-policy-binding "$secret_id" \
      --project "$project" \
      --member "serviceAccount:${sa_email}" \
      --role "roles/secretmanager.secretAccessor" \
      --quiet > /dev/null || { echo " [$var] ERROR: Failed to bind $secret_id" >&2; exit 1; }

    return 0
  fi

  # Secret already exists (e.g. created by hand, as better-auth-secret may
  # be — see this script's header). Bind the service account every run,
  # not just on creation, since a manually-created secret may not have
  # granted it access yet.
  echo " [$var] Granting access to Cloud Run service account."
  gcloud secrets add-iam-policy-binding "$secret_id" \
    --project "$project" \
    --member "serviceAccount:${sa_email}" \
    --role "roles/secretmanager.secretAccessor" \
    --quiet > /dev/null || { echo " [$var] ERROR: Failed to bind $secret_id" >&2; exit 1; }

  if [[ -z "$value" ]]; then
    echo " [$var] Value not in environment. Skipping version update."
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

UPDATE_ARGS=()

# Plain env vars (hardcoded)
for var in "${!PLAIN_VARS[@]}"; do
  echo " [$var] Setting to ${PLAIN_VARS[$var]}"
  UPDATE_ARGS+=("${var}=${PLAIN_VARS[$var]}")
done

# Per-environment env vars (from env file, not secrets)
for var in "${ENV_FILE_VARS[@]}"; do
  value="${!var:-}"
  echo " [$var] Setting to $value"
  [[ -n "$value" ]] && UPDATE_ARGS+=("${var}=${value}")
done

# Secret-backed env vars — both owned (pushed above) and referenced
# (f3-auth's own secrets, never pushed here) are wired into Cloud Run the
# same way; only the push step above treats them differently.
SECRET_ARGS=()
for var in "${!SECRET_MAP[@]}"; do
  secret_id="${SECRET_MAP[$var]}"
  echo " [$var] Mapping to secret $secret_id"
  SECRET_ARGS+=("${var}=${secret_id}:latest")
done
for var in "${!REFERENCED_SECRET_MAP[@]}"; do
  secret_id="${REFERENCED_SECRET_MAP[$var]}"
  echo " [$var] Mapping to secret $secret_id (referenced, owned by f3-auth)"
  # auth3's own runtime service account may differ from f3-auth's — grant it
  # access too, without pushing a version (push_secret() is deliberately
  # never called for this map, see its declaration above).
  gcloud secrets add-iam-policy-binding "$secret_id" \
    --project "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" \
    --role "roles/secretmanager.secretAccessor" \
    --quiet > /dev/null || { echo " [$var] ERROR: Failed to bind $secret_id" >&2; exit 1; }
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
    --update-env-vars "$(IFS=,; echo "${UPDATE_ARGS[*]}")" \
    --update-secrets "$(IFS=,; echo "${SECRET_ARGS[*]}")" \
    --quiet

echo ""
echo "Done! Service $SERVICE_NAME in $PROJECT updated."
