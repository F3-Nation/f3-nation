#!/usr/bin/env bash
# Prints the number of the latest merged release PR, the one the Release Plan
# workflow plans. It only reads from GitHub. Exits 0 with the number on stdout,
# 1 (with the reason on stderr) when there is no such PR or --merge-sha rules
# it out, and 2 on a usage error.
#
#   find-release-pr.sh [--merge-sha <40-hex commit>]
#
# It lists every page of the release branch's PRs rather than searching, since
# the search index can lag a PR merged seconds ago. --merge-sha must be at or
# after that PR's merge commit: a merge-queue batch can land other PRs after it
# in the same push, so the pushed commit may come later, and a commit before it
# means a newer release replaced the one the caller meant. gh calls use GH_REPO
# (owner/name). Needs gh and jq.
set -euo pipefail

RELEASE_BRANCH='release-please--branches--main'
RELEASE_AUTHOR='f3-nation-release-please[bot]'
RELEASE_TITLE='chore: release main'

usage_error() {
  printf 'find-release-pr: %s\n' "$*" >&2
  exit 2
}

not_found() {
  printf 'find-release-pr: %s\n' "$*" >&2
  exit 1
}

merge_sha=""
while [ $# -gt 0 ]; do
  case "$1" in
    --merge-sha)
      [ $# -ge 2 ] || usage_error "--merge-sha needs a commit"
      merge_sha="$2"
      shift 2
      ;;
    *) usage_error "unknown argument: $1" ;;
  esac
done
if [ -n "$merge_sha" ] && ! [[ "$merge_sha" =~ ^[0-9a-f]{40}$ ]]; then
  usage_error "--merge-sha must be a full 40-character commit SHA"
fi
[ -n "${GH_REPO:-}" ] || usage_error "set GH_REPO to owner/name"

pages="$(gh api --paginate --slurp \
  "repos/${GH_REPO}/pulls?state=closed&base=main&head=${GH_REPO%%/*}:${RELEASE_BRANCH}&per_page=100")" \
  || not_found "can't list the release PRs"
latest="$(jq -r --arg author "$RELEASE_AUTHOR" --arg title "$RELEASE_TITLE" '
  [add[] | select(.merged_at != null and .user.login == $author and (.title | startswith($title)))]
  | if length == 0 then empty else (sort_by(.merged_at) | last | "\(.number) \(.merge_commit_sha)") end' <<<"$pages")" \
  || not_found "can't read the release PR list"
[ -n "$latest" ] || not_found "no merged release PR found"
read -r number merge_commit <<<"$latest"

if [ -n "$merge_sha" ]; then
  status="$(gh api "repos/${GH_REPO}/compare/${merge_commit}...${merge_sha}" --jq '.status')" \
    || not_found "can't compare ${merge_sha} with the merge commit of #${number}"
  case "$status" in
    identical | ahead) ;;
    *) not_found "${merge_sha} isn't at or after the merge commit of the latest merged release PR (#${number}, ${merge_commit})" ;;
  esac
fi

echo "$number"
