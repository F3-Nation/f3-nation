#!/usr/bin/env bash
# .agents/skills/github/scripts/gh-check.sh

set -euo pipefail

require_write=false
for arg in "$@"; do
    if [[ "$arg" == "--require-write" ]]; then
        require_write=true
    else
        echo "ERROR: Unknown argument: $arg"
        echo "Usage: $0 [--require-write]"
        exit 1
    fi
done

# 1. Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "ERROR: GitHub CLI ('gh') is not installed."
    echo "INSTRUCTION FOR USER: Please install GitHub CLI by following: https://cli.github.com/"
    exit 1
fi

# 2. Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "ERROR: GitHub CLI is not authenticated."
    echo "INSTRUCTION FOR USER: Please run 'gh auth login' in your terminal and select GitHub.com."
    exit 1
fi

# 3. Check whether the current repository is accessible and whether access is read-only
if ! repo_permission="$(gh repo view --json viewerPermission --jq '.viewerPermission' 2>/dev/null)"; then
    echo "ERROR: The current repository is not accessible."
    exit 1
fi

case "$repo_permission" in
    WRITE|MAINTAIN|ADMIN)
        echo "SUCCESS: gh CLI is installed, authenticated, and has write access to the current repository."
        ;;
    READ)
        if [[ "$require_write" == true ]]; then
            echo "ERROR: The current repository is accessible only in read-only mode. Write operations are not permitted."
            exit 1
        fi
        echo "SUCCESS: gh CLI is installed, authenticated, and the current repository is accessible in read-only mode."
        ;;
    NONE|NULL|TRIAGE|"")
        echo "ERROR: The current repository is not accessible or has insufficient permissions."
        exit 1
        ;;
    *)
        echo "ERROR: Unknown repository permission: $repo_permission"
        exit 1
        ;;
esac