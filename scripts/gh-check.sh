#!/usr/bin/env bash
# scripts/gh-check.sh

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

# 3. Check whether the target repository is accessible and whether access is read-only.
# `gh repo view` without an argument resolves the repository from the checkout's git
# remotes and ignores GH_REPO, so pass GH_REPO explicitly when it is set.
repo_label="${GH_REPO:-the current repository}"
# gh's stderr carries the real cause of a failure (typo in GH_REPO, missing token
# scope, SSO enforcement, network error), so keep it and show it.
gh_err=""
trap 'if [[ -n "$gh_err" ]]; then rm -f "$gh_err"; fi' EXIT
gh_err="$(mktemp "${TMPDIR:-/tmp}/gh-check.XXXXXX")"
if ! repo_permission="$(gh repo view ${GH_REPO:+"$GH_REPO"} --json viewerPermission --jq '.viewerPermission' 2>"$gh_err")"; then
    echo "ERROR: Cannot access ${repo_label}."
    sed 's/^/  gh: /' "$gh_err"
    if [[ -n "${GH_REPO:-}" ]]; then
        echo "INSTRUCTION FOR USER: Check that GH_REPO is set to an <owner>/<name> repository you can access."
    else
        echo "INSTRUCTION FOR USER: Run this from a cloned repository directory or set GH_REPO to a repository you can access."
    fi
    exit 1
fi

case "$repo_permission" in
    WRITE|MAINTAIN|ADMIN)
        echo "SUCCESS: gh CLI is installed, authenticated, and has write access to ${repo_label}."
        ;;
    READ)
        if [[ "$require_write" == true ]]; then
            echo "ERROR: Access to ${repo_label} is read-only. Write operations are not permitted."
            exit 1
        fi
        echo "SUCCESS: gh CLI is installed, authenticated, and ${repo_label} is accessible in read-only mode."
        ;;
    NONE|NULL|TRIAGE|"")
        echo "ERROR: Cannot access ${repo_label} or it has insufficient permissions."
        exit 1
        ;;
    *)
        echo "ERROR: Unknown repository permission: $repo_permission"
        exit 1
        ;;
esac