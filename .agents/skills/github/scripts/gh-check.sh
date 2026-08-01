#!/usr/bin/env bash
# ./scripts/ai-gh-check.sh

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

# 3. Check access to current repository
if ! gh repo view &> /dev/null; then
    echo "ERROR: Cannot access the current repository."
    echo "INSTRUCTION FOR USER: Ensure you are in the correct git repository directory and have read/write access."
    exit 1
fi

echo "SUCCESS: gh CLI is installed, authenticated, and has repo access."