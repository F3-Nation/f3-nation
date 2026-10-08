#!/usr/bin/env bash
# Set up (or update) the one-command staging refresh: Cloud Run job f3-staging-refresh
# in project f3data (F3-65, docs/STAGING_REFRESH.md). Idempotent; re-run it to rebuild
# the image from this checkout and redeploy the job (do that after a release that adds
# a migration, or the job refuses with "rebuild the refresh image").
#
#   bash tooling/scripts/staging-refresh/setup.sh               # everything
#   bash tooling/scripts/staging-refresh/setup.sh --image-only  # rebuild + redeploy only
#
# Run by an Owner of f3data who can read the spuds DB passwords in Secret Manager
# (DB_SPUDS_PASSWORD_PROD / DB_SPUDS_PASSWORD_STAGING). Needs gcloud (logged in),
# cloud-sql-proxy, psql >= 15 and python3. Builds with Cloud Build: no local docker.
#
# What it does:
#   1. service account staging-refresh@f3data.iam.gserviceaccount.com
#   2. DB login staging_refresh: read-only on prod (prod-login.sql), owner-level on
#      staging's tables (staging-login.sql); passwords in Secret Manager
#   3. the SA may read those two secrets + OBFUSCATION_SALT and connect to Cloud SQL
#   4. builds + pushes the image (Cloud Build -> Artifact Registry cloud-run-builds)
#   5. deploys the job (32Gi / 8 CPU, 3h timeout, no retries)
#   6. lets RUNNERS execute it (also with --args, e.g. --dry-run) and read its logs:
#      log bucket f3-staging-refresh (30 days) fed by sink f3-staging-refresh with
#      only this job's logs, logging.viewAccessor on its _AllLogs view; removes the
#      first version's view on _Default and its bindings
#   7. prints what it can't do itself (the slackbot restart permission)
set -euo pipefail

PROJECT=f3data
REGION=us-central1
JOB=f3-staging-refresh
SA="staging-refresh@${PROJECT}.iam.gserviceaccount.com"
DB_USER=staging_refresh
PROD_INSTANCE=f3data
PROD_DB=f3_prod
STAGING_INSTANCE=f3data-nonprod
STAGING_DB=f3_staging
SECRET_PROD=staging-refresh-prod-db-password
SECRET_STAGING=staging-refresh-staging-db-password
SALT_SECRET=OBFUSCATION_SALT
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-builds/${JOB}"
# The job's logs: a bucket that only this job's logs are routed to (by LOG_SINK),
# read through the bucket's built-in _AllLogs view.
LOG_BUCKET=f3-staging-refresh
LOG_SINK=f3-staging-refresh
LOG_RETENTION_DAYS=30
LOG_VIEW_RESOURCE="projects/${PROJECT}/locations/global/buckets/${LOG_BUCKET}/views/_AllLogs"
# What the first version of this script made instead (a view on _Default whose filter
# could only say resource.type, so it showed every Cloud Run job in the project);
# removed below if present.
OLD_LOG_VIEW=f3-staging-refresh
OLD_LOG_TITLE=f3-staging-refresh-logs
# Who may run the refresh: space-separated IAM members, e.g.
#   STAGING_REFRESH_RUNNERS="user:a@example.com user:b@example.com"
# Read from the environment, not committed: the repo is public. Not needed
# with --image-only.
RUNNERS=()
SLACKBOT_PROJECT=f3-slackbot-staging
SLACKBOT_SERVICE=f3-slackbot

IMAGE_ONLY=0
[ "${1:-}" = "--image-only" ] && IMAGE_ONLY=1
if [ "$IMAGE_ONLY" = 0 ]; then
  read -r -a RUNNERS <<<"${STAGING_REFRESH_RUNNERS:?set STAGING_REFRESH_RUNNERS to the IAM members who may run the refresh}"
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
PROXY_PID=""
TMP="$(mktemp -d)"
cleanup() {
  if [ -n "$PROXY_PID" ]; then kill "$PROXY_PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

say() { printf '\n== %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need gcloud
need python3
if [ "$IMAGE_ONLY" = 0 ]; then
  need cloud-sql-proxy
  need psql
fi

new_pw() { python3 -c 'import secrets; print(secrets.token_hex(24) + "Aa9-_")'; }

secret_value() { gcloud secrets versions access latest --secret "$1" --project "$PROJECT" 2>/dev/null; }

store_secret() { # name value
  if ! gcloud secrets describe "$1" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$1" --project "$PROJECT" --replication-policy automatic \
      --labels purpose=db-login,owner=staging-refresh >/dev/null
  fi
  printf '%s' "$2" | gcloud secrets versions add "$1" --project "$PROJECT" --data-file=- >/dev/null
  echo "stored $1"
}

# psql as spuds through a local proxy; the SQL file reads STAGING_REFRESH_PW and
# STAGING_REFRESH_PW_SET (1 = a newly generated password that must be applied) from the env.
run_sql() { # instance port database spuds-secret sql-file password password-is-new
  cloud-sql-proxy "$PROJECT:$REGION:$1" --port "$2" --address 127.0.0.1 >"$TMP/proxy-$1.log" 2>&1 &
  PROXY_PID=$!
  for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -p "$2" -q 2>/dev/null && break; sleep 1; done
  local admin_pw
  admin_pw="$(secret_value "$4")"
  PGPASSWORD="$admin_pw" STAGING_REFRESH_PW="$6" STAGING_REFRESH_PW_SET="$7" \
    psql "host=127.0.0.1 port=$2 dbname=$3 user=spuds" -X -q -v ON_ERROR_STOP=1 -P pager=off -f "$5"
  # A stored password is only trusted once it logs in: an earlier run may have stored a
  # new one and then failed before applying it, and that run's re-run must apply it.
  if ! PGPASSWORD="$6" psql "host=127.0.0.1 port=$2 dbname=$3 user=staging_refresh" \
    -X -q -t -c 'SELECT 1' >/dev/null 2>&1; then
    if [ "$7" = 1 ]; then
      echo "staging_refresh can't log in on $1 with the password just applied" >&2
      exit 1
    fi
    echo "the stored staging_refresh password doesn't log in on $1 (stored by an earlier run but never applied); applying it"
    PGPASSWORD="$admin_pw" STAGING_REFRESH_PW="$6" STAGING_REFRESH_PW_SET=1 \
      psql "host=127.0.0.1 port=$2 dbname=$3 user=spuds" -X -q -v ON_ERROR_STOP=1 -P pager=off -f "$5"
    PGPASSWORD="$6" psql "host=127.0.0.1 port=$2 dbname=$3 user=staging_refresh" \
      -X -q -t -c 'SELECT 1' >/dev/null 2>&1 \
      || { echo "staging_refresh still can't log in on $1" >&2; exit 1; }
  fi
  kill "$PROXY_PID"; wait "$PROXY_PID" 2>/dev/null || true; PROXY_PID=""
}

# Sets LOGIN_PW to the login's password from its secret, or to a new one it stores there;
# LOGIN_PW_SET=1 only for a new one (the SQL then applies it). Runs in this shell, not a
# subshell, so both globals survive.
prepare_login() { # secret-name
  if LOGIN_PW="$(secret_value "$1")" && [ -n "$LOGIN_PW" ]; then
    LOGIN_PW_SET=0
  else
    LOGIN_PW="$(new_pw)"
    store_secret "$1" "$LOGIN_PW" >&2
    LOGIN_PW_SET=1
  fi
}

gcloud projects describe "$PROJECT" >/dev/null
gcloud secrets describe "$SALT_SECRET" --project "$PROJECT" >/dev/null \
  || { echo "secret $SALT_SECRET is missing in $PROJECT" >&2; exit 1; }

if [ "$IMAGE_ONLY" = 0 ]; then
  say "1. service account $SA"
  if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${SA%%@*}" --project "$PROJECT" \
      --display-name "F3 staging refresh (Cloud Run job $JOB)"
  else
    echo "exists"
  fi

  say "2. DB login $DB_USER on prod ($PROD_INSTANCE/$PROD_DB, read-only)"
  prepare_login "$SECRET_PROD"
  run_sql "$PROD_INSTANCE" 5481 "$PROD_DB" DB_SPUDS_PASSWORD_PROD "$HERE/prod-login.sql" \
    "$LOGIN_PW" "$LOGIN_PW_SET"
  say "2. DB login $DB_USER on staging ($STAGING_INSTANCE/$STAGING_DB, table owners)"
  prepare_login "$SECRET_STAGING"
  run_sql "$STAGING_INSTANCE" 5482 "$STAGING_DB" DB_SPUDS_PASSWORD_STAGING "$HERE/staging-login.sql" \
    "$LOGIN_PW" "$LOGIN_PW_SET"

  say "3. secrets + Cloud SQL access for the service account"
  for s in "$SECRET_PROD" "$SECRET_STAGING" "$SALT_SECRET"; do
    gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT" \
      --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
    echo "secretAccessor on $s"
  done
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
    --role roles/cloudsql.client --condition=None >/dev/null
  echo "cloudsql.client on $PROJECT"
fi

say "4. build + push the image (Cloud Build, from $REPO)"
TAG="$(git -C "$REPO" rev-parse --short=12 HEAD)"
if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
  TAG="${TAG}-dirty-$(date -u +%Y%m%d%H%M%S)"
  echo "WARNING: the checkout has uncommitted changes; they are built into $TAG"
fi
IMAGE="$IMAGE_BASE:$TAG"
TURBO_VERSION="$(grep '^  turbo:' "$REPO/pnpm-workspace.yaml" | awk '{print $2}')"
cat >"$TMP/cloudbuild.yaml" <<YAML
steps:
  - name: gcr.io/cloud-builders/docker
    args: [build, --file, tooling/scripts/Dockerfile.staging-refresh,
           --build-arg, TURBO_VERSION=${TURBO_VERSION}, --tag, "${IMAGE}", .]
images: ["${IMAGE}"]
options:
  machineType: E2_HIGHCPU_8
timeout: 1800s
YAML
gcloud builds submit "$REPO" --project "$PROJECT" --config "$TMP/cloudbuild.yaml"

say "5. deploy job $JOB"
gcloud run jobs deploy "$JOB" --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --service-account "$SA" \
  --set-cloudsql-instances "$PROJECT:$REGION:$PROD_INSTANCE,$PROJECT:$REGION:$STAGING_INSTANCE" \
  --set-secrets "PROD_DB_PASSWORD=$SECRET_PROD:latest,STAGING_DB_PASSWORD=$SECRET_STAGING:latest,OBFUSCATION_SALT=$SALT_SECRET:latest" \
  --set-env-vars "PROD_DB_USER=$DB_USER,PROD_DB_NAME=$PROD_DB,PROD_DB_SOCKET=/cloudsql/$PROJECT:$REGION:$PROD_INSTANCE,STAGING_DB_USER=$DB_USER,STAGING_DB_NAME=$STAGING_DB,STAGING_DB_SOCKET=/cloudsql/$PROJECT:$REGION:$STAGING_INSTANCE" \
  --memory 32Gi --cpu 8 --task-timeout 3h --max-retries 0 --tasks 1 --parallelism 1 \
  --labels purpose=staging-refresh

if [ "$IMAGE_ONLY" = 0 ]; then
  say "6. who may run it and read its logs"
  for m in "${RUNNERS[@]}"; do
    # WithOverrides so `--args=--dry-run` works too; includes reading executions.
    gcloud run jobs add-iam-policy-binding "$JOB" --project "$PROJECT" --region "$REGION" \
      --member "$m" --role roles/run.jobsExecutorWithOverrides >/dev/null
    echo "run.jobsExecutorWithOverrides on $JOB for $m"
  done
  # Logs. Not project-wide logging.viewer (that shows the prod apps' logs) and not a view
  # on _Default (a view filter can't name a job). The sink copies this job's entries into
  # its own bucket; _Default keeps its copy as before. Entries reach the bucket only from
  # the time the sink exists: earlier runs stay in _Default only.
  if gcloud logging buckets describe "$LOG_BUCKET" --location global --project "$PROJECT" \
    >/dev/null 2>&1; then
    gcloud logging buckets update "$LOG_BUCKET" --location global --project "$PROJECT" \
      --retention-days "$LOG_RETENTION_DAYS" >/dev/null
  else
    gcloud logging buckets create "$LOG_BUCKET" --location global --project "$PROJECT" \
      --retention-days "$LOG_RETENTION_DAYS" \
      --description "Logs of Cloud Run job $JOB only (routed by sink $LOG_SINK)"
  fi
  echo "log bucket $LOG_BUCKET (${LOG_RETENTION_DAYS}d)"
  LOG_DEST="logging.googleapis.com/projects/$PROJECT/locations/global/buckets/$LOG_BUCKET"
  LOG_FILTER="resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\""
  if gcloud logging sinks describe "$LOG_SINK" --project "$PROJECT" >/dev/null 2>&1; then
    gcloud logging sinks update "$LOG_SINK" "$LOG_DEST" --project "$PROJECT" \
      --log-filter "$LOG_FILTER" >/dev/null
  else
    gcloud logging sinks create "$LOG_SINK" "$LOG_DEST" --project "$PROJECT" \
      --log-filter "$LOG_FILTER" --description "Cloud Run job $JOB's logs -> bucket $LOG_BUCKET"
  fi
  echo "log sink $LOG_SINK: $LOG_FILTER"
  for m in "${RUNNERS[@]}"; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member "$m" --role roles/logging.viewAccessor \
      --condition "expression=resource.name == \"$LOG_VIEW_RESOURCE\",title=$JOB-log-bucket" \
      >/dev/null
    echo "logging.viewAccessor on $LOG_VIEW_RESOURCE for $m"
  done

  # Remove the first version's too-wide access: its bindings (exact condition, read back
  # from the policy, for whoever holds one) and the view on _Default.
  gcloud projects get-iam-policy "$PROJECT" --format json >"$TMP/policy.json"
  python3 - "$TMP/policy.json" "$OLD_LOG_TITLE" "$TMP" >"$TMP/old-bindings.tsv" <<'PY'
import json, sys
policy, title, tmp = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
for i, b in enumerate(policy.get("bindings", [])):
    c = b.get("condition") or {}
    if b.get("role") != "roles/logging.viewAccessor" or c.get("title") != title:
        continue
    path = f"{tmp}/old-condition-{i}.json"
    json.dump(c, open(path, "w"))
    for m in b.get("members", []):
        print(f"{m}\t{path}")
PY
  # fd 3, so gcloud can't read the list from stdin.
  while IFS=$'\t' read -r -u 3 m cond; do
    gcloud projects remove-iam-policy-binding "$PROJECT" --member "$m" \
      --role roles/logging.viewAccessor --condition-from-file "$cond" >/dev/null </dev/null
    echo "removed the old _Default log-view binding for $m"
  done 3<"$TMP/old-bindings.tsv"
  if gcloud logging views describe "$OLD_LOG_VIEW" --bucket _Default --location global \
    --project "$PROJECT" >/dev/null 2>&1; then
    gcloud logging views delete "$OLD_LOG_VIEW" --bucket _Default --location global \
      --project "$PROJECT" --quiet
    echo "deleted the old view $OLD_LOG_VIEW on _Default"
  fi
fi

say "7. not done here"
cat <<EOF
The job restarts the staging slackbot after a load, if it may. Nobody running this script
has access to $SLACKBOT_PROJECT, so ask someone who does to run:

  gcloud run services add-iam-policy-binding $SLACKBOT_SERVICE --project $SLACKBOT_PROJECT \\
    --region $REGION --member serviceAccount:$SA --role roles/run.developer
  # deploying a revision also needs actAs on the slackbot's runtime service account:
  gcloud iam service-accounts add-iam-policy-binding \\
    "\$(gcloud run services describe $SLACKBOT_SERVICE --project $SLACKBOT_PROJECT --region $REGION \\
        --format='value(spec.template.spec.serviceAccountName)')" \\
    --project $SLACKBOT_PROJECT --member serviceAccount:$SA --role roles/iam.serviceAccountUser

Until then each refresh prints the restart command at the end instead of running it.

Done. Image $IMAGE. Refresh staging with:

  gcloud run jobs execute $JOB --project $PROJECT --region $REGION --wait

and read its logs (from the first run after the sink was created) with:

  gcloud logging read 'resource.labels.job_name="$JOB"' --project $PROJECT \\
    --bucket $LOG_BUCKET --location global --view _AllLogs --freshness 1d --order asc \\
    --format 'value(textPayload)'
EOF
