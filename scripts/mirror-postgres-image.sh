#!/usr/bin/env bash
# Pulls SOURCE_IMAGE, retags and pushes it to TARGET_REF (preserving the
# source's own tag), then prints and records the pushed image's GHCR digest.
# Used by .github/workflows/mirror-postgres-image.yml. Tested by
# mirror-postgres-image.test.sh with a stubbed `docker`.
set -euo pipefail

: "${SOURCE_IMAGE:?SOURCE_IMAGE is required}"
: "${TARGET_REF:?TARGET_REF is required}"

tag="${SOURCE_IMAGE#*:}"
tag="${tag%@*}"

docker pull "$SOURCE_IMAGE"
docker tag "$SOURCE_IMAGE" "${TARGET_REF}:${tag}"
docker push "${TARGET_REF}:${tag}"

# The local image now carries RepoDigests for both the original Docker Hub
# pull and this push, in no guaranteed order -- grep for the one under our
# own TARGET_REF rather than trusting index 0 (Qodo review on #1188).
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
