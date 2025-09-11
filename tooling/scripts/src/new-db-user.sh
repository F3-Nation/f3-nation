#!/bin/bash

# Check if the correct number of arguments is provided
if [ "$#" -ne 3 ]; then
    echo "Usage: $0 <username> <password> <dbname>"
    exit 1
fi

USERNAME=$1
PASSWORD=$2
DBNAME=$3

# Load environment variables
DATABASE_URL=$(pnpm -F scripts with-env tsx -e "const { env } = require('@acme/env'); console.log(env.DATABASE_URL);" | tail -n 1)

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "DATABASE_URL is not set. Please check your .env file."
    exit 1
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "DATABASE_URL is not set. Please check your .env file."
    exit 1
fi

echo "DATABASE_URL: $DATABASE_URL"

# Run PostgreSQL commands
psql ${DATABASE_URL} << EOF
CREATE USER $USERNAME WITH PASSWORD '$PASSWORD';
CREATE DATABASE $DBNAME;
GRANT ALL PRIVILEGES ON DATABASE $DBNAME TO $USERNAME;
\c $DBNAME
GRANT USAGE ON SCHEMA public TO $USERNAME;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $USERNAME;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $USERNAME;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO $USERNAME;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO $USERNAME;
EOF

echo "User '$USERNAME' and database '$DBNAME' created successfully."