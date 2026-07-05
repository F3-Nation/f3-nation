#!/usr/bin/env bash
# Sync Slackbot Python dependencies after Node dependencies install.

set -euo pipefail

if command -v uv >/dev/null 2>&1; then
  uv sync
  exit 0
fi

cat <<'EOF'

WARNING: uv is not installed, so Slackbot Python dependencies were not synced.

Install uv:
  curl -LsSf https://astral.sh/uv/install.sh | sh

Then run:
  pnpm python:install

See docs/LOCAL_DEV_DOCKER.md#uv-python-package-manager-for-slackbot

EOF

exit 0
