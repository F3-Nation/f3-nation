#!/usr/bin/env bash

set -euo pipefail

ruff_args=()

while (($#)); do
  case "$1" in
    --)
      shift
      ;;
    --cache)
      shift
      ;;
    --cache-location)
      shift
      if (($#)); then
        shift
      fi
      ;;
    --cache-location=*)
      shift
      ;;
    *)
      ruff_args+=("$1")
      shift
      ;;
  esac
done

uv run ruff check . "${ruff_args[@]}"
