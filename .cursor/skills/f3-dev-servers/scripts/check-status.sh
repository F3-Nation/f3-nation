#!/bin/bash
# Check status of f3-nation dev servers
# Uses netcat for fast port checking (lsof is too slow on macOS)

echo "=== F3 Nation Dev Server Status ==="
echo ""

# Check Caddy (port 443)
if nc -z localhost 443 2>/dev/null; then
    echo "✅ Caddy (port 443): RUNNING"
else
    echo "❌ Caddy (port 443): NOT RUNNING"
    echo "   Start with: caddy run --config Caddyfile"
fi

# Check API (port 3001)
if nc -z localhost 3001 2>/dev/null; then
    echo "✅ API (port 3001): RUNNING"
else
    echo "❌ API (port 3001): NOT RUNNING"
    echo "   Start with: PORT=3001 pnpm -F f3-nation-api dev"
fi

# Check Map (port 3000)
if nc -z localhost 3000 2>/dev/null; then
    echo "✅ Map (port 3000): RUNNING"
else
    echo "❌ Map (port 3000): NOT RUNNING"
    echo "   Start with: PORT=3000 pnpm -F f3-nation-map dev"
fi

echo ""
