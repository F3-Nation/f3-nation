#!/bin/bash
set -euo pipefail

# Pull database snapshot from production database defined in .env.firebase
# Usage: ./scripts/db/snapshot.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
SNAPSHOTS_DIR="$PROJECT_DIR/db-snapshots"

DUMP_TYPE="full"

# Load specific environment variables safely (avoid sourcing entire file)
load_env_var() {
    local var_name="$1"
    local env_file="$2"
    local value
    # Extract value, handling quotes properly
    value=$(grep "^${var_name}=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2-)
    # Remove surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    echo "$value"
}

# Load production database URL from .env.firebase (source of truth for snapshots)
ENV_FILE="$PROJECT_DIR/.env.firebase"
if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: .env.firebase not found at $ENV_FILE"
    echo "This file should contain production DATABASE_URL"
    exit 1
fi

[[ -z "${DATABASE_URL:-}" ]] && DATABASE_URL=$(load_env_var "DATABASE_URL" "$ENV_FILE")

# Check for pg_dump
if ! command -v pg_dump &> /dev/null; then
    echo "Error: pg_dump not found"
    echo "Install PostgreSQL client tools:"
    echo "  macOS: brew install libpq && brew link --force libpq"
    echo "  Ubuntu: sudo apt-get install postgresql-client"
    exit 1
fi

# Function to clean database URL (strip query params except sslmode)
clean_db_url() {
    local db_url="$1"
    local clean_url="${db_url%%\?*}"
    if [[ "$db_url" == *"sslmode="* ]]; then
        local sslmode=$(echo "$db_url" | grep -oE 'sslmode=[^&]+' | head -1)
        clean_url="${clean_url}?${sslmode}"
    fi
    echo "$clean_url"
}

# Get the URL from environment variable
if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "Error: DATABASE_URL is not set"
    echo "Please set it in .env.firebase"
    exit 1
fi

clean_url=$(clean_db_url "$DATABASE_URL")

# Create snapshot directory
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
SNAPSHOT_DIR="$SNAPSHOTS_DIR/latest/$TIMESTAMP"
mkdir -p "$SNAPSHOT_DIR"

echo "Creating database snapshot..."
echo "  Source: DATABASE_URL"
echo "  Type: $DUMP_TYPE"
echo "  Directory: $SNAPSHOT_DIR"

# Dynamically discover auth_* tables plus users table from public schema
dump_table_patterns="auth_% users"

# Resolve table patterns to actual table names
where_clauses=""
for pattern in $dump_table_patterns; do
    if [[ -n "$where_clauses" ]]; then
        where_clauses="$where_clauses OR "
    fi
    if [[ "$pattern" == *"%"* ]]; then
        where_clauses="${where_clauses}tablename LIKE '$pattern'"
    else
        where_clauses="${where_clauses}tablename = '$pattern'"
    fi
done
dump_tables=$(psql "$clean_url" -t -c "SELECT 'public.' || tablename FROM pg_tables WHERE schemaname = 'public' AND ($where_clauses) ORDER BY tablename" 2>/dev/null | tr -d ' ' | grep -v '^$' | tr '\n' ' ')
echo "  Tables to dump: $dump_tables"

# Dump schema
if [[ "$DUMP_TYPE" == "full" || "$DUMP_TYPE" == "schema" ]]; then
    echo "  Dumping schema..."
    schema_args=()

    if [[ -n "$dump_tables" ]]; then
        # Dump specific tables only
        for table in $dump_tables; do
            schema_args+=(--table="$table")
        done
    else
        # Dump entire public schema
        schema_args+=(--schema=public)
    fi

    pg_dump "$clean_url" \
        --schema-only \
        --no-owner \
        --no-privileges \
        --no-comments \
        "${schema_args[@]}" \
        > "$SNAPSHOT_DIR/schema.sql" 2>/dev/null
    echo "    Created schema.sql ($(wc -c < "$SNAPSHOT_DIR/schema.sql" | tr -d ' ') bytes)"
fi

# Dump data
if [[ "$DUMP_TYPE" == "full" || "$DUMP_TYPE" == "data" ]]; then
    echo "  Dumping data..."

    if [[ -n "$dump_tables" ]]; then
        # For specific tables: try pg_dump first, fall back to CSV export
        table_args=()
        for table in $dump_tables; do
            table_args+=(--table="$table")
        done

        stderr_file="$SNAPSHOT_DIR/.dump_stderr"
        # Allow pg_dump to fail - we'll check stderr and use fallback
        pg_dump "$clean_url" \
            --data-only \
            --no-owner \
            --no-privileges \
            --inserts \
            "${table_args[@]}" \
            > "$SNAPSHOT_DIR/data.sql" 2> "$stderr_file" || true

        if grep -q "permission denied for sequence" "$stderr_file" 2>/dev/null; then
            echo "    pg_dump failed (sequence permissions), using CSV fallback..."
            rm -f "$SNAPSHOT_DIR/data.sql"
            mkdir -p "$SNAPSHOT_DIR/csv"

            # Export each table as CSV
            for table in $dump_tables; do
                csv_file="$SNAPSHOT_DIR/csv/${table//\./_}.csv"
                psql "$clean_url" -c "COPY $table TO STDOUT WITH (FORMAT CSV, HEADER)" > "$csv_file" 2>/dev/null
                row_count=$(( $(wc -l < "$csv_file" | tr -d ' ') - 1 ))
                echo "    Exported $table ($row_count rows)"
            done

            # Create a load script
            cat > "$SNAPSHOT_DIR/data.sql" << 'LOADER'
-- Data exported as CSV files in csv/ subdirectory
-- This file is a placeholder - use the seed script to load CSV data
-- CSV files: csv/*.csv
LOADER
        fi
        rm -f "$stderr_file"
    else
        # For full schema dump: use pg_dump
        pg_dump "$clean_url" \
            --data-only \
            --no-owner \
            --no-privileges \
            --inserts \
            --schema=public \
            > "$SNAPSHOT_DIR/data.sql" 2>/dev/null
    fi

    echo "    Created data.sql ($(wc -c < "$SNAPSHOT_DIR/data.sql" | tr -d ' ') bytes)"
fi

# Create metadata
cat > "$SNAPSHOT_DIR/metadata.json" << EOF
{
  "timestamp": "$TIMESTAMP",
  "type": "$DUMP_TYPE",
  "database": "f3prod",
  "source_var": "DATABASE_URL",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
echo "  Created metadata.json"

# Update latest symlink
rm -f "$SNAPSHOTS_DIR/latest/current"
ln -s "$TIMESTAMP" "$SNAPSHOTS_DIR/latest/current"
echo "  Updated 'current' symlink"

echo ""
echo "Snapshot complete: $SNAPSHOT_DIR"
echo ""
echo "Use 'npm run db:local:seed' to load into local database"
