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

if ! affected_json="$("$turbo_bin" ls --affected --output=json)"; then
  echo "::warning::Turbo affected-workspace detection failed."
  use_full_workspace "Unable to calculate affected workspaces"
  exit 0
fi

if ! affected_count="$(
  node -e 'const value = JSON.parse(process.argv[1]); if (!Number.isInteger(value?.packages?.count) || value.packages.count < 0) process.exit(1); process.stdout.write(String(value.packages.count));' "$affected_json"
)"; then
  echo "::warning::Turbo returned invalid affected-workspace JSON."
  use_full_workspace "Unable to parse affected workspaces"
  exit 0
fi

if [[ "$affected_count" -gt 0 ]]; then
  echo "TURBO_RUN_ARGS=--affected" >>"$GITHUB_ENV"
  echo "Selected ${affected_count} affected Turbo workspace(s)."
else
  use_full_workspace "Turbo selected no affected workspaces"
fi
