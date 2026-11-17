#!/usr/bin/env bash
# Regression tests for scripts/check-skill-frontmatter.mjs: each case builds a
# throwaway skills tree and asserts the checker's exit status and message.
# Run directly: bash scripts/check-skill-frontmatter.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="${script_dir}/check-skill-frontmatter.mjs"
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/check-skill-frontmatter-test.XXXXXX")" || exit 1

hint="Wrap the value in quotes"

# Writes one skill named "demo" whose SKILL.md is the given text.
make_fixture() {
  local dir="$1" content="$2"
  mkdir -p "$dir/.agents/skills/demo"
  printf '%s\n' "$content" >"$dir/.agents/skills/demo/SKILL.md"
}

# Optional 4th argument: text the output must contain; 5th: text it must not.
expect() {
  local description="$1" expected_status="$2" content="$3" pattern="${4:-}" absent="${5:-}"
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
  elif [[ -n "$absent" && "$output" == *"$absent"* ]]; then
    echo "FAIL: $description (output contains \"$absent\")"
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
expect "unquoted # prints the quoting hint" 1 $'---\nname: demo\ndescription: Use for "triage #123".\n---' "$hint"
expect "unquoted colon-space fails" 1 $'---\nname: demo\ndescription: Use when: asked.\n---' 'unquoted ": "'
expect "trailing colon fails" 1 $'---\nname: demo\ndescription: Use when:\n---' 'unquoted ": "'
expect "name must match directory" 1 $'---\nname: other\ndescription: Use when asked.\n---' 'name must be "demo"' "$hint"
expect "unclosed single quote fails" 1 $'---\nname: demo\ndescription: \'Use when asked.\n---' 'never closes' "$hint"
expect "unclosed double quote fails" 1 $'---\nname: demo\ndescription: "Use when\n  asked.\n---' 'never closes'
expect "multiline quoted value passes" 0 $'---\nname: demo\ndescription: \'Use when\n  asked.\'\n---'
expect "missing description fails" 1 $'---\nname: demo\n---' 'description is missing'
expect "empty description fails" 1 $'---\nname: demo\ndescription:\n---' 'description is missing'
expect "missing frontmatter fails" 1 $'# Demo\n\nNo frontmatter.' 'no frontmatter block'
expect "multiline plain value passes" 0 $'---\nname: demo\ndescription: Use when\n  asked to demo.\n---'
expect "block scalar value passes" 0 $'---\nname: demo\ndescription: |\n  Use for "triage #123": all of it.\n---'
expect "nested mapping field passes" 0 $'---\nname: demo\ndescription: Use when asked.\nmetadata:\n  author: someone\n---'
expect "unquoted # on a continuation line fails" 1 $'---\nname: demo\ndescription: Use when\n  asked to triage #123.\n---' 'unquoted " #"'
expect "unquoted colon-space on a continuation line fails" 1 $'---\nname: demo\ndescription: Use\n  when: asked.\n---' 'unquoted ": "'
expect "comment-only description fails" 1 $'---\nname: demo\ndescription: # TODO\n---' 'description is missing'
expect "empty block scalar description fails" 1 $'---\nname: demo\ndescription: |\n---' 'description is missing'
expect "missing name fails" 1 $'---\ndescription: Use when asked.\n---' 'name must be "demo"'
expect "unquoted colon-space in another field fails" 1 $'---\nname: demo\ndescription: Use when asked.\nargument-hint: issue: number\n---' 'argument-hint has an unquoted ": "'
expect "unclosed frontmatter fails" 1 $'---\nname: demo\ndescription: Use when asked.' 'no frontmatter block'
expect "apostrophe inside single quotes fails" 1 $'---\nname: demo\ndescription: \'Use when it\'s asked\'\n---' 'after its closing'
expect "text after a closing double quote fails" 1 $'---\nname: demo\ndescription: "Use" # when asked to "demo"\n---' 'after its closing'
expect "quoted value on the next line passes" 0 $'---\nname: demo\ndescription:\n  \'Use for triage #123: all fields.\'\n---'
expect "backtick-led plain value fails" 1 $'---\nname: demo\ndescription: `pnpm lint` helper.\n---' 'YAML reads as syntax'
expect "bracket-led plain value fails" 1 $'---\nname: demo\ndescription: [Draft] Use when asked.\n---' 'YAML reads as syntax'
expect "flow list in another field passes" 0 $'---\nname: demo\ndescription: Use when asked.\nallowed-tools: [Read, Bash]\n---'
expect "flow map in another field passes" 0 $'---\nname: demo\ndescription: Use when asked.\nmetadata: {author: someone}\n---'
expect "leading-indicator value prints the quoting hint" 1 $'---\nname: demo\ndescription: *Use* when asked.\n---' "$hint"
expect "key with no space after the colon fails" 1 $'---\nname: demo\ndescription:Use when asked.\n---' 'description is missing'

# Runs the checker on a root that make_fixture has not filled in.
expect_root() {
  local description="$1" pattern="$2" dir="$3"
  local output status
  output="$(node "$checker" "$dir" 2>&1)"
  status=$?
  if [[ "$status" -ne 1 || "$output" != *"$pattern"* ]]; then
    echo "FAIL: $description (exit $status, expected 1 with \"$pattern\")"
    echo "$output"
    failures=$((failures + 1))
  else
    echo "ok: $description"
  fi
}

no_skills_dir="$(mktemp -d "$tmp_dir/case.XXXXXX")" || exit 1
expect_root "missing skills directory fails" 'directory is missing' "$no_skills_dir"
empty_skills_dir="$(mktemp -d "$tmp_dir/case.XXXXXX")" || exit 1
mkdir -p "$empty_skills_dir/.agents/skills"
expect_root "empty skills directory fails" 'no skill directories' "$empty_skills_dir"
no_skill_file_dir="$(mktemp -d "$tmp_dir/case.XXXXXX")" || exit 1
mkdir -p "$no_skill_file_dir/.agents/skills/aaa" "$no_skill_file_dir/.agents/skills/zzz"
expect_root "first skill without SKILL.md fails" 'skills/aaa/SKILL.md: file is missing' "$no_skill_file_dir"
expect_root "last skill without SKILL.md fails" 'skills/zzz/SKILL.md: file is missing' "$no_skill_file_dir"

if [[ "$failures" -ne 0 ]]; then
  echo "$failures check-skill-frontmatter test(s) failed"
  exit 1
fi
echo "check-skill-frontmatter tests passed"
