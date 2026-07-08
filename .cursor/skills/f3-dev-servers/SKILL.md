---
name: f3-dev-servers
description: Start and manage f3-nation development servers. Use when the user wants to start dev servers, check if services are running, or troubleshoot the local development environment.
---

# F3 Nation Development Servers

Local dev has two layers:

- **Docker infra** — Postgres, Adminer, GCS emulator, Mailpit (stateful services).
- **App servers** — the Next.js apps (Map, API, Admin, Me, Auth, Homepage) and the
  Python Slackbot, run natively with `pnpm dev`.

## Starting Everything (Normal Method)

From the repo root:

```bash
pnpm docker:up   # start the Docker infra (detached) — needed once per session
pnpm dev         # start ALL app servers (Turbo runs them in parallel)
```

`pnpm dev` starts every app **except** the Python Slackbot. To include it:

```bash
pnpm dev --include-py
```

First time on a fresh clone, run the one-time bootstrap instead of `docker:up`
(copies `.env` files, starts Docker, migrates + seeds the DB):

```bash
pnpm local:setup
```

## App Ports

| App      | Package name  | URL                     |
| -------- | ------------- | ----------------------- |
| Map      | `f3-map`      | <http://localhost:3000> |
| API      | `f3-api`      | <http://localhost:3001> |
| Admin    | `f3-admin`    | <http://localhost:3002> |
| Me       | `f3-me`       | <http://localhost:3003> |
| Auth     | `f3-auth`     | <http://localhost:3004> |
| Homepage | `f3-homepage` | <http://localhost:3005> |
| Slackbot | `f3-slackbot` | <http://localhost:3006> |

Ports are baked into each app's `dev` script — you don't need to set `PORT=`.

## Running Individual Apps

To run just one (or a few) apps instead of everything:

```bash
pnpm -F f3-map dev                        # single app
pnpm dev --filter=f3-map --filter=f3-api  # a subset (+ their deps)
```

Note: apps call each other at runtime (e.g. Map → API, and auth flows → Auth), so
when testing a flow end-to-end, start the apps it depends on too.

## Quick Check: Are Services Running?

Run the status check script from the repo root:

```bash
.cursor/skills/f3-dev-servers/scripts/check-status.sh
```

It uses `nc` (netcat) for fast port checking (~1 second) — checks all seven app ports (3000–3006).

Or check any port manually:

```bash
nc -z localhost 3000 && echo "Map OK" || echo "Map DOWN"
nc -z localhost 3001 && echo "API OK" || echo "API DOWN"
```

Note: Avoid using `lsof` for port checks on macOS - it takes 30+ seconds.

## Verifying Startup Success

After starting, each Next.js app logs `✓ Ready in X.Xs` when it's up.

## Restarting After `.env` Changes

Next.js reads `.env` **once at startup** and inlines `NEXT_PUBLIC_*` vars into the
bundle. After editing any `.env`, restart the app servers or the change won't apply:

```bash
pkill -f "next dev"   # or Ctrl+C in the pnpm dev terminal
pnpm dev
```

## Stopping Services

```bash
pkill -f "next dev"   # stop all app servers
pnpm docker:down      # stop Docker infra (keeps data; add -v to wipe volumes)
```

For servers started in an IDE terminal, press `Ctrl+C` in that terminal.

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

### Database not running

If you see database connection errors, ensure the Docker infra is up:

```bash
docker ps            # check the f3-postgres container is running
pnpm docker:up       # start it if not
```

For the full local Docker setup, see [`docs/LOCAL_DEV_DOCKER.md`](../../../docs/LOCAL_DEV_DOCKER.md).
