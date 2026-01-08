#!/usr/bin/env bash
# Copies the launchd plist into place and loads it. Verbose by default.
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLIST_SRC="${REPO_ROOT}/docs/launchd/com.f3.dataingest.plist.sample"
PLIST_DEST="${HOME}/Library/LaunchAgents/com.f3.dataingest.plist"
LOG_DIR="${HOME}/Library/Logs/f3-region-pages-data-ingest"

echo "[info] Repo root: ${REPO_ROOT}"
echo "[info] Plist source: ${PLIST_SRC}"
echo "[info] Plist dest: ${PLIST_DEST}"
echo "[info] Log dir: ${LOG_DIR}"

if [[ ! -f "${PLIST_SRC}" ]]; then
  echo "[error] Missing plist template at ${PLIST_SRC}" >&2
  exit 1
fi

mkdir -p "$(dirname "${PLIST_DEST}")" "${LOG_DIR}"

# Replace the sample paths with current user/repo paths before installing.
TMP_PLIST="$(mktemp)"
sed \
  -e "s|/Users/patrick/src/F3-Nation/f3-region-pages|${REPO_ROOT}|g" \
  -e "s|/Users/patrick/Library/Logs/f3-region-pages-data-ingest|${LOG_DIR}|g" \
  "${PLIST_SRC}" > "${TMP_PLIST}"

echo "[info] Installing plist to ${PLIST_DEST}"
cp "${TMP_PLIST}" "${PLIST_DEST}"
rm -f "${TMP_PLIST}"

echo "[info] Loading launchd job"
launchctl unload "${PLIST_DEST}" >/dev/null 2>&1 || true
launchctl load -w "${PLIST_DEST}"

echo "[info] LaunchAgent installed. You can trigger it now with:"
echo "       launchctl start com.f3.dataingest"

if command -v code >/dev/null 2>&1; then
  echo "[info] VS Code CLI detected; each run will open ${LOG_DIR} in VS Code."
else
  echo "[warn] VS Code CLI 'code' not found. Install it to auto-open ${LOG_DIR} during runs."
fi
