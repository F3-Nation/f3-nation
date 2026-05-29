#!/usr/bin/env bash
# `pnpm lint` forwards `--cache --cache-location …` (for eslint) to every lint
# task; ignore those args and run the Go linters.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
test -z "$(gofmt -l . | tee /dev/stderr)" && go vet ./...
