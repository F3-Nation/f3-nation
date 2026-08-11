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
#   in the graph. Python tools reject them. Only strips them from the trailing
#   run of the command's argument list, so identical tokens that are genuinely
#   part of the wrapped command (e.g. a `--` the wrapped tool itself expects,
#   followed by more of its own args) are left alone.
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

cmd=("$@")
while ((${#cmd[@]})); do
  n=${#cmd[@]}
  last="${cmd[$((n - 1))]}"
  case "$last" in
    --cache | --)
      cmd=("${cmd[@]:0:$((n - 1))}")
      continue
      ;;
    --cache-location=*)
      cmd=("${cmd[@]:0:$((n - 1))}")
      continue
      ;;
  esac
  if ((n >= 2)) && [[ "${cmd[$((n - 2))]}" == "--cache-location" ]]; then
    cmd=("${cmd[@]:0:$((n - 2))}")
    continue
  fi
  break
done

if ((${#cmd[@]} == 0)); then
  echo "ERROR: command stripped to empty — usage: python-task.sh <task-name> <package-label> <command...>" >&2
  exit 2
fi

exec "${cmd[@]}"
