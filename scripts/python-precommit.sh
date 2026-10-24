#!/usr/bin/env bash
# Called by the Python Lefthook job through python-task.sh's optional-uv guard.
set -euo pipefail

# Ruff scans the current directory without file arguments; an empty selection
# must never turn this staged-file hook into a whole-repository rewrite.
if (($# == 0)); then
  exit 0
fi

# Apply lint fixes first so import sorting cannot undo the final formatting.
uv run --all-packages ruff check --fix -- "$@"
uv run --all-packages ruff format -- "$@"
