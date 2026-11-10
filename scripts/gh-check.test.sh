#!/usr/bin/env bash
# Regression tests for scripts/gh-check.sh, mainly that the permission check
# targets GH_REPO when it is set rather than the checkout's own remotes.
# `gh` is replaced by a stub that, like the real `gh repo view`, ignores GH_REPO: it
# reports on an explicit repository argument and treats no argument as the checkout's own.
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
    if [[ -s "$tmp_dir/stub.log" ]]; then
      echo "  gh stub log:"
      sed 's/^/    /' "$tmp_dir/stub.log"
    fi
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/gh-check-test.XXXXXX")" || exit 1

# The checkout's own repository (no argument) is read-only; fork/repo is admin;
# anything else does not exist. A `gh` call the stub doesn't model is logged to
# stub.log, which assert_eq prints on failure.
cat >"$tmp_dir/gh" <<'STUB'
#!/usr/bin/env bash
if [[ "$1 $2" == "auth status" ]]; then
  exit 0
fi
if [[ "$1 $2" != "repo view" ]]; then
  echo "unexpected gh call: $*" >>"$(dirname "$0")/stub.log"
  exit 2
fi
repo=""
if [[ $# -ge 3 && "$3" != -* ]]; then
  repo="$3"
fi
case "$repo" in
  "") echo READ ;;
  fork/repo) echo ADMIN ;;
  *)
    echo "HTTP 404: Not Found" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$tmp_dir/gh"

# Runs gh-check.sh with the stub first on PATH; prints "<exit code>: <output line>",
# the first output line unless LINE names another.
# The first argument is the GH_REPO value to export, or "" to leave GH_REPO unset;
# the remaining arguments are passed to gh-check.sh.
run_check() {
  local gh_repo="$1"
  shift
  (
    unset GH_REPO
    [[ -z "$gh_repo" ]] || export GH_REPO="$gh_repo"
    PATH="$tmp_dir:$PATH"
    out="$(bash "$check" "$@" 2>&1)"
    code=$?
    echo "${code}: $(printf '%s\n' "$out" | sed -n "${LINE:-1}p")"
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
assert_eq "an inaccessible repository shows gh's own error" \
  "1:   gh: HTTP 404: Not Found" \
  "$(LINE=2 run_check missing/repo --require-write)"
assert_eq "an unknown argument is rejected" \
  "1: ERROR: Unknown argument: --bogus" \
  "$(run_check "" --bogus)"

if [[ "$failures" -ne 0 ]]; then
  echo "${failures} failure(s)"
  exit 1
fi
