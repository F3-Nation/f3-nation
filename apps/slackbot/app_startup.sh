#!/bin/bash
# filepath: /app/app_startup.sh

set -Eeu -o pipefail

# Simple supervisor that keeps the local server running in Socket Mode.
APP_PID=""
STOPPING=false
ENV_FILE=".env"
SOCKET_MODE_VAR="SOCKET_MODE"
LOCAL_HTTP_PORT_VAR="LOCAL_HTTP_PORT"

# Preflight checks for required CLIs
assert_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1"; exit 1; }; }
assert_cmd watchfiles
assert_cmd dotenv

ensure_socket_mode() {
  local existing=""
  if [[ -f "${ENV_FILE}" ]] && grep -E "^${SOCKET_MODE_VAR}=" "${ENV_FILE}" >/dev/null; then
    existing=$(grep -E "^${SOCKET_MODE_VAR}=" "${ENV_FILE}" | tail -1 | cut -d= -f2-)
  fi
  if [[ -z "${existing}" ]]; then
    existing="true"
    # Add a newline if .env exists and does not end with one
    if [[ -f "${ENV_FILE}" ]] && [[ $(tail -c1 "${ENV_FILE}") != "" ]]; then
      echo >> "${ENV_FILE}"
    fi
    echo "${SOCKET_MODE_VAR}=${existing}" >> "${ENV_FILE}"
    echo "Initialized ${SOCKET_MODE_VAR}=${existing} in ${ENV_FILE}"
  fi

  if [[ "${existing}" != "true" ]]; then
    sed -i "s/^${SOCKET_MODE_VAR}=.*/${SOCKET_MODE_VAR}=true/" "${ENV_FILE}"
    existing="true"
    echo "Forced ${SOCKET_MODE_VAR}=true in ${ENV_FILE}"
  fi

  SOCKET_MODE="${existing}"
  export SOCKET_MODE
}

ensure_local_http_port() {
  local existing=""
  if [[ -f "${ENV_FILE}" ]] && grep -E "^${LOCAL_HTTP_PORT_VAR}=" "${ENV_FILE}" >/dev/null; then
    existing=$(grep -E "^${LOCAL_HTTP_PORT_VAR}=" "${ENV_FILE}" | tail -1 | cut -d= -f2-)
  fi
  if [[ -z "${existing}" ]]; then
    existing="3006"
    if [[ -f "${ENV_FILE}" ]] && [[ $(tail -c1 "${ENV_FILE}") != "" ]]; then
      echo >> "${ENV_FILE}"
    fi
    echo "${LOCAL_HTTP_PORT_VAR}=${existing}" >> "${ENV_FILE}"
    echo "Initialized ${LOCAL_HTTP_PORT_VAR}=${existing} in ${ENV_FILE}"
  fi
}

start_app() {
  echo "Starting the app with watchfiles..."
  ( watchfiles --filter python 'dotenv -f .env run -- python main.py' ) &
  APP_PID=$!
  echo "App PID: ${APP_PID}"
}

cleanup() {
  echo "Shutting down processes..."
  if [[ -n "${APP_PID:-}" ]] && kill -0 "${APP_PID}" 2>/dev/null; then
    kill "${APP_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}
# On SIGINT/SIGTERM, mark stopping, cleanup, and exit
trap 'STOPPING=true; cleanup; exit 0' SIGINT SIGTERM
# Always cleanup on script exit as a safety net
trap cleanup EXIT

ensure_socket_mode
ensure_local_http_port

if [[ "${SOCKET_MODE}" != "true" ]]; then
  echo "SOCKET_MODE must be true for local development."
  exit 1
fi

echo "SOCKET_MODE=true; localtunnel is disabled."

while true; do
  start_app
  if ! wait "${APP_PID}"; then
    :
  fi

  if [[ "$STOPPING" == true ]]; then
    break
  fi

  if ! kill -0 "${APP_PID}" 2>/dev/null; then
    echo "App process exited; restarting..."
  fi
done