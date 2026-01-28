#!/bin/sh
set -e

echo "=== Starting nanano ==="

# Run database migrations
echo "Running database migrations..."
node /app/scripts/migrate.js

# Start the application
echo "Starting Next.js server..."
exec npm run start
