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

BUCKET_NAME="${GOOGLE_LOGO_BUCKET_BUCKET_NAME:-f3-logos}"
GCS_PORT=9023
PG_CONTAINER=f3-postgres

echo ""
echo "  F3 Nation — Local Dev Setup"
echo "  ────────────────────────────────────────────"

# ── Step 1: Copy env file ────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "  → Copying .env.docker.example → .env"
  cp .env.docker.example .env
  echo "     Done. Edit .env and add NEXT_PUBLIC_GOOGLE_API_KEY when you have one."
else
  echo "  → .env already exists, skipping copy"
fi

# ── Step 2: Start Docker services ────────────────────────────────────────────
echo "  → Starting Docker services..."
docker compose -f docker-compose.local.yml up -d

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
curl -sf -X POST "http://localhost:${GCS_PORT}/storage/v1/b" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"${BUCKET_NAME}\"}" > /dev/null \
  && echo "     Bucket '${BUCKET_NAME}' created." \
  || echo "     Bucket may already exist — continuing."

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
echo "    1. Set NEXT_PUBLIC_GOOGLE_API_KEY in .env (map tiles won't load without it)"
echo "       Get one free at: https://console.cloud.google.com/google/maps-apis/"
echo ""
echo "    2. Start the app servers:"
echo "       pnpm dev"
echo ""
echo "  Daily workflow:"
echo "    pnpm docker:up    — start Docker services"
echo "    pnpm docker:down  — stop Docker services"
echo ""
