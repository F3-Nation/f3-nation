#!/usr/bin/env bash
# Pulls SOURCE_IMAGE, retags and pushes it to TARGET_REF (preserving the
# source's own tag), then prints and records the pushed image's GHCR digest.
# Used by .github/workflows/mirror-postgres-image.yml. Tested by
# mirror-postgres-image.test.sh with a stubbed `docker`.
set -euo pipefail

: "${SOURCE_IMAGE:?SOURCE_IMAGE is required}"
: "${TARGET_REF:?TARGET_REF is required}"

# The whole point of this workflow is mirroring a pinned image; a mutable
# tag typed into the workflow_dispatch input would mirror whatever that tag
# currently resolves to instead.
if [[ ! "$SOURCE_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo "SOURCE_IMAGE must be digest-pinned (end with @sha256:<64 hex chars>), got: ${SOURCE_IMAGE}" >&2
  exit 1
fi

name="${SOURCE_IMAGE%@*}"
last="${name##*/}"
if [[ "$last" != *:* ]]; then
  echo "SOURCE_IMAGE must include a tag (e.g. postgres:18.6-trixie@sha256:...), got: ${SOURCE_IMAGE}" >&2
  exit 1
fi
tag="${last##*:}"

docker pull "$SOURCE_IMAGE"
docker tag "$SOURCE_IMAGE" "${TARGET_REF}:${tag}"
docker push "${TARGET_REF}:${tag}"

# The local image now carries RepoDigests for both the original Docker Hub
# pull and this push, in no guaranteed order -- match on TARGET_REF rather
# than trusting index 0.
digest="$(docker inspect --format '{{json .RepoDigests}}' "${TARGET_REF}:${tag}" | grep -o "${TARGET_REF}@sha256:[a-f0-9]*")"
echo "Mirrored to ${digest}"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "digest=${digest}" >>"$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  # printf, not echo -- echo doesn't expand \n escapes by default, which
  # would otherwise leave literal backslash-n in the step summary.
  printf '### Mirrored image\n\n`%s`\n' "$digest" >>"$GITHUB_STEP_SUMMARY"
fi
