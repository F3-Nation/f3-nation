#!/bin/bash
set -euo pipefail

# Stop local PostgreSQL container
# Usage: ./scripts/db/local/down.sh [--remove-data]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"

REMOVE_DATA=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --remove-data)
            REMOVE_DATA=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--remove-data]"
            exit 1
            ;;
    esac
done

cd "$PROJECT_DIR"

if [[ "$REMOVE_DATA" == "true" ]]; then
    echo "Stopping PostgreSQL and removing data volume..."
    docker compose down -v
    echo "PostgreSQL stopped and data volume removed"
else
    echo "Stopping PostgreSQL (preserving data)..."
    docker compose down
    echo "PostgreSQL stopped. Data preserved in Docker volume."
    echo "Use --remove-data to also remove the data volume"
fi
