#!/usr/bin/env bash
# Regression tests for scripts/select-turbo-scope.sh: the full-workspace
# fallback for every detection failure (missing SHAs, missing task, a failing
# Turbo dry run, malformed JSON, an empty or non-runnable task plan), and exact
# SHA/task passthrough on success. It also exercises the repository's real
# Turbo graph for Python-only lint and build changes.
# Run directly: bash scripts/select-turbo-scope.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${script_dir}/.."
scope_script="${script_dir}/select-turbo-scope.sh"
failures=0

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

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/select-turbo-scope-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

# A fake turbo binary that records its own argv (so tests can assert on
# forwarded task names) and produces BEHAVIOR-controlled dry-run output,
# so tests never invoke the real monorepo build graph.
stub_turbo() {
  local behavior="$1"
  local stub="$tmp_dir/turbo-$behavior"
  {
    echo '#!/usr/bin/env bash'
    echo "echo \"\$@\" >'$tmp_dir/turbo.args'"
    case "$behavior" in
    fail) echo 'exit 1' ;;
    malformed) echo 'echo "not json"' ;;
    empty) echo 'echo "{\"tasks\":[]}"' ;;
    nonexistent) echo 'echo "{\"tasks\":[{\"taskId\":\"f3-data-models#build\",\"command\":\"<NONEXISTENT>\"},{\"taskId\":\"f3-slackbot#build\",\"command\":\"<NONEXISTENT>\"}]}"' ;;
    affected) echo 'echo "{\"tasks\":[{\"taskId\":\"f3-data-models#lint\",\"command\":\"<NONEXISTENT>\"},{\"taskId\":\"f3-slackbot#lint\",\"command\":\"ruff check .\"}]}"' ;;
    esac
  } >"$stub"
  chmod +x "$stub"
  echo "$stub"
}

# run_scope BASE HEAD TASK TURBO_BIN
run_scope() {
  local github_env="$tmp_dir/github_env"
  rm -f "$tmp_dir/turbo.args"
  : >"$github_env"
  GITHUB_ENV="$github_env" \
    TURBO_SCM_BASE="$1" \
    TURBO_SCM_HEAD="$2" \
    TURBO_SCOPE_TASK="$3" \
    TURBO_SCOPE_TURBO_BIN="$4" \
    bash "$scope_script" >"$tmp_dir/stdout" 2>"$tmp_dir/stderr"
}

affected_turbo="$(stub_turbo affected)"

run_scope "" "head-sha" "lint" "$affected_turbo"
status=$?
assert_eq "missing base SHA exits 0" "0" "$status"
assert_eq "missing base SHA falls back to full workspace" "TURBO_RUN_ARGS=" "$(cat "$tmp_dir/github_env")"
assert_eq "missing base SHA never invokes turbo" "0" "$([[ -e "$tmp_dir/turbo.args" ]] && echo 1 || echo 0)"

run_scope "base-sha" "" "lint" "$affected_turbo"
assert_eq "missing head SHA falls back to full workspace" "TURBO_RUN_ARGS=" "$(cat "$tmp_dir/github_env")"
assert_eq "missing head SHA never invokes turbo" "0" "$([[ -e "$tmp_dir/turbo.args" ]] && echo 1 || echo 0)"

run_scope "base-sha" "head-sha" "" "$affected_turbo"
assert_eq "missing task name falls back after pinning SHAs" \
  "$(printf 'TURBO_SCM_BASE=base-sha\nTURBO_SCM_HEAD=head-sha\nTURBO_RUN_ARGS=')" \
  "$(cat "$tmp_dir/github_env")"
assert_eq "missing task name never invokes turbo" "0" "$([[ -e "$tmp_dir/turbo.args" ]] && echo 1 || echo 0)"

run_scope "base-sha" "head-sha" "lint" "$(stub_turbo fail)"
assert_eq "failing Turbo dry run falls back to full workspace" \
  "$(printf 'TURBO_SCM_BASE=base-sha\nTURBO_SCM_HEAD=head-sha\nTURBO_RUN_ARGS=')" \
  "$(cat "$tmp_dir/github_env")"

run_scope "base-sha" "head-sha" "lint" "$(stub_turbo malformed)"
assert_eq "malformed task-plan JSON falls back to full workspace" \
  "$(printf 'TURBO_SCM_BASE=base-sha\nTURBO_SCM_HEAD=head-sha\nTURBO_RUN_ARGS=')" \
  "$(cat "$tmp_dir/github_env")"

run_scope "base-sha" "head-sha" "lint" "$(stub_turbo empty)"
assert_eq "empty task plan falls back to full workspace" \
  "$(printf 'TURBO_SCM_BASE=base-sha\nTURBO_SCM_HEAD=head-sha\nTURBO_RUN_ARGS=')" \
  "$(cat "$tmp_dir/github_env")"

run_scope "base-sha" "head-sha" "build" "$(stub_turbo nonexistent)"
assert_eq "non-runnable task plan falls back to full workspace" \
  "$(printf 'TURBO_SCM_BASE=base-sha\nTURBO_SCM_HEAD=head-sha\nTURBO_RUN_ARGS=')" \
  "$(cat "$tmp_dir/github_env")"

run_scope "base-sha" "head-sha" "lint" "$affected_turbo"
status=$?
assert_eq "nonempty task plan exits 0" "0" "$status"
assert_eq "nonempty task plan preserves exact base/head SHAs and enables --affected" \
  "$(printf 'TURBO_SCM_BASE=base-sha\nTURBO_SCM_HEAD=head-sha\nTURBO_RUN_ARGS=--affected')" \
  "$(cat "$tmp_dir/github_env")"
assert_eq "task name is forwarded to the Turbo dry run" \
  "run lint --affected --dry-run=json" "$(cat "$tmp_dir/turbo.args")"
assert_eq "only runnable tasks are counted" \
  "Selected 1 runnable affected lint task(s)." "$(cat "$tmp_dir/stdout")"

# Exercise the installed Turbo binary against the repository's actual package
# graph. A Python-only change must select the Slackbot's runnable lint task, but
# its build plan contains only Turbo's <NONEXISTENT> placeholders and must fall
# back to the full workspace. The shared clone is ephemeral and keeps this
# repository-sized fixture cheap; the tmp_dir trap removes it before cleanup.
real_turbo="${SELECT_TURBO_SCOPE_REAL_TURBO_BIN:-${repo_root}/node_modules/.bin/turbo}"
if [[ -x "$real_turbo" ]]; then
  integration_repo="${tmp_dir}/integration-repo"
  git clone --quiet --shared "$repo_root" "$integration_repo"
  printf '\n# affected-selection integration fixture\n' \
    >>"${integration_repo}/packages/db-python/f3_data_models/utils.py"
  git -C "$integration_repo" add packages/db-python/f3_data_models/utils.py
  git -C "$integration_repo" \
    -c user.email=test@example.com \
    -c user.name="Turbo scope test" \
    -c commit.gpgsign=false \
    -c core.hooksPath=/dev/null \
    commit --quiet -m "test: Python-only affected fixture"
  integration_base="$(git -C "$integration_repo" rev-parse HEAD^)"
  integration_head="$(git -C "$integration_repo" rev-parse HEAD)"

  (
    cd "$integration_repo" || exit 1
    GITHUB_ENV="${tmp_dir}/real-github-env" \
      TURBO_SCM_BASE="$integration_base" \
      TURBO_SCM_HEAD="$integration_head" \
      TURBO_SCOPE_TASK=lint \
      TURBO_SCOPE_TURBO_BIN="$real_turbo" \
      bash "$scope_script" >"${tmp_dir}/real-lint-output" 2>&1
  )
  assert_eq "real Turbo selects runnable Slackbot lint for a Python-only change" \
    "TURBO_RUN_ARGS=--affected" \
    "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/real-github-env")"

  : >"${tmp_dir}/real-github-env"
  (
    cd "$integration_repo" || exit 1
    GITHUB_ENV="${tmp_dir}/real-github-env" \
      TURBO_SCM_BASE="$integration_base" \
      TURBO_SCM_HEAD="$integration_head" \
      TURBO_SCOPE_TASK=build \
      TURBO_SCOPE_TURBO_BIN="$real_turbo" \
      bash "$scope_script" >"${tmp_dir}/real-build-output" 2>&1
  )
  assert_eq "real Turbo falls back when Python-only build tasks are non-runnable" \
    "TURBO_RUN_ARGS=" \
    "$(grep '^TURBO_RUN_ARGS=' "${tmp_dir}/real-github-env")"
elif [[ -n "${CI:-}" ]]; then
  echo "FAIL: real Turbo integration checks require installed dependencies in CI"
  failures=$((failures + 1))
else
  echo "SKIP: real Turbo integration checks (dependencies are not installed)"
fi

if ((failures > 0)); then
  echo "${failures} test(s) failed."
  exit 1
fi

echo "All select-turbo-scope.sh regression tests passed."
