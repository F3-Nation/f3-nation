#!/usr/bin/env bash
# .agents/skills/github/scripts/gh-check.sh

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
repo_permission="$(gh repo view --json viewerPermission --jq '.viewerPermission' 2>/dev/null)"
repo_status=$?

if [[ $repo_status -ne 0 ]]; then
    echo "ERROR: The current repository is not accessible."
    exit 1
fi

case "$repo_permission" in
    WRITE|MAINTAIN|ADMIN)
        echo "SUCCESS: gh CLI is installed, authenticated, and has write access to the current repository."
        ;;
    READ)
        echo "SUCCESS: gh CLI is installed, authenticated, and the current repository is accessible in read-only mode."
        ;;
    NONE|"")
        echo "ERROR: The current repository is not accessible."
        exit 1
        ;;
    *)
        echo "SUCCESS: gh CLI is installed, authenticated, and the current repository is accessible."
        ;;
esac