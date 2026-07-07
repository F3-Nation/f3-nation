#!/bin/bash
# Check status of f3-nation dev servers
# Uses netcat for fast port checking (lsof is too slow on macOS)

echo "=== F3 Nation Dev Server Status ==="
echo ""

# name | port | package (pnpm -F <package> dev)
services=(
    "Map|3000|f3-map"
    "API|3001|f3-api"
    "Admin|3002|f3-admin"
    "Me|3003|f3-me"
    "Auth|3004|f3-auth"
    "Homepage|3005|f3-homepage"
    "Slackbot|3006|f3-slackbot"
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
