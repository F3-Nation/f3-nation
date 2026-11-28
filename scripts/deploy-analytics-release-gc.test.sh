#!/usr/bin/env bash
# Regression tests for scripts/deploy-analytics-release-gc.sh. `gcloud` is
# replaced by a stub that prints PUBLISHER_IMAGE for `run jobs describe` and
# records the arguments of `run jobs deploy`, so no cloud call is made.
# Run directly: bash scripts/deploy-analytics-release-gc.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_script="${script_dir}/deploy-analytics-release-gc.sh"
repo_args_file="${script_dir}/../apps/analytics/release-gc-job.args"
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/deploy-analytics-release-gc-test.XXXXXX")" || exit 1

cat >"$tmp_dir/gcloud" <<'STUB'
#!/usr/bin/env bash
dir="$(dirname "$0")"
case "$1 $2 $3" in
  "run jobs describe")
    if [[ -n "${DESCRIBE_FAILS:-}" ]]; then
      echo "ERROR: permission denied" >&2
      exit 1
    fi
    printf '%s\n' "${PUBLISHER_IMAGE}"
    ;;
  "run jobs deploy") printf '%s\n' "$@" >"$dir/deployed" ;;
  *)
    echo "unexpected gcloud call: $*" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$tmp_dir/gcloud"

digest_a="sha256:$(printf 'a%.0s' {1..64})"
digest_b="sha256:$(printf 'b%.0s' {1..64})"
image="us-central1-docker.pkg.dev/f3data/cloud-run-builds/analytics-etl:1.4.0@${digest_a}"

# Prints "<exit code> deployed=<yes|no>: <last output line>".
run_deploy() {
  local out code deployed=no
  rm -f "$tmp_dir/deployed"
  out="$(PATH="$tmp_dir:$PATH" \
    IMAGE="${IMAGE_OVERRIDE:-$image}" \
    ARGS_FILE="$1" \
    PUBLISHER_IMAGE="$2" \
    JOB_NAME=analytics-release-gc \
    PUBLISHER_JOB=analytics-etl \
    SERVICE_ACCOUNT=analytics-release-gc@f3data.iam.gserviceaccount.com \
    ANALYTICS_ENV=production \
    BUCKET=f3-analytics \
    PRODUCER_REVISION=gha-1-1 \
    REGION=us-central1 \
    PROJECT=f3data \
    bash "$deploy_script" 2>&1)"
  code=$?
  [[ -e "$tmp_dir/deployed" ]] && deployed=yes
  printf '%s deployed=%s: %s\n' "$code" "$deployed" "$(printf '%s\n' "$out" | tail -n 1)"
}

expect() {
  local description="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected"* ]]; then
    echo "ok - $description"
  else
    echo "not ok - $description"
    echo "  expected prefix: $expected"
    echo "  actual:          $actual"
    failures=$((failures + 1))
  fi
}

expect "deploys with the repo's args when the publisher runs this digest" \
  "0 deployed=yes" "$(run_deploy "$repo_args_file" "$image")"
if grep -qx -- "--args=gc-releases,--apply" "$tmp_dir/deployed" &&
  grep -qx -- "--clear-secrets" "$tmp_dir/deployed" &&
  grep -qx -- "--clear-volumes" "$tmp_dir/deployed" &&
  grep -qx -- "--clear-volume-mounts" "$tmp_dir/deployed"; then
  echo "ok - deploy passes the args file and clears secrets and volumes"
else
  echo "not ok - deploy passes the args file and clears secrets and volumes"
  sed 's/^/  /' "$tmp_dir/deployed"
  failures=$((failures + 1))
fi

expect "skips a release without the args file" \
  "0 deployed=no: ::warning::analytics-release-gc not updated: this release has no release-gc-job.args" \
  "$(run_deploy "$tmp_dir/missing.args" "$image")"

expect "skips when the publisher runs another digest" \
  "0 deployed=no: ::warning::analytics-release-gc not updated: analytics-etl now runs ${digest_b}" \
  "$(run_deploy "$repo_args_file" "us-central1-docker.pkg.dev/f3data/cloud-run-builds/analytics-etl:1.5.0@${digest_b}")"

expect "fails when the publisher image has no digest" \
  "1 deployed=no: ::error::could not read the digest" \
  "$(run_deploy "$repo_args_file" "")"

expect "fails when the publisher lookup fails" \
  "1 deployed=no" \
  "$(DESCRIBE_FAILS=1 run_deploy "$repo_args_file" "$image")"

printf 'gc-releases --apply; rm -rf /\n' >"$tmp_dir/bad.args"
expect "rejects args that are not comma-separated tokens" \
  "1 deployed=no: ::error::release-gc-job.args must be" \
  "$(run_deploy "$tmp_dir/bad.args" "$image")"

expect "rejects an image that is not pinned to a digest" \
  "1 deployed=no: ::error::unexpected image reference" \
  "$(IMAGE_OVERRIDE="us-central1-docker.pkg.dev/f3data/cloud-run-builds/analytics-etl:1.4.0" run_deploy "$repo_args_file" "$image")"

if [[ "$failures" -ne 0 ]]; then
  echo "$failures test(s) failed"
  exit 1
fi
echo "all deploy-analytics-release-gc tests passed"
