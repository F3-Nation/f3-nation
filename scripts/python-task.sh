#!/usr/bin/env bash
# Shared wrapper for Python-backed pnpm/turbo tasks (currently the Slack bot;
# any future Python package can route through this too).
#
# - Skips cleanly (exit 0, one line) when `uv` isn't installed locally, so
#   contributors without Python installed can still run `pnpm lint`/`pnpm test`.
# - Never skips in CI: if `uv` is missing while `CI` is set, fails loudly
#   instead, so the gate can never be silently switched off.
# - Strips the ESLint/Prettier cache flags (`--cache`, `--cache-location <path>`,
#   a bare `--`) that turbo's root `lint`/`format` scripts append to every task
#   in the graph. Python tools reject them.
#
# Usage: python-task.sh <task-name> <package-label> <command...>
set -uo pipefail

task_name="${1:?usage: python-task.sh <task-name> <package-label> <command...>}"
package_label="${2:?usage: python-task.sh <task-name> <package-label> <command...>}"
shift 2

if (($# == 0)); then
  echo "ERROR: missing command — usage: python-task.sh <task-name> <package-label> <command...>" >&2
  exit 2
fi

if ! command -v uv >/dev/null 2>&1; then
  if [ -n "${CI:-}" ]; then
    echo "ERROR: uv is not installed and CI is set — refusing to skip '${task_name}' for ${package_label}." >&2
    exit 1
  fi

  cat <<EOF
Skipping ${task_name} for ${package_label}: uv is not installed. See docs/LOCAL_DEV_DOCKER.md — run \`pnpm python:install\` after installing uv.
EOF
  exit 0
fi

cmd=()
while (($#)); do
  case "$1" in
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
    --)
      shift
      ;;
    *)
      cmd+=("$1")
      shift
      ;;
  esac
done

if ((${#cmd[@]} == 0)); then
  echo "ERROR: command stripped to empty — usage: python-task.sh <task-name> <package-label> <command...>" >&2
  exit 2
fi

exec "${cmd[@]}"
