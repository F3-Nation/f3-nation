#!/bin/bash
set -euo pipefail

# Seed local PostgreSQL from snapshot using database URL from .env.local
# Usage: ./scripts/db/local/seed.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"
SNAPSHOTS_DIR="$PROJECT_DIR/db-snapshots"

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
        # Remove surrounding quotes if present
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

# Find snapshot path
snapshot_path="$SNAPSHOTS_DIR/latest/current"

# Resolve symlink if needed
if [[ -L "$snapshot_path" ]]; then
    snapshot_path="$SNAPSHOTS_DIR/latest/$(readlink "$snapshot_path")"
fi

if [[ ! -d "$snapshot_path" ]]; then
    echo "Warning: No snapshot found at $snapshot_path"
    echo "Run 'npm run db:snapshot' first to create a snapshot"
    exit 1
fi

# Check if local PostgreSQL is running
if ! psql "$db_url" -c "SELECT 1" &> /dev/null; then
    echo "Error: Cannot connect to local database"
    echo "Run 'npm run db:local:up' first"
    exit 1
fi

echo "Seeding database from snapshot..."
echo "  Snapshot: $snapshot_path"

# Check what files exist
has_schema=false
has_data=false
[[ -f "$snapshot_path/schema.sql" ]] && has_schema=true
[[ -f "$snapshot_path/data.sql" ]] && has_data=true

if [[ "$has_schema" == "false" && "$has_data" == "false" ]]; then
    echo "Error: No schema.sql or data.sql found in snapshot"
    exit 1
fi

# Drop and recreate public schema to clear all tables
echo "  Clearing existing data..."
setup_sql="DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS citext;"
setup_sql="$setup_sql CREATE TYPE public.user_status AS ENUM ('active', 'inactive');"
setup_sql="$setup_sql CREATE OR REPLACE FUNCTION public.set_updated_column() RETURNS TRIGGER AS \$\$ BEGIN NEW.updated = timezone('utc', now()); RETURN NEW; END; \$\$ LANGUAGE plpgsql;"

psql "$db_url" -c "$setup_sql" > /dev/null

# Restore schema
if [[ "$has_schema" == "true" ]]; then
    echo "  Restoring schema..."
    psql "$db_url" -f "$snapshot_path/schema.sql" > /dev/null 2>&1 || true
fi

# Restore data
if [[ -d "$snapshot_path/csv" ]]; then
    # CSV format: load each CSV file
    echo "  Restoring data from CSV files..."
    for csv_file in "$snapshot_path/csv"/*.csv; do
        if [[ -f "$csv_file" ]]; then
            # Extract table name from filename (public_tablename.csv -> public.tablename)
            filename=$(basename "$csv_file" .csv)
            table_name="${filename/_/.}"
            row_count=$(( $(wc -l < "$csv_file" | tr -d ' ') - 1 ))
            if [[ $row_count -gt 0 ]]; then
                echo "    Loading $table_name ($row_count rows)..."
                psql "$db_url" -c "\\COPY $table_name FROM '$csv_file' WITH (FORMAT CSV, HEADER)" > /dev/null 2>&1 || {
                    echo "    Warning: Failed to load $table_name"
                }
            fi
        fi
    done
elif [[ "$has_data" == "true" ]]; then
    echo "  Restoring data..."
    psql "$db_url" -f "$snapshot_path/data.sql" > /dev/null 2>&1 || true
fi

echo ""
echo "Database seeded successfully!"
echo "  DATABASE_URL=$db_url"
