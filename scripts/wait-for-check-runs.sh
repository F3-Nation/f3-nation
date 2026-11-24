#!/usr/bin/env bash
# Polls the check runs on GITHUB_SHA in GITHUB_REPOSITORY until every named
# check satisfies MODE, or fails once ATTEMPTS polls have passed.
#
#   exist      every named check has a check run, in any state
#   completed  the newest run of every named check has completed, whatever its
#              conclusion; an older finished run doesn't count while a rerun is
#              pending
#
# Usage: wait-for-check-runs.sh MODE ATTEMPTS INTERVAL_SECONDS CHECK_NAME...
# Needs `gh` signed in (GH_TOKEN in CI). A failed `gh` call fails the wait
# rather than being read as "not there yet".
set -euo pipefail

usage() {
  echo "usage: $0 exist|completed ATTEMPTS INTERVAL_SECONDS CHECK_NAME..." >&2
  exit 2
}

[[ $# -ge 4 ]] || usage
mode="$1" attempts="$2" interval="$3"
shift 3
case "${mode}" in exist | completed) ;; *) usage ;; esac
[[ "${attempts}" =~ ^[1-9][0-9]*$ && "${interval}" =~ ^[0-9]+$ ]] || usage
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}" "${GITHUB_SHA:?GITHUB_SHA must be set}"

missing=""
for _ in $(seq 1 "${attempts}"); do
  if ! runs="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/check-runs?per_page=100" \
    --jq '.check_runs[] | [.name, .status, .id] | @tsv')"; then
    echo "::error::Could not read the check runs on ${GITHUB_SHA}."
    exit 1
  fi
  missing=""
  for name in "$@"; do
    if [[ "${mode}" == exist ]]; then
      awk -F'\t' -v n="${name}" '$1 == n { found = 1 } END { exit !found }' <<<"${runs}" ||
        missing="${missing} ${name}"
    else
      # Judge the newest run (ids only grow), as the staging-refresh gate does.
      awk -F'\t' -v n="${name}" '
        $1 == n && (!seen || $3 + 0 > newest) { seen = 1; newest = $3 + 0; status = $2 }
        END { exit status != "completed" }' <<<"${runs}" ||
        missing="${missing} ${name}"
    fi
  done
  if [[ -z "${missing}" ]]; then exit 0; fi
  # Also after the last attempt, so the wait lasts the full ATTEMPTS x INTERVAL
  # that the timeout message reports.
  sleep "${interval}"
done

minutes=$((attempts * interval / 60))
if [[ "${mode}" == exist ]]; then
  echo "::error::CI didn't start these checks on ${GITHUB_SHA} within ${minutes} minutes:${missing}"
else
  echo "::error::These checks didn't finish on ${GITHUB_SHA} within ${minutes} minutes:${missing}"
fi
exit 1
