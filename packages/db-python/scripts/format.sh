#!/usr/bin/env bash
# Ruff formatter entry point for the db-python `format` turbo task.
#
# Check by default; root `pnpm format:fix` appends --write, which switches
# Ruff to rewriting files rather than forwarding an unsupported flag.
set -uo pipefail

if printf '%s\n' "$@" | grep -qx -- '--write'; then
  exec uv run ruff format .
fi

exec uv run ruff format --check .
