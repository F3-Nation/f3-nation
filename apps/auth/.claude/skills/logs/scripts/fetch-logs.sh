#!/usr/bin/env bash
set -euo pipefail

# fetch-logs.sh — deterministic gcloud log fetcher for f3-auth Cloud Run
#
# Usage: fetch-logs.sh [prod|staging] [errors|warnings] [LIMIT] [TIMERANGE] [CUSTOM_FILTER...]
#
# Examples:
#   fetch-logs.sh                        → 20 recent staging entries
#   fetch-logs.sh prod                   → 20 recent prod entries
#   fetch-logs.sh errors 1h              → staging errors, last hour
#   fetch-logs.sh prod errors 50 30m     → 50 prod errors, last 30 minutes
#   fetch-logs.sh httpRequest.status>=500 → staging 5xx errors

# --- defaults ---
ENV="staging"
LIMIT=20
SEVERITY_FILTER=""
TIME_FILTER=""
FRESHNESS="1d"
CUSTOM_FILTERS=()

# --- environment map ---
project_for_env() {
  case "$1" in
    staging) echo "f3-authentication-staging" ;;
    prod) echo "f3-authentication" ;;
    *) echo "Unknown environment: $1" >&2; exit 1 ;;
  esac
}

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
      # Use regex guards to avoid greedy glob matches on custom filters
      if [[ "$arg" =~ ^[0-9]+m$ ]]; then
        minutes="${arg%m}"
        FRESHNESS="${minutes}m"
        TIME_FILTER=" AND timestamp>=\"$(date -u -v-${minutes}M '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d "${minutes} minutes ago" '+%Y-%m-%dT%H:%M:%SZ')\""
      elif [[ "$arg" =~ ^[0-9]+h$ ]]; then
        hours="${arg%h}"
        FRESHNESS="${hours}h"
        TIME_FILTER=" AND timestamp>=\"$(date -u -v-${hours}H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d "${hours} hours ago" '+%Y-%m-%dT%H:%M:%SZ')\""
      elif [[ "$arg" =~ ^[0-9]+d$ ]]; then
        days="${arg%d}"
        FRESHNESS="${days}d"
        TIME_FILTER=" AND timestamp>=\"$(date -u -v-${days}d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d "${days} days ago" '+%Y-%m-%dT%H:%M:%SZ')\""
      elif [[ "$arg" =~ ^[0-9]+$ ]]; then
        LIMIT="$arg"
      else
        CUSTOM_FILTERS+=(" AND $arg")
      fi
      ;;
  esac
done

PROJECT=$(project_for_env "$ENV")

# --- build filter ---
FILTER="resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"f3-auth\"${SEVERITY_FILTER}${TIME_FILTER}${CUSTOM_FILTERS[*]:-}"

# --- print metadata to stderr for the skill to read ---
echo "env=$ENV" >&2
echo "project=$PROJECT" >&2
echo "limit=$LIMIT" >&2
echo "filter=$FILTER" >&2

# --- execute ---
exec gcloud logging read "$FILTER" \
  --project="$PROJECT" \
  --limit="$LIMIT" \
  --format='json' \
  --freshness="$FRESHNESS"
