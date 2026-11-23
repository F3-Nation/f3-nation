#!/usr/bin/env bash
# Checks that the Staging plans for one merged release PR exist, were opened by
# an account the release skill trusts, and link to each other. It only reads
# from GitHub. Exits 0 when the plans are complete, 1 (with the reason on
# stdout) when they aren't, and 2 on a usage error.
#
#   check-filed-plans.sh --pr <number> --facts <release-facts.json>
#                        [--attempts <n>] [--delay <seconds>] [--workflows-dir <dir>]
#
# The facts file is release-facts.sh's output for the same PR. A Staging test
# plan is required when the release ships an app: a component with a
# deploy-<component>.yml workflow in --workflows-dir (default: this checkout's
# .github/workflows), other than analytics, which the release skill leaves out
# of both plans. A plan counts when GitHub Actions opened it (the Release Plan
# workflow files with its job token) or its author has write access, as in the
# skill's step 11. Search can lag an issue filed seconds ago, so an incomplete
# result is checked again up to --attempts times (default 1), --delay seconds
# apart (default 15). gh calls use GH_REPO (owner/name). Needs gh, git and jq.
set -euo pipefail

usage_error() {
  printf 'check-filed-plans: %s\n' "$*" >&2
  exit 2
}

incomplete() {
  printf 'check-filed-plans: %s\n' "$*"
  exit 1
}

pr=""
facts=""
attempts=1
delay=15
workflows_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --pr)
      [ $# -ge 2 ] || usage_error "--pr needs a number"
      pr="$2"
      shift 2
      ;;
    --facts)
      [ $# -ge 2 ] || usage_error "--facts needs a file"
      facts="$2"
      shift 2
      ;;
    --attempts)
      [ $# -ge 2 ] || usage_error "--attempts needs a number"
      attempts="$2"
      shift 2
      ;;
    --delay)
      [ $# -ge 2 ] || usage_error "--delay needs a number"
      delay="$2"
      shift 2
      ;;
    --workflows-dir)
      [ $# -ge 2 ] || usage_error "--workflows-dir needs a directory"
      workflows_dir="$2"
      shift 2
      ;;
    *) usage_error "unknown argument: $1" ;;
  esac
done
case "$pr" in
  "" | *[!0-9]*) usage_error "--pr must be a number" ;;
esac
case "$attempts" in
  "" | *[!0-9]* | 0) usage_error "--attempts must be a positive number" ;;
esac
case "$delay" in
  "" | *[!0-9]*) usage_error "--delay must be a number of seconds" ;;
esac
[ -f "$facts" ] || usage_error "facts file not found: $facts"
[ -n "${GH_REPO:-}" ] || usage_error "set GH_REPO to owner/name"
if [ -z "$workflows_dir" ]; then
  workflows_dir="$(git rev-parse --show-toplevel)/.github/workflows" \
    || usage_error "run from a checkout of the repo, or pass --workflows-dir"
fi
[ -d "$workflows_dir" ] || usage_error "workflows directory not found: $workflows_dir"

components="$(jq -r '.components[]' "$facts")" || usage_error "can't read components from $facts"
needs_test_plan=false
for component in $components; do
  if [ "$component" != "analytics" ] && [ -f "${workflows_dir}/deploy-${component}.yml" ]; then
    needs_test_plan=true
  fi
done

# Prints the number of each issue whose title matches $1 and whose author the
# skill trusts.
trusted_numbers() {
  local number login permission
  jq -r --arg re "$1" '.[] | select(.title | test($re)) | "\(.number) \(.author.login)"' <<<"$issues" \
    | while read -r number login; do
      if [ "$login" = "app/github-actions" ]; then
        echo "$number"
        continue
      fi
      permission="$(gh api "repos/${GH_REPO}/collaborators/${login}/permission" --jq '.permission' 2>/dev/null)" \
        || permission=""
      case "$permission" in
        admin | maintain | write) echo "$number" ;;
      esac
    done
}

# Succeeds when issue $1's body mentions issue #$2.
mentions() {
  local body
  body="$(jq -r --argjson n "$1" '.[] | select(.number == $n) | .body' <<<"$issues")"
  grep -qE "#${2}([^0-9]|\$)" <<<"$body"
}

# Checks the plans once: prints the result and returns 0 when they're
# complete, or prints why and returns 1.
check_once() {
  local release_plans test_plans release_plan test_plan
  issues="$(gh issue list --repo "$GH_REPO" --state all --limit 100 \
    --search "\"(#${pr})\" in:title" --json number,title,author,body)" || {
    echo "can't list the issues for #${pr}"
    return 1
  }

  release_plans="$(trusted_numbers "^Release plan: .* to Staging \\(#${pr}\\)\$")"
  if [ -z "$release_plans" ]; then
    echo "no Staging release plan for #${pr} from a trusted author"
    return 1
  fi

  if [ "$needs_test_plan" != "true" ]; then
    echo "OK: Staging release plan #$(head -n 1 <<<"$release_plans"); no app ships, so no test plan is needed"
    return 0
  fi

  test_plans="$(trusted_numbers "^Staging test plan: .* \\(#${pr}\\)\$")"
  if [ -z "$test_plans" ]; then
    echo "the release ships an app but has no Staging test plan from a trusted author"
    return 1
  fi

  for release_plan in $release_plans; do
    for test_plan in $test_plans; do
      if mentions "$release_plan" "$test_plan" && mentions "$test_plan" "$release_plan"; then
        echo "OK: Staging release plan #${release_plan} and test plan #${test_plan} link to each other"
        return 0
      fi
    done
  done
  echo "the Staging release plan and test plan for #${pr} don't link to each other"
  return 1
}

issues=""
attempt=1
while :; do
  result="$(check_once)" && {
    echo "$result"
    exit 0
  }
  if [ "$attempt" -ge "$attempts" ]; then
    incomplete "$result"
  fi
  echo "check-filed-plans: attempt ${attempt}: ${result}; checking again in ${delay}s"
  attempt=$((attempt + 1))
  sleep "$delay"
done
