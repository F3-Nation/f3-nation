#!/usr/bin/env bash
set -uo pipefail

turbo_status=0
ws_status=0

turbo run lint --continue -- --cache --cache-location node_modules/.cache/.eslintcache || turbo_status=$?
pnpm run lint:ws || ws_status=$?

if [ "$turbo_status" -ne 0 ]; then
  exit "$turbo_status"
fi

exit "$ws_status"
