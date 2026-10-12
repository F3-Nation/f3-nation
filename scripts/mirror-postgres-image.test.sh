#!/usr/bin/env bash
# Regression tests for scripts/mirror-postgres-image.sh: that it extracts the
# right tag from source-image shapes beyond the default `name:tag@digest`,
# that it selects the pushed GHCR digest out of RepoDigests by matching
# TARGET_REF even when another entry sorts first or a same-prefix decoy
# repo is present, and that it fails loudly (and pushes nothing) on each
# documented failure mode. Run directly: bash scripts/mirror-postgres-image.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mirror_script="${script_dir}/mirror-postgres-image.sh"
failures=0

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: ${description}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/mirror-postgres-image-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

# A fake `docker` that records every invocation's argv. `inspect` returns
# $DOCKER_INSPECT_OUTPUT verbatim (defaulting to RepoDigests with the Docker
# Hub digest sorted first and a same-prefix decoy repo, to catch an
# unanchored match); `push` fails if $DOCKER_PUSH_EXIT is set.
cat >"$tmp_dir/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$MIRROR_TEST_DIR/docker.calls"
if [[ "$1" == "inspect" ]]; then
  echo "${DOCKER_INSPECT_OUTPUT:-[\"docker.io/library/postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"ghcr.io/f3-nation/f3-nation-ci-postgres-other@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"ghcr.io/f3-nation/f3-nation-ci-postgres@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"]}"
elif [[ "$1" == "push" && -n "${DOCKER_PUSH_EXIT:-}" ]]; then
  exit "$DOCKER_PUSH_EXIT"
fi
STUB
chmod +x "$tmp_dir/docker"

# Runs the script with the given SOURCE_IMAGE/TARGET_REF, honoring any of
# DOCKER_PUSH_EXIT/DOCKER_INSPECT_OUTPUT/SKIP_GITHUB_FILES already exported
# by the caller, and records its exit status in $tmp_dir/exit_code. On an
# unexpected status, dumps stdout so the real failure is visible instead of
# just a mismatched assertion further down.
run_mirror() {
  local source_image="$1" target_ref="$2" expect_status="$3"
  : >"$tmp_dir/docker.calls"
  : >"$tmp_dir/output"
  : >"$tmp_dir/summary"
  local github_output="$tmp_dir/output" github_summary="$tmp_dir/summary"
  if [[ -n "${SKIP_GITHUB_FILES:-}" ]]; then
    github_output=""
    github_summary=""
  fi
  PATH="$tmp_dir:$PATH" \
    MIRROR_TEST_DIR="$tmp_dir" \
    SOURCE_IMAGE="$source_image" \
    TARGET_REF="$target_ref" \
    GITHUB_OUTPUT="$github_output" \
    GITHUB_STEP_SUMMARY="$github_summary" \
    DOCKER_PUSH_EXIT="${DOCKER_PUSH_EXIT:-}" \
    DOCKER_INSPECT_OUTPUT="${DOCKER_INSPECT_OUTPUT:-}" \
    "$mirror_script" >"$tmp_dir/stdout" 2>&1
  echo "$?" >"$tmp_dir/exit_code"
  if [[ "$(cat "$tmp_dir/exit_code")" != "$expect_status" ]]; then
    echo "  (exit ${expect_status} expected, got $(cat "$tmp_dir/exit_code"); stdout was:)"
    sed 's/^/    /' "$tmp_dir/stdout"
  fi
}

default_source="postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722"
default_target="ghcr.io/f3-nation/f3-nation-ci-postgres"

run_mirror "$default_source" "$default_target" 0

assert_eq "exits 0 on the happy path" \
  "0" "$(cat "$tmp_dir/exit_code")"

assert_eq "pulls, tags, and pushes in order, with the source's own tag" \
  "pull ${default_source}
tag ${default_source} ${default_target}:18.6-trixie
push ${default_target}:18.6-trixie
inspect --format {{json .RepoDigests}} ${default_target}:18.6-trixie" \
  "$(cat "$tmp_dir/docker.calls")"

assert_eq "selects the GHCR digest by matching TARGET_REF, ignoring a same-prefix decoy repo and index order" \
  "digest=${default_target}@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
  "$(cat "$tmp_dir/output")"

assert_eq "writes the digest to the step summary without literal backslash-n" \
  '### Mirrored image

`ghcr.io/f3-nation/f3-nation-ci-postgres@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`' \
  "$(cat "$tmp_dir/summary")"

# --- tag extraction across source-image shapes ---

run_mirror "postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722" "$default_target" 1
assert_eq "digest-only source (no tag) fails loudly instead of mirroring under the digest" \
  "1" "$(grep -c "SOURCE_IMAGE must include a tag" "$tmp_dir/stdout")"
assert_eq "digest-only source: no push attempted" \
  "0" "$(grep -c '^push' "$tmp_dir/docker.calls")"

run_mirror "postgres" "$default_target" 1
assert_eq "no-tag, no-digest source fails loudly" \
  "1" "$(grep -c "SOURCE_IMAGE must include a tag" "$tmp_dir/stdout")"

run_mirror "localhost:5000/postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722" "$default_target" 0
assert_eq "a registry-with-port source still yields the image's own tag, not the port" \
  "1" \
  "$(grep -xc "tag localhost:5000/postgres:18@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722 ${default_target}:18" "$tmp_dir/docker.calls")"

# --- failure modes ---

DOCKER_PUSH_EXIT=1 run_mirror "$default_source" "$default_target" 1
assert_eq "a failed push exits non-zero and records no digest output" \
  "0" "$(grep -c '^digest=' "$tmp_dir/output")"

DOCKER_INSPECT_OUTPUT='[]' run_mirror "$default_source" "$default_target" 1
assert_eq "an inspect result with no matching digest exits non-zero" \
  "1" "$(cat "$tmp_dir/exit_code")"

(
  PATH="$tmp_dir:$PATH" MIRROR_TEST_DIR="$tmp_dir" TARGET_REF="$default_target" "$mirror_script"
) >"$tmp_dir/stdout" 2>&1
assert_eq "missing SOURCE_IMAGE fails with the :? guard message" \
  "1" "$(grep -c "SOURCE_IMAGE is required" "$tmp_dir/stdout")"

(
  PATH="$tmp_dir:$PATH" MIRROR_TEST_DIR="$tmp_dir" SOURCE_IMAGE="$default_source" "$mirror_script"
) >"$tmp_dir/stdout" 2>&1
assert_eq "missing TARGET_REF fails with the :? guard message" \
  "1" "$(grep -c "TARGET_REF is required" "$tmp_dir/stdout")"

# A local run (no GITHUB_OUTPUT/GITHUB_STEP_SUMMARY) must still succeed.
SKIP_GITHUB_FILES=1 run_mirror "$default_source" "$default_target" 0
assert_eq "runs locally with no GITHUB_OUTPUT/GITHUB_STEP_SUMMARY set" \
  "0" "$(cat "$tmp_dir/exit_code")"

echo
if [[ "$failures" -eq 0 ]]; then
  echo "All tests passed."
  exit 0
else
  echo "${failures} test(s) failed."
  exit 1
fi
