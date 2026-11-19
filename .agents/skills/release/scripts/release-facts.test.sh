#!/usr/bin/env bash
# Regression tests for release-facts.sh, run against a throwaway git repo and a
# fake `gh` that answers from fixtures and logs every call, so the tests can
# assert the script never writes to GitHub.
# Run directly: bash .agents/skills/release/scripts/release-facts.test.sh
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "FAIL: release-facts tests need jq, which CI must provide"
    exit 1
  fi
  echo "SKIP: release-facts tests need jq, which isn't installed"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
facts="${script_dir}/release-facts.sh"
failures=0

assert_eq() {
  local description="$1" expected="$2" actual="$3"
  if [ "$expected" != "$actual" ]; then
    echo "FAIL: ${description}"
    echo "  expected: ${expected}"
    echo "  actual:   ${actual}"
    failures=$((failures + 1))
  else
    echo "PASS: ${description}"
  fi
}

tmp_dir=""
trap 'if [ -n "$tmp_dir" ]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/release-facts-test.XXXXXX")" || exit 1
mkdir "$tmp_dir/bin" "$tmp_dir/fake" || exit 1
export FAKE_DIR="$tmp_dir/fake"
export CALL_LOG="$tmp_dir/calls.log"

# Fake gh: answers reads from $FAKE_DIR and logs every call.
cat >"$tmp_dir/bin/gh" <<'GH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$CALL_LOG"
case "$1 $2" in
  "repo view") echo '{"nameWithOwner":"Org/repo"}' ;;
  "pr list") cat "$FAKE_DIR/pr-list.json" ;;
  "pr view")
    [ -f "$FAKE_DIR/pr-$3.json" ] || exit 1
    cat "$FAKE_DIR/pr-$3.json"
    ;;
  "run list")
    case "$*" in
      *deploy-homepage.yml*) cat "$FAKE_DIR/homepage-runs.json" ;;
      *"--status in_progress"*) cat "$FAKE_DIR/in-progress-runs.json" ;;
      *)
        [ -z "${FAIL_WAITING:-}" ] || exit 1
        cat "$FAKE_DIR/waiting-runs.json"
        ;;
    esac
    ;;
  api\ *)
    path="$2"
    case "$path" in
      */pulls)
        [ -z "${FAIL_PULLS:-}" ] || exit 1
        sha="${path%/pulls}"
        sha="${sha##*/}"
        if [ -f "$FAKE_DIR/pulls-$sha.json" ]; then cat "$FAKE_DIR/pulls-$sha.json"; else echo '[{"merged_at":"2026-01-01T00:00:00Z"}]'; fi
        ;;
      */pending_deployments)
        run="${path%/pending_deployments}"
        run="${run##*/}"
        cat "$FAKE_DIR/pending-$run.json"
        ;;
      *) exit 1 ;;
    esac
    ;;
  *) exit 1 ;;
esac
GH
chmod +x "$tmp_dir/bin/gh"

# Wraps the real git so a test can make one of the script's list commands fail.
real_git="$(command -v git)"
cat >"$tmp_dir/bin/git" <<GIT
#!/usr/bin/env bash
if [ -n "\${FAIL_GIT_MIGRATIONS:-}" ] && [ "\$1 \$3" = "diff --diff-filter=A" ]; then exit 1; fi
if [ -n "\${FAIL_GIT_REV_LIST:-}" ] && [ "\$1" = rev-list ]; then exit 1; fi
exec "$real_git" "\$@"
GIT
chmod +x "$tmp_dir/bin/git"
export PATH="$tmp_dir/bin:$PATH"

# A repo with two releases: the first, then a feature, an advisory merge (two
# parents, like GitHub's), a commit whose PR was closed unmerged, migrations,
# and the second release. Only the apps have deploy workflows.
git init -q --bare "$tmp_dir/origin.git"
git init -q -b main "$tmp_dir/work"
cd "$tmp_dir/work" || exit 1
git config user.email t@example.com
git config user.name tester
git config commit.gpgsign false
git remote add origin "$tmp_dir/origin.git"
commit() {
  git add -A && git commit -q -m "$1" && git rev-parse HEAD
}
echo one >README.md
mkdir -p .github/workflows
for app in api homepage me slackbot; do echo "name: Deploy $app" >".github/workflows/deploy-$app.yml"; done
echo 'name: CI' >.github/workflows/ci.yml
first_release="$(commit "chore: release main (#1)")"
mkdir -p apps/api packages/db/drizzle
echo 'X=1' >apps/api/.env.example
feature="$(commit "feat(api): add a setting (#2)")"
git switch -q -c fork
echo 'fixed' >apps/api/handler.ts
commit "fix(api): guard input" >/dev/null
git switch -q main
git merge -q --no-ff -m "Merge commit from fork" fork
advisory="$(git rev-parse HEAD)"
git branch -q -D fork
echo 'closed' >apps/api/other.ts
closed_pr="$(commit "fix(api): tidy (#5)")"
echo 'CREATE TABLE things (id int);' >packages/db/drizzle/0001_things.sql
echo 'UPDATE things SET id = 1;' >packages/db/drizzle/0002_backfill.sql
# Larger than a pipe buffer, with the match on its first line.
{
  echo 'CREATE TABLE big (id int);'
  printf -- '-- %s\n' "$(head -c 1100000 /dev/zero | tr '\0' x)"
} >packages/db/drizzle/0003_big.sql
commit "feat(db): add things (#3)" >/dev/null
echo two >README.md
release="$(commit "chore: release main (#4)")"
git tag api@1.0.0 "$release"
git tag homepage@1.0.0 "$release"
git tag me@1.0.0 "$release"
git tag pkg-db@1.0.0 "$release"
git tag slackbot@1.0.0 "$release"
git tag tailwind-config@1.0.0 "$release"
git tag api@0.9.0 "$first_release"
git push -q origin main --tags

echo '[]' >"$FAKE_DIR/pulls-$advisory.json"
echo '[{"merged_at":null}]' >"$FAKE_DIR/pulls-$closed_pr.json"
cat >"$FAKE_DIR/pr-list.json" <<JSON
[{"number":1,"mergedAt":"2026-01-01T00:00:00Z"},{"number":4,"mergedAt":"2026-02-01T00:00:00Z"}]
JSON
cat >"$FAKE_DIR/pr-4.json" <<JSON
{"number":4,"title":"chore: release main","state":"MERGED","mergedAt":"2026-02-01T00:00:00Z",
 "mergeCommit":{"oid":"$release"},
 "body":"<details><summary>api: 1.0.0</summary>x</details>\n<details><summary>homepage: 1.0.0</summary>y</details>"}
JSON
cat >"$FAKE_DIR/pr-1.json" <<JSON
{"number":1,"title":"chore: release main","state":"MERGED","mergedAt":"2026-01-01T00:00:00Z",
 "mergeCommit":{"oid":"$first_release"},"body":""}
JSON
cat >"$FAKE_DIR/pr-6.json" <<JSON
{"number":6,"title":"chore: release main","state":"OPEN","mergedAt":null,"mergeCommit":null,"body":""}
JSON
cat >"$FAKE_DIR/pr-7.json" <<JSON
{"number":7,"title":"feat(api): not a release","state":"MERGED","mergedAt":"2026-01-05T00:00:00Z",
 "mergeCommit":{"oid":"$feature"},"body":""}
JSON
cat >"$FAKE_DIR/pr-8.json" <<JSON
{"number":8,"title":"chore: release main","state":"MERGED","mergedAt":"2026-03-01T00:00:00Z",
 "mergeCommit":{"oid":"0000000000000000000000000000000000000000"},"body":""}
JSON
cat >"$FAKE_DIR/pr-9.json" <<JSON
{"number":9,"title":"chore: release main","state":"MERGED","mergedAt":"2026-02-02T00:00:00Z",
 "mergeCommit":{"oid":"$closed_pr"},"body":"<details><summary>api: 1.0.1</summary>x</details>"}
JSON
cat >"$FAKE_DIR/waiting-runs.json" <<JSON
[{"databaseId":11,"workflowName":"Deploy API","headBranch":"api@1.0.0"},
 {"databaseId":12,"workflowName":"Deploy API","headBranch":"api@0.9.0"}]
JSON
# Slackbot's run is in_progress while one of its two deploy jobs waits; Me's
# is still deploying to Staging, with nothing waiting yet.
cat >"$FAKE_DIR/in-progress-runs.json" <<JSON
[{"databaseId":13,"workflowName":"Deploy Slackbot","headBranch":"slackbot@1.0.0"},
 {"databaseId":14,"workflowName":"Deploy Me","headBranch":"me@1.0.0"}]
JSON
echo '[{"environment":{"name":"api-production"}}]' >"$FAKE_DIR/pending-11.json"
echo '[{"environment":{"name":"slackbot-production"}}]' >"$FAKE_DIR/pending-13.json"
echo '[]' >"$FAKE_DIR/pending-14.json"
echo '[{"status":"completed","conclusion":"success"}]' >"$FAKE_DIR/homepage-runs.json"

run_facts() {
  : >"$CALL_LOG"
  out="$(GH_REPO=Org/repo bash "$facts" "$@" 2>"$tmp_dir/err")"
  status=$?
}

run_facts --pr 4 --no-fetch
assert_eq "a merged release PR succeeds" "0" "$status"
assert_eq "release commit" "$release" "$(jq -r '.release_sha' <<<"$out")"
assert_eq "previous release is the last release commit before it" "$first_release" "$(jq -r '.previous_release_sha' <<<"$out")"
assert_eq "components come from the changelog headings" '["api","homepage"]' "$(jq -c '.components' <<<"$out")"
assert_eq "tags on the release commit only" \
  '["api@1.0.0","homepage@1.0.0","me@1.0.0","pkg-db@1.0.0","slackbot@1.0.0","tailwind-config@1.0.0"]' \
  "$(jq -c '.tags' <<<"$out")"
assert_eq "migrations in order, CREATE TABLE needs the refresh setup" \
  '[{"file":"packages/db/drizzle/0001_things.sql","needs_refresh_setup":true},{"file":"packages/db/drizzle/0002_backfill.sql","needs_refresh_setup":false},{"file":"packages/db/drizzle/0003_big.sql","needs_refresh_setup":true}]' \
  "$(jq -c '.migrations' <<<"$out")"
assert_eq "env-var files that changed" '["apps/api/.env.example"]' "$(jq -c '.env_files_changed' <<<"$out")"
assert_eq "commits without a merged PR, advisory merge flagged" \
  "[{\"sha\":\"$closed_pr\",\"advisory_merge\":false},{\"sha\":\"$advisory\",\"advisory_merge\":true}]" \
  "$(jq -c '[.commits_without_pr[] | {sha, advisory_merge}]' <<<"$out")"
assert_eq "an unlisted commit lists its files" '["apps/api/handler.ts"]' \
  "$(jq -c --arg s "$advisory" '.commits_without_pr[] | select(.sha == $s) | .files' <<<"$out")"
assert_eq "this release's runs with a deployment waiting, in_progress ones included" \
  '[{"run_id":11,"workflow":"Deploy API","tag":"api@1.0.0","environments":["api-production"]},{"run_id":13,"workflow":"Deploy Slackbot","tag":"slackbot@1.0.0","environments":["slackbot-production"]}]' \
  "$(jq -c '.pending_deploys' <<<"$out")"
assert_eq "an app tag with no deployment waiting is reported; packages, tailwind-config and Homepage aren't" \
  '["me@1.0.0"]' "$(jq -c '.tags_without_waiting_run' <<<"$out")"
assert_eq "Homepage deploy state" "success" "$(jq -r '.homepage_deploy' <<<"$out")"
assert_eq "never writes to GitHub" "0" "$(grep -cE -- '-X|--method|(POST|PATCH|PUT|DELETE)|issue create|pr (edit|create|merge)' "$CALL_LOG")"

run_facts --no-fetch
assert_eq "without --pr, the latest merged release PR is used" "4" "$(jq -r '.pr' <<<"$out")"

echo '[]' >"$FAKE_DIR/homepage-runs.json"
run_facts --pr 4 --no-fetch
assert_eq "no Homepage run is reported as missing" "missing" "$(jq -r '.homepage_deploy' <<<"$out")"
echo '[{"status":"in_progress","conclusion":""}]' >"$FAKE_DIR/homepage-runs.json"
run_facts --pr 4 --no-fetch
assert_eq "an unfinished Homepage run is reported as pending" "pending" "$(jq -r '.homepage_deploy' <<<"$out")"

run_facts --pr 6 --no-fetch
assert_eq "an open release PR is refused" "1" "$status"
assert_eq "the refusal says why" "1" "$(grep -c 'only a merged release PR' "$tmp_dir/err")"

run_facts --pr 7 --no-fetch
assert_eq "a PR that isn't a release is refused" "1" "$status"

run_facts --pr 1 --no-fetch
assert_eq "a release with no earlier release is refused" "1" "$status"
assert_eq "that refusal says why" "1" "$(grep -c 'no earlier release commit' "$tmp_dir/err")"

run_facts --pr 8 --no-fetch
assert_eq "a release commit missing from origin/main is refused" "1" "$status"

run_facts --pr abc
assert_eq "a non-numeric --pr is refused" "1" "$status"

run_facts --pr 9 --no-fetch
assert_eq "a release with no tags at origin is refused" "1" "$status"
assert_eq "that refusal says why" "1" "$(grep -c 'no release tags' "$tmp_dir/err")"

FAIL_WAITING=1 run_facts --pr 4 --no-fetch
assert_eq "an unreadable list of waiting runs fails the run" "1" "$status"

FAIL_PULLS=1 run_facts --pr 4 --no-fetch
assert_eq "an unreadable commit fails the run instead of being guessed" "1" "$status"

FAIL_GIT_MIGRATIONS=1 run_facts --pr 4 --no-fetch
assert_eq "a failed migration listing fails the run" "1" "$status"
assert_eq "and prints no facts" "" "$out"

FAIL_GIT_REV_LIST=1 run_facts --pr 4 --no-fetch
assert_eq "a failed commit listing fails the run" "1" "$status"
assert_eq "and prints no facts" "" "$out"

if [ "$failures" -ne 0 ]; then
  echo "${failures} release-facts test(s) failed"
  exit 1
fi
echo "All release-facts tests passed"
