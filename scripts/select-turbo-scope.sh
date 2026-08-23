#!/usr/bin/env bash
# Select --affected for PRs when Turbo finds workspaces to run. Any detection
# failure, including malformed output, fails open to the full workspace so an
# optimization can never block or silently empty a required CI check.
set -uo pipefail

turbo_bin="${TURBO_SCOPE_TURBO_BIN:-./node_modules/.bin/turbo}"
github_env="${GITHUB_ENV:?GITHUB_ENV must be set}"

use_full_workspace() {
  echo "TURBO_RUN_ARGS=" >>"$github_env"
  echo "::notice::${1}; running the full workspace instead."
}

if [[ -z "${TURBO_SCM_BASE:-}" || -z "${TURBO_SCM_HEAD:-}" ]]; then
  echo "::warning::Pull-request base/head SHAs were unavailable."
  use_full_workspace "Unable to pin the affected comparison range"
  exit 0
fi

{
  echo "TURBO_SCM_BASE=${TURBO_SCM_BASE}"
  echo "TURBO_SCM_HEAD=${TURBO_SCM_HEAD}"
} >>"$github_env"

if ! changed_files="$(
  git diff --name-only "${TURBO_SCM_BASE}...${TURBO_SCM_HEAD}"
)"; then
  echo "::warning::Unable to inspect the pull-request file list."
  use_full_workspace "Unable to check for changes outside Turbo's package graph"
  exit 0
fi

# Turbo models package.json workspaces only. These repository-wide inputs and
# the uv-only db-python workspace are otherwise invisible on a mixed PR, which
# could skip the Slackbot's ruff, mypy, pytest, or formatting tasks.
if printf '%s\n' "$changed_files" |
  grep -E '^(packages/db-python/|pyproject\.toml$|uv\.lock$|\.python-version$|scripts/python-task\.sh$|\.gitignore$|\.prettierignore$)' >/dev/null; then
  use_full_workspace "Change touches files Turbo cannot safely attribute"
  exit 0
fi

if ! affected_json="$("$turbo_bin" ls --affected --output=json)"; then
  echo "::warning::Turbo affected-workspace detection failed."
  use_full_workspace "Unable to calculate affected workspaces"
  exit 0
fi

if ! affected_count="$(
  printf '%s' "$affected_json" |
    node -e 'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => (input += chunk)); process.stdin.on("end", () => { const value = JSON.parse(input); if (!Number.isInteger(value?.packages?.count) || value.packages.count < 0) process.exit(1); process.stdout.write(String(value.packages.count)); });'
)"; then
  echo "::warning::Turbo returned invalid affected-workspace JSON."
  use_full_workspace "Unable to parse affected workspaces"
  exit 0
fi

if [[ "$affected_count" -eq 0 ]]; then
  use_full_workspace "Turbo selected no affected workspaces"
  exit 0
fi

if [[ -z "${TURBO_SCOPE_TASK:-}" ]]; then
  echo "::warning::No Turbo task was supplied for affected-scope validation."
  use_full_workspace "Unable to verify affected task selection"
  exit 0
fi

if ! task_json="$(
  "$turbo_bin" run "$TURBO_SCOPE_TASK" --affected --dry-run=json
)"; then
  echo "::warning::Turbo affected-task detection failed."
  use_full_workspace "Unable to calculate affected ${TURBO_SCOPE_TASK} tasks"
  exit 0
fi

if ! task_count="$(
  printf '%s' "$task_json" |
    node -e 'let input = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => (input += chunk)); process.stdin.on("end", () => { const value = JSON.parse(input); if (!Array.isArray(value?.tasks)) process.exit(1); process.stdout.write(String(value.tasks.length)); });'
)"; then
  echo "::warning::Turbo returned invalid affected-task JSON."
  use_full_workspace "Unable to parse affected ${TURBO_SCOPE_TASK} tasks"
  exit 0
fi

if [[ "$task_count" -eq 0 ]]; then
  use_full_workspace "Turbo selected no affected ${TURBO_SCOPE_TASK} tasks"
  exit 0
fi

echo "TURBO_RUN_ARGS=--affected" >>"$github_env"
echo "Selected ${affected_count} affected Turbo workspace(s)."
