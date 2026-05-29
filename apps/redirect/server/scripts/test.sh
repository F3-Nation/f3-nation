#!/usr/bin/env bash
# `pnpm test:coverage` forwards `--coverage` (for vitest) to every test task;
# ignore extra args here and run the Go test suite.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
go test ./... -count=1
