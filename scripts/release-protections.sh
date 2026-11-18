#!/usr/bin/env bash
# Checks, and with --apply sets, the GitHub settings that keep a production
# deploy behind a release-please tag and a second person:
#   - a tag ruleset that lets only the release-please app and org admins
#     create, move or delete `*@*` release tags, so a writer can't tag an
#     unreviewed commit and trigger a deploy-*.yml workflow;
#   - a branch ruleset that lets only that app and org admins push to
#     `release-please--*` branches, so the release PR branch holds only
#     Release Please's output from `main` and the `uv lock` that release-please.yml
#     runs on it can't execute a writer's code in a `main`-scoped run;
#   - on every production environment: deploys only from that app's release
#     tags or `main` (workflow_dispatch re-deploys run from `main`), no admin
#     bypass, and required reviewers who can't approve a deploy they started;
#   - the release app's private key only in the `release-please` environment,
#     which accepts runs from `main` alone and never waits for approval, so a
#     workflow on another branch can't read the key and tag through the app.
# The default is a read-only check that exits 1 on drift. --apply needs repo
# admin; it keeps each production environment's reviewers and wait timer, then
# re-checks. It can't move a secret, so a key stored elsewhere stays drift for
# an admin to fix, and it stops with an error, before the production
# environments, if the release environment has an approval rule.
#
# Usage: scripts/release-protections.sh [--apply] [--repo <owner>/<name>]
set -euo pipefail

TAG_RULESET="release-tags"
TAG_REF_PATTERN='refs/tags/*@*'
BRANCH_RULESET="release-branches"
BRANCH_REF_PATTERN='refs/heads/release-please--*'
RELEASE_APP_SLUG="f3-nation-release-please"
RELEASE_ENV="release-please"
RELEASE_KEY_SECRET="RELEASE_PLEASE_APP_PRIVATE_KEY"

# Production environment and the release-tag pattern it deploys from, one per
# line. It must match the prod_environment inputs in .github/workflows/;
# scripts/release-protections.test.sh fails otherwise.
PROD_ENVIRONMENTS='admin-production admin@*
analytics-production analytics@*
api-production api@*
auth-production auth@*
map-production map@*
me-production me@*
region-pages-production region-pages@*
slackbot-production slackbot@*'

usage() {
  echo "Usage: $0 [--apply] [--repo <owner>/<name>]"
}

apply=false
repo="${GH_REPO:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)
      apply=true
      shift
      ;;
    --repo)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "ERROR: --repo needs a value" >&2
        usage >&2
        exit 2
      fi
      repo="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

for tool in gh jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: '$tool' is required but not installed." >&2
    exit 1
  fi
done

if [[ -z "$repo" ]]; then
  repo="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
fi

gh_err=""
trap 'if [[ -n "$gh_err" ]]; then rm -f "$gh_err"; fi' EXIT
gh_err="$(mktemp "${TMPDIR:-/tmp}/release-protections.XXXXXX")"

drift_count=0
drift() {
  echo "DRIFT: $*"
  drift_count=$((drift_count + 1))
}

# Ruleset fields compared between live and desired state; ignores ids,
# timestamps and links. OrganizationAdmin has no meaningful actor_id.
CANONICAL_RULESET='{
  enforcement,
  include: (.conditions.ref_name.include // [] | sort),
  exclude: (.conditions.ref_name.exclude // [] | sort),
  rules: ([.rules[]?.type] | sort),
  bypass: ([.bypass_actors[]? | "\(.actor_type):\(if .actor_type == "OrganizationAdmin" then "-" else .actor_id end):\(.bypass_mode)"] | sort)
}'

# Each managed ruleset as "<name> <target> <ref pattern> <rule,rule,...>".
# Only the release app and org admins bypass either one.
RULESETS="${TAG_RULESET} tag ${TAG_REF_PATTERN} creation,update,deletion
${BRANCH_RULESET} branch ${BRANCH_REF_PATTERN} creation,update,deletion,non_fast_forward"

# Args: name target pattern rules app_id
desired_ruleset() {
  jq -n --arg name "$1" --arg target "$2" --arg pattern "$3" --arg rules "$4" --argjson app "$5" '{
    name: $name,
    target: $target,
    enforcement: "active",
    conditions: { ref_name: { include: [$pattern], exclude: [] } },
    rules: [ $rules | split(",")[] | { type: . } ],
    bypass_actors: [
      { actor_id: $app, actor_type: "Integration", bypass_mode: "always" },
      { actor_id: 1, actor_type: "OrganizationAdmin", bypass_mode: "always" }
    ]
  }'
}

# Prints the id of the ruleset with this name and target, or nothing.
find_ruleset_id() {
  gh api --paginate "repos/${repo}/rulesets?includes_parents=false" |
    jq -r --arg name "$1" --arg target "$2" '.[] | select(.name == $name and .target == $target) | .id' |
    head -n 1
}

# Args: name target pattern rules app_id
check_ruleset() {
  local name="$1" target="$2" pattern="$3" ruleset_id want have
  ruleset_id="$(find_ruleset_id "$name" "$target")"
  if [[ -z "$ruleset_id" ]]; then
    drift "no ${target} ruleset named '${name}' protects ${pattern}"
    return
  fi
  want="$(desired_ruleset "$@" | jq -cS "$CANONICAL_RULESET")"
  have="$(gh api "repos/${repo}/rulesets/${ruleset_id}" | jq -cS "$CANONICAL_RULESET")"
  if [[ "$want" != "$have" ]]; then
    drift "${target} ruleset '${name}' differs from the desired state"
    echo "  want: ${want}"
    echo "  have: ${have}"
  fi
}

# Args: name target pattern rules app_id
apply_ruleset() {
  local name="$1" target="$2" ruleset_id
  ruleset_id="$(find_ruleset_id "$name" "$target")"
  if [[ -z "$ruleset_id" ]]; then
    desired_ruleset "$@" | gh api -X POST "repos/${repo}/rulesets" --input - >/dev/null
    echo "CREATED: ${target} ruleset '${name}'"
  else
    desired_ruleset "$@" | gh api -X PUT "repos/${repo}/rulesets/${ruleset_id}" --input - >/dev/null
    echo "UPDATED: ${target} ruleset '${name}'"
  fi
}

# Prints the environment's JSON. A missing environment is drift, not a crash;
# any other error stops the script rather than passing the check.
get_environment() {
  local env="$1"
  if gh api "repos/${repo}/environments/${env}" 2>"$gh_err"; then
    return 0
  fi
  if grep -q "HTTP 404" "$gh_err"; then
    return 3
  fi
  sed 's/^/  gh: /' "$gh_err" >&2
  echo "ERROR: could not read environment '${env}'" >&2
  exit 1
}

# Prints the environment's deployment policies as sorted "<type>:<name>" lines.
list_policies() {
  gh api --paginate "repos/${repo}/environments/${1}/deployment-branch-policies" |
    jq -r '.branch_policies[] | "\(.type):\(.name)"' | LC_ALL=C sort
}

# Drift unless the environment's deployment policies are exactly $2.
check_policies() {
  local env="$1" want="$2" have
  have="$(list_policies "$env")"
  if [[ "$want" != "$have" ]]; then
    drift "${env}: deployment policies are [$(paste -sd, - <<<"$have")], want [$(paste -sd, - <<<"$want")]"
  fi
}

# Makes the environment's deployment policies exactly $2.
sync_policies() {
  local env="$1" want="$2" policies line type name id
  policies="$(gh api --paginate "repos/${repo}/environments/${env}/deployment-branch-policies" |
    jq -r '.branch_policies[] | "\(.id) \(.type):\(.name)"')"
  # Remove policies outside the desired set: each one widens what may deploy.
  if [[ -n "$policies" ]]; then
    while read -r id line; do
      if ! grep -qxF "$line" <<<"$want"; then
        gh api -X DELETE "repos/${repo}/environments/${env}/deployment-branch-policies/${id}" >/dev/null
      fi
    done <<<"$policies"
  fi
  while IFS=: read -r type name; do
    if ! grep -qxF "${type}:${name}" <<<"$(cut -d' ' -f2- <<<"$policies")"; then
      gh api -X POST "repos/${repo}/environments/${env}/deployment-branch-policies" \
        -f name="$name" -f type="$type" >/dev/null
    fi
  done <<<"$want"
}

desired_policies() {
  printf 'branch:main\ntag:%s\n' "$1" | LC_ALL=C sort
}

check_environment() {
  local env="$1" pattern="$2" env_json status=0 problems reviewers
  env_json="$(get_environment "$env")" || status=$?
  if [[ "$status" -eq 3 ]]; then
    drift "${env}: environment does not exist"
    return
  elif [[ "$status" -ne 0 ]]; then
    exit 1
  fi

  problems="$(jq -r '
    (.protection_rules // [] | map(select(.type == "required_reviewers")) | first) as $rr
    | (if .can_admins_bypass != false then "admins can bypass its protection rules" else empty end),
      (if .deployment_branch_policy != {protected_branches: false, custom_branch_policies: true}
        then "deployments are not limited to selected branches and tags" else empty end),
      (if $rr == null or ($rr.reviewers // [] | length) == 0 then "no required reviewers"
        elif $rr.prevent_self_review != true then "reviewers can approve their own deploys"
        else empty end)
  ' <<<"$env_json")"
  if [[ -n "$problems" ]]; then
    while IFS= read -r line; do
      drift "${env}: ${line}"
    done <<<"$problems"
  fi

  reviewers="$(jq '[.protection_rules // [] | .[] | select(.type == "required_reviewers") | .reviewers[]?] | length' <<<"$env_json")"
  if [[ "$reviewers" -eq 1 ]]; then
    echo "WARN: ${env}: only one required reviewer, who can't approve a deploy they start themselves (a workflow_dispatch re-deploy); add a second"
  fi

  if [[ "$(jq -r '.deployment_branch_policy.custom_branch_policies // false' <<<"$env_json")" == "true" ]]; then
    check_policies "$env" "$(desired_policies "$pattern")"
  fi
}

apply_environment() {
  local env="$1" pattern="$2" env_json status=0 body
  env_json="$(get_environment "$env")" || status=$?
  if [[ "$status" -eq 3 ]]; then
    echo "ERROR: ${env} does not exist; create it with its required reviewers, then re-run." >&2
    exit 1
  elif [[ "$status" -ne 0 ]]; then
    exit 1
  fi

  body="$(jq '
    (.protection_rules // []) as $rules
    | {
        wait_timer: ([$rules[] | select(.type == "wait_timer") | .wait_timer] | first // 0),
        prevent_self_review: true,
        can_admins_bypass: false,
        reviewers: [$rules[] | select(.type == "required_reviewers") | .reviewers[]? | {type, id: .reviewer.id}],
        deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}
      }
  ' <<<"$env_json")"
  # An empty reviewers list would remove the approval gate entirely.
  if [[ "$(jq '.reviewers | length' <<<"$body")" -eq 0 ]]; then
    echo "ERROR: ${env} has no required reviewers to keep; add them, then re-run." >&2
    exit 1
  fi
  gh api -X PUT "repos/${repo}/environments/${env}" --input - <<<"$body" >/dev/null
  sync_policies "$env" "$(desired_policies "$pattern")"
  echo "UPDATED: ${env}"
}

# Prints "true" when the environment JSON has a rule that makes a run wait.
has_approval_rule() {
  jq -r '[.protection_rules // [] | .[] | select(.type == "required_reviewers" or .type == "wait_timer")] | length > 0' <<<"$1"
}

# The release environment has no required reviewers or wait timer:
# release-please runs on every push to main and must not wait for an approval.
check_release_env() {
  local env_json status=0 secrets env envs
  env_json="$(get_environment "$RELEASE_ENV")" || status=$?
  if [[ "$status" -eq 3 ]]; then
    drift "${RELEASE_ENV}: environment does not exist"
  elif [[ "$status" -ne 0 ]]; then
    exit 1
  else
    if [[ "$(jq -r '.can_admins_bypass' <<<"$env_json")" != "false" ]]; then
      drift "${RELEASE_ENV}: admins can bypass its protection rules"
    fi
    if ! jq -e '.deployment_branch_policy == {protected_branches: false, custom_branch_policies: true}' <<<"$env_json" >/dev/null; then
      drift "${RELEASE_ENV}: deployments are not limited to selected branches and tags"
    else
      check_policies "$RELEASE_ENV" "branch:main"
    fi
    if [[ "$(has_approval_rule "$env_json")" == "true" ]]; then
      drift "${RELEASE_ENV}: has required reviewers or a wait timer; release-please must run without waiting"
    fi
    secrets="$(gh api --paginate "repos/${repo}/environments/${RELEASE_ENV}/secrets" --jq '.secrets[].name')"
    if ! grep -qxF "$RELEASE_KEY_SECRET" <<<"$secrets"; then
      drift "${RELEASE_KEY_SECRET} is not a secret of the ${RELEASE_ENV} environment; releases will fail"
    fi
  fi

  secrets="$(gh api --paginate "repos/${repo}/actions/secrets" --jq '.secrets[].name')"
  if grep -qxF "$RELEASE_KEY_SECRET" <<<"$secrets"; then
    drift "${RELEASE_KEY_SECRET} is a repository secret; keep it only in the ${RELEASE_ENV} environment"
  fi
  secrets="$(gh api --paginate "repos/${repo}/actions/organization-secrets" --jq '.secrets[].name')"
  if grep -qxF "$RELEASE_KEY_SECRET" <<<"$secrets"; then
    drift "${RELEASE_KEY_SECRET} is an organization secret this repo can read; keep it only in the ${RELEASE_ENV} environment"
  fi
  # Another environment may accept runs from any branch, which could then mint
  # an app token and tag through the ruleset's app bypass.
  # Assigned first so a failed listing stops the script under set -e.
  envs="$(gh api --paginate "repos/${repo}/environments" --jq '.environments[].name')"
  while IFS= read -r env; do
    if [[ -z "$env" || "$env" == "$RELEASE_ENV" ]]; then
      continue
    fi
    secrets="$(gh api --paginate "repos/${repo}/environments/${env}/secrets" --jq '.secrets[].name')"
    if grep -qxF "$RELEASE_KEY_SECRET" <<<"$secrets"; then
      drift "${RELEASE_KEY_SECRET} is a secret of the ${env} environment; keep it only in the ${RELEASE_ENV} environment"
    fi
  done <<<"$envs"
}

# Creates or tightens the release environment. Moving the key into it and
# removing an approval rule are left to an admin: the API never returns a
# secret's value, and a PUT without reviewers would silently strip them.
apply_release_env() {
  local env_json status=0
  env_json="$(get_environment "$RELEASE_ENV")" || status=$?
  if [[ "$status" -ne 0 && "$status" -ne 3 ]]; then
    exit 1
  fi
  if [[ "$status" -eq 0 && "$(has_approval_rule "$env_json")" == "true" ]]; then
    echo "ERROR: ${RELEASE_ENV} has required reviewers or a wait timer; an admin must remove them, then re-run." >&2
    exit 1
  fi
  jq -n '{can_admins_bypass: false, deployment_branch_policy: {protected_branches: false, custom_branch_policies: true}}' |
    gh api -X PUT "repos/${repo}/environments/${RELEASE_ENV}" --input - >/dev/null
  sync_policies "$RELEASE_ENV" "branch:main"
  echo "UPDATED: ${RELEASE_ENV}"
}

app_id="$(gh api "apps/${RELEASE_APP_SLUG}" | jq -r '.id')"
if ! [[ "$app_id" =~ ^[0-9]+$ ]]; then
  echo "ERROR: could not look up the ${RELEASE_APP_SLUG} app id" >&2
  exit 1
fi

if [[ "$apply" == true ]]; then
  while read -r name target pattern rules; do
    apply_ruleset "$name" "$target" "$pattern" "$rules" "$app_id"
  done <<<"$RULESETS"
  apply_release_env
  while read -r env pattern; do
    apply_environment "$env" "$pattern"
  done <<<"$PROD_ENVIRONMENTS"
  echo "Re-checking ${repo}..."
fi

while read -r name target pattern rules; do
  check_ruleset "$name" "$target" "$pattern" "$rules" "$app_id"
done <<<"$RULESETS"
check_release_env
while read -r env pattern; do
  check_environment "$env" "$pattern"
done <<<"$PROD_ENVIRONMENTS"

if [[ "$drift_count" -gt 0 ]]; then
  echo "FAIL: ${drift_count} release protection setting(s) differ in ${repo}."
  if [[ "$apply" != true ]]; then
    echo "Run '$0 --apply --repo ${repo}' as a repo admin to fix them."
  fi
  exit 1
fi
echo "OK: release tags and branches, the release app key and production environments are protected in ${repo}."
