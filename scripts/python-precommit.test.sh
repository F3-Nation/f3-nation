#!/usr/bin/env bash
# Exercise the real Python Lefthook job through isolated Git commits. Only the
# python job is copied into each fixture, so the repository-wide typecheck job
# cannot run there or be mistaken for the Python-only file filter under test.
# Run directly: bash scripts/python-precommit.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
lefthook_bin="${repo_root}/node_modules/.bin/lefthook"
git_bin="$(command -v git)"
node_bin="$(command -v node)"
uv_bin="$(command -v uv || true)"
failures=0
ruff_cases_skipped=0

if [[ ! -x "$lefthook_bin" || -z "$git_bin" || -z "$node_bin" ]]; then
  echo "ERROR: Python hook regression tests require pnpm install, Git, and Node."
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/python-precommit-test.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/with-uv" "$tmp_dir/without-uv"
for tools_dir in "$tmp_dir/with-uv" "$tmp_dir/without-uv"; do
  ln -s "$BASH" "$tools_dir/bash"
  ln -s "$node_bin" "$tools_dir/node"
  ln -s "$lefthook_bin" "$tools_dir/lefthook"
  # Whitelist runtime utilities rather than retaining system PATH directories:
  # uv may itself be installed in /usr/bin or /bin on another contributor's OS.
  for utility in git sh dirname sed uname readlink cat grep awk head tr cut sort find xargs which; do
    utility_bin="$(command -v "$utility")"
    ln -s "$utility_bin" "$tools_dir/$utility"
  done
done
if [[ -n "$uv_bin" ]]; then
  ln -s "$uv_bin" "$tmp_dir/with-uv/uv"
fi
with_uv_path="$tmp_dir/with-uv"
without_uv_path="$tmp_dir/without-uv"

# Preserve hook-level settings and the exact job's glob, command and stage_fixed
# setting. Other jobs would require the whole application in each fixture and
# obscure whether this job alone skips TypeScript changes.
awk '
  /^pre-commit:/ { in_hook = 1; print; next }
  in_hook && /^[^[:space:]]/ { in_hook = 0 }
  in_hook && /^    - name:/ { seen_job = 1; selected = ($0 == "    - name: python") }
  in_hook && (!seen_job || selected) { print }
' "$repo_root/lefthook.yml" >"$tmp_dir/lefthook.yml"
if ! grep -q '^    - name: python$' "$tmp_dir/lefthook.yml"; then
  # Without a python job the fixture hook must still run, so the suite fails on
  # its assertions rather than erroring during fixture setup.
  printf '    - name: fixture-without-python-job\n      run: "true"\n' >>"$tmp_dir/lefthook.yml"
fi

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: ${description}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    if [[ -f "${fixture_repo:-}/commit.log" ]]; then
      cat "$fixture_repo/commit.log"
    fi
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

fixture_git() {
  env -i HOME="$HOME" TMPDIR="$tmp_dir" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    PATH="${fixture_path:-$with_uv_path}" CI= LEFTHOOK=1 NO_COLOR=1 \
    UV_PROJECT_ENVIRONMENT="$repo_root/.venv" UV_NO_SYNC=1 UV_OFFLINE=1 \
    UV_PYTHON_DOWNLOADS=never \
    "$git_bin" -C "$fixture_repo" "$@"
}

new_fixture() {
  fixture_repo="$tmp_dir/$1"
  fixture_path="$with_uv_path"
  mkdir -p "$fixture_repo/scripts"
  cp "$tmp_dir/lefthook.yml" "$fixture_repo/lefthook.yml"
  cp "$script_dir/python-task.sh" "$fixture_repo/scripts/python-task.sh"
  if [[ -f "$script_dir/python-precommit.sh" ]]; then
    cp "$script_dir/python-precommit.sh" "$fixture_repo/scripts/python-precommit.sh"
  fi
  cat >"$fixture_repo/pyproject.toml" <<'EOF'
[project]
name = "python-hook-fixture"
version = "0.0.0"
requires-python = ">=3.13,<3.14"

[tool.ruff.lint]
select = ["F", "I"]
EOF
  printf 'staged = 1\n\n\nunstaged = 1\n' >"$fixture_repo/partial.py"
  printf 'original\n' >"$fixture_repo/unrelated.txt"
  fixture_git init --quiet || exit 1
  fixture_git config user.name "Python hook test" || exit 1
  fixture_git config user.email "hook-test@example.invalid" || exit 1
  fixture_git config commit.gpgsign false || exit 1
  fixture_git add . || exit 1
  fixture_git commit --quiet -m 'test(repo): initialize isolated fixture' || exit 1
  (
    cd "$fixture_repo" || exit 1
    env -i HOME="$HOME" TMPDIR="$tmp_dir" PATH="$with_uv_path" \
      GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      "$lefthook_bin" install
  ) >"$fixture_repo/install.log" 2>&1 || {
    cat "$fixture_repo/install.log"
    exit 1
  }
}

commit_fixture() {
  fixture_git commit --quiet -m 'test(repo): exercise Python hook' >"$fixture_repo/commit.log" 2>&1
  commit_status=$?
}

# A genuinely uv-free PATH must work even on machines where uv is installed.
assert_eq "missing-uv test PATH cannot resolve uv" "1" \
  "$(env -i PATH="$without_uv_path" "$BASH" -c 'command -v uv >/dev/null 2>&1'; echo "$?")"
new_fixture no-uv
printf 'answer=42\n' >"$fixture_repo/example.py"
fixture_git add example.py || exit 1
fixture_path="$without_uv_path"
commit_fixture
assert_eq "local Python commit succeeds without uv" "0" "$commit_status"
assert_eq "missing uv emits an explicit Python hook skip" "1" \
  "$(grep -c 'Skipping pre-commit for python:' "$fixture_repo/commit.log")"
assert_eq "skipped Python content is unchanged" "answer=42" \
  "$(fixture_git show HEAD:example.py)"

# Empty selections must return before Ruff can scan or rewrite the repository.
mkdir -p "$tmp_dir/recording-uv"
cat >"$tmp_dir/recording-uv/uv" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$UV_RECORDING_LOG"
EOF
chmod +x "$tmp_dir/recording-uv/uv"
: >"$tmp_dir/uv-calls.log"
env -i PATH="$tmp_dir/recording-uv:$without_uv_path" \
  UV_RECORDING_LOG="$tmp_dir/uv-calls.log" \
  "$BASH" "$script_dir/python-precommit.sh"
empty_status=$?
assert_eq "empty Python selection succeeds" "0" "$empty_status"
assert_eq "empty Python selection never invokes uv" "" "$(cat "$tmp_dir/uv-calls.log")"

if [[ -z "$uv_bin" || ! -x "$repo_root/.venv/bin/ruff" ]]; then
  if [[ -n "${CI:-}" ]]; then
    echo "ERROR: CI requires uv and Ruff for the real Python hook commit cases."
    exit 1
  fi
  ruff_cases_skipped=1
  echo "Skipping real Ruff commit cases: run pnpm python:install first."
else
  new_fixture formatting
  printf 'answer=42\n' >"$fixture_repo/example.py"
  fixture_git add example.py || exit 1
  commit_fixture
  assert_eq "unformatted Python commit succeeds" "0" "$commit_status"
  assert_eq "Ruff formatting is included in the commit" "answer = 42" \
    "$(fixture_git show HEAD:example.py)"
  assert_eq "formatted file is restaged without a leftover diff" "" \
    "$(fixture_git status --porcelain -- example.py)"

  new_fixture fixable-lint
  printf 'import os\n\nanswer=42\n' >"$fixture_repo/example.py"
  fixture_git add example.py || exit 1
  commit_fixture
  assert_eq "fixable Python lint commit succeeds" "0" "$commit_status"
  assert_eq "lint autofix and formatting are both committed" "answer = 42" \
    "$(fixture_git show HEAD:example.py)"

  new_fixture formatter-fixable-lint
  mkdir -p "$fixture_repo/apps/narrow"
  printf '[tool.ruff]\nline-length = 40\n\n[tool.ruff.lint]\nselect = ["E501"]\n' \
    >"$fixture_repo/apps/narrow/pyproject.toml"
  printf 'answer = max(first_value, second_value, third)\n' >"$fixture_repo/apps/narrow/example.py"
  fixture_git add apps || exit 1
  commit_fixture
  assert_eq "a long line the formatter wraps does not block the commit" "0" "$commit_status"
  assert_eq "wrapped line is committed" \
    "$(printf 'answer = max(\n    first_value, second_value, third\n)')" \
    "$(fixture_git show HEAD:apps/narrow/example.py)"

  new_fixture blocking-lint
  before_head="$(fixture_git rev-parse HEAD)"
  printf 'answer = undefined_name\n' >"$fixture_repo/example.py"
  fixture_git add example.py || exit 1
  commit_fixture
  assert_eq "unfixable Python lint blocks the commit" "blocked" \
    "$(if [[ "$commit_status" -ne 0 ]]; then echo blocked; else echo committed; fi)"
  assert_eq "failed lint leaves HEAD unchanged" "$before_head" "$(fixture_git rev-parse HEAD)"
  assert_eq "blocked commit reports the Ruff diagnostic" "1" \
    "$(grep -c 'F821' "$fixture_repo/commit.log")"
  assert_eq "blocked Python remains staged for correction" "A  example.py" \
    "$(fixture_git status --porcelain -- example.py)"

  new_fixture typescript-only
  # An unstaged invalid Python file is a tripwire for an accidental whole-tree
  # lint; the actual job must not launch for this TypeScript-only commit.
  printf 'answer = undefined_name\n' >"$fixture_repo/unstaged.py"
  printf 'export const answer = 42;\n' >"$fixture_repo/example.ts"
  fixture_git add example.ts || exit 1
  commit_fixture
  assert_eq "TypeScript-only commit skips the Python job" "0" "$commit_status"
  assert_eq "Lefthook reports the Python job as skipped" "1" \
    "$(grep -Ec 'python.*skip' "$fixture_repo/commit.log")"
  assert_eq "TypeScript-only commit has no Ruff output" "0" \
    "$(grep -Ec 'All checks passed|reformatted|left unchanged|F821' "$fixture_repo/commit.log")"
  assert_eq "unstaged Python file stays outside the commit" "?? unstaged.py" \
    "$(fixture_git status --porcelain -- unstaged.py)"

  new_fixture deletion-only
  printf 'answer = undefined_name\n' >"$fixture_repo/unstaged.py"
  fixture_git rm --quiet partial.py || exit 1
  commit_fixture
  assert_eq "Python deletion-only commit succeeds" "0" "$commit_status"
  assert_eq "Python deletion-only commit skips the Python job" "1" \
    "$(grep -Ec 'python.*skip' "$fixture_repo/commit.log")"
  assert_eq "deleted Python file stays deleted" "" \
    "$(fixture_git ls-tree --name-only HEAD -- partial.py)"
  assert_eq "deletion-only commit has no Ruff output" "0" \
    "$(grep -Ec 'All checks passed|reformatted|left unchanged|F821' "$fixture_repo/commit.log")"

  new_fixture spaced-path
  mkdir -p "$fixture_repo/directory with spaces"
  printf 'answer=42\n' >"$fixture_repo/directory with spaces/example file.py"
  fixture_git add 'directory with spaces/example file.py' || exit 1
  commit_fixture
  assert_eq "Python paths containing spaces commit successfully" "0" "$commit_status"
  assert_eq "spaced Python path is formatted and restaged" "answer = 42" \
    "$(fixture_git show 'HEAD:directory with spaces/example file.py')"

  new_fixture workspace-config
  mkdir -p "$fixture_repo/apps/strict" "$fixture_repo/apps/lenient"
  printf '[tool.ruff.lint]\nselect = ["F"]\n' >"$fixture_repo/apps/strict/pyproject.toml"
  printf '[tool.ruff.lint]\nselect = ["F"]\nignore = ["F821"]\n' \
    >"$fixture_repo/apps/lenient/pyproject.toml"
  printf 'import os\n\nanswer=42\n' >"$fixture_repo/apps/strict/example.py"
  printf 'answer=undefined_name\n' >"$fixture_repo/apps/lenient/example.py"
  fixture_git add apps || exit 1
  commit_fixture
  assert_eq "mixed workspaces use their nearest Ruff configurations" "0" "$commit_status"
  assert_eq "strict workspace receives its lint fix" "answer = 42" \
    "$(fixture_git show HEAD:apps/strict/example.py)"
  assert_eq "lenient workspace preserves its local lint exception" "answer = undefined_name" \
    "$(fixture_git show HEAD:apps/lenient/example.py)"

  new_fixture partial-staging
  printf 'staged=2\n\n\nunstaged = 1\n' >"$fixture_repo/partial.py"
  printf 'staged unrelated\n' >"$fixture_repo/staged-unrelated.txt"
  fixture_git add partial.py staged-unrelated.txt || exit 1
  printf 'staged=2\n\n\nunstaged = 2\n' >"$fixture_repo/partial.py"
  printf 'unstaged unrelated\n' >"$fixture_repo/unrelated.txt"
  commit_fixture
  assert_eq "partially staged Python commit succeeds" "0" "$commit_status"
  assert_eq "commit formats only the staged Python content" \
    "$(printf 'staged = 2\n\n\nunstaged = 1')" "$(fixture_git show HEAD:partial.py)"
  assert_eq "unstaged Python edit is restored in the working tree" \
    "$(printf 'staged = 2\n\n\nunstaged = 2')" "$(cat "$fixture_repo/partial.py")"
  assert_eq "unrelated staged content is preserved" "staged unrelated" \
    "$(fixture_git show HEAD:staged-unrelated.txt)"
  assert_eq "unrelated unstaged content is preserved" "unstaged unrelated" \
    "$(cat "$fixture_repo/unrelated.txt")"
  assert_eq "unrelated unstaged file is not added to the commit" "original" \
    "$(fixture_git show HEAD:unrelated.txt)"
fi

if ((failures > 0)); then
  echo "${failures} Python hook regression assertion(s) failed."
  exit 1
fi

if ((ruff_cases_skipped)); then
  echo "Python pre-commit checks passed; real Ruff cases were skipped."
else
  echo "All Python pre-commit regression tests passed."
fi
