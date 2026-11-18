#!/usr/bin/env bash
# Regression tests for scripts/release-protections.sh: the check, --apply,
# drift and error paths, plus a guard that the script's environment list
# matches the deploy workflows.
# `gh` is replaced by a stub that keeps repo state in files, so writes from
# --apply are visible to the re-check that follows them.
# Run directly: bash scripts/release-protections.test.sh
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  if [[ -n "${CI:-}" ]]; then
    echo "FAIL: release-protections tests need jq, which isn't installed"
    exit 1
  fi
  echo "SKIP: release-protections tests need jq, which isn't installed"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
script="${script_dir}/release-protections.sh"
failures=0

pass() { echo "PASS: $1"; }
fail() {
  echo "FAIL: $1"
  shift
  for line in "$@"; do echo "  ${line}"; done
  failures=$((failures + 1))
}

assert_eq() {
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1" "expected: $2" "actual:   $3"; fi
}

assert_contains() {
  if grep -qF -- "$2" <<<"$3"; then pass "$1"; else fail "$1" "missing: $2" "output:" "$3"; fi
}

assert_not_contains() {
  if grep -qF -- "$2" <<<"$3"; then fail "$1" "unexpected: $2" "output:" "$3"; else pass "$1"; fi
}

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/release-protections-test.XXXXXX")" || exit 1

# State layout under $STUB_STATE: rulesets/<id>.json, env/<name>.json,
# policies/<name>.json ({branch_policies: [...]}), repo-secrets,
# org-secrets and env-secrets/<name> (one secret name per line), writes.log
# (one line per write call), fail-env (an environment whose read fails with
# HTTP 500) and fail-secrets (a secrets path whose listing fails with HTTP 403).
cat >"$tmp_dir/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
state="$STUB_STATE"
method=GET
fields=()
input=""
path=""
jq_filter=""
shift # "api"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    --paginate) shift ;;
    --input) input="$(cat)"; shift 2 ;;
    --jq) jq_filter="$2"; shift 2 ;;
    -f) fields+=("$2"); shift 2 ;;
    *) path="$1"; shift ;;
  esac
done
path="${path%%\?*}"
path="${path#repos/acme/app/}"
if [[ "$method" != GET ]]; then
  echo "$method $path" >>"$state/writes.log"
fi
if [[ "$method" == GET && "$(cat "$state/fail-secrets" 2>/dev/null)" == "$path" ]]; then
  echo "HTTP 403: Resource not accessible by integration" >&2
  exit 1
fi
secret_list() {
  jq -R -s '{secrets: [split("\n")[] | select(. != "") | {name: .}]}' "$1"
}
respond() {
case "$method $path" in
  "GET actions/secrets") jq -R -s '{secrets: [split("\n")[] | select(. != "") | {name: .}]}' "$state/repo-secrets" ;;
  "GET actions/organization-secrets") jq -R -s '{secrets: [split("\n")[] | select(. != "") | {name: .}]}' "$state/org-secrets" ;;
  "GET apps/f3-nation-release-please") echo '{"id":4242}' ;;
  "GET rulesets")
    files=("$state"/rulesets/*.json)
    if [[ -e "${files[0]}" ]]; then jq -s '[.[] | {id, name, target}]' "${files[@]}"; else echo '[]'; fi
    ;;
  "GET rulesets/"*) cat "$state/rulesets/${path#rulesets/}.json" ;;
  "POST rulesets")
    id=$((7 + $(find "$state/rulesets" -name '*.json' | wc -l)))
    jq --argjson id "$id" '. + {id: $id}' <<<"$input" >"$state/rulesets/${id}.json"
    ;;
  "PUT rulesets/"*) jq --argjson id "${path#rulesets/}" '. + {id: $id}' <<<"$input" >"$state/rulesets/${path#rulesets/}.json" ;;
  "GET environments") jq -s '{environments: [.[] | {name}]}' "$state"/env/*.json ;;
  "GET environments/"*"/secrets")
    env="${path#environments/}"; env="${env%/secrets}"
    if [[ -f "$state/env-secrets/${env}" ]]; then secret_list "$state/env-secrets/${env}"; else echo '{"secrets":[]}'; fi
    ;;
  "GET environments/"*"/deployment-branch-policies")
    env="${path#environments/}"; env="${env%/deployment-branch-policies}"
    cat "$state/policies/${env}.json"
    ;;
  "POST environments/"*"/deployment-branch-policies")
    env="${path#environments/}"; env="${env%/deployment-branch-policies}"
    name="${fields[0]#name=}"; type="${fields[1]#type=}"
    jq --arg n "$name" --arg t "$type" \
      '.branch_policies += [{id: ((.branch_policies | map(.id) | max // 0) + 1), name: $n, type: $t}]' \
      "$state/policies/${env}.json" >"$state/tmp.json"
    mv "$state/tmp.json" "$state/policies/${env}.json"
    echo "POST policy ${env} ${type}:${name}" >>"$state/writes.log"
    ;;
  "DELETE environments/"*"/deployment-branch-policies/"*)
    rest="${path#environments/}"; env="${rest%%/*}"; id="${rest##*/}"
    jq --argjson id "$id" '.branch_policies |= map(select(.id != $id))' \
      "$state/policies/${env}.json" >"$state/tmp.json"
    mv "$state/tmp.json" "$state/policies/${env}.json"
    ;;
  "GET environments/"*)
    env="${path#environments/}"
    if [[ "$(cat "$state/fail-env" 2>/dev/null)" == "$env" ]]; then
      echo "HTTP 500: Internal Server Error" >&2
      exit 1
    fi
    if [[ ! -f "$state/env/${env}.json" ]]; then
      echo "HTTP 404: Not Found" >&2
      exit 1
    fi
    cat "$state/env/${env}.json"
    ;;
  "PUT environments/"*)
    env="${path#environments/}"
    echo "$input" >"$state/put-${env}.json"
    jq --arg name "$env" '{
      name: $name,
      can_admins_bypass: .can_admins_bypass,
      deployment_branch_policy: .deployment_branch_policy,
      protection_rules: (
        (if (.reviewers // []) | length > 0
          then [{type: "required_reviewers", prevent_self_review: .prevent_self_review,
                 reviewers: [.reviewers[] | {type, reviewer: {id}}]}]
          else [] end)
        + (if (.wait_timer // 0) > 0 then [{type: "wait_timer", wait_timer: .wait_timer}] else [] end)
      )
    }' <<<"$input" >"$state/env/${env}.json"
    ;;
  *)
    echo "unexpected gh call: $method $path" >&2
    exit 2
    ;;
esac
}
if [[ -n "$jq_filter" ]]; then
  respond | jq -r "$jq_filter"
else
  respond
fi
STUB
chmod +x "$tmp_dir/gh"

environments() {
  sed -n "/^PROD_ENVIRONMENTS='/,/'$/p" "$script" | sed "s/^PROD_ENVIRONMENTS='//; s/'$//" | awk '{print $1}'
}

# Fresh state with every gap the script closes: no rulesets, no release
# environment, and every production environment open to admins, any ref and
# self-approval. The release key is only a release-please environment secret;
# cases that need it elsewhere add it.
reset_state() {
  rm -rf "$tmp_dir/state"
  mkdir -p "$tmp_dir/state/rulesets" "$tmp_dir/state/env" "$tmp_dir/state/policies" "$tmp_dir/state/env-secrets"
  : >"$tmp_dir/state/writes.log"
  printf 'RELEASE_PLEASE_APP_ID\n' >"$tmp_dir/state/repo-secrets"
  : >"$tmp_dir/state/org-secrets"
  printf 'RELEASE_PLEASE_APP_ID\nRELEASE_PLEASE_APP_PRIVATE_KEY\n' >"$tmp_dir/state/env-secrets/release-please"
  echo '{"total_count":0,"branch_policies":[]}' >"$tmp_dir/state/policies/release-please.json"
  local env
  for env in $(environments); do
    jq -n --arg name "$env" '{
      name: $name,
      can_admins_bypass: true,
      deployment_branch_policy: null,
      protection_rules: [
        {type: "required_reviewers", prevent_self_review: false,
         reviewers: [{type: "User", reviewer: {id: 11, login: "a"}}, {type: "Team", reviewer: {id: 12, slug: "t"}}]}
      ]
    }' >"$tmp_dir/state/env/${env}.json"
    echo '{"total_count":0,"branch_policies":[]}' >"$tmp_dir/state/policies/${env}.json"
  done
}

run() {
  PATH="$tmp_dir:$PATH" STUB_STATE="$tmp_dir/state" GH_REPO="" bash "$script" --repo acme/app "$@" 2>&1
}

# 1. Unprotected state: check reports every gap and fails.
reset_state
out="$(run)"
code=$?
assert_eq "check fails on an unprotected repo" "1" "$code"
assert_contains "check reports the missing tag ruleset" "DRIFT: no tag ruleset named 'release-tags'" "$out"
assert_contains "check reports the missing branch ruleset" "DRIFT: no branch ruleset named 'release-branches' protects refs/heads/release-please--*" "$out"
assert_contains "check reports admin bypass" "DRIFT: api-production: admins can bypass its protection rules" "$out"
assert_contains "check reports no ref policy" "DRIFT: api-production: deployments are not limited to selected branches and tags" "$out"
assert_contains "check reports self-review" "DRIFT: api-production: reviewers can approve their own deploys" "$out"
assert_contains "check reports the missing release environment" "DRIFT: release-please: environment does not exist" "$out"
assert_eq "check makes no writes" "" "$(cat "$tmp_dir/state/writes.log")"

# 2. --apply fixes everything and the re-check passes.
jq '.protection_rules += [{type: "wait_timer", wait_timer: 5}]' "$tmp_dir/state/env/map-production.json" >"$tmp_dir/x.json"
mv "$tmp_dir/x.json" "$tmp_dir/state/env/map-production.json"
echo '{"total_count":2,"branch_policies":[{"id":1,"name":"*","type":"branch"},{"id":2,"name":"map@*","type":"tag"}]}' \
  >"$tmp_dir/state/policies/map-production.json"
out="$(run --apply)"
code=$?
assert_eq "apply then re-check passes" "0" "$code"
assert_contains "apply reports success" "OK: release tags and branches, the release app key and production environments are protected in acme/app." "$out"
assert_eq "apply creates the release environment closed to admins and other refs" \
  '{"can_admins_bypass":false,"deployment_branch_policy":{"custom_branch_policies":true,"protected_branches":false}}' \
  "$(jq -cS . "$tmp_dir/state/put-release-please.json")"
assert_eq "release environment deploys only from main" \
  "branch:main" \
  "$(jq -r '[.branch_policies[] | "\(.type):\(.name)"] | sort | join(" ")' "$tmp_dir/state/policies/release-please.json")"
ruleset="$(jq -cS '{target, enforcement, include: .conditions.ref_name.include, rules: [.rules[].type], bypass: [.bypass_actors[] | [.actor_type, .actor_id, .bypass_mode]]}' "$tmp_dir/state/rulesets/7.json")"
assert_eq "ruleset limits *@* tags to the release app and org admins" \
  '{"bypass":[["Integration",4242,"always"],["OrganizationAdmin",1,"always"]],"enforcement":"active","include":["refs/tags/*@*"],"rules":["creation","update","deletion"],"target":"tag"}' \
  "$ruleset"
ruleset="$(jq -cS '{target, enforcement, include: .conditions.ref_name.include, rules: [.rules[].type], bypass: [.bypass_actors[] | [.actor_type, .actor_id, .bypass_mode]]}' "$tmp_dir/state/rulesets/8.json")"
assert_eq "ruleset limits release-please branches to the release app and org admins" \
  '{"bypass":[["Integration",4242,"always"],["OrganizationAdmin",1,"always"]],"enforcement":"active","include":["refs/heads/release-please--*"],"rules":["creation","update","deletion","non_fast_forward"],"target":"branch"}' \
  "$ruleset"
put="$(jq -cS . "$tmp_dir/state/put-api-production.json")"
assert_eq "environment update keeps reviewers and turns on the protections" \
  '{"can_admins_bypass":false,"deployment_branch_policy":{"custom_branch_policies":true,"protected_branches":false},"prevent_self_review":true,"reviewers":[{"id":11,"type":"User"},{"id":12,"type":"Team"}],"wait_timer":0}' \
  "$put"
assert_eq "environment update keeps an existing wait timer" "5" "$(jq '.wait_timer' "$tmp_dir/state/put-map-production.json")"
assert_eq "api-production deploys only from api@* tags and main" \
  "branch:main tag:api@*" \
  "$(jq -r '[.branch_policies[] | "\(.type):\(.name)"] | sort | join(" ")' "$tmp_dir/state/policies/api-production.json")"
assert_eq "apply removes a policy outside the desired set and keeps the matching one" \
  "branch:main tag:map@*" \
  "$(jq -r '[.branch_policies[] | "\(.type):\(.name)"] | sort | join(" ")' "$tmp_dir/state/policies/map-production.json")"
assert_not_contains "apply doesn't re-add an existing policy" "POST policy map-production tag:map@*" "$(cat "$tmp_dir/state/writes.log")"

# 3. A second apply on a protected repo updates the rulesets in place.
: >"$tmp_dir/state/writes.log"
out="$(run --apply)"
assert_contains "second apply updates the existing tag ruleset" "PUT rulesets/7" "$(cat "$tmp_dir/state/writes.log")"
assert_contains "second apply updates the existing branch ruleset" "PUT rulesets/8" "$(cat "$tmp_dir/state/writes.log")"
assert_not_contains "second apply creates no ruleset" "POST rulesets" "$(cat "$tmp_dir/state/writes.log")"
assert_not_contains "second apply adds no policies" "POST policy" "$(cat "$tmp_dir/state/writes.log")"

# The protected state from here on passes the check; each case below breaks
# one setting, expects drift, and restores the file it changed.
out="$(run)"
code=$?
assert_eq "check passes with the key only in the release environment" "0" "$code"

cp "$tmp_dir/state/rulesets/7.json" "$tmp_dir/ruleset.bak"
jq '.bypass_actors += [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]' \
  "$tmp_dir/ruleset.bak" >"$tmp_dir/state/rulesets/7.json"
out="$(run)"
code=$?
assert_eq "check fails on an extra ruleset bypass actor" "1" "$code"
assert_contains "check reports the extra bypass actor" "DRIFT: tag ruleset 'release-tags' differs from the desired state" "$out"
jq '.enforcement = "evaluate"' "$tmp_dir/ruleset.bak" >"$tmp_dir/state/rulesets/7.json"
out="$(run)"
code=$?
assert_eq "check fails on an evaluate-only ruleset" "1" "$code"
assert_contains "check reports the evaluate-only ruleset" "DRIFT: tag ruleset 'release-tags' differs from the desired state" "$out"
cp "$tmp_dir/ruleset.bak" "$tmp_dir/state/rulesets/7.json"

mv "$tmp_dir/state/rulesets/8.json" "$tmp_dir/ruleset.bak"
out="$(run)"
code=$?
assert_eq "check fails without the branch ruleset" "1" "$code"
assert_contains "check reports the missing branch ruleset" "DRIFT: no branch ruleset named 'release-branches'" "$out"
jq '.bypass_actors += [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]' \
  "$tmp_dir/ruleset.bak" >"$tmp_dir/state/rulesets/8.json"
out="$(run)"
code=$?
assert_eq "check fails on an extra branch ruleset bypass actor" "1" "$code"
assert_contains "check reports the branch ruleset's extra bypass actor" "DRIFT: branch ruleset 'release-branches' differs from the desired state" "$out"
jq '.enforcement = "evaluate"' "$tmp_dir/ruleset.bak" >"$tmp_dir/state/rulesets/8.json"
out="$(run)"
code=$?
assert_eq "check fails on an evaluate-only branch ruleset" "1" "$code"
assert_contains "check reports the evaluate-only branch ruleset" "DRIFT: branch ruleset 'release-branches' differs from the desired state" "$out"
cp "$tmp_dir/ruleset.bak" "$tmp_dir/state/rulesets/8.json"

cp "$tmp_dir/state/env/api-production.json" "$tmp_dir/env.bak"
jq '.protection_rules = []' "$tmp_dir/env.bak" >"$tmp_dir/state/env/api-production.json"
out="$(run)"
code=$?
assert_eq "check fails on an environment without reviewers" "1" "$code"
assert_contains "check reports no required reviewers" "DRIFT: api-production: no required reviewers" "$out"
cp "$tmp_dir/env.bak" "$tmp_dir/state/env/api-production.json"

cp "$tmp_dir/state/env/release-please.json" "$tmp_dir/env.bak"
jq '.can_admins_bypass = true' "$tmp_dir/env.bak" >"$tmp_dir/state/env/release-please.json"
out="$(run)"
assert_contains "check reports admin bypass on the release environment" "DRIFT: release-please: admins can bypass its protection rules" "$out"
jq '.deployment_branch_policy = null' "$tmp_dir/env.bak" >"$tmp_dir/state/env/release-please.json"
out="$(run)"
code=$?
assert_eq "check fails on an unrestricted release environment" "1" "$code"
assert_contains "check reports an unrestricted release environment" \
  "DRIFT: release-please: deployments are not limited to selected branches and tags" "$out"
jq '.protection_rules = [{type: "wait_timer", wait_timer: 5}]' "$tmp_dir/env.bak" >"$tmp_dir/state/env/release-please.json"
cp "$tmp_dir/state/env/release-please.json" "$tmp_dir/env-wait.json"
out="$(run)"
code=$?
assert_eq "check fails on a release environment that waits" "1" "$code"
assert_contains "check reports a release environment wait timer" \
  "DRIFT: release-please: has required reviewers or a wait timer; release-please must run without waiting" "$out"
: >"$tmp_dir/state/writes.log"
out="$(run --apply)"
code=$?
assert_eq "apply fails on a release environment that waits" "1" "$code"
assert_contains "apply says an admin must remove the wait" "ERROR: release-please has required reviewers or a wait timer" "$out"
assert_not_contains "apply doesn't PUT a release environment that waits" "PUT environments/release-please" "$(cat "$tmp_dir/state/writes.log")"
assert_eq "apply leaves the waiting release environment unchanged" \
  "$(jq -cS . "$tmp_dir/env-wait.json")" "$(jq -cS . "$tmp_dir/state/env/release-please.json")"
jq '.protection_rules = [{type: "required_reviewers", reviewers: [{type: "User", reviewer: {id: 11}}]}]' \
  "$tmp_dir/env.bak" >"$tmp_dir/state/env/release-please.json"
out="$(run)"
code=$?
assert_eq "check fails on a release environment with required reviewers" "1" "$code"
assert_contains "check reports release environment reviewers" \
  "DRIFT: release-please: has required reviewers or a wait timer" "$out"
: >"$tmp_dir/state/writes.log"
out="$(run --apply)"
code=$?
assert_eq "apply fails on a release environment with required reviewers" "1" "$code"
assert_contains "apply says an admin must remove the reviewers" "ERROR: release-please has required reviewers or a wait timer" "$out"
assert_not_contains "apply doesn't PUT a release environment with reviewers" "PUT environments/release-please" "$(cat "$tmp_dir/state/writes.log")"
cp "$tmp_dir/env.bak" "$tmp_dir/state/env/release-please.json"

cp "$tmp_dir/state/policies/release-please.json" "$tmp_dir/policies.bak"
jq '.branch_policies += [{id: 98, name: "release-please--*", type: "branch"}]' \
  "$tmp_dir/policies.bak" >"$tmp_dir/state/policies/release-please.json"
out="$(run)"
assert_contains "check reports a release environment open to another branch" \
  "DRIFT: release-please: deployment policies are [branch:main,branch:release-please--*], want [branch:main]" "$out"
cp "$tmp_dir/policies.bak" "$tmp_dir/state/policies/release-please.json"

echo "RELEASE_PLEASE_APP_PRIVATE_KEY" >>"$tmp_dir/state/repo-secrets"
out="$(run)"
code=$?
assert_eq "check fails on a repo-level release key" "1" "$code"
assert_contains "check names the repo-level release key" "DRIFT: RELEASE_PLEASE_APP_PRIVATE_KEY is a repository secret" "$out"
out="$(run --apply)"
code=$?
assert_eq "apply can't clear a repo-level release key" "1" "$code"
printf 'RELEASE_PLEASE_APP_ID\n' >"$tmp_dir/state/repo-secrets"

echo "RELEASE_PLEASE_APP_PRIVATE_KEY" >"$tmp_dir/state/org-secrets"
out="$(run)"
code=$?
assert_eq "check fails on an org-level release key" "1" "$code"
assert_contains "check names the org-level release key" "DRIFT: RELEASE_PLEASE_APP_PRIVATE_KEY is an organization secret" "$out"
: >"$tmp_dir/state/org-secrets"

echo '{"name":"me-staging"}' >"$tmp_dir/state/env/me-staging.json"
echo "RELEASE_PLEASE_APP_PRIVATE_KEY" >"$tmp_dir/state/env-secrets/me-staging"
out="$(run)"
code=$?
assert_eq "check fails on a release key in another environment" "1" "$code"
assert_contains "check names the other environment holding the release key" \
  "DRIFT: RELEASE_PLEASE_APP_PRIVATE_KEY is a secret of the me-staging environment; keep it only in the release-please environment" "$out"
rm "$tmp_dir/state/env/me-staging.json" "$tmp_dir/state/env-secrets/me-staging"

printf 'RELEASE_PLEASE_APP_ID\n' >"$tmp_dir/state/env-secrets/release-please"
out="$(run)"
code=$?
assert_eq "check fails when the release environment lacks the key" "1" "$code"
assert_contains "check reports the missing release key" \
  "DRIFT: RELEASE_PLEASE_APP_PRIVATE_KEY is not a secret of the release-please environment" "$out"
printf 'RELEASE_PLEASE_APP_ID\nRELEASE_PLEASE_APP_PRIVATE_KEY\n' >"$tmp_dir/state/env-secrets/release-please"

for secrets_path in actions/secrets actions/organization-secrets environments environments/release-please/secrets environments/admin-production/secrets; do
  echo "$secrets_path" >"$tmp_dir/state/fail-secrets"
  out="$(run)"
  code=$?
  assert_eq "check fails when ${secrets_path} can't be listed" "1" "$code"
  assert_not_contains "check doesn't report OK when ${secrets_path} can't be listed" "OK:" "$out"
done
rm "$tmp_dir/state/fail-secrets"

# 4. Drift after a protected state: one policy widened, one reviewer list.
jq '.branch_policies += [{id: 99, name: "release/*", type: "branch"}]' "$tmp_dir/state/policies/me-production.json" >"$tmp_dir/x.json"
mv "$tmp_dir/x.json" "$tmp_dir/state/policies/me-production.json"
jq '.protection_rules[0].reviewers |= .[0:1]' "$tmp_dir/state/env/region-pages-production.json" >"$tmp_dir/x.json"
mv "$tmp_dir/x.json" "$tmp_dir/state/env/region-pages-production.json"
out="$(run)"
code=$?
assert_eq "check fails on an extra deployment policy" "1" "$code"
assert_contains "check names the extra policy" "DRIFT: me-production: deployment policies are [branch:main,branch:release/*,tag:me@*], want [branch:main,tag:me@*]" "$out"
assert_contains "check warns about a single reviewer" "WARN: region-pages-production: only one required reviewer" "$out"

# 5. A missing environment is drift; apply refuses to create it without reviewers.
reset_state
rm "$tmp_dir/state/env/me-production.json"
out="$(run)"
assert_contains "check reports a missing environment" "DRIFT: me-production: environment does not exist" "$out"
out="$(run --apply)"
code=$?
assert_eq "apply fails on a missing environment" "1" "$code"
assert_contains "apply says to create the environment" "ERROR: me-production does not exist" "$out"

# 6. Apply refuses to strip an environment's reviewers.
reset_state
jq '.protection_rules = []' "$tmp_dir/state/env/api-production.json" >"$tmp_dir/x.json"
mv "$tmp_dir/x.json" "$tmp_dir/state/env/api-production.json"
out="$(run --apply)"
code=$?
assert_eq "apply fails on an environment without reviewers" "1" "$code"
assert_contains "apply names the environment without reviewers" "ERROR: api-production has no required reviewers" "$out"
assert_not_contains "apply doesn't PUT an environment without reviewers" "PUT environments/api-production" "$(cat "$tmp_dir/state/writes.log")"

# 7. A gh error other than 404 fails the check instead of passing it.
reset_state
PATH="$tmp_dir:$PATH" STUB_STATE="$tmp_dir/state" bash "$script" --repo acme/app --apply >/dev/null 2>&1
echo "map-production" >"$tmp_dir/state/fail-env"
out="$(run)"
code=$?
assert_eq "check fails when an environment can't be read" "1" "$code"
assert_contains "check reports the read error" "ERROR: could not read environment 'map-production'" "$out"
assert_not_contains "check doesn't report OK after a read error" "OK:" "$out"
rm "$tmp_dir/state/fail-env"

echo "release-please" >"$tmp_dir/state/fail-env"
: >"$tmp_dir/state/writes.log"
out="$(run --apply)"
code=$?
assert_eq "apply fails when the release environment can't be read" "1" "$code"
assert_not_contains "apply doesn't PUT an unreadable release environment" "PUT environments/release-please" "$(cat "$tmp_dir/state/writes.log")"
assert_not_contains "apply stops before the production environments" "-production" "$(cat "$tmp_dir/state/writes.log")"
rm "$tmp_dir/state/fail-env"

# 8. Argument handling.
out="$(run --repo)"
code=$?
assert_eq "--repo without a value is a usage error" "2" "$code"
out="$(run --bogus)"
code=$?
assert_eq "unknown argument is a usage error" "2" "$code"

# 9. PROD_ENVIRONMENTS and the deploy workflows' prod_environment inputs match.
listed="$(environments | LC_ALL=C sort -u)"
used="$(grep -hE '^[[:space:]]+prod_environment:' "$repo_root"/.github/workflows/*.yml | awk '{print $2}' | LC_ALL=C sort -u)"
missing="$(LC_ALL=C comm -13 <(echo "$listed") <(echo "$used"))"
assert_eq "every workflow prod_environment is listed in PROD_ENVIRONMENTS" "" "$missing"
extra="$(LC_ALL=C comm -23 <(echo "$listed") <(echo "$used"))"
assert_eq "every PROD_ENVIRONMENTS entry is used by a deploy workflow" "" "$extra"

if [[ "$failures" -gt 0 ]]; then
  echo "${failures} release-protections test(s) failed"
  exit 1
fi
echo "All release-protections tests passed"
