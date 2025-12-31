#!/bin/bash
set -euo pipefail

# Reset local PostgreSQL database (cascade delete all data) using .env.local
# Usage: ./scripts/db/local/reset.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"

# Check for psql
if ! command -v psql &> /dev/null; then
    echo "Error: psql not found"
    echo "Install PostgreSQL client tools:"
    echo "  macOS: brew install libpq && brew link --force libpq"
    echo "  Ubuntu: sudo apt-get install postgresql-client"
    exit 1
fi

# Load environment variables for local database URL
load_env_var() {
    local var_name="$1"
    local env_file="$PROJECT_DIR/.env.local"
    if [[ -f "$env_file" ]]; then
        local value
        value=$(grep "^${var_name}=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        echo "$value"
    fi
}

# Get database URL from .env.local or use default
get_db_url() {
    local url="${DATABASE_URL:-}"
    [[ -z "$url" ]] && url=$(load_env_var "DATABASE_URL")
    [[ -z "$url" ]] && url="postgresql://f3prod:f3prod_local_dev@localhost:5433/f3prod_dev"
    echo "$url"
}

db_url=$(get_db_url)

# Check if local PostgreSQL is running
if ! psql "$db_url" -c "SELECT 1" &> /dev/null; then
    echo "Error: Cannot connect to local database"
    echo "Run 'npm run db:local:up' first"
    exit 1
fi

echo "Resetting local database..."

# Drop and recreate public schema
setup_sql="DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS citext;"
setup_sql="$setup_sql CREATE TYPE public.user_status AS ENUM ('active', 'inactive');"
setup_sql="$setup_sql CREATE OR REPLACE FUNCTION public.set_updated_column() RETURNS TRIGGER AS \$\$ BEGIN NEW.updated = timezone('utc', now()); RETURN NEW; END; \$\$ LANGUAGE plpgsql;"

psql "$db_url" -c "$setup_sql" > /dev/null

echo "  Database reset complete (all tables dropped)"
echo ""
echo "Run 'npm run db:local:seed' to restore data from snapshots."
