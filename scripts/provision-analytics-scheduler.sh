#!/usr/bin/env bash
set -euo pipefail

usage() { printf 'Usage: %s --project P --region R --job J --service-account SA --cron CRON --time-zone ZONE [--name NAME] [--pause|--resume|--status]\n' "$0" >&2; }
project=''; region=''; job=''; service_account=''; cron=''; time_zone=''; name='analytics-etl-daily'; action=apply
while (($#)); do
  case "$1" in
    --project) project=${2:?missing project}; shift 2;;
    --region) region=${2:?missing region}; shift 2;;
    --job) job=${2:?missing job}; shift 2;;
    --service-account|--scheduler-service-account) service_account=${2:?missing service account}; shift 2;;
    --cron) cron=${2:?missing cron}; shift 2;;
    --time-zone|--timezone) time_zone=${2:?missing timezone}; shift 2;;
    --name) name=${2:?missing name}; shift 2;;
    --pause) action=pause; shift;; --resume) action=resume; shift;; --status) action=status; shift;;
    -h|--help) usage; exit 0;; *) usage; exit 2;;
  esac
done
[[ -n "$project" && -n "$region" && -n "$job" && -n "$service_account" && -n "$cron" && -n "$time_zone" ]] || { usage; exit 2; }
target="https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run"
common=(--project="$project" --location="$region")
case "$action" in
  status) gcloud scheduler jobs describe "$name" "${common[@]}"; exit;;
  pause) gcloud scheduler jobs pause "$name" "${common[@]}"; exit;;
  resume) gcloud scheduler jobs resume "$name" "${common[@]}"; exit;;
esac
args=("${common[@]}" --schedule="$cron" --time-zone="$time_zone" --uri="$target" --http-method=POST --oauth-service-account-email="$service_account" --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform --max-retry-attempts=0)
if gcloud scheduler jobs describe "$name" "${common[@]}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$name" "${args[@]}"
else
  gcloud scheduler jobs create http "$name" "${args[@]}"
fi
