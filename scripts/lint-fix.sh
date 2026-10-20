#!/usr/bin/env bash
# `pnpm lint:fix`. Only workspaces with a tracked eslint-suppressions.json get
# `--prune-suppressions`: ESLint writes an empty baseline into any workspace it
# prunes, and the Python lint wrappers reject the flag.
set -uo pipefail

cache=(--cache --cache-location node_modules/.cache/.eslintcache)
baselines=()
include=()
exclude=()
while IFS= read -r file; do
  baselines+=("$file")
  dir="$(dirname "$file")"
  include+=("--filter=./${dir}")
  exclude+=("--filter=!./${dir}")
done < <(git ls-files '*/eslint-suppressions.json')

status=0
if ((${#include[@]} == 0)); then
  turbo run lint --continue -- --fix "${cache[@]}" || status=$?
  exit "$status"
fi

turbo run lint --continue "${exclude[@]}" -- --fix "${cache[@]}" || status=$?
turbo run lint --continue "${include[@]}" -- --fix --prune-suppressions "${cache[@]}" || status=$?
# ESLint saves the baseline unformatted.
prettier --write --log-level warn "${baselines[@]}" || status=$?
exit "$status"
