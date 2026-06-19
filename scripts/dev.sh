#!/usr/bin/env bash

set -euo pipefail

include_py=false
turbo_args=()

for arg in "$@"; do
  case "$arg" in
    --include-py | --include-python)
      include_py=true
      ;;
    *)
      turbo_args+=("$arg")
      ;;
  esac
done

if [[ "$include_py" == "true" ]]; then
  exec turbo dev "${turbo_args[@]}"
fi

exec turbo dev --filter='!slack-bot' "${turbo_args[@]}"
