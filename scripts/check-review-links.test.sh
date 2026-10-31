#!/usr/bin/env bash
# Regression tests for scripts/check-review-links.mjs: that it passes a
# consistent fixture repo (including underscore anchors and narrowed or widened
# Greptile scopes), and fails when a REVIEW.md link (plain, titled or in-page)
# points at a missing file or heading, when an anchor follows a directory link,
# when a nested AGENTS.md isn't listed in .greptile/files.json or is scoped
# outside its directory, when the Greptile config lists a file that no
# longer exists, or when a bot config names a rule id REVIEW.md doesn't define.
# Run directly: bash scripts/check-review-links.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${script_dir}/check-review-links.mjs"
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-review-links-test.XXXXXX")" || exit 1

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

underscore="$tmp_dir/underscore"
make_fixture "$underscore"
printf '# packages/api\n\n## `snake_case` names\n' >"$underscore/packages/api/AGENTS.md"
printf '# Code review\n\n- [rule](packages/api/AGENTS.md#snake_case-names)\n' >"$underscore/REVIEW.md"
expect "heading with an underscore keeps it in the anchor" pass "$underscore"

titled="$tmp_dir/titled"
make_fixture "$titled"
printf '# Code review\n\n- [rule](packages/api/AGENTS.md#missing "Rule")\n' >"$titled/REVIEW.md"
expect "titled link to a missing heading" fail "$titled" "no heading for #missing"

in_page="$tmp_dir/in-page"
make_fixture "$in_page"
printf '# Code review\n\n## Checks\n\n- [ok](#checks) [bad](#missing)\n' >"$in_page/REVIEW.md"
expect "in-page link to a missing heading" fail "$in_page" "REVIEW.md has no heading for #missing"

dir_anchor="$tmp_dir/dir-anchor"
make_fixture "$dir_anchor"
printf '# Code review\n\n- [rule](packages/api#authorization)\n' >"$dir_anchor/REVIEW.md"
expect "anchor on a directory link" fail "$dir_anchor" "anchor on a directory link"

narrow="$tmp_dir/narrow"
make_fixture "$narrow"
sed 's#"packages/api/\*\*"#"packages/api/src/**", "packages/api/test/**"#' "$narrow/.greptile/files.json" >"$narrow/files.tmp" && mv "$narrow/files.tmp" "$narrow/.greptile/files.json"
expect "scope narrowed to paths under the directory" pass "$narrow"

wide="$tmp_dir/wide"
make_fixture "$wide"
sed 's#"packages/api/\*\*"#"packages/api/**", "apps/*/src/proxy.ts"#' "$wide/.greptile/files.json" >"$wide/files.tmp" && mv "$wide/files.tmp" "$wide/.greptile/files.json"
expect "scope widened beyond the directory" pass "$wide"

stale="$tmp_dir/stale"
make_fixture "$stale"
git -C "$stale" rm -qf packages/api/AGENTS.md
printf '# Code review\n' >"$stale/REVIEW.md"
expect "Greptile config lists a deleted file" fail "$stale" "packages/api/AGENTS.md does not exist"

rule_ids="$tmp_dir/rule-ids"
make_fixture "$rule_ids"
printf '# Code review\n\n- **KP-ACTIVE:** Rule.\n- **CC-AUTHZ** Rule.\n' >"$rule_ids/REVIEW.md"
printf 'path_instructions:\n  - instructions: Apply KP-ACTIVE and CC-AUTHZ.\n' >"$rule_ids/.coderabbit.yaml"
expect "bot config names defined rule ids" pass "$rule_ids"
printf '{ "rules": [{ "rule": "KP-RENAMED: check it." }] }\n' >"$rule_ids/.greptile/config.json"
expect "bot config names an undefined rule id" fail "$rule_ids" ".greptile/config.json: KP-RENAMED is not defined in REVIEW.md"
printf '{ "rules": [{ "rule": "KP-ACTIVE-2: check it." }] }\n' >"$rule_ids/.greptile/config.json"
expect "rule id with a numeric segment must match in full" fail "$rule_ids" "KP-ACTIVE-2 is not defined in REVIEW.md"

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} check-review-links test(s) failed"
  exit 1
fi
echo "All check-review-links tests passed"
