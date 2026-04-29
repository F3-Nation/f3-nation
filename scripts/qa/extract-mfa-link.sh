#!/usr/bin/env bash
#
# extract-mfa-link.sh -- find the latest Ethereal preview URL emitted by apps/auth
# in dev mode, fetch the email body, and print either the magic link (default) or
# the 6-digit MFA code.
#
# Why this exists: in local development, apps/auth/src/lib/email-mfa.ts uses
# nodemailer's Ethereal test transport instead of SendGrid. Every send emits a
# log line like:
#
#     Preview email: https://ethereal.email/message/abc123...
#
# That URL is publicly accessible (no auth) and contains the entire email HTML,
# including the 6-digit code and a magic link. Hitting the auth server's
# `/api/auth/callback/credentials` with the email + code completes sign-in
# headlessly. See docs/QA_LOCAL_AUTH.md for the full recipe.
#
# Freshness: by default this script enforces consume-once semantics -- it
# tracks the last URL it returned and refuses to return the same URL twice.
# That is the only reliable way to detect "the auth server didn't actually
# send a fresh email" when the input is a merged Turbo log without per-line
# timestamps. Pass --allow-reuse to disable.

set -euo pipefail

# ---- defaults ---------------------------------------------------------------

LOG_FILE="${F3_AUTH_LOG:-/tmp/f3-auth.log}"
STATE_FILE="${F3_AUTH_LINK_STATE:-${TMPDIR:-/tmp}/extract-mfa-link.last-url}"
MODE="link"          # "link" | "code"
ALLOW_REUSE=0
QUIET=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--code] [--log PATH] [--state PATH] [--allow-reuse] [--quiet] [-h]

Reads a captured apps/auth dev log, finds the latest Ethereal preview URL,
fetches it, and prints the magic link (default) or the 6-digit code.

By default the script enforces consume-once: if the latest preview URL in the
log matches the URL it returned last time, the script exits non-zero with a
"stale URL" error. This catches the common failure mode where the caller
forgot to trigger a fresh send and is about to drive automation against an
already-consumed code. Pass --allow-reuse if you genuinely want the same URL
twice (rare).

Options:
  --code              Print just the 6-digit MFA code instead of the magic link
  --log PATH          Path to the captured auth log
                        (default: \$F3_AUTH_LOG or /tmp/f3-auth.log)
  --state PATH        Path to the consume-once state file
                        (default: \$F3_AUTH_LINK_STATE or
                         \$TMPDIR/extract-mfa-link.last-url)
  --allow-reuse       Skip the consume-once freshness check
  --quiet             Suppress the trailing newline so the value can be
                        captured directly with \$( ... )
  -h, --help          Show this help

Capture the auth log first, e.g.:
  pnpm --filter f3-auth dev > /tmp/f3-auth.log 2>&1 &

Then trigger a send (POST /api/verify-email?action=send, or drive a calling
app's /api/auth/login through the email-entry form), and run this script.
EOF
}

# ---- arg parse --------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --code)         MODE="code"; shift ;;
    --link)         MODE="link"; shift ;;
    --log)          LOG_FILE="${2:?--log requires a path}"; shift 2 ;;
    --state)        STATE_FILE="${2:?--state requires a path}"; shift 2 ;;
    --allow-reuse)  ALLOW_REUSE=1; shift ;;
    --quiet|-q)     QUIET=1; shift ;;
    -h|--help)      usage; exit 0 ;;
    *)              echo "extract-mfa-link.sh: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ---- preflight --------------------------------------------------------------

if ! command -v curl >/dev/null 2>&1; then
  echo "extract-mfa-link.sh: curl is required" >&2
  exit 3
fi

if [[ ! -f "$LOG_FILE" ]]; then
  echo "extract-mfa-link.sh: log file not found: $LOG_FILE" >&2
  echo "  Capture the auth log first, e.g.:" >&2
  echo "    pnpm --filter f3-auth dev > $LOG_FILE 2>&1 &" >&2
  exit 4
fi

# ---- find the latest preview URL --------------------------------------------

PREVIEW_URL="$(grep -oE 'https://ethereal\.email/message/[A-Za-z0-9_-]+' "$LOG_FILE" | tail -1 || true)"

if [[ -z "$PREVIEW_URL" ]]; then
  echo "extract-mfa-link.sh: no Ethereal preview URL found in $LOG_FILE" >&2
  echo "  Has apps/auth been started in dev mode and has a code been requested?" >&2
  echo "  Try: curl -s -X POST -H 'Content-Type: application/json' \\" >&2
  echo "         -d '{\"email\":\"qa-bot@f3nation.test\"}' \\" >&2
  echo "         http://localhost:3004/api/verify-email?action=send" >&2
  exit 5
fi

# ---- consume-once freshness check -------------------------------------------
#
# Compare the URL we found against the URL we returned last time. If they
# match, the caller is reading a stale log entry -- the auth server did not
# actually emit a new "Preview email:" line since the last extraction. This
# is the common failure mode in CI/agent QA where retries silently reuse
# already-consumed codes.
#
# This check works regardless of log file format, single-app vs merged logs,
# or whether the log lines carry timestamps.

if [[ "$ALLOW_REUSE" != "1" ]]; then
  if [[ -f "$STATE_FILE" ]]; then
    LAST_URL="$(cat "$STATE_FILE" 2>/dev/null || true)"
    if [[ -n "$LAST_URL" && "$LAST_URL" == "$PREVIEW_URL" ]]; then
      echo "extract-mfa-link.sh: latest preview URL matches the last one we returned." >&2
      echo "  This usually means no fresh email was sent since the last call." >&2
      echo "  Trigger a new send (e.g., POST /api/verify-email?action=send) and retry." >&2
      echo "  To override (rarely correct), pass --allow-reuse." >&2
      echo "  URL: $PREVIEW_URL" >&2
      exit 6
    fi
  fi
fi

# ---- fetch the email body and extract ---------------------------------------

EMAIL_HTML="$(curl -s "$PREVIEW_URL")"

if [[ -z "$EMAIL_HTML" ]]; then
  echo "extract-mfa-link.sh: empty response from $PREVIEW_URL" >&2
  exit 7
fi

case "$MODE" in
  link)
    VALUE="$(printf '%s' "$EMAIL_HTML" \
      | grep -oE 'https?://[^"]+/login/email/verify\?email=[^"]+&code=[0-9]{6}' \
      | head -1 || true)"
    ;;
  code)
    # The code lives in a <p> with letter-spacing: 8px in the rendered HTML.
    VALUE="$(printf '%s' "$EMAIL_HTML" \
      | grep -oE 'letter-spacing:[[:space:]]*8px[^>]*>[[:space:]]*[0-9]{6}' \
      | grep -oE '[0-9]{6}' \
      | head -1 || true)"
    ;;
esac

if [[ -z "$VALUE" ]]; then
  echo "extract-mfa-link.sh: could not extract $MODE from $PREVIEW_URL" >&2
  echo "  The email format in apps/auth/src/lib/email-mfa.ts may have changed." >&2
  exit 8
fi

# ---- record state and emit --------------------------------------------------

# Record the URL we're about to return so the next call can detect reuse.
# Best-effort -- a state-file write failure should not fail the run, since
# the value itself is valid.
mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true
printf '%s' "$PREVIEW_URL" > "$STATE_FILE" 2>/dev/null || true

if [[ "$QUIET" == "1" ]]; then
  printf '%s' "$VALUE"
else
  printf '%s\n' "$VALUE"
fi
