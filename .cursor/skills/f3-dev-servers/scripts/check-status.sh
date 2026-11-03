#!/bin/bash
# Check status of f3-nation dev servers
# Uses netcat for fast port checking (lsof is too slow on macOS)

# Probe this checkout's ports, which `pnpm local:setup --slot N` shifts by N*100.
# shellcheck source=../../../../scripts/lib/local-ports.sh
source "$(dirname "${BASH_SOURCE[0]}")/../../../../scripts/lib/local-ports.sh"
load_local_ports

echo "=== F3 Nation Dev Server Status ==="
echo ""

# name | port | package (pnpm -F <package> dev)
services=(
    "Map|${F3_MAP_PORT:-3000}|f3-map"
    "API|${F3_API_PORT:-3001}|f3-api"
    "Admin|${F3_ADMIN_PORT:-3002}|f3-admin"
    "Me|${F3_ME_PORT:-3003}|f3-me"
    "Auth|${F3_AUTH_PORT:-3004}|f3-auth"
    "Homepage|${F3_HOMEPAGE_PORT:-3005}|f3-homepage"
    "Region pages|${F3_REGION_PAGES_PORT:-3006}|f3-region-pages"
    "Slackbot|${F3_SLACKBOT_PORT:-3007}|f3-slackbot"
)

for entry in "${services[@]}"; do
    IFS='|' read -r name port pkg <<< "$entry"
    if nc -z localhost "$port" 2>/dev/null; then
        echo "✅ $name (port $port): RUNNING"
    else
        echo "❌ $name (port $port): NOT RUNNING"
        echo "   Start with: pnpm -F $pkg dev  (or 'pnpm dev --include-py' to start all)"
    fi
done

echo ""
