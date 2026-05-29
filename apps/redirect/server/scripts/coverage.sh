#!/usr/bin/env bash
# Run unit tests with coverage and enforce a minimum threshold on the
# business-logic packages.
#
# The cloud-IO packages (internal/certstore, internal/server) and the cmd/
# entrypoints talk to live GCS / ACME / sockets and are validated by the
# deploy-time smoke test, not unit coverage — so they are intentionally
# excluded from the gate to keep the threshold meaningful.
#
# Usage:
#   scripts/coverage.sh                 # enforce default threshold
#   COVER_THRESHOLD=80 scripts/coverage.sh
#   COVER_PKGS="./internal/mappings/..." scripts/coverage.sh
set -euo pipefail

# Run from the Go module root (this script lives at <module>/scripts/).
cd "$(cd "$(dirname "$0")/.." && pwd)"

COVER_THRESHOLD="${COVER_THRESHOLD:-70}"
COVER_PKGS="${COVER_PKGS:-./internal/mappings/... ./internal/redirect/...}"
PROFILE="${COVER_PROFILE:-coverage.out}"

echo "==> go test (coverage gate ${COVER_THRESHOLD}% on: ${COVER_PKGS})"
# shellcheck disable=SC2086
go test -covermode=atomic -coverprofile="$PROFILE" $COVER_PKGS

TOTAL=$(go tool cover -func="$PROFILE" | awk '/^total:/ {gsub("%","",$3); print $3}')
echo "==> total coverage: ${TOTAL}%"

# Optional HTML report (gitignored).
go tool cover -html="$PROFILE" -o coverage.html 2>/dev/null || true

awk -v t="$TOTAL" -v min="$COVER_THRESHOLD" 'BEGIN {
  if (t+0 < min+0) {
    printf "FAIL: coverage %.1f%% is below threshold %s%%\n", t, min
    exit 1
  }
  printf "PASS: coverage %.1f%% meets threshold %s%%\n", t, min
}'
