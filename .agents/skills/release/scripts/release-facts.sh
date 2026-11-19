#!/usr/bin/env bash
# Print, as one JSON object, the facts a release plan and test plan are built
# from: the merged release PR, the commit range since the previous release,
# the new migrations, the env-var files that changed, the commits that reached
# the default branch without a merged pull request (security-advisory merges
# among them), and the deploy runs for this release that wait for approval.
# It only reads: nothing is written to GitHub or the checkout.
#
#   release-facts.sh [--pr <number>] [--no-fetch]
#
# Without --pr it picks the most recently merged release PR. --no-fetch skips
# `git fetch` (the checkout must already have the release commit). Run it from
# a checkout of the repo; it targets GH_REPO (owner/name) when set, else the
# checkout's repo. Needs git, gh and jq.
set -euo pipefail

RELEASE_TITLE='chore: release main'
RELEASE_AUTHOR='app/f3-nation-release-please'
# Migrations that can take away the Staging refresh login's access, so a
# Production run needs the refresh's full setup again. Keep in step with
# docs/STAGING_REFRESH.md ("Migrations that need the full setup").
REFRESH_SETUP_PATTERN='CREATE[[:space:]]+TABLE|CREATE[[:space:]]+SCHEMA|OWNER[[:space:]]+TO|REVOKE|audit\.enable_tracking'
# Files whose change can mean a deployed env var or secret must change too.
ENV_FILE_PATTERN='(^|/)\.env[^/]*\.example$|(^|/)env\.ts$|(^|/)cloud-run-env[^/]*\.sh$|(^|/)turbo\.json$'

die() {
  printf 'release-facts: %s\n' "$*" >&2
  exit 1
}

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

# The apps this release ships, from the changelog's "<summary>name: version"
# headings.
apps_json="$(jq -r '.body' <<<"$pr_json" \
  | sed -n 's/.*<summary>\([^<:]*\):.*/\1/p' \
  | jq -R -s 'split("\n") | map(select(length > 0))')"

# The tags release-please put on the release commit; deploy runs start from them.
tags_json="$(git ls-remote --tags origin \
  | awk -v sha="$release_sha" '$1 == sha { sub("^refs/tags/", "", $2); sub("\\^\\{\\}$", "", $2); print $2 }' \
  | sort -u | jq -R -s 'split("\n") | map(select(length > 0))')"

migrations_json='[]'
while IFS= read -r file; do
  [ -n "$file" ] || continue
  needs_setup=false
  if git show "$release_sha:$file" | grep -Eiq "$REFRESH_SETUP_PATTERN"; then
    needs_setup=true
  fi
  migrations_json="$(jq --arg file "$file" --argjson setup "$needs_setup" \
    '. + [{file: $file, needs_refresh_setup: $setup}]' <<<"$migrations_json")"
done < <(git diff --name-only --diff-filter=A "$previous_sha" "$release_sha" -- 'packages/db/drizzle/*.sql' | sort)

env_files_json="$(git diff --name-only "$previous_sha" "$release_sha" \
  | { grep -E "$ENV_FILE_PATTERN" || true; } | jq -R -s 'split("\n") | map(select(length > 0))')"

# A commit with no merged pull request never appears in the changelog. GitHub
# names a security advisory's merge from its private fork "Merge commit from
# fork".
unlisted_json='[]'
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  merged="$(gh api "repos/$repo/commits/$sha/pulls" | jq '[.[] | select(.merged_at != null)] | length')" \
    || die "can't read the pull requests for commit $sha"
  [ "$merged" -eq 0 ] || continue
  subject="$(git log -1 --format=%s "$sha")"
  files_json="$(git show --name-only --format= "$sha" | jq -R -s 'split("\n") | map(select(length > 0))')"
  unlisted_json="$(jq --arg sha "$sha" --arg subject "$subject" --argjson files "$files_json" \
    '. + [{sha: $sha, subject: $subject, advisory_merge: ($subject == "Merge commit from fork"), files: $files}]' \
    <<<"$unlisted_json")"
done < <(git rev-list --first-parent "$previous_sha..$release_sha^")

pending_json='[]'
homepage_deploy="not_in_release"
if [ "$(jq 'length' <<<"$tags_json")" -gt 0 ]; then
  while IFS=$'\t' read -r run_id workflow tag; do
    [ -n "$run_id" ] || continue
    environments="$(gh api "repos/$repo/actions/runs/$run_id/pending_deployments" | jq '[.[].environment.name]')" \
      || die "can't read the pending deployments of run $run_id"
    pending_json="$(jq --argjson id "$run_id" --arg workflow "$workflow" --arg tag "$tag" --argjson envs "$environments" \
      '. + [{run_id: $id, workflow: $workflow, tag: $tag, environments: $envs}]' <<<"$pending_json")"
  done < <(gh run list --repo "$repo" --status waiting --limit 100 --json databaseId,workflowName,headBranch \
    | jq -r --argjson tags "$tags_json" '.[] | select(.headBranch as $b | $tags | index($b)) | [.databaseId, .workflowName, .headBranch] | @tsv')

  homepage_tag="$(jq -r '.[] | select(startswith("homepage@"))' <<<"$tags_json" | head -n 1)"
  if [ -n "$homepage_tag" ]; then
    homepage_deploy="$(gh run list --repo "$repo" --workflow deploy-homepage.yml --branch "$homepage_tag" --limit 1 --json status,conclusion \
      | jq -r 'if length == 0 then "missing" elif .[0].status != "completed" then "pending" else .[0].conclusion end')"
  fi
fi

jq -n \
  --arg repo "$repo" \
  --argjson pr "$(jq '.number' <<<"$pr_json")" \
  --arg merged_at "$(jq -r '.mergedAt' <<<"$pr_json")" \
  --arg release_sha "$release_sha" \
  --arg previous_sha "$previous_sha" \
  --argjson apps "$apps_json" \
  --argjson tags "$tags_json" \
  --argjson migrations "$migrations_json" \
  --argjson env_files "$env_files_json" \
  --argjson unlisted "$unlisted_json" \
  --argjson pending "$pending_json" \
  --arg homepage "$homepage_deploy" \
  '{repo: $repo, pr: $pr, merged_at: $merged_at, release_sha: $release_sha,
    previous_release_sha: $previous_sha, apps: $apps, tags: $tags,
    migrations: $migrations, env_files_changed: $env_files,
    commits_without_pr: $unlisted, pending_deploys: $pending,
    homepage_deploy: $homepage}'
