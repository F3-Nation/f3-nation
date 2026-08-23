#!/usr/bin/env bash
# Regression tests for scripts/select-turbo-scope.sh.
# Run directly: bash scripts/select-turbo-scope.test.sh
set -uo pipefail

if [[ -n "${SELECT_TURBO_SCOPE_TEST_ACTIVE:-}" ]]; then
  exit 0
fi
export SELECT_TURBO_SCOPE_TEST_ACTIVE=1

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${script_dir}/.."
scope_script="${script_dir}/select-turbo-scope.sh"
failures=0
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/turbo-scope-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: ${description}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

run_case() {
  local name="$1" turbo_body="$2"
  local scm_base="${3-base-sha}" scm_head="${4-head-sha}"
  local turbo_task="${5-}"
  local changed_files="${6-}" git_status="${7-0}"
  local case_dir="${tmp_dir}/${name}"
  mkdir -p "$case_dir"
  printf '%s\n' '#!/usr/bin/env bash' "$turbo_body" >"${case_dir}/turbo"
  printf '%s\n' \
    '#!/usr/bin/env bash' \
    'printf "%s" "${TURBO_SCOPE_TEST_CHANGED_FILES:-}"' \
    'exit "${TURBO_SCOPE_TEST_GIT_STATUS:-0}"' >"${case_dir}/git"
  chmod +x "${case_dir}/turbo" "${case_dir}/git"
  : >"${case_dir}/github-env"

  PATH="${case_dir}:${PATH}" \
    GITHUB_ENV="${case_dir}/github-env" \
    TURBO_SCM_BASE="$scm_base" \
    TURBO_SCM_HEAD="$scm_head" \
    TURBO_SCOPE_TASK="$turbo_task" \
    TURBO_SCOPE_TURBO_BIN="${case_dir}/turbo" \
    TURBO_SCOPE_TEST_CHANGED_FILES="$changed_files" \
    TURBO_SCOPE_TEST_GIT_STATUS="$git_status" \
    bash "$scope_script" >"${case_dir}/output" 2>&1
  status=$?
}

run_case affected 'if [[ "$1" == "run" ]]; then printf '\''%s\n'\'' '\''{"tasks":[{}]}'\''; else printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''; fi' base-sha head-sha build
assert_eq "affected selection exits successfully" "0" "$status"
assert_eq "affected selection persists base SHA" "TURBO_SCM_BASE=base-sha" "$(grep '^TURBO_SCM_BASE=' "${tmp_dir}/affected/github-env")"
assert_eq "affected selection persists head SHA" "TURBO_SCM_HEAD=head-sha" "$(grep '^TURBO_SCM_HEAD=' "${tmp_dir}/affected/github-env")"
assert_eq "affected selection enables --affected" "TURBO_RUN_ARGS=--affected" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/affected/github-env")"

run_case empty 'printf '\''%s\n'\'' '\''{"packages":{"count":0}}'\'''
assert_eq "empty selection exits successfully" "0" "$status"
assert_eq "empty selection falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/empty/github-env")"
assert_eq "empty selection emits a notice" "1" "$(grep -c '::notice::Turbo selected no affected workspaces' "${tmp_dir}/empty/output")"

run_case failure 'exit 17'
assert_eq "Turbo failure exits successfully" "0" "$status"
assert_eq "Turbo failure falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/failure/github-env")"
assert_eq "Turbo failure emits a warning" "1" "$(grep -c '::warning::Turbo affected-workspace detection failed' "${tmp_dir}/failure/output")"

run_case malformed 'printf '\''%s\n'\'' '\''not-json'\'''
assert_eq "malformed JSON exits successfully" "0" "$status"
assert_eq "malformed JSON falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/malformed/github-env")"
assert_eq "malformed JSON emits a warning" "1" "$(grep -c '::warning::Turbo returned invalid affected-workspace JSON' "${tmp_dir}/malformed/output")"

run_case wrong-shape 'printf '\''%s\n'\'' '\''{"packages":{}}'\'''
assert_eq "wrong-shaped JSON exits successfully" "0" "$status"
assert_eq "wrong-shaped JSON falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/wrong-shape/github-env")"
assert_eq "wrong-shaped JSON emits a warning" "1" "$(grep -c '::warning::Turbo returned invalid affected-workspace JSON' "${tmp_dir}/wrong-shape/output")"

run_case missing-sha 'printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''' '' head-sha
assert_eq "missing SHA exits successfully" "0" "$status"
assert_eq "missing SHA falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/missing-sha/github-env")"
assert_eq "missing SHA emits a warning" "1" "$(grep -c '::warning::Pull-request base/head SHAs were unavailable' "${tmp_dir}/missing-sha/output")"

env -u GITHUB_ENV \
  TURBO_SCM_BASE=base-sha \
  TURBO_SCM_HEAD=head-sha \
  bash "$scope_script" >"${tmp_dir}/missing-github-env-output" 2>&1
assert_eq "missing GITHUB_ENV fails closed" "1" "$?"
assert_eq "missing GITHUB_ENV explains the runner contract" "1" "$(grep -c 'GITHUB_ENV must be set' "${tmp_dir}/missing-github-env-output")"

run_case missing-head-sha 'printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''' base-sha ''
assert_eq "missing head SHA exits successfully" "0" "$status"
assert_eq "missing head SHA falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/missing-head-sha/github-env")"

run_case negative-count 'printf '\''%s\n'\'' '\''{"packages":{"count":-1}}'\'''
assert_eq "negative package count exits successfully" "0" "$status"
assert_eq "negative package count falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/negative-count/github-env")"

run_case missing-task 'printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\'''
assert_eq "missing task exits successfully" "0" "$status"
assert_eq "missing task falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/missing-task/github-env")"
assert_eq "missing task emits a warning" "1" "$(grep -c '::warning::No Turbo task was supplied' "${tmp_dir}/missing-task/output")"

run_case unattributed-python 'if [[ "$1" == "run" ]]; then printf '\''%s\n'\'' '\''{"tasks":[{}]}'\''; else printf '\''%s\n'\'' '\''{"packages":{"count":1}}'\''; fi' base-sha head-sha test $'apps/me/src/env.ts\npackages/db-python/f3_data_models/models.py\n'
assert_eq "mixed Python change exits successfully" "0" "$status"
assert_eq "mixed Python change falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/unattributed-python/github-env")"

run_case global-ignore 'if [[ "$1" == "run" ]]; then printf '\''%s\n'\'' '\''{"tasks":[{}]}'\''; else printf '\''%s\n'\'' '\''{"packages":{"count":1}}'\''; fi' base-sha head-sha format $'.prettierignore\napps/me/src/env.ts\n'
assert_eq "global ignore change exits successfully" "0" "$status"
assert_eq "global ignore change falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/global-ignore/github-env")"

run_case git-failure 'printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''' base-sha head-sha build '' 17
assert_eq "git diff failure exits successfully" "0" "$status"
assert_eq "git diff failure falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/git-failure/github-env")"

run_case task-affected 'if [[ "$1" == "run" ]]; then printf '\''%s\n'\'' '\''{"tasks":[{}]}'\''; else printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''; fi' base-sha head-sha build
assert_eq "nonempty affected task selection exits successfully" "0" "$status"
assert_eq "nonempty affected task selection enables --affected" "TURBO_RUN_ARGS=--affected" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/task-affected/github-env")"

run_case task-empty 'if [[ "$1" == "run" ]]; then printf '\''%s\n'\'' '\''{"tasks":[]}'\''; else printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''; fi' base-sha head-sha build
assert_eq "empty affected task selection exits successfully" "0" "$status"
assert_eq "empty affected task selection falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/task-empty/github-env")"
assert_eq "empty affected task selection emits a notice" "1" "$(grep -c '::notice::Turbo selected no affected build tasks' "${tmp_dir}/task-empty/output")"

run_case task-malformed 'if [[ "$1" == "run" ]]; then printf '\''%s\n'\'' '\''{"tasks":null}'\''; else printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''; fi' base-sha head-sha test
assert_eq "malformed affected task JSON exits successfully" "0" "$status"
assert_eq "malformed affected task JSON falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/task-malformed/github-env")"
assert_eq "malformed affected task JSON emits a warning" "1" "$(grep -c '::warning::Turbo returned invalid affected-task JSON' "${tmp_dir}/task-malformed/output")"

run_case task-failure 'if [[ "$1" == "run" ]]; then exit 7; fi; printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''' base-sha head-sha build
assert_eq "affected task failure exits successfully" "0" "$status"
assert_eq "affected task failure falls back to full" "TURBO_RUN_ARGS=" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/task-failure/github-env")"
assert_eq "affected task failure emits a warning" "1" "$(grep -c '::warning::Turbo affected-task detection failed' "${tmp_dir}/task-failure/output")"

run_case task-large 'if [[ "$1" == "run" ]]; then printf '\''{"tasks":[{"padding":"'\''; head -c 140000 /dev/zero | tr '\''\0'\'' x; printf '\''"}]}\n'\''; else printf '\''%s\n'\'' '\''{"packages":{"count":2}}'\''; fi' base-sha head-sha build
assert_eq "large affected task JSON exits successfully" "0" "$status"
assert_eq "large affected task JSON enables --affected" "TURBO_RUN_ARGS=--affected" "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/task-large/github-env")"

# Exercise the real lint wrapper with command stubs so its shell indirection
# cannot silently drop --affected before invoking Turbo.
lint_case_dir="${tmp_dir}/lint-wrapper"
mkdir -p "$lint_case_dir"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\n" "$*" > "$LINT_TURBO_ARGS"' >"${lint_case_dir}/turbo"
for command_name in pnpm node; do
  printf '%s\n' '#!/usr/bin/env bash' 'exit 0' >"${lint_case_dir}/${command_name}"
done
chmod +x "${lint_case_dir}/turbo" "${lint_case_dir}/pnpm" "${lint_case_dir}/node"
(
  cd "$repo_root" &&
    PATH="${lint_case_dir}:${PATH}" \
      LINT_TURBO_ARGS="${lint_case_dir}/turbo-args" \
      "$BASH" scripts/lint.sh --affected --dry-run=json
)
assert_eq \
  "lint wrapper forwards --affected to Turbo" \
  "run lint --affected --dry-run=json --continue -- --cache --cache-location node_modules/.cache/.eslintcache" \
  "$(cat "${lint_case_dir}/turbo-args")"

printf '%s\n' '#!/usr/bin/env bash' 'exit 23' >"${lint_case_dir}/turbo"
(
  cd "$repo_root" &&
    PATH="${lint_case_dir}:${PATH}" \
      LINT_TURBO_ARGS="${lint_case_dir}/turbo-args" \
      "$BASH" scripts/lint.sh --affected
)
assert_eq "lint wrapper propagates Turbo failure" "23" "$?"

SELECT_TURBO_SCOPE_TEST_ACTIVE=1 "$BASH" "$0"
assert_eq "scope regression suite exits immediately on re-entry" "0" "$?"

# Exercise the installed Turbo binary so an upgrade that adds non-JSON stdout
# cannot silently force every PR onto the full-workspace fallback.
real_turbo="${script_dir}/../node_modules/.bin/turbo"
if [[ -x "$real_turbo" ]]; then
  real_head="$(git -C "$repo_root" rev-parse HEAD)"
  real_json="$(
    TURBO_SCM_BASE="$real_head" \
      TURBO_SCM_HEAD="$real_head" \
      "$real_turbo" ls --affected --output=json
  )"
  node -e 'const value = JSON.parse(process.argv[1]); if (!Number.isInteger(value?.packages?.count)) process.exit(1);' "$real_json"
  assert_eq "real Turbo affected output remains parseable JSON" "0" "$?"

  # Build a minimal temporary monorepo with a genuine root-only commit so a
  # Turbo upgrade that changes root-file attribution cannot disable the full
  # workspace fallback unnoticed.
  root_only_repo="${tmp_dir}/root-only-repo"
  mkdir -p "${root_only_repo}/packages/example" "${root_only_repo}/.github"
  printf '%s\n' '{"name":"root-only-fixture","private":true,"packageManager":"pnpm@11.21.0"}' >"${root_only_repo}/package.json"
  printf '%s\n' 'packages:' '  - packages/*' >"${root_only_repo}/pnpm-workspace.yaml"
  printf '%s\n' "lockfileVersion: '9.0'" '' 'settings:' '  autoInstallPeers: true' '  excludeLinksFromLockfile: false' '' 'importers:' '' '  .: {}' '' '  packages/example: {}' >"${root_only_repo}/pnpm-lock.yaml"
  printf '%s\n' '{"tasks":{}}' >"${root_only_repo}/turbo.json"
  printf '%s\n' '{"name":"example","version":"1.0.0"}' >"${root_only_repo}/packages/example/package.json"
  if ! root_only_json="$(
    cd "$root_only_repo" &&
      export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null &&
      git init --quiet --initial-branch=main &&
      git config user.email test@example.com &&
      git config user.name "Turbo scope test" &&
      git add . &&
      git -c commit.gpgsign=false -c core.hooksPath=/dev/null commit --quiet -m initial &&
      root_base="$(git rev-parse HEAD)" &&
      printf '%s\n' 'name: fixture' >.github/root-only.yml &&
      git add .github/root-only.yml &&
      git -c commit.gpgsign=false -c core.hooksPath=/dev/null commit --quiet -m root-only &&
      root_head="$(git rev-parse HEAD)" &&
      TURBO_SCM_BASE="$root_base" \
        TURBO_SCM_HEAD="$root_head" \
        "$real_turbo" ls --affected --output=json
  )"; then
    echo "FAIL: could not build the root-only fixture repo"
    failures=$((failures + 1))
  else
    root_only_count="$(
      node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(String(value?.packages?.count));' "$root_only_json"
    )"
    assert_eq "real Turbo maps a root-only CI change to zero workspaces" "0" "$root_only_count"
  fi

  # Exercise pnpm's argument forwarding through a real root task without
  # running that task. This catches wrapper changes that drop --affected.
  pnpm_json="$(
    cd "$repo_root" &&
      TURBO_SCM_BASE="$real_head" \
        TURBO_SCM_HEAD="$real_head" \
        pnpm --silent format --affected --dry-run=json
  )"
  node -e 'const value = JSON.parse(process.argv[1]); if (!Array.isArray(value?.tasks)) process.exit(1);' "$pnpm_json"
  assert_eq "pnpm forwards --affected to a root Turbo task" "0" "$?"
elif [[ -n "${CI:-}" ]]; then
  echo "FAIL: real Turbo checks require installed dependencies in CI"
  failures=$((failures + 1))
else
  echo "SKIP: real Turbo output check (dependencies are not installed)"
fi

if ((failures > 0)); then
  echo "${failures} test(s) failed."
  exit 1
fi

echo "All select-turbo-scope.sh regression tests passed."
