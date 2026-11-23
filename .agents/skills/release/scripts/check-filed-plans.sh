#!/usr/bin/env bash
# Checks that the Staging plans for one merged release PR exist, were opened by
# an account the release skill trusts, and link to each other. It only reads
# from GitHub. Exits 0 when the plans are complete, 1 (with the reason on
# stdout) when they aren't, and 2 on a usage error.
#
#   check-filed-plans.sh --pr <number> --facts <release-facts.json>
#                        [--attempts <n>] [--delay <seconds>]
#
# Run it from a checkout that has the release commit. The facts file is
# release-facts.sh's output for the same PR. A Staging test plan is required
# when the release ships an app: a component with a deploy-<component>.yml
# workflow at the facts' release_sha, other than analytics, which the release
# skill leaves out of both plans. A plan counts when GitHub Actions opened it
# (the Release Plan workflow files with its job token) or its author has write
# access, as in the skill's step 11. The plans link to each other with the
# templates' own wording: the release plan's "Staging test plan, #<n>"
# (plan-template.md) and the test plan's "go/no-go in #<n>"
# (test-plan-template.md); change both files together. Search can lag an issue
# filed seconds ago, so an incomplete result is checked again up to --attempts
# times (default 1), --delay seconds apart (default 15). gh calls use GH_REPO
# (owner/name). Needs gh, git and jq.
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
release_sha="$(jq -r '.release_sha // empty' "$facts")" || usage_error "can't read $facts"
[ -n "$release_sha" ] || usage_error "$facts has no release_sha"
components="$(jq -r '.components[]' "$facts")" || usage_error "can't read components from $facts"
workflows="$(git ls-tree --name-only "$release_sha" -- .github/workflows/)" \
  || usage_error "can't read the workflows at ${release_sha}; run from a checkout that has it"
needs_test_plan=false
for component in $components; do
  if [ "$component" != "analytics" ] && grep -qxF ".github/workflows/deploy-${component}.yml" <<<"$workflows"; then
    needs_test_plan=true
  fi
done

# Prints the number of each issue whose title matches $1 and whose author the
# skill trusts. A 404 means the author isn't a collaborator, so not trusted;
# any other failed lookup (an outage, a rate limit, a token error) is printed
# to stderr and fails the call, so it isn't mistaken for an untrusted author.
trusted_numbers() {
  local number login permission
  jq -r --arg re "$1" '.[] | select(.title | test($re)) | "\(.number) \(.author.login)"' <<<"$issues" \
    | while read -r number login; do
      if [ "$login" = "app/github-actions" ]; then
        echo "$number"
        continue
      fi
      if ! permission="$(gh api "repos/${GH_REPO}/collaborators/${login}/permission" --jq '.permission' 2>&1)"; then
        if grep -q 'HTTP 404' <<<"$permission"; then
          permission=""
        else
          printf "check-filed-plans: can't read %s's access: %s\n" "$login" "$permission" >&2
          exit 1
        fi
      fi
      case "$permission" in
        admin | maintain | write) echo "$number" ;;
      esac
    done
}

# Succeeds when issue $1's body has the link phrase $2 followed by #$3.
links_to() {
  local body
  body="$(jq -r --argjson n "$1" '.[] | select(.number == $n) | .body' <<<"$issues")"
  grep -qE "${2} #${3}([^0-9]|\$)" <<<"$body"
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

  release_plans="$(trusted_numbers "^Release plan: .* to Staging \\(#${pr}\\)\$")" || {
    echo "can't read the access of a release plan's author"
    return 1
  }
  if [ -z "$release_plans" ]; then
    echo "no Staging release plan for #${pr} from a trusted author"
    return 1
  fi

  if [ "$needs_test_plan" != "true" ]; then
    echo "OK: Staging release plan #$(head -n 1 <<<"$release_plans"); no app ships, so no test plan is needed"
    return 0
  fi

  test_plans="$(trusted_numbers "^Staging test plan: .* \\(#${pr}\\)\$")" || {
    echo "can't read the access of a test plan's author"
    return 1
  }
  if [ -z "$test_plans" ]; then
    echo "the release ships an app but has no Staging test plan from a trusted author"
    return 1
  fi

  for release_plan in $release_plans; do
    for test_plan in $test_plans; do
      if links_to "$release_plan" "Staging test plan," "$test_plan" \
        && links_to "$test_plan" "go/no-go in" "$release_plan"; then
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
