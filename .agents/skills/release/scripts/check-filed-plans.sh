#!/usr/bin/env bash
# Checks that the Staging plans for one merged release PR exist, were opened by
# an account the release skill trusts, and link to each other. It only reads
# from GitHub. Exits 0 when the plans are complete, 1 (with the reason on
# stdout) when they aren't, and 2 on a usage error.
#
#   check-filed-plans.sh --pr <number> --facts <release-facts.json>
#
# The facts file is release-facts.sh's output for the same PR. A Staging test
# plan is required when the release ships an app: any component other than a
# pkg-* package or analytics, which the release skill leaves out of both plans.
# A plan counts when GitHub Actions opened it (the Release Plan workflow files
# with its job token) or its author has write access, as in the skill's step 11.
# gh calls use GH_REPO (owner/name). Needs gh and jq.
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
    *) usage_error "unknown argument: $1" ;;
  esac
done
case "$pr" in
  "" | *[!0-9]*) usage_error "--pr must be a number" ;;
esac
[ -f "$facts" ] || usage_error "facts file not found: $facts"
[ -n "${GH_REPO:-}" ] || usage_error "set GH_REPO to owner/name"

needs_test_plan="$(jq -r '[.components[] | select(startswith("pkg-") or . == "analytics" | not)] | length > 0' "$facts")" \
  || usage_error "can't read components from $facts"

issues="$(gh issue list --repo "$GH_REPO" --state all --limit 100 \
  --search "\"(#${pr})\" in:title" --json number,title,author,body)" \
  || incomplete "can't list the issues for #${pr}"

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

release_plans="$(trusted_numbers "^Release plan: .* to Staging \\(#${pr}\\)\$")"
[ -n "$release_plans" ] || incomplete "no Staging release plan for #${pr} from a trusted author"

if [ "$needs_test_plan" != "true" ]; then
  echo "OK: Staging release plan #$(head -n 1 <<<"$release_plans"); no app ships, so no test plan is needed"
  exit 0
fi

test_plans="$(trusted_numbers "^Staging test plan: .* \\(#${pr}\\)\$")"
[ -n "$test_plans" ] || incomplete "the release ships an app but has no Staging test plan from a trusted author"

for release_plan in $release_plans; do
  for test_plan in $test_plans; do
    if mentions "$release_plan" "$test_plan" && mentions "$test_plan" "$release_plan"; then
      echo "OK: Staging release plan #${release_plan} and test plan #${test_plan} link to each other"
      exit 0
    fi
  done
done
incomplete "the Staging release plan and test plan for #${pr} don't link to each other"
