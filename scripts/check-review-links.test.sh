#!/usr/bin/env bash
# Regression tests for scripts/check-review-links.mjs: that it passes a
# consistent fixture repo, and fails when a REVIEW.md link points at a missing
# file or heading, when a nested AGENTS.md isn't listed in
# .greptile/files.json or is scoped to the wrong directory, or when the
# Greptile config lists a file that no longer exists.
# Run directly: bash scripts/check-review-links.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${script_dir}/check-review-links.mjs"
failures=0

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-review-links-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

# Builds a minimal repo with one nested AGENTS.md, a REVIEW.md linking to one
# of its headings, and a matching .greptile/files.json.
make_fixture() {
  local dir="$1"
  mkdir -p "$dir/packages/api" "$dir/.greptile"
  git -C "$dir" init -q
  printf '# Root\n' >"$dir/AGENTS.md"
  printf '# packages/api\n\n## Authorization\n\nRules.\n' >"$dir/packages/api/AGENTS.md"
  printf '# Code review\n\n- Check authz ([rule](packages/api/AGENTS.md#authorization)).\n' >"$dir/REVIEW.md"
  cat >"$dir/.greptile/files.json" <<'JSON'
{
  "files": [
    { "path": "REVIEW.md" },
    { "path": "packages/api/AGENTS.md", "scope": ["packages/api/**"] }
  ]
}
JSON
  git -C "$dir" add -A
}

expect() {
  local description="$1" expected_status="$2" dir="$3" pattern="${4:-}"
  local output status
  output="$(node "$checker" "$dir" 2>&1)"
  status=$?
  if [[ "$expected_status" == "pass" && "$status" -ne 0 ]]; then
    echo "FAIL: ${description} (expected pass, got: ${output})"
    failures=$((failures + 1))
  elif [[ "$expected_status" == "fail" && "$status" -eq 0 ]]; then
    echo "FAIL: ${description} (expected a failure)"
    failures=$((failures + 1))
  elif [[ -n "$pattern" && "$output" != *"$pattern"* ]]; then
    echo "FAIL: ${description} (output missing '${pattern}': ${output})"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

ok="$tmp_dir/ok"
make_fixture "$ok"
expect "consistent fixture passes" pass "$ok"

anchor="$tmp_dir/anchor"
make_fixture "$anchor"
printf '# packages/api\n\n## Access control\n' >"$anchor/packages/api/AGENTS.md"
expect "renamed heading orphans a critical check" fail "$anchor" "no heading for #authorization"

missing_file="$tmp_dir/missing-file"
make_fixture "$missing_file"
printf '# Code review\n\n- [rule](packages/db/AGENTS.md#migrations)\n' >"$missing_file/REVIEW.md"
expect "link to a missing file" fail "$missing_file" "does not exist"

unlisted="$tmp_dir/unlisted"
make_fixture "$unlisted"
mkdir -p "$unlisted/packages/db"
printf '# packages/db\n' >"$unlisted/packages/db/AGENTS.md"
git -C "$unlisted" add -A
expect "nested AGENTS.md missing from Greptile config" fail "$unlisted" "packages/db/AGENTS.md is not listed"

scope="$tmp_dir/scope"
make_fixture "$scope"
sed 's#"packages/api/\*\*"#"packages/**"#' "$scope/.greptile/files.json" >"$scope/files.tmp" && mv "$scope/files.tmp" "$scope/.greptile/files.json"
expect "wrong Greptile scope" fail "$scope" "must be scoped to"

stale="$tmp_dir/stale"
make_fixture "$stale"
git -C "$stale" rm -qf packages/api/AGENTS.md
printf '# Code review\n' >"$stale/REVIEW.md"
expect "Greptile config lists a deleted file" fail "$stale" "packages/api/AGENTS.md does not exist"

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} check-review-links test(s) failed"
  exit 1
fi
echo "All check-review-links tests passed"
