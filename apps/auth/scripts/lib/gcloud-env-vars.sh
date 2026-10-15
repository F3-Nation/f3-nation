#!/usr/bin/env bash
# Shared by cloud-run-env.sh and cloud-run-env-auth3.sh. Source it; don't run it.

# join_env_vars DELIM KEY=VALUE...
#
# DELIM must be one character: IFS joins with only its first character.
#
# Prints the entries as one --update-env-vars value in gcloud's "^DELIM^"
# custom-delimiter syntax. A plain comma join breaks values that contain a
# comma (EMAIL_FROM can carry a quoted display name, e.g.
# "Team, F3 <support@example.com>"): gcloud splits them into separate vars.
#
# Fails, naming the variable, if any entry contains DELIM, rather than letting
# gcloud split that value. Call it in an assignment, not inline in the gcloud
# arguments, so `set -e` sees the failure:
#   ENV_VARS_ARG="$(join_env_vars "|" "${UPDATE_ARGS[@]}")"
join_env_vars() {
  local delim="$1"
  if [[ ${#delim} -ne 1 ]]; then
    echo "Error: env-var delimiter must be a single character, got '$delim'." >&2
    return 1
  fi
  shift
  local entry
  for entry in "$@"; do
    if [[ "$entry" == *"$delim"* ]]; then
      echo "Error: ${entry%%=*} contains '$delim', the env-var delimiter. Remove it from the value." >&2
      return 1
    fi
  done
  local IFS="$delim"
  printf '^%s^%s' "$delim" "$*"
}
