#!/usr/bin/env bash
# scripts/local-setup.sh
#
# ONE-TIME setup for the local Docker development environment.
#
# Run this once after cloning the repo:
#   bash scripts/local-setup.sh      (or: pnpm local:setup)
#
# After the first run, use these commands instead:
#   pnpm docker:up    — start Docker services
#   pnpm docker:down  — stop Docker services
#   pnpm dev          — start the app servers
#
# This script is safe to re-run. Migrations and seed are idempotent.
#
# Running a second checkout (e.g. a git worktree) next to the first? Give it
# its own ports, containers, and database with a slot number from 1 to 9:
#   pnpm local:setup --slot 1    — apps on 3100–3105, Postgres on 5533, …
# The slot is saved in the root .env, so later runs and `pnpm dev` reuse it.
# `--slot 0` goes back to the defaults.

set -e

# shellcheck source=scripts/lib/local-ports.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/local-ports.sh"

slot=""
while [ $# -gt 0 ]; do
  case "$1" in
    --slot) slot="${2:-}"; shift 2 ;;
    --slot=*) slot="${1#*=}"; shift ;;
    *) echo "Unknown argument: $1 (usage: pnpm local:setup [--slot 0-9])"; exit 1 ;;
  esac
done
if [ -n "$slot" ]; then
  if ! [[ "$slot" =~ ^[0-9]$ ]]; then
    echo "ERROR: --slot must be a number from 0 to 9."
    exit 1
  fi
  write_local_ports "$slot"
fi
load_local_ports

BUCKETS=(f3-public-images f3-public-images-staging)
GCS_PORT="${F3_GCS_PORT:-9023}"
PG_PORT="${F3_POSTGRES_PORT:-5433}"
PG_CONTAINER="${F3_CONTAINER_PREFIX:-f3}-postgres"

echo ""
echo "  F3 Nation — Local Dev Setup"
echo "  ────────────────────────────────────────────"

# ── Step 1: Copy per-directory env files ─────────────────────────────────────
echo "  → Copying .env.example files..."
_env_ts=$(date +%Y%m%d%H%M%S)
for dir in apps/api apps/auth apps/map apps/me apps/admin apps/homepage apps/slackbot packages/env packages/db; do
  if [ -f "$dir/.env" ]; then
    mv "$dir/.env" "$dir/.env.bak.$_env_ts"
    echo "     $dir/.env backed up → $dir/.env.bak.$_env_ts"
  fi
  cp "$dir/.env.example" "$dir/.env"
  rewrite_env_ports "$dir/.env"
  echo "     $dir/.env created"
done
# Values the apps don't take from a URL: the API's listen port, and what the
# db scripts need to find this checkout's container and seed its OAuth clients.
if [ -n "${F3_API_PORT:-}" ]; then
  echo "PORT=$F3_API_PORT" >>apps/api/.env
fi
for var in F3_CONTAINER_PREFIX F3_ADMIN_PORT F3_ME_PORT; do
  if [ -n "${!var:-}" ]; then
    echo "$var=${!var}" >>packages/db/.env
  fi
done

# ── Step 1b: Generate AUTH_JWT_PRIVATE_KEY for apps/auth ─────────────────────
if grep -q '\.\.\.' apps/auth/.env 2>/dev/null; then
  if command -v openssl >/dev/null 2>&1; then
    KEY=$(openssl genrsa 2048 2>/dev/null | \
          openssl pkcs8 -topk8 -nocrypt -outform PEM | \
          awk 'NR>1{printf "\\n"} {printf "%s", $0}')
    KEY="${KEY%\\n}"
    grep -v '^AUTH_JWT_PRIVATE_KEY=' apps/auth/.env > /tmp/auth_env_tmp
    printf 'AUTH_JWT_PRIVATE_KEY="%s"\n' "$KEY" >> /tmp/auth_env_tmp
    mv /tmp/auth_env_tmp apps/auth/.env
    echo "     Generated AUTH_JWT_PRIVATE_KEY in apps/auth/.env"
  else
    echo "     WARNING: openssl not found — AUTH_JWT_PRIVATE_KEY left as placeholder in apps/auth/.env"
    echo "     Fix manually: openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -outform PEM"
  fi
fi

# Safety: refuse to migrate/seed against a non-local database
if ! grep -q "^DATABASE_URL=postgresql://f3local:f3local@localhost:$PG_PORT/" packages/db/.env; then
  echo "     ERROR: packages/db/.env DATABASE_URL is not the local Docker Postgres target."
  echo "     Refusing to run db:migrate:local and db:seed:local."
  exit 1
fi

# ── Step 2: Start Docker services ────────────────────────────────────────────
echo "  → Starting Docker services..."
if ! docker info >/dev/null 2>&1; then
  echo "     ERROR: Docker is not running."
  echo "     Start Docker Desktop (or 'colima start') and re-run this script."
  exit 1
fi
docker compose -f docker-compose.yml up -d

# ── Step 3: Wait for Postgres ────────────────────────────────────────────────
echo "  → Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U f3local -q 2>/dev/null; then
    echo "     Postgres is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "     ERROR: Postgres did not become ready in time."
    echo "     Run: docker logs $PG_CONTAINER"
    exit 1
  fi
  sleep 1
done

# ── Step 4: Create GCS buckets ───────────────────────────────────────────────
for BUCKET_NAME in "${BUCKETS[@]}"; do
  echo "  → Creating GCS bucket '${BUCKET_NAME}'..."
  status=$(curl -s -o /tmp/gcs-bucket-create.out -w "%{http_code}" -X POST "http://localhost:${GCS_PORT}/storage/v1/b" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${BUCKET_NAME}\"}")
  if [ "$status" = "200" ] || [ "$status" = "201" ]; then
    echo "     Bucket '${BUCKET_NAME}' created."
  elif [ "$status" = "409" ]; then
    echo "     Bucket '${BUCKET_NAME}' already exists — continuing."
  else
    echo "     ERROR: failed to create bucket '${BUCKET_NAME}' (HTTP ${status})."
    cat /tmp/gcs-bucket-create.out
    exit 1
  fi
done

# ── Step 5: Run migrations ────────────────────────────────────────────────────
# Mark the compose-owned local database, including pre-existing Docker volumes.
# Go through the container directly, never through a host port that may be a proxy.
docker exec "$PG_CONTAINER" psql -U f3local -d f3nation -v ON_ERROR_STOP=1 \
  -c "COMMENT ON DATABASE f3nation IS 'f3-disposable-local-v1'"
echo "  → Running database migrations..."
pnpm db:migrate:local

# ── Step 6: Seed the database ─────────────────────────────────────────────────
echo "  → Seeding database with local dev data..."
pnpm db:seed:local

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ Setup complete!"
echo ""
echo "  Services running:"
echo "    Postgres  → localhost:$PG_PORT"
echo "    Adminer   → http://localhost:${F3_ADMINER_PORT:-8080}  (user: f3local / pass: f3local)"
echo "    GCS       → http://localhost:$GCS_PORT"
echo "    Mailpit   → http://localhost:${F3_MAILPIT_UI_PORT:-8025}  (all outbound emails land here)"
if [ -n "${F3_MAP_PORT:-}" ]; then
  echo ""
  echo "  This checkout uses its own ports (saved in the root .env):"
  echo "    Map ${F3_MAP_PORT} · API ${F3_API_PORT} · Admin ${F3_ADMIN_PORT} · Me ${F3_ME_PORT} · Auth ${F3_AUTH_PORT} · Homepage ${F3_HOMEPAGE_PORT}"
  echo "    pnpm dev picks them up. When starting one app on its own, export them first:"
  echo "      set -a; . ./.env; set +a"
fi
echo ""
echo "  Next steps:"
echo "    1. Set F3_GOOGLE_API_KEY in apps/map/.env and apps/admin/.env"
echo "       (map tiles won't load without it)"
echo "       Get one free at: https://console.cloud.google.com/google/maps-apis/"
echo ""
echo "    2. (Optional) If you want to run slackbot, there are a few extra steps — see apps/slackbot/README.md"
echo ""
echo "    3. Start the app servers:"
echo "       pnpm dev"
echo ""
echo "  Daily workflow:"
echo "    pnpm docker:up    — start Docker services"
echo "    pnpm docker:down  — stop Docker services"
echo ""
