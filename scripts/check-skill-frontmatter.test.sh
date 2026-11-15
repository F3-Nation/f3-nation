#!/usr/bin/env bash
# Regression tests for scripts/check-skill-frontmatter.mjs: that it passes
# plain and quoted values (including an apostrophe and a " #" inside quotes),
# and fails on an unquoted " #" or ": ", a name that differs from the
# directory, a missing description, and a missing frontmatter block.
# Run directly: bash scripts/check-skill-frontmatter.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${script_dir}/check-skill-frontmatter.mjs"
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-skill-frontmatter-test.XXXXXX")" || exit 1

# Writes one skill named "demo" whose SKILL.md is the given text.
make_fixture() {
  local dir="$1" content="$2"
  mkdir -p "$dir/.agents/skills/demo"
  printf '%s\n' "$content" >"$dir/.agents/skills/demo/SKILL.md"
}

expect() {
  local description="$1" expected_status="$2" content="$3" pattern="${4:-}"
  local dir output status
  dir="$(mktemp -d "$tmp_dir/case.XXXXXX")" || exit 1
  make_fixture "$dir" "$content"
  output="$(node "$checker" "$dir" 2>&1)"
  status=$?
  if [[ "$status" -ne "$expected_status" ]]; then
    echo "FAIL: $description (exit $status, expected $expected_status)"
    echo "$output"
    failures=$((failures + 1))
  elif [[ -n "$pattern" && "$output" != *"$pattern"* ]]; then
    echo "FAIL: $description (output lacks \"$pattern\")"
    echo "$output"
    failures=$((failures + 1))
  else
    echo "ok: $description"
  fi
}

expect "plain values pass" 0 $'---\nname: demo\ndescription: Use when asked to demo.\n---\n# Demo'
expect "quoted # and apostrophe pass" 0 $'---\nname: demo\ndescription: \'Use for "triage #123" on an issue\'\'s fields: all of them.\'\n---'
expect "double-quoted value passes" 0 $'---\nname: demo\ndescription: "Post to #channel"\n---'
expect "unquoted # fails" 1 $'---\nname: demo\ndescription: Use for "triage #123".\n---' 'unquoted " #"'
expect "unquoted colon-space fails" 1 $'---\nname: demo\ndescription: Use when: asked.\n---' 'unquoted ": "'
expect "name must match directory" 1 $'---\nname: other\ndescription: Use when asked.\n---' 'name must be "demo"'
expect "missing description fails" 1 $'---\nname: demo\n---' 'description is missing'
expect "empty description fails" 1 $'---\nname: demo\ndescription:\n---' 'description is missing'
expect "missing frontmatter fails" 1 $'# Demo\n\nNo frontmatter.' 'no frontmatter block'

if [[ "$failures" -ne 0 ]]; then
  echo "$failures check-skill-frontmatter test(s) failed"
  exit 1
fi
echo "check-skill-frontmatter tests passed"
