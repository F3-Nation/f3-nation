---
name: f3-dev-servers
description: Start and manage f3-nation development servers (Caddy, API, Map). Use when the user wants to start dev servers, check if services are running, or troubleshoot the local development environment.
---

# F3 Nation Development Servers

Start the three dev servers needed for local f3-nation development.

## Starting All Services (Agent Method)

The agent CAN start all three services by running Shell commands with `block_until_ms: 0` to background them immediately.

Run these in parallel with `block_until_ms: 0` and `working_directory` set to the repo root:

```bash
# 1. Caddy
caddy run --config Caddyfile

# 2. API
PORT=3001 pnpm -F f3-nation-api dev

# 3. Map
PORT=3000 pnpm -F f3-nation-map dev
```

Note: nvm/rbenv/jenv should be auto-loaded via `~/.zshenv` so no prefix needed.

**Agent workflow:**

1. Run check-status.sh first to see what's already running
2. Start only the services that aren't running (use `block_until_ms: 0` for each)
3. Wait 5 seconds for services to initialize
4. Run check-status.sh again to verify all services are up
5. Optionally read terminal output files to check for startup errors

## Quick Check: Are Services Running?

Run the status check script from the repo root:

```bash
.cursor/skills/f3-dev-servers/scripts/check-status.sh
```

This script uses `nc` (netcat) for fast port checking (~1 second). It checks ports 443, 3000, and 3001.

Or check manually:

```bash
# Fast check with netcat
nc -z localhost 443 && echo "Caddy OK" || echo "Caddy DOWN"
nc -z localhost 3000 && echo "Map OK" || echo "Map DOWN"
nc -z localhost 3001 && echo "API OK" || echo "API DOWN"
```

Note: Avoid using `lsof` for port checks on macOS - it takes 30+ seconds.

## Manual Startup (User Method)

If the user prefers to start manually in named terminals:

### 1. Caddy (reverse proxy) - in `caddy` terminal

```bash
caddy run --config Caddyfile
```

Caddy proxies:

- `https://map.f3nation.test` → `localhost:3000`
- `https://api.f3nation.test` → `localhost:3001`

### 2. API Server - in `api` terminal

```bash
PORT=3001 pnpm -F f3-nation-api dev
```

### 3. Map App - in `map` terminal

```bash
PORT=3000 pnpm -F f3-nation-map dev
```

## Startup Order

Start in this order for best results:

1. Caddy first (handles HTTPS)
2. API second (the map app depends on API endpoints)
3. Map app last

## Verifying Startup Success

After starting, check terminal outputs for these success indicators:

- **Caddy**: Look for `"msg":"serving initial configuration"`
- **API**: Look for `✓ Ready in X.Xs`
- **Map**: Look for `✓ Ready in X.Xs`

## Stopping Services

To stop services, use `pkill` (faster than lsof):

```bash
pkill -f "caddy run"
pkill -f "f3-nation-api dev"
pkill -f "f3-nation-map dev"
```

Or kill by port (slower, lsof takes 30+ seconds on macOS):

```bash
kill -9 $(lsof -t -i :3000)  # Map
kill -9 $(lsof -t -i :3001)  # API
sudo kill -9 $(lsof -t -i :443)   # Caddy (needs sudo for port 443)
```

For user-started services in IDE terminals, press `Ctrl+C` in the terminal.

## Troubleshooting

### Port already in use

```bash
# Find what's using the port
lsof -i :3000

# Kill it
kill -9 <PID>
```

### Node version warning

If you see this warning:

```
WARN  Unsupported engine: wanted: {"node":">=20.19.0"} (current: {"node":"v18.20.4"...})
```

The `~/.zshenv` file may be missing or misconfigured. It should contain:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

This ensures nvm is loaded for all zsh shells, including non-interactive ones from Cursor.

### Caddy certificate issues

Ensure the certificate files exist in the project root:

- `map.f3nation.test+1-cert.pem`
- `map.f3nation.test+1-key.pem`

If missing, regenerate with mkcert:

```bash
mkcert map.f3nation.test api.f3nation.test
```

### Database not running

If you see database connection errors, ensure PostgreSQL/Docker is running:

```bash
docker ps  # Check if postgres container is running
```
