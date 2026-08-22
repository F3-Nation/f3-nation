#!/usr/bin/env bash
# Select --affected for PRs when Turbo finds workspaces to run. Any detection
# failure, including malformed output, fails open to the full workspace so an
# optimization can never block or silently empty a required CI check.
set -uo pipefail

turbo_bin="${TURBO_SCOPE_TURBO_BIN:-./node_modules/.bin/turbo}"

use_full_workspace() {
  echo "TURBO_RUN_ARGS=" >>"${GITHUB_ENV:?GITHUB_ENV must be set}"
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
} >>"$GITHUB_ENV"

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

if [[ -n "${TURBO_SCOPE_TASK:-}" ]]; then
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
fi

echo "TURBO_RUN_ARGS=--affected" >>"$GITHUB_ENV"
echo "Selected ${affected_count} affected Turbo workspace(s)."
