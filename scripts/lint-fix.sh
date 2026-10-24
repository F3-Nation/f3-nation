#!/usr/bin/env bash
# `pnpm lint:fix`. Only workspaces with a tracked eslint-suppressions.json get
# `--prune-suppressions`: ESLint writes an empty baseline into any workspace it
# prunes, and the Python lint wrappers reject the flag.
set -uo pipefail

if (($# > 0)); then
  echo "lint:fix: arguments are not supported; it always runs repo-wide. Run \`pnpm lint\` in a workspace to check one." >&2
  exit 2
fi

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

# ESLint prunes even when lint fails, and a parse error drops every entry for
# that file, so restore the baselines if any pruning workspace fails.
backup="$(mktemp -d)"
trap 'rm -rf "$backup"' EXIT
for file in "${baselines[@]}"; do
  mkdir -p "$backup/$(dirname "$file")"
  cp "$file" "$backup/$file"
done
if ! turbo run lint --continue "${include[@]}" -- --fix --prune-suppressions "${cache[@]}"; then
  for file in "${baselines[@]}"; do
    cp "$backup/$file" "$file"
  done
  echo "lint:fix: lint failed; eslint-suppressions.json files left unpruned." >&2
  exit 1
fi
# ESLint saves the baseline unformatted.
prettier --write --log-level warn "${baselines[@]}" || status=$?
exit "$status"
