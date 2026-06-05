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

set -e

BUCKET_NAME="${GOOGLE_LOGO_BUCKET_BUCKET_NAME:-f3-public-images}"
GCS_PORT=9023
PG_CONTAINER=f3-postgres

echo ""
echo "  F3 Nation — Local Dev Setup"
echo "  ────────────────────────────────────────────"

# ── Step 1: Copy per-directory env files ─────────────────────────────────────
echo "  → Copying .env.local.example files..."
_env_ts=$(date +%Y%m%d%H%M%S)
for dir in apps/api apps/auth apps/map apps/me apps/admin apps/homepage packages/env; do
  if [ -f "$dir/.env" ]; then
    mv "$dir/.env" "$dir/.env.bak.$_env_ts"
    echo "     $dir/.env backed up → $dir/.env.bak.$_env_ts"
  fi
  cp "$dir/.env.local.example" "$dir/.env"
  echo "     $dir/.env created"
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
if ! grep -q '^DATABASE_URL=postgresql://f3local:f3local@localhost:5433/' packages/env/.env; then
  echo "     ERROR: packages/env/.env DATABASE_URL is not the local Docker Postgres target."
  echo "     Refusing to run db:migrate and db:seed:local."
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

# ── Step 4: Create GCS bucket ────────────────────────────────────────────────
echo "  → Creating GCS bucket '${BUCKET_NAME}'..."
status=$(curl -s -o /tmp/gcs-bucket-create.out -w "%{http_code}" -X POST "http://localhost:${GCS_PORT}/storage/v1/b" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"${BUCKET_NAME}\"}")
if [ "$status" = "200" ] || [ "$status" = "201" ]; then
  echo "     Bucket '${BUCKET_NAME}' created."
elif [ "$status" = "409" ]; then
  echo "     Bucket already exists — continuing."
else
  echo "     ERROR: failed to create bucket (HTTP ${status})."
  cat /tmp/gcs-bucket-create.out
  exit 1
fi

# ── Step 5: Run migrations ────────────────────────────────────────────────────
echo "  → Running database migrations..."
pnpm db:migrate

# ── Step 6: Seed the database ─────────────────────────────────────────────────
echo "  → Seeding database with local dev data..."
pnpm db:seed:local

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ Setup complete!"
echo ""
echo "  Services running:"
echo "    Postgres  → localhost:5433"
echo "    Adminer   → http://localhost:8080  (user: f3local / pass: f3local)"
echo "    GCS       → http://localhost:9023"
echo "    Mailpit   → http://localhost:8025  (all outbound emails land here)"
echo ""
echo "  Next steps:"
echo "    1. Set NEXT_PUBLIC_GOOGLE_API_KEY in apps/map/.env, apps/api/.env, and apps/admin/.env"
echo "       (map tiles won't load without it)"
echo "       Get one free at: https://console.cloud.google.com/google/maps-apis/"
echo ""
echo "    2. Start the app servers:"
echo "       pnpm dev"
echo ""
echo "  Daily workflow:"
echo "    pnpm docker:up    — start Docker services"
echo "    pnpm docker:down  — stop Docker services"
echo ""
