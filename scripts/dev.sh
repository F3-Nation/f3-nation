#!/usr/bin/env bash

set -euo pipefail

include_py=false
slackbot_requested=false
turbo_args=()
expecting_filter_value=false

for arg in "$@"; do
  if [[ "$expecting_filter_value" == true ]]; then
    if [[ "$arg" == *f3-slackbot* ]]; then
      slackbot_requested=true
    fi

    turbo_args+=("$arg")
    expecting_filter_value=false
    continue
  fi

  case "$arg" in
    --include-py | --include-python)
      include_py=true
      ;;
    -F | --filter)
      turbo_args+=("$arg")
      expecting_filter_value=true
      ;;
    -F=* | --filter=*)
      if [[ "${arg#*=}" == *f3-slackbot* ]]; then
        slackbot_requested=true
      fi

      turbo_args+=("$arg")
      ;;
    *)
      if [[ "$arg" == *f3-slackbot* ]]; then
        slackbot_requested=true
      fi

      turbo_args+=("$arg")
      ;;
  esac
done

if [[ "$include_py" == "true" || "$slackbot_requested" == "true" ]]; then
  exec turbo dev "${turbo_args[@]+"${turbo_args[@]}"}"
fi

exec turbo dev --filter='!f3-slackbot' "${turbo_args[@]+"${turbo_args[@]}"}"
