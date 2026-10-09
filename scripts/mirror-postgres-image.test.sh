#!/usr/bin/env bash
# Regression tests for scripts/mirror-postgres-image.sh: that it preserves
# the source's own tag, and that it selects the pushed GHCR digest out of
# RepoDigests by matching TARGET_REF rather than trusting index 0 even when
# the original Docker Hub digest sorts first (the bug Qodo's review on
# #1188 caught). Run directly: bash scripts/mirror-postgres-image.test.sh
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

# A fake `docker` that records every invocation's argv and, for `inspect`,
# returns RepoDigests with the Docker Hub digest sorted first -- the exact
# ordering that caused the original bug.
cat >"$tmp_dir/docker" <<'STUB'
#!/usr/bin/env bash
echo "$@" >>"$MIRROR_TEST_DIR/docker.calls"
if [[ "$1" == "inspect" ]]; then
  echo '["docker.io/library/postgres@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","ghcr.io/f3-nation/f3-nation-ci-postgres@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]'
fi
STUB
chmod +x "$tmp_dir/docker"

run_mirror() {
  : >"$tmp_dir/docker.calls"
  : >"$tmp_dir/output"
  : >"$tmp_dir/summary"
  PATH="$tmp_dir:$PATH" \
    MIRROR_TEST_DIR="$tmp_dir" \
    SOURCE_IMAGE="postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722" \
    TARGET_REF="ghcr.io/f3-nation/f3-nation-ci-postgres" \
    GITHUB_OUTPUT="$tmp_dir/output" \
    GITHUB_STEP_SUMMARY="$tmp_dir/summary" \
    "$mirror_script" >"$tmp_dir/stdout" 2>&1
}

run_mirror

assert_eq "retags with the source's own tag, not its digest" \
  "1" \
  "$(grep -xc "tag postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722 ghcr.io/f3-nation/f3-nation-ci-postgres:18.6-trixie" "$tmp_dir/docker.calls")"

assert_eq "pushes the retagged GHCR ref" \
  "1" \
  "$(grep -xc "push ghcr.io/f3-nation/f3-nation-ci-postgres:18.6-trixie" "$tmp_dir/docker.calls")"

assert_eq "selects the GHCR digest, not whichever RepoDigests entry sorts first" \
  "digest=ghcr.io/f3-nation/f3-nation-ci-postgres@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
  "$(cat "$tmp_dir/output")"

assert_eq "writes the digest to the step summary without literal backslash-n" \
  '### Mirrored image

`ghcr.io/f3-nation/f3-nation-ci-postgres@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`' \
  "$(cat "$tmp_dir/summary")"

echo
if [[ "$failures" -eq 0 ]]; then
  echo "All tests passed."
  exit 0
else
  echo "${failures} test(s) failed."
  exit 1
fi
