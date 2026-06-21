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
  pnpm slackbot:sync

See docs/LOCAL_DEV_DOCKER.md#uv-python-package-manager-for-slackbot

EOF

if [ "${F3_REQUIRE_UV:-}" = "1" ]; then
  echo "ERROR: F3_REQUIRE_UV=1 is set, so uv is required."
  exit 1
fi

exit 0
