#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# db-proxy.sh — Start Cloud SQL Auth Proxy with auto-install
# =============================================================================
# Usage: bash scripts/db-proxy.sh [--port PORT]
# Default port: 5432
#
# Auto-installs gcloud CLI and cloud-sql-proxy if missing.
# =============================================================================

PORT="${1:-5433}"
INSTANCE="f3data:us-central1:f3data-nonprod"

# --- Auto-install gcloud CLI if missing --------------------------------------

if ! command -v gcloud &>/dev/null; then
  echo "gcloud CLI not found. Installing..."
  echo ""

  if command -v brew &>/dev/null; then
    brew install google-cloud-sdk
  elif [[ "$(uname)" == "Linux" ]]; then
    curl -sSL https://sdk.cloud.google.com | bash -s -- --disable-prompts --install-dir="$HOME"
    export PATH="$HOME/google-cloud-sdk/bin:$PATH"
  else
    echo "Error: Cannot auto-install gcloud CLI on this platform."
    echo ""
    echo "Install manually: https://cloud.google.com/sdk/docs/install"
    exit 1
  fi

  if ! command -v gcloud &>/dev/null; then
    echo "Error: gcloud installation failed. Install manually."
    echo "  https://cloud.google.com/sdk/docs/install"
    exit 1
  fi

  echo ""
  echo "Installed: $(gcloud version 2>/dev/null | head -1)"
  echo ""
  echo "Now authenticate:"
  echo "  gcloud auth login"
  echo "  gcloud auth application-default login"
  echo ""
  exit 0
fi

# --- Auto-install Cloud SQL Auth Proxy if missing ----------------------------

if ! command -v cloud-sql-proxy &>/dev/null; then
  echo "cloud-sql-proxy not found. Installing..."
  echo ""

  if command -v brew &>/dev/null; then
    brew install cloud-sql-proxy
  elif [[ "$(uname)" == "Linux" ]]; then
    ARCH=$(uname -m)
    if [[ "$ARCH" == "x86_64" ]]; then
      URL="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.21.2/cloud-sql-proxy.linux.amd64"
    elif [[ "$ARCH" == "aarch64" ]]; then
      URL="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.21.2/cloud-sql-proxy.linux.arm64"
    else
      echo "Error: Unsupported architecture '$ARCH'. Install cloud-sql-proxy manually."
      echo "  https://cloud.google.com/sql/docs/mysql/connect-auth-proxy#install"
      exit 1
    fi
    echo "Downloading from $URL..."
    curl -o /usr/local/bin/cloud-sql-proxy "$URL" 2>/dev/null
    chmod +x /usr/local/bin/cloud-sql-proxy
  else
    echo "Error: Cannot auto-install cloud-sql-proxy on this platform."
    echo ""
    echo "Install manually:"
    echo "  macOS:  brew install cloud-sql-proxy"
    echo "  Linux:  https://cloud.google.com/sql/docs/mysql/connect-auth-proxy#install"
    exit 1
  fi

  if ! command -v cloud-sql-proxy &>/dev/null; then
    echo "Error: Installation failed. Install cloud-sql-proxy manually."
    exit 1
  fi

  echo ""
  echo "Installed: $(cloud-sql-proxy --version)"
  echo ""
fi

# --- Check GCP authentication ------------------------------------------------

if ! gcloud auth application-default print-access-token &>/dev/null 2>&1; then
  echo "Error: GCP application-default credentials not found."
  echo ""
  echo "Run these commands first:"
  echo "  gcloud auth login"
  echo "  gcloud auth application-default login"
  echo ""
  exit 1
fi

# --- Check if port is already in use -----------------------------------------

if lsof -i :"$PORT" &>/dev/null 2>&1; then
  PID=$(lsof -ti :"$PORT" 2>/dev/null | head -1)
  PROC=$(ps -p "$PID" -o comm= 2>/dev/null || echo "unknown")
  echo "Port $PORT is already in use by $PROC (PID $PID)."
  echo ""
  if [[ "$PROC" == *"cloud-sql-proxy"* || "$PROC" == *"cloud_sql_proxy"* ]]; then
    echo "Cloud SQL Proxy is already running. Nothing to do."
    exit 0
  else
    echo "Kill it with: kill $PID"
    echo "Or use a different port: pnpm db:proxy -- 5433"
    exit 1
  fi
fi

# --- Start the proxy ---------------------------------------------------------

echo "Starting Cloud SQL Auth Proxy..."
echo "  Instance: $INSTANCE"
echo "  Port:     localhost:$PORT"
echo ""

exec cloud-sql-proxy "$INSTANCE" --port "$PORT"
