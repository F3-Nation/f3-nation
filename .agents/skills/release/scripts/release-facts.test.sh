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
        if [ -f "$FAKE_DIR/pulls-$sha.json" ]; then
          cat "$FAKE_DIR/pulls-$sha.json"
        else
          echo '[{"number":99,"title":"chore(repo): tidy","merged_at":"2026-01-01T00:00:00Z","body":"### Release steps\n\nNone"}]'
        fi
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
for app in admin analytics api homepage me slackbot; do echo "name: Deploy $app" >".github/workflows/deploy-$app.yml"; done
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
# One per remaining part of the refresh-setup pattern, in mixed case.
echo 'create schema audit2;' >packages/db/drizzle/0004_schema.sql
echo 'ALTER TABLE things Owner To app;' >packages/db/drizzle/0005_owner.sql
echo 'revoke SELECT ON things FROM ro;' >packages/db/drizzle/0006_revoke.sql
echo "SELECT Audit.Enable_Tracking('things');" >packages/db/drizzle/0007_audit.sql
db_change="$(commit "feat(db): add things (#3)")"
# Its PR gets the fake gh's default body, whose section says None.
mkdir -p docs
echo 'tidy' >docs/tidy.md
commit "chore(repo): tidy (#11)" >/dev/null
echo 'empty' >docs/empty.md
empty_section="$(commit "docs(repo): note (#12)")"
echo 'stacked' >docs/stacked.md
stacked="$(commit "feat(api): stacked change (#13)")"
echo two >README.md
release="$(commit "chore: release main (#4)")"
git tag admin@1.0.0 "$release"
git tag analytics@1.0.0 "$release"
git tag api@1.0.0 "$release"
git tag homepage@1.0.0 "$release"
git tag me@1.0.0 "$release"
git tag pkg-db@1.0.0 "$release"
git tag slackbot@1.0.0 "$release"
git tag tailwind-config@1.0.0 "$release"
git tag api@0.9.0 "$first_release"
git push -q origin main --tags
# A release commit that exists in the checkout but was never pushed.
git switch -q -c local-only
echo three >README.md
unpushed="$(commit "chore: release main (#8)")"
git switch -q main

echo '[]' >"$FAKE_DIR/pulls-$advisory.json"
echo '[{"merged_at":null}]' >"$FAKE_DIR/pulls-$closed_pr.json"
# The feature's PR has steps; the migration's predates the section. A closed PR
# listed first must not be the one read.
cat >"$FAKE_DIR/pulls-$feature.json" <<'JSON'
[{"number":20,"title":"feat(api): old attempt","merged_at":null,"body":"### Release steps\n\nWrong PR."},
 {"number":2,"title":"feat(api): add a setting","merged_at":"2026-01-02T00:00:00Z",
  "body":"### TL;DR\n\nAdds X.\n\n### 🚀 Release steps\n\n<!-- template help -->\n\nSet X=1 on the API before approving it.\n\n### ✅ How to Test\n\nClick."}]
JSON
cat >"$FAKE_DIR/pulls-$db_change.json" <<'JSON'
[{"number":3,"title":"feat(db): add things","merged_at":"2026-01-03T00:00:00Z","body":"### TL;DR\n\nAdds things."}]
JSON
cat >"$FAKE_DIR/pulls-$empty_section.json" <<'JSON'
[{"number":12,"title":"docs(repo): note","merged_at":"2026-01-04T00:00:00Z","body":"### 🚀 Release steps\n\n<!-- template help -->\n\n### ✅ How to Test\n\nRead it."}]
JSON
# A stacked PR merged into a feature branch is listed before the PR that
# landed the commit on main; the main one's steps must be read.
cat >"$FAKE_DIR/pulls-$stacked.json" <<JSON
[{"number":14,"title":"feat(api): stacked part","merged_at":"2026-01-05T00:00:00Z","merge_commit_sha":"0000000","base":{"ref":"feat/big"},"body":"### Release steps\n\nNone"},
 {"number":13,"title":"feat(api): stacked change","merged_at":"2026-01-06T00:00:00Z","merge_commit_sha":"$stacked","base":{"ref":"main"},"body":"### Release steps\n\nRestart the API job."}]
JSON
# Newest first, as gh returns them.
cat >"$FAKE_DIR/pr-list.json" <<JSON
[{"number":4,"mergedAt":"2026-02-01T00:00:00Z"},{"number":1,"mergedAt":"2026-01-01T00:00:00Z"}]
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
 "mergeCommit":{"oid":"$unpushed"},"body":""}
JSON
cat >"$FAKE_DIR/pr-10.json" <<JSON
{"number":10,"title":"chore: release main","state":"MERGED","mergedAt":"2026-02-01T00:00:00Z",
 "mergeCommit":{"oid":"$release"},
 "body":"<details><summary>api: 1.0.0</summary>x</details>\n<details><summary>map: 1.0.0</summary>y</details>"}
JSON
cat >"$FAKE_DIR/pr-9.json" <<JSON
{"number":9,"title":"chore: release main","state":"MERGED","mergedAt":"2026-02-02T00:00:00Z",
 "mergeCommit":{"oid":"$closed_pr"},"body":"<details><summary>api: 1.0.1</summary>x</details>"}
JSON
# Run 15 is a dispatch from a branch named like the API tag, on another
# commit; run 16 re-deploys Admin by a dispatch from its tag.
cat >"$FAKE_DIR/waiting-runs.json" <<JSON
[{"databaseId":11,"workflowName":"Deploy API","headBranch":"api@1.0.0","headSha":"$release"},
 {"databaseId":12,"workflowName":"Deploy API","headBranch":"api@0.9.0","headSha":"$first_release"},
 {"databaseId":15,"workflowName":"Deploy API","headBranch":"api@1.0.0","headSha":"$feature"},
 {"databaseId":16,"workflowName":"Deploy Admin","headBranch":"admin@1.0.0","headSha":"$release"}]
JSON
# Slackbot's run is in_progress while one of its two deploy jobs waits; Me's
# is still deploying to Staging, with nothing waiting yet.
cat >"$FAKE_DIR/in-progress-runs.json" <<JSON
[{"databaseId":13,"workflowName":"Deploy Slackbot","headBranch":"slackbot@1.0.0","headSha":"$release"},
 {"databaseId":14,"workflowName":"Deploy Me","headBranch":"me@1.0.0","headSha":"$release"}]
JSON
echo '[{"environment":{"name":"api-production"}}]' >"$FAKE_DIR/pending-11.json"
echo '[{"environment":{"name":"api-production"}}]' >"$FAKE_DIR/pending-15.json"
echo '[{"environment":{"name":"admin-production"}}]' >"$FAKE_DIR/pending-16.json"
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
  '["admin@1.0.0","analytics@1.0.0","api@1.0.0","homepage@1.0.0","me@1.0.0","pkg-db@1.0.0","slackbot@1.0.0","tailwind-config@1.0.0"]' \
  "$(jq -c '.tags' <<<"$out")"
assert_eq "migrations in order; each refresh-setup pattern matches in any case, a backfill doesn't" \
  '[{"file":"packages/db/drizzle/0001_things.sql","needs_refresh_setup":true},{"file":"packages/db/drizzle/0002_backfill.sql","needs_refresh_setup":false},{"file":"packages/db/drizzle/0003_big.sql","needs_refresh_setup":true},{"file":"packages/db/drizzle/0004_schema.sql","needs_refresh_setup":true},{"file":"packages/db/drizzle/0005_owner.sql","needs_refresh_setup":true},{"file":"packages/db/drizzle/0006_revoke.sql","needs_refresh_setup":true},{"file":"packages/db/drizzle/0007_audit.sql","needs_refresh_setup":true}]' \
  "$(jq -c '.migrations' <<<"$out")"
root_migrations="$(jq -c '.migrations' <<<"$out")"
assert_eq "env-var files that changed" '["apps/api/.env.example"]' "$(jq -c '.env_files_changed' <<<"$out")"
assert_eq "commits without a merged PR, advisory merge flagged" \
  "[{\"sha\":\"$closed_pr\",\"advisory_merge\":false},{\"sha\":\"$advisory\",\"advisory_merge\":true}]" \
  "$(jq -c '[.commits_without_pr[] | {sha, advisory_merge}]' <<<"$out")"
assert_eq "an unlisted commit lists its files" '["apps/api/handler.ts"]' \
  "$(jq -c --arg s "$advisory" '.commits_without_pr[] | select(.sha == $s) | .files' <<<"$out")"
assert_eq "PRs with release steps or a missing or empty section, oldest first; None and unmerged PRs left out, and the PR that landed a commit on main read" \
  '[{"pr":2,"title":"feat(api): add a setting","state":"steps","text":"Set X=1 on the API before approving it."},{"pr":3,"title":"feat(db): add things","state":"section_missing","text":""},{"pr":12,"title":"docs(repo): note","state":"section_missing","text":""},{"pr":13,"title":"feat(api): stacked change","state":"steps","text":"Restart the API job."}]' \
  "$(jq -c '.release_steps' <<<"$out")"
assert_eq "runs of the release commit with a deployment waiting: in_progress and tag dispatches included, other commits not" \
  '[{"run_id":11,"workflow":"Deploy API","tag":"api@1.0.0","environments":["api-production"]},{"run_id":13,"workflow":"Deploy Slackbot","tag":"slackbot@1.0.0","environments":["slackbot-production"]},{"run_id":16,"workflow":"Deploy Admin","tag":"admin@1.0.0","environments":["admin-production"]}]' \
  "$(jq -c '.pending_deploys' <<<"$out")"
assert_eq "an app tag with no deployment waiting is reported; packages, tailwind-config, Homepage and Analytics aren't" \
  '["me@1.0.0"]' "$(jq -c '.tags_without_waiting_run' <<<"$out")"
assert_eq "Homepage deploy state" "success" "$(jq -r '.homepage_deploy' <<<"$out")"
assert_eq "never writes to GitHub" "0" "$(grep -cE -- '-X|--method|(POST|PATCH|PUT|DELETE)|issue create|pr (edit|create|merge)' "$CALL_LOG")"

run_facts --no-fetch
assert_eq "without --pr, the latest merged release PR is used" "4" "$(jq -r '.pr' <<<"$out")"

out="$(cd apps && GH_REPO=Org/repo bash "$facts" --pr 4 --no-fetch 2>"$tmp_dir/err")"
status=$?
assert_eq "run from a subdirectory succeeds" "0" "$status"
assert_eq "and finds the same migrations" "$root_migrations" "$(jq -c '.migrations' <<<"$out")"
assert_eq "and the same tags without a waiting run" '["me@1.0.0"]' "$(jq -c '.tags_without_waiting_run' <<<"$out")"

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
assert_eq "that refusal says why" "1" "$(grep -c "isn't on origin/main" "$tmp_dir/err")"

run_facts --pr abc
assert_eq "a non-numeric --pr is refused" "1" "$status"
assert_eq "that refusal says why" "1" "$(grep -c 'must be a number' "$tmp_dir/err")"

run_facts --pr 10 --no-fetch
assert_eq "a changelog component with no tag on the release commit is refused" "1" "$status"
assert_eq "that refusal names it" "1" "$(grep -c 'no release tag .* for: map' "$tmp_dir/err")"

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
