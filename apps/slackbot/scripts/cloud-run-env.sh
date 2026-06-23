#!/usr/bin/env bash
set -euo pipefail

# Push secrets and env vars to GCP Cloud Run for the f3-slackbot service and scripts job.
#
# Usage:
#   bash scripts/cloud-run-env.sh --env staging   # reads .env.cloud-run.staging → project f3-slackbot-staging
#   bash scripts/cloud-run-env.sh --env prod      # reads .env.cloud-run.prod    → project f3-slackbot
#
# Each environment is a separate GCP project. Secret names are identical in both
# projects — isolation comes from the project boundary.
#
# This script:
#   1. Creates/updates secrets in GCP Secret Manager
#   2. Updates the Cloud Run service and scripts job to reference those secrets as env vars
#
# Requires:
#   - gcloud CLI authenticated (`gcloud auth login`)
#   - .env.cloud-run.prod / .env.cloud-run.staging populated

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Environment → GCP project mapping
declare -A PROJECT_MAP=(
  [prod]="f3-slackbot"
  [staging]="f3-slackbot-staging"
)

SERVICE_NAME="f3-slackbot"
SCRIPTS_JOB_NAME="f3-slackbot-scripts"
REGION="us-central1"

# Env vars that map to GCP secrets (var name → secret ID)
# Only genuinely sensitive values go here.
declare -A SECRET_MAP=(
  [SLACK_SIGNING_SECRET]="slack-signing-secret"
  [SLACK_BOT_TOKEN]="slack-bot-token"
  [SLACK_CLIENT_SECRET]="slack-client-secret"
  [DATABASE_PASSWORD]="database-password"
  [SECRET_ADMIN_PASSWORD]="secret-admin-password"
  [PASSWORD_ENCRYPT_KEY]="password-encrypt-key"
  [F3_API_KEY]="f3-api-key"
  [MAP_REVALIDATION_KEY]="map-revalidation-key"
  [STRAVA_CLIENT_SECRET]="strava-client-secret"
  [ADMIN_BOT_TOKEN]="admin-bot-token"
  [SENDGRID_API_KEY]="sendgrid-api-key"
)

# Per-environment env vars read from the env file (not sensitive, set as plain Cloud Run env vars)
ENV_FILE_VARS=(
  SLACK_CLIENT_ID
  F3_BASE_URL
  STATS_URL
  MAP_REVALIDATION_URL
  FILE_BUCKET_PREFIX
  APP_URL
  ALL_USERS_ARE_ADMINS
  LOG_LEVEL
  SQL_ECHO
  DATABASE_HOST
  DATABASE_USER
  DATABASE_SCHEMA
  ACHIEVMENTS_ALPHA_TESTING_ORG_IDS
  ADMIN_CHANNEL_ID
  STRAVA_CLIENT_ID
  HOME_REGION_NUDGE_DAY
  HOME_REGION_NUDGE_HOUR
)

# Plain env vars (hardcoded, same across environments)
declare -A PLAIN_VARS=(
  [SLACK_SCOPES]="app_mentions:read,canvases:read,canvases:write,channels:history,channels:join,channels:manage,channels:read,channels:write.invites,channels:write.topic,chat:write,chat:write.customize,chat:write.public,commands,emoji:read,files:read,files:write,groups:history,groups:read,groups:write,groups:write.invites,groups:write.topic,im:history,im:read,im:write,im:write.topic,incoming-webhook,links.embed:write,links:read,links:write,metadata.message:read,mpim:history,mpim:read,mpim:write,mpim:write.topic,pins:read,pins:write,reactions:read,reactions:write,reminders:read,reminders:write,remote_files:read,remote_files:share,remote_files:write,team:read,usergroups:read,usergroups:write,users.profile:read,users:read,users:read.email,users:write"
  [LOCAL_DEVELOPMENT]=false
  [ENABLE_DEBUGGING]=false
  [SOCKET_MODE]=false
  [LOCAL_HTTP_PORT]=3006
  [USE_GCP_AUTH_PROXY]=true
  [PYTHONUNBUFFERED]=1
)

# Parse flags
ENV_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      if [[ $# -lt 2 || -z "${2:-}" ]]; then
        echo "Error: --env requires an argument."
        echo "Usage: $0 --env <prod|staging>"
        exit 1
      fi
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

# Safely parse the env file without sourcing to prevent execution of arbitrary shell code
while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip blank lines and comments
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  # Match only KEY=VALUE pairs (no command substitution or expansion)
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    _env_key="${BASH_REMATCH[1]}"
    _env_val="${BASH_REMATCH[2]}"
    # Strip surrounding single or double quotes
    if [[ "$_env_val" =~ ^\"(.*)\"$ ]] || [[ "$_env_val" =~ ^\'(.*)\'$ ]]; then
      _env_val="${BASH_REMATCH[1]}"
    fi
    export "${_env_key}=${_env_val}"
  fi
done < "$ENV_FILE"
unset _env_key _env_val

echo "Environment:  $ENV_NAME"
echo "GCP Project:  $PROJECT"
echo "Service:      $SERVICE_NAME"
echo "Scripts job:  $SCRIPTS_JOB_NAME"
echo "Region:       $REGION"
echo "Env file:     $ENV_FILE"
echo ""

# ── Push secrets to Secret Manager ──
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
    create_output=""
    if ! create_output="$(gcloud secrets create "$secret_id" --project "$project" --replication-policy="automatic" 2>&1)"; then
      if grep -qi "already exists" <<<"$create_output"; then
        echo "  EXISTS: $secret_id"
      else
        echo "  ERROR: failed to create secret $secret_id"
        echo "$create_output"
        return 1
      fi
    fi

    existing="$(gcloud secrets versions access latest --secret="$secret_id" --project "$project" 2>/dev/null)" || existing=""
  else
    existing="$(gcloud secrets versions access latest --secret="$secret_id" --project "$project" 2>/dev/null)" || existing=""
  fi

  if [[ "$existing" == "$value" ]]; then
    echo "  UNCHANGED: $secret_id"
    return 0
  fi

  echo "  UPDATE: $secret_id"
  printf '%s' "$value" | gcloud secrets versions add "$secret_id" --project "$project" --data-file=-

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
FAILED=0
for pid in "${PIDS[@]}"; do
  wait "$pid" || FAILED=1
done
if [[ "$FAILED" -ne 0 ]]; then
  echo "Error: One or more secret pushes failed."
  exit 1
fi

# ── Grant Cloud Run runtime service accounts access to secrets ──
echo ""
echo "Granting secret access to Cloud Run runtime service accounts..."

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
DEFAULT_COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

get_service_sa() {
  local service_name="$1"
  local sa_email

  sa_email="$(gcloud run services describe "$service_name" \
    --project "$PROJECT" \
    --region "$REGION" \
    --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null)" || sa_email=""

  printf '%s' "${sa_email:-$DEFAULT_COMPUTE_SA}"
}

get_job_sa() {
  local job_name="$1"
  local sa_email

  # Cloud Run Jobs have had different describe shapes across gcloud/API versions;
  # try the known formats, then fall back to the default compute service account.
  sa_email="$(gcloud run jobs describe "$job_name" \
    --project "$PROJECT" \
    --region "$REGION" \
    --format='value(spec.template.spec.template.spec.serviceAccountName)' 2>/dev/null)" || sa_email=""

  if [[ -z "$sa_email" ]]; then
    sa_email="$(gcloud run jobs describe "$job_name" \
      --project "$PROJECT" \
      --region "$REGION" \
      --format='value(template.template.serviceAccount)' 2>/dev/null)" || sa_email=""
  fi

  printf '%s' "${sa_email:-$DEFAULT_COMPUTE_SA}"
}

RUNTIME_SAS=(
  "$(get_service_sa "$SERVICE_NAME")"
  "$(get_job_sa "$SCRIPTS_JOB_NAME")"
)

for var in "${!SECRET_MAP[@]}"; do
  secret_id="${SECRET_MAP[$var]}"
  for sa_email in "${RUNTIME_SAS[@]}"; do
    echo "  Granting $sa_email access to $secret_id..."
    if ! gcloud secrets add-iam-policy-binding "$secret_id" \
      --project "$PROJECT" \
      --member "serviceAccount:${sa_email}" \
      --role "roles/secretmanager.secretAccessor" \
      --quiet > /dev/null; then
      echo "  ERROR: Failed to grant IAM access for secret $secret_id to $sa_email — aborting."
      exit 1
    fi
  done
done

# ── Build the Cloud Run update command ──
echo ""
echo "Updating Cloud Run service and scripts job env vars and secret references..."

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

# gcloud parses --update-env-vars/--update-secrets as dictionary flags. The
# default separator is a comma, but values like SLACK_SCOPES also contain
# commas, so use gcloud's custom delimiter escaping syntax.
DICT_DELIM="__F3_ENV_DELIM__"

join_dict_args() {
  local joined=""
  local arg

  for arg in "$@"; do
    if [[ -z "$joined" ]]; then
      joined="$arg"
    else
      joined+="${DICT_DELIM}${arg}"
    fi
  done

  printf '^%s^%s' "$DICT_DELIM" "$joined"
}

UPDATE_ENV_VARS_ARG="$(join_dict_args "${UPDATE_ARGS[@]}")"
UPDATE_SECRETS_ARG="$(join_dict_args "${SECRET_ARGS[@]}")"

gcloud run services update "$SERVICE_NAME" \
  --project "$PROJECT" \
  --region "$REGION" \
  --update-env-vars "$UPDATE_ENV_VARS_ARG" \
  --update-secrets "$UPDATE_SECRETS_ARG" \
  --quiet

if gcloud run jobs describe "$SCRIPTS_JOB_NAME" \
  --project "$PROJECT" \
  --region "$REGION" \
  --format='value(name)' &>/dev/null; then
  gcloud run jobs update "$SCRIPTS_JOB_NAME" \
    --project "$PROJECT" \
    --region "$REGION" \
    --update-env-vars "$UPDATE_ENV_VARS_ARG" \
    --update-secrets "$UPDATE_SECRETS_ARG" \
    --quiet
else
  echo "WARNING: Cloud Run Job $SCRIPTS_JOB_NAME does not exist in $PROJECT; skipping job env update."
fi

echo ""
echo "Done! Service $SERVICE_NAME and scripts job $SCRIPTS_JOB_NAME in $PROJECT updated."
