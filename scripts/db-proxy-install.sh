#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# db-proxy-install.sh — Install Cloud SQL Auth Proxy as a background service
# =============================================================================
# Usage:
#   bash scripts/db-proxy-install.sh            # Install and start
#   bash scripts/db-proxy-install.sh --uninstall # Remove the service
#   bash scripts/db-proxy-install.sh --status    # Check if running
#
# On macOS: installs a launchd LaunchAgent (auto-starts on login)
# On Linux: installs a systemd user service (auto-starts on login)
# =============================================================================

INSTANCE="f3data:us-central1:f3data-nonprod"
PORT=5433
LABEL="com.f3nation.cloud-sql-proxy"

# --- Resolve cloud-sql-proxy path -------------------------------------------

resolve_proxy_path() {
  if command -v cloud-sql-proxy &>/dev/null; then
    command -v cloud-sql-proxy
  elif [[ -f /opt/homebrew/bin/cloud-sql-proxy ]]; then
    echo "/opt/homebrew/bin/cloud-sql-proxy"
  elif [[ -f /usr/local/bin/cloud-sql-proxy ]]; then
    echo "/usr/local/bin/cloud-sql-proxy"
  else
    echo ""
  fi
}

# --- macOS (launchd) ---------------------------------------------------------

install_macos() {
  local proxy_path
  proxy_path=$(resolve_proxy_path)

  if [[ -z "$proxy_path" ]]; then
    echo "cloud-sql-proxy not found. Installing via Homebrew..."
    brew install cloud-sql-proxy
    proxy_path=$(resolve_proxy_path)
  fi

  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="$plist_dir/$LABEL.plist"

  mkdir -p "$plist_dir"

  cat > "$plist_path" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$proxy_path</string>
    <string>${INSTANCE}?port=${PORT}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/cloud-sql-proxy.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/cloud-sql-proxy.err</string>
</dict>
</plist>
PLIST

  # Unload first if already loaded (ignore errors)
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

  launchctl bootstrap "gui/$(id -u)" "$plist_path"

  echo "Installed and started Cloud SQL Auth Proxy as a background service."
  echo ""
  echo "  Plist:    $plist_path"
  echo "  Port:     localhost:$PORT"
  echo "  Logs:     /tmp/cloud-sql-proxy.log"
  echo "  Errors:   /tmp/cloud-sql-proxy.err"
  echo ""
  echo "The proxy will auto-start on login. No terminal tab needed."
  echo ""
  echo "Useful commands:"
  echo "  pnpm db:proxy:status     — check if running"
  echo "  pnpm db:proxy:uninstall  — remove the service"
}

uninstall_macos() {
  local plist_path="$HOME/Library/LaunchAgents/$LABEL.plist"

  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

  if [[ -f "$plist_path" ]]; then
    rm "$plist_path"
    echo "Removed $plist_path"
  fi

  echo "Cloud SQL Auth Proxy background service uninstalled."
}

status_macos() {
  if launchctl print "gui/$(id -u)/$LABEL" &>/dev/null 2>&1; then
    echo "Cloud SQL Auth Proxy is running as a background service."
    echo ""
    if lsof -i :"$PORT" &>/dev/null 2>&1; then
      echo "  Listening on localhost:$PORT"
    else
      echo "  WARNING: Service is loaded but not listening on port $PORT."
      echo "  Check logs: cat /tmp/cloud-sql-proxy.err"
    fi
  else
    echo "Cloud SQL Auth Proxy background service is NOT running."
    echo ""
    echo "Install it:  pnpm db:proxy:install"
    echo "Or run once:  pnpm db:proxy"
  fi
}

# --- Linux (systemd) ---------------------------------------------------------

install_linux() {
  local proxy_path
  proxy_path=$(resolve_proxy_path)

  if [[ -z "$proxy_path" ]]; then
    echo "cloud-sql-proxy not found. Downloading..."
    local arch
    arch=$(uname -m)
    if [[ "$arch" == "x86_64" ]]; then
      URL="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.21.2/cloud-sql-proxy.linux.amd64"
    elif [[ "$arch" == "aarch64" ]]; then
      URL="https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.21.2/cloud-sql-proxy.linux.arm64"
    else
      echo "Error: Unsupported architecture. Install cloud-sql-proxy manually."
      exit 1
    fi
    sudo curl -o /usr/local/bin/cloud-sql-proxy "$URL"
    sudo chmod +x /usr/local/bin/cloud-sql-proxy
    proxy_path="/usr/local/bin/cloud-sql-proxy"
  fi

  local service_dir="$HOME/.config/systemd/user"
  local service_path="$service_dir/cloud-sql-proxy.service"

  mkdir -p "$service_dir"

  cat > "$service_path" << EOF
[Unit]
Description=Cloud SQL Auth Proxy (F3 Nation)

[Service]
ExecStart=$proxy_path ${INSTANCE}?port=${PORT}
Restart=on-failure

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now cloud-sql-proxy

  echo "Installed and started Cloud SQL Auth Proxy as a systemd user service."
  echo ""
  echo "  Port:   localhost:$PORT"
  echo "  Status: systemctl --user status cloud-sql-proxy"
}

uninstall_linux() {
  systemctl --user disable --now cloud-sql-proxy 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/cloud-sql-proxy.service"
  systemctl --user daemon-reload
  echo "Cloud SQL Auth Proxy systemd service uninstalled."
}

status_linux() {
  if systemctl --user is-active cloud-sql-proxy &>/dev/null; then
    echo "Cloud SQL Auth Proxy is running as a systemd service."
    systemctl --user status cloud-sql-proxy --no-pager | head -5
  else
    echo "Cloud SQL Auth Proxy systemd service is NOT running."
    echo "Install it:  pnpm db:proxy:install"
  fi
}

# --- Dispatch ----------------------------------------------------------------

ACTION="${1:-install}"
OS="$(uname)"

case "$ACTION" in
  install|--install)
    if [[ "$OS" == "Darwin" ]]; then install_macos
    elif [[ "$OS" == "Linux" ]]; then install_linux
    else echo "Unsupported OS: $OS"; exit 1; fi
    ;;
  uninstall|--uninstall)
    if [[ "$OS" == "Darwin" ]]; then uninstall_macos
    elif [[ "$OS" == "Linux" ]]; then uninstall_linux
    else echo "Unsupported OS: $OS"; exit 1; fi
    ;;
  status|--status)
    if [[ "$OS" == "Darwin" ]]; then status_macos
    elif [[ "$OS" == "Linux" ]]; then status_linux
    else echo "Unsupported OS: $OS"; exit 1; fi
    ;;
  *)
    echo "Usage: $0 [install|uninstall|status]"
    exit 1
    ;;
esac
