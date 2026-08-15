#!/usr/bin/env bash
set -uo pipefail

turbo_status=0
ws_status=0
vitest_thresholds_status=0
python_task_status=0

turbo run lint --continue -- --cache --cache-location node_modules/.cache/.eslintcache || turbo_status=$?
pnpm run lint:ws || ws_status=$?
node scripts/check-vitest-thresholds.mjs || vitest_thresholds_status=$?
bash scripts/python-task.test.sh || python_task_status=$?

if [ "$turbo_status" -ne 0 ]; then
  exit "$turbo_status"
fi

if [ "$ws_status" -ne 0 ]; then
  exit "$ws_status"
fi

if [ "$vitest_thresholds_status" -ne 0 ]; then
  exit "$vitest_thresholds_status"
fi

exit "$python_task_status"
