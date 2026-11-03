#!/usr/bin/env bash
# Called by the Python Lefthook job through python-task.sh's optional-uv guard.
set -euo pipefail

# Ruff scans the current directory without file arguments; an empty selection
# must never turn this staged-file hook into a whole-repository rewrite.
if (($# == 0)); then
  exit 0
fi

# Apply import fixes before formatting, then check the final content so
# formatter-fixable lint does not block the commit.
uv run --all-packages ruff check --fix-only -- "$@"
uv run --all-packages ruff format -- "$@"
uv run --all-packages ruff check -- "$@"
