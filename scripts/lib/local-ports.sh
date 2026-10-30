#!/usr/bin/env bash
# Per-checkout port overrides, so several worktrees can run the local stack
# side by side. `pnpm local:setup --slot N` writes them to the root .env, which
# Docker Compose also reads. No root .env (or slot 0) means the defaults below.
# Sourced by scripts/local-setup.sh and scripts/dev.sh.

LOCAL_PORTS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_PORT_DEFAULTS="F3_MAP_PORT=3000 F3_API_PORT=3001 F3_ADMIN_PORT=3002 F3_ME_PORT=3003 F3_AUTH_PORT=3004 F3_HOMEPAGE_PORT=3005 F3_REGION_PAGES_PORT=3006 F3_SLACKBOT_PORT=3007 F3_POSTGRES_PORT=5433 F3_MAILPIT_SMTP_PORT=1025 F3_MAILPIT_UI_PORT=8025 F3_GCS_PORT=9023 F3_ADMINER_PORT=8080"
LOCAL_PORT_KEYS_RE='^(COMPOSE_PROJECT_NAME|F3_CONTAINER_PREFIX|F3_[A-Z_]+_PORT)='

# Exports the overrides found in the root .env. Only these keys are read.
load_local_ports() {
  local line slot="" pair var
  [ -f "$LOCAL_PORTS_ROOT/.env" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      COMPOSE_PROJECT_NAME=* | F3_CONTAINER_PREFIX=* | F3_*_PORT=*) export "${line?}" ;;
    esac
    case "$line" in
      COMPOSE_PROJECT_NAME=f3-local-wt[1-9]) slot="${line##*wt}" ;;
    esac
  done <"$LOCAL_PORTS_ROOT/.env"
  # A slot saved before a port existed has no line for it; derive it from the slot.
  [ -n "$slot" ] || return 0
  for pair in $LOCAL_PORT_DEFAULTS; do
    var="${pair%%=*}"
    [ -n "${!var:-}" ] || export "$var=$((${pair#*=} + slot * 100))"
  done
}

# Writes slot N's overrides (every default + N*100) to the root .env, keeping
# its other lines. Slot 0 removes them.
write_local_ports() {
  local slot="$1" env_file="$LOCAL_PORTS_ROOT/.env" tmp pair
  tmp=$(mktemp)
  if [ -f "$env_file" ]; then
    grep -vE "$LOCAL_PORT_KEYS_RE" "$env_file" >"$tmp" || true
  fi
  if [ "$slot" -eq 0 ]; then
    # Exported overrides would otherwise outlive the .env lines just removed.
    unset COMPOSE_PROJECT_NAME F3_CONTAINER_PREFIX
    for pair in $LOCAL_PORT_DEFAULTS; do unset "${pair%%=*}"; done
  else
    {
      echo "COMPOSE_PROJECT_NAME=f3-local-wt$slot"
      echo "F3_CONTAINER_PREFIX=f3-wt$slot"
      for pair in $LOCAL_PORT_DEFAULTS; do
        echo "${pair%%=*}=$((${pair#*=} + slot * 100))"
      done
    } >>"$tmp"
  fi
  if [ -s "$tmp" ]; then mv "$tmp" "$env_file"; else rm -f "$tmp" "$env_file"; fi
}

# Rewrites the default localhost ports in an env file to the overrides in effect.
rewrite_env_ports() {
  local file="$1" pair var def val
  for pair in $LOCAL_PORT_DEFAULTS; do
    var="${pair%%=*}"
    def="${pair#*=}"
    val="${!var:-$def}"
    [ "$val" = "$def" ] && continue
    sed -E -i.bak "s#(localhost|127\.0\.0\.1):$def([^0-9]|\$)#\1:$val\2#g" "$file"
    if [ "$var" = F3_POSTGRES_PORT ]; then
      sed -E -i.bak "s#^(DATABASE_PORT=)$def\$#\1$val#" "$file"
    fi
  done
  rm -f "$file.bak"
}
