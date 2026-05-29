#!/usr/bin/env bash
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
test -z "$(gofmt -l . | tee /dev/stderr)"
