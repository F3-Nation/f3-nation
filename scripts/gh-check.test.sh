#!/usr/bin/env bash
# Regression tests for scripts/gh-check.sh, mainly that the permission check
# targets GH_REPO when it is set rather than the checkout's own remotes.
# `gh` is replaced by a stub that, like the real `gh repo view`, ignores GH_REPO and
# resolves a repository only from an explicit argument or the checkout's remotes.
# Run directly: bash scripts/gh-check.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
check="${script_dir}/gh-check.sh"
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

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/gh-check-test.XXXXXX")" || exit 1

# The checkout's own repository (no argument) is read-only; fork/repo is admin;
# anything else does not exist.
cat >"$tmp_dir/gh" <<'STUB'
#!/usr/bin/env bash
if [[ "$1 $2" == "auth status" ]]; then
  exit 0
fi
if [[ "$1 $2" != "repo view" ]]; then
  exit 2
fi
repo=""
for arg in "${@:3}"; do
  case "$arg" in
    --json | --jq | viewerPermission | .viewerPermission) ;;
    *) repo="$arg" ;;
  esac
done
case "$repo" in
  "") echo READ ;;
  fork/repo) echo ADMIN ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$tmp_dir/gh"

# Runs gh-check.sh with the stub first on PATH; prints "<exit code>: <first output line>".
# An optional GH_REPO=value argument is exported first; GH_REPO is otherwise unset.
run_check() {
  local gh_repo="$1"
  shift
  (
    unset GH_REPO
    [[ -z "$gh_repo" ]] || export GH_REPO="$gh_repo"
    PATH="$tmp_dir:$PATH"
    out="$(bash "$check" "$@" 2>&1)"
    code=$?
    echo "${code}: $(printf '%s\n' "$out" | head -n 1)"
  )
}

assert_eq "read-only checkout passes without --require-write" \
  "0: SUCCESS: gh CLI is installed, authenticated, and the current repository is accessible in read-only mode." \
  "$(run_check "")"
assert_eq "read-only checkout fails with --require-write" \
  "1: ERROR: Access to the current repository is read-only. Write operations are not permitted." \
  "$(run_check "" --require-write)"
assert_eq "GH_REPO naming a writable repository passes --require-write" \
  "0: SUCCESS: gh CLI is installed, authenticated, and has write access to fork/repo." \
  "$(run_check fork/repo --require-write)"
assert_eq "GH_REPO naming an inaccessible repository fails" \
  "1: ERROR: Cannot access missing/repo." \
  "$(run_check missing/repo --require-write)"
assert_eq "an unknown argument is rejected" \
  "1: ERROR: Unknown argument: --bogus" \
  "$(run_check "" --bogus)"

if [[ "$failures" -ne 0 ]]; then
  echo "${failures} failure(s)"
  exit 1
fi
