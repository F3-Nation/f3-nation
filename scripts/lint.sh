#!/usr/bin/env bash
set -uo pipefail

turbo_status=0
ws_status=0
vitest_thresholds_status=0
security_headers_status=0
eslint_suppressions_status=0
python_task_status=0
python_precommit_status=0
turbo_scope_status=0
mirror_postgres_image_status=0
pr_triage_status=0
my_work_status=0
github_scripts_status=0
prt_status=0
issue_fields_status=0
release_facts_status=0
filed_plans_status=0
find_release_pr_status=0
lint_fix_status=0
local_ports_status=0
review_links_status=0
skill_frontmatter_status=0
gh_check_status=0
release_protections_status=0
dockerfile_installs_status=0

turbo run lint "$@" --continue -- --cache --cache-location node_modules/.cache/.eslintcache || turbo_status=$?
pnpm run lint:ws || ws_status=$?
node scripts/check-vitest-thresholds.mjs || vitest_thresholds_status=$?
node scripts/check-security-headers-coverage.mjs || security_headers_status=$?
bash scripts/check-security-headers-coverage.test.sh || security_headers_status=$?
node scripts/check-eslint-suppressions.mjs || eslint_suppressions_status=$?
bash scripts/python-task.test.sh || python_task_status=$?
bash scripts/python-precommit.test.sh || python_precommit_status=$?
bash scripts/select-turbo-scope.test.sh || turbo_scope_status=$?
bash scripts/mirror-postgres-image.test.sh || mirror_postgres_image_status=$?
bash scripts/pr-triage.test.sh || pr_triage_status=$?
bash scripts/my-work.test.sh || my_work_status=$?
node --test .github/scripts/ || github_scripts_status=$?
bash .agents/skills/pr-local-test/scripts/prt.test.sh || prt_status=$?
bash .agents/skills/issue-triage/scripts/issue-fields.test.sh || issue_fields_status=$?
bash .agents/skills/release/scripts/release-facts.test.sh || release_facts_status=$?
bash .agents/skills/release/scripts/check-filed-plans.test.sh || filed_plans_status=$?
bash .agents/skills/release/scripts/find-release-pr.test.sh || find_release_pr_status=$?
bash scripts/lint-fix.test.sh || lint_fix_status=$?
bash scripts/local-ports.test.sh || local_ports_status=$?
node scripts/check-review-links.mjs || review_links_status=$?
bash scripts/check-review-links.test.sh || review_links_status=$?
node scripts/check-skill-frontmatter.mjs || skill_frontmatter_status=$?
bash scripts/check-skill-frontmatter.test.sh || skill_frontmatter_status=$?
bash scripts/gh-check.test.sh || gh_check_status=$?
bash scripts/release-protections.test.sh || release_protections_status=$?
node scripts/check-dockerfile-global-installs.mjs || dockerfile_installs_status=$?
bash scripts/check-dockerfile-global-installs.test.sh || dockerfile_installs_status=$?

if [ "$turbo_status" -ne 0 ]; then
  exit "$turbo_status"
fi

if [ "$ws_status" -ne 0 ]; then
  exit "$ws_status"
fi

if [ "$vitest_thresholds_status" -ne 0 ]; then
  exit "$vitest_thresholds_status"
fi

if [ "$security_headers_status" -ne 0 ]; then
  exit "$security_headers_status"
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

if [ "$issue_fields_status" -ne 0 ]; then
  exit "$issue_fields_status"
fi

if [ "$release_facts_status" -ne 0 ]; then
  exit "$release_facts_status"
fi

if [ "$filed_plans_status" -ne 0 ]; then
  exit "$filed_plans_status"
fi

if [ "$find_release_pr_status" -ne 0 ]; then
  exit "$find_release_pr_status"
fi

if [ "$lint_fix_status" -ne 0 ]; then
  exit "$lint_fix_status"
fi

if [ "$local_ports_status" -ne 0 ]; then
  exit "$local_ports_status"
fi

if [ "$review_links_status" -ne 0 ]; then
  exit "$review_links_status"
fi

if [ "$skill_frontmatter_status" -ne 0 ]; then
  exit "$skill_frontmatter_status"
fi

if [ "$gh_check_status" -ne 0 ]; then
  exit "$gh_check_status"
fi

if [ "$release_protections_status" -ne 0 ]; then
  exit "$release_protections_status"
fi

if [ "$dockerfile_installs_status" -ne 0 ]; then
  exit "$dockerfile_installs_status"
fi

if [ "$github_scripts_status" -ne 0 ]; then
  exit "$github_scripts_status"
fi

if [ "$my_work_status" -ne 0 ]; then
  exit "$my_work_status"
fi

exit "$pr_triage_status"
