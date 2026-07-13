#!/usr/bin/env bash
set -euo pipefail

# fetch-logs.sh — deterministic gcloud log fetcher for any monorepo Cloud Run app
#
# Usage: fetch-logs.sh [APP] [prod|staging] [errors|warnings] [LIMIT] [TIMERANGE] [CUSTOM_FILTER...]
#
# APP defaults to "auth" if omitted. Resolved from apps.conf.
#
# Examples:
#   fetch-logs.sh                        → 20 recent auth staging entries
#   fetch-logs.sh api                    → 20 recent api staging entries
#   fetch-logs.sh map prod               → 20 recent map prod entries
#   fetch-logs.sh auth prod errors 50 30m → 50 auth prod errors, last 30 minutes
#   fetch-logs.sh api httpRequest.status>=500 → api staging 5xx errors

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_FILE="$SCRIPT_DIR/../apps.conf"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: gcloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

if [ ! -f "$CONF_FILE" ]; then
  echo "Error: apps.conf not found at $CONF_FILE" >&2
  exit 1
fi

# --- load known app names from config ---
known_apps() {
  grep -v '^#' "$CONF_FILE" | grep -v '^$' | cut -d: -f1 | sort -u
}

# --- lookup config: app_config APP ENV → sets PROJECT, SERVICE, REGION ---
app_config() {
  local app="$1" env="$2"
  local line
  line=$(grep -v '^#' "$CONF_FILE" | grep "^${app}:${env}:" | head -1)
  if [ -z "$line" ]; then
    echo "Error: no config for app='$app' env='$env' in apps.conf" >&2
    echo "Available apps: $(known_apps | tr '\n' ' ')" >&2
    exit 1
  fi
  PROJECT=$(echo "$line" | cut -d: -f3)
  SERVICE=$(echo "$line" | cut -d: -f4)
  REGION=$(echo "$line" | cut -d: -f5)
}

# --- defaults ---
APP=""
ENV="staging"
LIMIT=20
SEVERITY_FILTER=""
FRESHNESS="1d"
CUSTOM_FILTERS=()

KNOWN_APPS=$(known_apps)

# --- parse arguments (order-independent) ---
for arg in "$@"; do
  case "$arg" in
    staging|prod)
      ENV="$arg"
      ;;
    errors)
      SEVERITY_FILTER=' AND severity>=ERROR'
      ;;
    warnings)
      SEVERITY_FILTER=' AND severity>=WARNING'
      ;;
    *)
      # Check if arg is a known app name
      if echo "$KNOWN_APPS" | grep -qx "$arg"; then
        APP="$arg"
      elif [[ "$arg" =~ ^[0-9]+[smhdw]$ ]]; then
        FRESHNESS="$arg"
      elif [[ "$arg" =~ ^[0-9]+$ ]]; then
        LIMIT="$arg"
      else
        CUSTOM_FILTERS+=(" AND $arg")
      fi
      ;;
  esac
done

# Default to auth if no app specified
APP="${APP:-auth}"

# --- resolve config ---
app_config "$APP" "$ENV"

# --- build filter ---
CUSTOM_FILTER_STR=""
for cf in "${CUSTOM_FILTERS[@]+"${CUSTOM_FILTERS[@]}"}"; do
  CUSTOM_FILTER_STR+="$cf"
done
FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\"${SEVERITY_FILTER}${CUSTOM_FILTER_STR}"

# --- print metadata to stderr for the skill to read ---
echo "app=$APP" >&2
echo "env=$ENV" >&2
echo "project=$PROJECT" >&2
echo "service=$SERVICE" >&2
echo "region=$REGION" >&2
echo "limit=$LIMIT" >&2
echo "filter=$FILTER" >&2

# --- execute ---
exec gcloud logging read "$FILTER" \
  --project="$PROJECT" \
  --limit="$LIMIT" \
  --format='json' \
  --freshness="$FRESHNESS"
