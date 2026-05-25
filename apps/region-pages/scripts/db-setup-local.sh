#!/usr/bin/env bash
set -euo pipefail

# Local DB setup for region-pages, aligned with the monorepo's shared local dev
# stack (root docker-compose.yml — Postgres on :5433). Replaces the legacy
# Supabase flow.
#
# Usage:  pnpm --filter f3-region-pages db:setup:local

# Resolve the monorepo root (this script lives at apps/region-pages/scripts/).
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
APP="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Starting shared local Postgres (docker compose, :5433)…"
(cd "$ROOT" && docker compose up -d postgres)

# Wait for Postgres to accept connections.
echo "==> Waiting for Postgres to be ready…"
for i in $(seq 1 30); do
  if (cd "$ROOT" && docker compose exec -T postgres pg_isready -U f3local -d f3nation >/dev/null 2>&1); then
    break
  fi
  sleep 1
done

cd "$APP"
if [ ! -f .env.local ]; then
  cp .env.local.example .env.local
  echo "==> Created .env.local from .env.local.example."
  echo "    Set F3_DATA_WAREHOUSE_URL before seeding (db:seed reads the warehouse)."
fi

echo "==> Resetting + migrating the region-pages schema…"
pnpm db:reset
pnpm db:migrate

echo "==> Seeding from the F3 data warehouse…"
pnpm db:seed

echo "==> Local DB setup complete."
