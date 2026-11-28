#!/usr/bin/env bash
# Updates one Analytics release-cleanup Cloud Run job to the image a tagged
# Analytics deploy just gave the publisher job. Run by
# .github/workflows/deploy-analytics.yml once per environment.
#
# Skips, with a warning and exit 0, instead of deploying when:
#   - ARGS_FILE is absent: the release commit predates schedulable cleanup, so
#     its CLI can't run the job's command. The job keeps its current template.
#   - The publisher job no longer runs IMAGE: a newer (or older) release
#     deployed it since, and cleanup must validate pointers with the code that
#     wrote them.
# Any lookup or validation failure exits non-zero.
#
# Environment:
#   IMAGE              publisher image, pinned to its digest
#   ARGS_FILE          path to apps/analytics/release-gc-job.args checked out at the release commit
#   JOB_NAME           cleanup job to update
#   PUBLISHER_JOB      publisher job whose image cleanup must match
#   SERVICE_ACCOUNT    cleanup job's runtime identity
#   ANALYTICS_ENV      ANALYTICS_ENVIRONMENT value (nonprod or production)
#   BUCKET             ANALYTICS_CATALOG_BUCKET value
#   PRODUCER_REVISION  ANALYTICS_PRODUCER_REVISION value
#   REGION, PROJECT    Cloud Run location
set -euo pipefail

for name in IMAGE ARGS_FILE JOB_NAME PUBLISHER_JOB SERVICE_ACCOUNT ANALYTICS_ENV BUCKET PRODUCER_REVISION REGION PROJECT; do
  if [[ -z "${!name:-}" ]]; then
    echo "::error::${name} is required" >&2
    exit 1
  fi
done

image_pattern="^${REGION}-docker\.pkg\.dev/${PROJECT}/cloud-run-builds/analytics-etl:[^@]+@sha256:[0-9a-f]{64}$"
if [[ ! "${IMAGE}" =~ ${image_pattern} ]]; then
  echo "::error::unexpected image reference: ${IMAGE}" >&2
  exit 1
fi

if [[ ! -e "${ARGS_FILE}" ]]; then
  echo "::warning::${JOB_NAME} not updated: this release has no release-gc-job.args, so its CLI predates scheduled cleanup"
  exit 0
fi

args="$(cat "${ARGS_FILE}")"
if [[ ! "${args}" =~ ^[A-Za-z0-9_.=-]+(,[A-Za-z0-9_.=-]+)*$ ]]; then
  echo "::error::release-gc-job.args must be one line of comma-separated arguments" >&2
  exit 1
fi

publisher_image="$(gcloud run jobs describe "${PUBLISHER_JOB}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --format='value(spec.template.spec.template.spec.containers[0].image)')"
if [[ "${publisher_image}" != *@sha256:* ]]; then
  echo "::error::could not read the digest ${PUBLISHER_JOB} runs" >&2
  exit 1
fi
if [[ "${publisher_image##*@}" != "${IMAGE##*@}" ]]; then
  echo "::warning::${JOB_NAME} not updated: ${PUBLISHER_JOB} now runs ${publisher_image##*@}, not this release's ${IMAGE##*@}"
  exit 0
fi

# The --clear-* flags drop secrets and volumes a hand-created job may carry:
# cleanup needs neither, and gcloud keeps any setting a deploy doesn't name.
gcloud run jobs deploy "${JOB_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --tasks=1 \
  --parallelism=1 \
  --max-retries=0 \
  --task-timeout=30m \
  --memory=1Gi \
  --cpu=1 \
  --clear-secrets \
  --clear-volumes \
  --clear-volume-mounts \
  --command=analytics-etl \
  --args="${args}" \
  --set-env-vars="ANALYTICS_ENVIRONMENT=${ANALYTICS_ENV},ANALYTICS_CATALOG_BUCKET=${BUCKET},ANALYTICS_PRODUCER_REVISION=${PRODUCER_REVISION}"
