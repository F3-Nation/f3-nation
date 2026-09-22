#!/usr/bin/env bash
# Select --affected for PRs when Turbo finds a task to run. Any detection
# failure, including malformed output, fails open to the full workspace so an
# optimization can never block or silently empty a required CI check. Files
# Turbo cannot attribute to a package are handled upstream by turbo.json's
# globalDependencies, which marks every workspace affected.
set -uo pipefail

turbo_bin="${TURBO_SCOPE_TURBO_BIN:-./node_modules/.bin/turbo}"
github_env="${GITHUB_ENV:?GITHUB_ENV must be set}"

use_full_workspace() {
  echo "TURBO_RUN_ARGS=" >>"$github_env"
  echo "::notice::${1}; running the full workspace instead."
  exit 0
}

if [[ -z "${TURBO_SCM_BASE:-}" || -z "${TURBO_SCM_HEAD:-}" ]]; then
  echo "::warning::Pull-request base/head SHAs were unavailable."
  use_full_workspace "Unable to pin the affected comparison range"
fi

{
  echo "TURBO_SCM_BASE=${TURBO_SCM_BASE}"
  echo "TURBO_SCM_HEAD=${TURBO_SCM_HEAD}"
} >>"$github_env"

if [[ -z "${TURBO_SCOPE_TASK:-}" ]]; then
  echo "::warning::No Turbo task was supplied for affected-scope validation."
  use_full_workspace "No Turbo task was supplied"
fi

if ! task_json="$("$turbo_bin" run "$TURBO_SCOPE_TASK" --affected --dry-run=json)"; then
  echo "::warning::Turbo affected-task detection failed."
  use_full_workspace "Unable to calculate affected ${TURBO_SCOPE_TASK} tasks"
fi

if ! runnable_task_count="$(
  printf '%s' "$task_json" |
    node -e 'const t = JSON.parse(
      require("fs").readFileSync(0, "utf8")).tasks;
      if (!Array.isArray(t) ||
          !t.every((task) => typeof task?.command === "string")) process.exit(1);
      process.stdout.write(String(
        t.filter((task) => task.command !== "<NONEXISTENT>").length));'
)"; then
  echo "::warning::Turbo returned invalid affected-task JSON."
  use_full_workspace "Unable to parse affected ${TURBO_SCOPE_TASK} tasks"
fi

if [[ "$runnable_task_count" -eq 0 ]]; then
  use_full_workspace "Turbo selected no runnable affected ${TURBO_SCOPE_TASK} tasks"
fi

echo "TURBO_RUN_ARGS=--affected" >>"$github_env"
echo "Selected ${runnable_task_count} runnable affected ${TURBO_SCOPE_TASK} task(s)."
