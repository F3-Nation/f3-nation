#!/usr/bin/env bash
# Ruff formatter entry point for the slackbot `format` turbo task.
#
# Mirrors the prettier `--check` / `--write` pair the JS workspaces use: the
# task checks by default, and root `pnpm format:fix` appends `--write`, which
# switches ruff to rewriting files. `ruff format` has no `--write` flag of its
# own, so it is consumed here rather than forwarded.
set -uo pipefail

if printf '%s\n' "$@" | grep -qx -- '--write'; then
  exec uv run ruff format .
fi

exec uv run ruff format --check .
