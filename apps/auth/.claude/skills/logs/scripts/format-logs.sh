#!/usr/bin/env bash
set -euo pipefail

# format-logs.sh — format gcloud JSON log output into a readable table
#
# Reads JSON from stdin (gcloud logging read --format=json output).
# Prints a markdown summary table to stdout.
#
# Usage: cat logs.json | format-logs.sh

INPUT=$(cat)

if [ -z "$INPUT" ] || [ "$INPUT" = "[]" ]; then
  echo "No log entries found."
  exit 0
fi

# --- summary counts ---
TOTAL=$(echo "$INPUT" | jq 'length' 2>/dev/null || echo 0)
ERRORS=$(echo "$INPUT" | jq '[.[] | select(.severity == "ERROR")] | length' 2>/dev/null || echo 0)
WARNINGS=$(echo "$INPUT" | jq '[.[] | select(.severity == "WARNING")] | length' 2>/dev/null || echo 0)
INFOS=$(echo "$INPUT" | jq '[.[] | select(.severity == "INFO" or .severity == "DEFAULT" or .severity == null)] | length' 2>/dev/null || echo 0)

# --- table header ---
echo "| Timestamp | Severity | Method + URL | Status | Latency | Remote IP |"
echo "|-----------|----------|--------------|--------|---------|-----------|"

# --- table rows ---
echo "$INPUT" | jq -r '.[] | [
  (.timestamp // .receiveTimestamp // "—"),
  (.severity // "DEFAULT"),
  (if .httpRequest then
    ((.httpRequest.requestMethod // "—") + " " + ((.httpRequest.requestUrl // "—") | split("?")[0]))
  else
    ((.textPayload // .jsonPayload.message // "—") | .[0:80])
  end),
  (.httpRequest.status // "—" | tostring),
  (.httpRequest.latency // "—" | tostring),
  (.httpRequest.remoteIp // "—")
] | "| " + .[0] + " | " + .[1] + " | " + .[2] + " | " + .[3] + " | " + .[4] + " | " + .[5] + " |"'

# --- summary footer ---
echo ""
echo "**Total:** ${TOTAL} entries — ${ERRORS} errors, ${WARNINGS} warnings, ${INFOS} info/default"

# --- error patterns ---
if [ "${ERRORS:-0}" -gt 0 ] || [ "$(echo "$INPUT" | jq '[.[] | select(.httpRequest.status >= 400)] | length' 2>/dev/null || echo 0)" -gt 0 ]; then
  echo ""
  echo "**Status code breakdown:**"
  echo "$INPUT" | jq -r '
    [.[] | select(.httpRequest.status != null) | .httpRequest.status | tostring] |
    group_by(.) |
    map({code: .[0], count: length}) |
    sort_by(-.count) |
    .[] |
    "- " + .code + ": " + (.count | tostring) + "x"
  ' 2>/dev/null || true
fi
