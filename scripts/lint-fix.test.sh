#!/usr/bin/env bash
# Regression test for scripts/lint-fix.sh: any argument is rejected before
# lint runs, so `pnpm lint:fix --filter=...` can't silently fix repo-wide.
# Run directly: bash scripts/lint-fix.test.sh
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${script_dir}/.."
failures=0

tmp_dir=""
trap 'if [[ -n "$tmp_dir" ]]; then rm -rf "$tmp_dir"; fi' EXIT
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/lint-fix-test.XXXXXX")" || exit 1

# A fake turbo that records any invocation, so the test can prove it never ran.
mkdir -p "$tmp_dir/bin"
printf '#!/usr/bin/env bash\ntouch "%s/turbo.called"\n' "$tmp_dir" >"$tmp_dir/bin/turbo"
chmod +x "$tmp_dir/bin/turbo"

output="$(cd "$repo_root" && PATH="$tmp_dir/bin:$PATH" bash scripts/lint-fix.sh --filter=./apps/map 2>&1)"
status=$?

if [[ "$status" -eq 2 ]]; then
  echo "PASS: an argument exits 2"
else
  echo "FAIL: an argument exits 2 (got ${status})"
  failures=$((failures + 1))
fi

if [[ "$output" == *"arguments are not supported"* ]]; then
  echo "PASS: an argument explains why"
else
  echo "FAIL: an argument explains why (got: ${output})"
  failures=$((failures + 1))
fi

if [[ -e "$tmp_dir/turbo.called" ]]; then
  echo "FAIL: an argument never reaches turbo"
  failures=$((failures + 1))
else
  echo "PASS: an argument never reaches turbo"
fi

exit "$failures"
