#!/usr/bin/env bash
# Print, as one JSON object, the facts a release plan and test plan are built
# from, read from git and GitHub for one merged release PR; the jq call at the
# end defines its fields. It writes nothing to GitHub, and changes the checkout
# only by fetching origin main (skipped with --no-fetch).
#
#   release-facts.sh [--pr <number>] [--no-fetch]
#
# Without --pr it picks the most recently merged release PR. --no-fetch skips
# `git fetch` (the checkout must already have the release commit). Run it from
# a checkout whose origin is the target repo; gh calls use GH_REPO (owner/name)
# when set, else the checkout's repo, and must name the same repo. Needs git,
# gh and jq.
set -euo pipefail

RELEASE_TITLE='chore: release main'
RELEASE_AUTHOR='app/f3-nation-release-please'
# Migrations that can take away the Staging refresh login's access, so a
# Production run needs the refresh's full setup again. The same list as
# docs/STAGING_REFRESH.md ("Migrations that need the full setup") and
# FULL_SETUP_NOTE in packages/db/src/migrate-remote.ts; change all three together.
REFRESH_SETUP_PATTERN='CREATE[[:space:]]+TABLE|CREATE[[:space:]]+SCHEMA|OWNER[[:space:]]+TO|REVOKE|audit\.enable_tracking'
# Files whose change can mean a deployed env var or secret must change too.
ENV_FILE_PATTERN='(^|/)\.env[^/]*\.example$|(^|/)env\.ts$|(^|/)cloud-run-env[^/]*\.sh$|(^|/)turbo\.json$'

die() {
  printf 'release-facts: %s\n' "$*" >&2
  exit 1
}

# Found next to this script rather than in the current checkout, which may not
# contain it.
RELEASE_STEPS_SECTION="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/scripts/release-steps-section.sh"
[ -f "$RELEASE_STEPS_SECTION" ] || die "can't find $RELEASE_STEPS_SECTION"

pr=""
fetch=1
while [ $# -gt 0 ]; do
  case "$1" in
    --pr)
      [ $# -ge 2 ] || die "--pr needs a number"
      pr="$2"
      shift 2
      ;;
    --no-fetch)
      fetch=0
      shift
      ;;
    *) die "unknown argument: $1" ;;
  esac
done
case "$pr" in
  "" | *[!0-9]*) [ -z "$pr" ] || die "--pr must be a number, got: $pr" ;;
esac

for tool in git gh jq; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is required"
done

# git pathspecs below are relative to the current directory, so run from the
# checkout's root.
top="$(git rev-parse --show-toplevel)" || die "run this from inside a checkout of the repo"
cd "$top" || die "can't cd to $top"

repo="${GH_REPO:-}"
if [ -z "$repo" ]; then
  repo="$(gh repo view --json nameWithOwner | jq -r '.nameWithOwner')" || die "can't tell which repo this is; set GH_REPO"
fi

if [ -z "$pr" ]; then
  pr="$(gh pr list --repo "$repo" --state merged --base main --author "$RELEASE_AUTHOR" \
    --search "$RELEASE_TITLE in:title" --limit 100 --json number,mergedAt \
    | jq -r 'sort_by(.mergedAt) | last | .number // empty')"
  [ -n "$pr" ] || die "no merged release PR found"
fi

pr_json="$(gh pr view "$pr" --repo "$repo" --json number,title,state,mergedAt,mergeCommit,body)" \
  || die "can't read PR #$pr"
state="$(jq -r '.state' <<<"$pr_json")"
title="$(jq -r '.title' <<<"$pr_json")"
[ "$state" = "MERGED" ] || die "PR #$pr is $state; only a merged release PR can be planned"
case "$title" in
  "$RELEASE_TITLE"*) ;;
  *) die "PR #$pr isn't a release PR (title: $title)" ;;
esac
release_sha="$(jq -r '.mergeCommit.oid // empty' <<<"$pr_json")"
[ -n "$release_sha" ] || die "PR #$pr has no merge commit"

if [ "$fetch" -eq 1 ]; then
  git fetch --quiet origin main || die "git fetch origin main failed"
fi
git merge-base --is-ancestor "$release_sha" origin/main 2>/dev/null \
  || die "release commit $release_sha isn't on origin/main in this checkout"

previous_sha=""
if git rev-parse --verify --quiet "$release_sha^" >/dev/null; then
  previous_sha="$(git log "$release_sha^" --grep "^$RELEASE_TITLE" --format=%H -n 1)"
fi
[ -n "$previous_sha" ] || die "no earlier release commit before $release_sha"

# Every component this release versions (apps, analytics and pkg-* packages),
# from the changelog's "<summary>name: version" headings.
components_json="$(jq -r '.body' <<<"$pr_json" \
  | sed -n 's/.*<summary>\([^<:]*\):.*/\1/p' \
  | jq -R -s 'split("\n") | map(select(length > 0))')"

# The tags release-please put on the release commit; deploy runs start from them.
tags_json="$(git ls-remote --tags origin \
  | awk -v sha="$release_sha" '$1 == sha { sub("^refs/tags/", "", $2); sub("\\^\\{\\}$", "", $2); print $2 }' \
  | sort -u | jq -R -s 'split("\n") | map(select(length > 0))')"

new_migrations="$(git diff --name-only --diff-filter=A "$previous_sha" "$release_sha" -- 'packages/db/drizzle/*.sql' \
  | sort)" || die "can't list the migrations added since $previous_sha"
migrations_json='[]'
while IFS= read -r file; do
  [ -n "$file" ] || continue
  needs_setup=false
  # Read the whole file before matching: grep -q stops at the first match, and
  # a large file piped into it would fail with SIGPIPE and read as no match.
  sql="$(git show "$release_sha:$file")" || die "can't read $file at $release_sha"
  if grep -Eiq "$REFRESH_SETUP_PATTERN" <<<"$sql"; then
    needs_setup=true
  fi
  migrations_json="$(jq --arg file "$file" --argjson setup "$needs_setup" \
    '. + [{file: $file, needs_refresh_setup: $setup}]' <<<"$migrations_json")"
done <<<"$new_migrations"

env_files_json="$(git diff --name-only "$previous_sha" "$release_sha" \
  | { grep -E "$ENV_FILE_PATTERN" || true; } | jq -R -s 'split("\n") | map(select(length > 0))')"

# Each commit's merged pull request, for its Release steps section, oldest
# first; and the commits with none. GitHub lands a security advisory's fix from
# its private fork as one commit named "Merge commit from fork"; it has no
# conventional-commit type, so release-please leaves it out of the changelog.
candidates="$(git rev-list --first-parent "$previous_sha..$release_sha^")" \
  || die "can't list the commits between $previous_sha and $release_sha"
unlisted_json='[]'
release_steps_json='[]'
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  # GitHub lists every PR the commit belongs to, in no set order. Read the one
  # that landed it on main: the PR whose merge commit it is, else one based on
  # main, else any merged one.
  merged_pr="$(gh api "repos/$repo/commits/$sha/pulls" \
    | jq -c --arg sha "$sha" '[.[] | select(.merged_at != null)]
      | (map(select(.merge_commit_sha == $sha)) + map(select(.base.ref == "main")) + .) | first // empty')" \
    || die "can't read the pull requests for commit $sha"
  if [ -n "$merged_pr" ]; then
    number="$(jq -r '.number' <<<"$merged_pr")"
    section_status=0
    steps="$(jq -r '.body // ""' <<<"$merged_pr" | bash "$RELEASE_STEPS_SECTION")" || section_status=$?
    case "$section_status" in
      0) section_state="steps" ;;
      3) continue ;;
      4 | 5)
        section_state="section_missing"
        steps=""
        ;;
      *) die "can't read the Release steps section of PR #$number" ;;
    esac
    # rev-list is newest first, so prepending leaves the list oldest first.
    release_steps_json="$(jq --argjson pr "$number" --arg title "$(jq -r '.title' <<<"$merged_pr")" \
      --arg state "$section_state" --arg text "$steps" \
      '[{pr: $pr, title: $title, state: $state, text: $text}] + .' <<<"$release_steps_json")"
    continue
  fi
  subject="$(git log -1 --format=%s "$sha")"
  # Against the first parent: a merge's own diff lists only files that differ
  # from every parent, which for an advisory merge is usually none.
  files_json="$(git diff --name-only "$sha^1" "$sha" | jq -R -s 'split("\n") | map(select(length > 0))')" \
    || die "can't list the files commit $sha changed"
  unlisted_json="$(jq --arg sha "$sha" --arg subject "$subject" --argjson files "$files_json" \
    '. + [{sha: $sha, subject: $subject, advisory_merge: ($subject == "Merge commit from fork"), files: $files}]' \
    <<<"$unlisted_json")"
done <<<"$candidates"

if [ "$(jq 'length' <<<"$tags_json")" -eq 0 ] && [ "$(jq 'length' <<<"$components_json")" -gt 0 ]; then
  die "no release tags on $release_sha at origin; check that origin is $repo and that the release is tagged"
fi
# Each changelog component's tag is "<component>@<version>"; a missing one
# would drop that component's deploy from the plans unreported.
untagged="$(jq -r --argjson tags "$tags_json" \
  '.[] | . as $c | select($tags | map(sub("@[^@]*$"; "")) | index($c) | not)' <<<"$components_json")"
[ -z "$untagged" ] || die "no release tag on $release_sha at origin for: $(tr '\n' ' ' <<<"$untagged")"

pending_json='[]'
homepage_deploy="not_in_release"
if [ "$(jq 'length' <<<"$tags_json")" -gt 0 ]; then
  # A run with parallel deploy jobs (Slackbot's service and scripts) stays
  # in_progress while one job waits for approval, so both states are read and
  # a run counts only when it has a deployment waiting. A run must also be of
  # the release commit: a branch can share a tag's name, and its run uses that
  # branch's own workflow file.
  waiting_runs="$(gh run list --repo "$repo" --status waiting --limit 100 \
    --json databaseId,workflowName,headBranch,headSha)" \
    || die "can't list the deploy runs waiting for approval"
  running_runs="$(gh run list --repo "$repo" --status in_progress --limit 100 \
    --json databaseId,workflowName,headBranch,headSha)" \
    || die "can't list the deploy runs in progress"
  runs_tsv="$(printf '%s\n%s\n' "$waiting_runs" "$running_runs" \
    | jq -r -s --argjson tags "$tags_json" --arg sha "$release_sha" \
      'add | unique_by(.databaseId)[]
        | select(.headSha == $sha)
        | select(.headBranch as $b | $tags | index($b))
        | [.databaseId, .workflowName, .headBranch] | @tsv')" \
    || die "can't read the deploy run lists"
  while IFS=$'\t' read -r run_id workflow tag; do
    [ -n "$run_id" ] || continue
    environments="$(gh api "repos/$repo/actions/runs/$run_id/pending_deployments" | jq '[.[].environment.name]')" \
      || die "can't read the pending deployments of run $run_id"
    [ "$(jq 'length' <<<"$environments")" -gt 0 ] || continue
    pending_json="$(jq --argjson id "$run_id" --arg workflow "$workflow" --arg tag "$tag" \
      --argjson envs "$environments" \
      '. + [{run_id: $id, workflow: $workflow, tag: $tag, environments: $envs}]' <<<"$pending_json")"
  done <<<"$runs_tsv"

  homepage_tag="$(jq -r '.[] | select(startswith("homepage@"))' <<<"$tags_json" | head -n 1)"
  if [ -n "$homepage_tag" ]; then
    homepage_deploy="$(gh run list --repo "$repo" --workflow deploy-homepage.yml --branch "$homepage_tag" \
      --limit 1 --json status,conclusion \
      | jq -r 'if length == 0 then "missing"
               elif .[0].status != "completed" then "pending"
               else .[0].conclusion end')" \
      || die "can't read the Homepage deploy run for $homepage_tag"
  fi
fi

# Components with a deploy-<component>.yml workflow at the release commit. A
# tag of any other component (the packages, tailwind-config) has no deploy.
deployable_json="$(git ls-tree --full-name --name-only "$release_sha" .github/workflows/ \
  | sed -n 's#^\.github/workflows/deploy-\(.*\)\.yml$#\1#p' \
  | jq -R -s 'split("\n") | map(select(length > 0))')" \
  || die "can't list the deploy workflows at $release_sha"

# Release tags whose deploy has no deployment waiting for approval: already
# approved, failed, cancelled, still deploying to Staging, or started again
# from main. The Homepage deploys without approval and Analytics is left out
# of the plans.
missing_runs_json="$(jq -c --argjson pending "$pending_json" --argjson deployable "$deployable_json" \
  '[.[] | select(sub("@[^@]*$"; "") | IN($deployable[]))
    | select((startswith("homepage@") or startswith("analytics@")) | not)
    | select(. as $t | $pending | map(.tag) | index($t) | not)]' <<<"$tags_json")"

jq -n \
  --arg repo "$repo" \
  --argjson pr "$(jq '.number' <<<"$pr_json")" \
  --arg merged_at "$(jq -r '.mergedAt' <<<"$pr_json")" \
  --arg release_sha "$release_sha" \
  --arg previous_sha "$previous_sha" \
  --argjson components "$components_json" \
  --argjson tags "$tags_json" \
  --argjson migrations "$migrations_json" \
  --argjson env_files "$env_files_json" \
  --argjson unlisted "$unlisted_json" \
  --argjson release_steps "$release_steps_json" \
  --argjson pending "$pending_json" \
  --arg homepage "$homepage_deploy" \
  --argjson missing_runs "$missing_runs_json" \
  '{repo: $repo, pr: $pr, merged_at: $merged_at, release_sha: $release_sha,
    previous_release_sha: $previous_sha, components: $components, tags: $tags,
    migrations: $migrations, env_files_changed: $env_files,
    commits_without_pr: $unlisted, release_steps: $release_steps,
    pending_deploys: $pending,
    tags_without_waiting_run: $missing_runs, homepage_deploy: $homepage}'
