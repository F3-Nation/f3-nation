#!/usr/bin/env bash
set -uo pipefail

turbo_status=0
ws_status=0
vitest_thresholds_status=0
eslint_suppressions_status=0
python_task_status=0
python_precommit_status=0
turbo_scope_status=0
mirror_postgres_image_status=0
pr_triage_status=0
prt_status=0
review_completion_status=0
lint_fix_status=0

turbo run lint "$@" --continue -- --cache --cache-location node_modules/.cache/.eslintcache || turbo_status=$?
pnpm run lint:ws || ws_status=$?
node scripts/check-vitest-thresholds.mjs || vitest_thresholds_status=$?
node scripts/check-eslint-suppressions.mjs || eslint_suppressions_status=$?
bash scripts/python-task.test.sh || python_task_status=$?
bash scripts/python-precommit.test.sh || python_precommit_status=$?
bash scripts/select-turbo-scope.test.sh || turbo_scope_status=$?
bash scripts/mirror-postgres-image.test.sh || mirror_postgres_image_status=$?
bash scripts/pr-triage.test.sh || pr_triage_status=$?
bash .agents/skills/pr-local-test/scripts/prt.test.sh || prt_status=$?
bash .agents/skills/pr-review-inline/scripts/completion-gate.test.sh || review_completion_status=$?
bash scripts/lint-fix.test.sh || lint_fix_status=$?

if [ "$turbo_status" -ne 0 ]; then
  exit "$turbo_status"
fi

if [ "$ws_status" -ne 0 ]; then
  exit "$ws_status"
fi

if [ "$vitest_thresholds_status" -ne 0 ]; then
  exit "$vitest_thresholds_status"
fi

if [ "$eslint_suppressions_status" -ne 0 ]; then
  exit "$eslint_suppressions_status"
fi

if [ "$python_task_status" -ne 0 ]; then
  exit "$python_task_status"
fi

if [ "$python_precommit_status" -ne 0 ]; then
  exit "$python_precommit_status"
fi

if [ "$turbo_scope_status" -ne 0 ]; then
  exit "$turbo_scope_status"
fi

if [ "$mirror_postgres_image_status" -ne 0 ]; then
  exit "$mirror_postgres_image_status"
fi

if [ "$prt_status" -ne 0 ]; then
  exit "$prt_status"
fi

if [ "$review_completion_status" -ne 0 ]; then
  exit "$review_completion_status"
fi

if [ "$lint_fix_status" -ne 0 ]; then
  exit "$lint_fix_status"
fi

exit "$pr_triage_status"
