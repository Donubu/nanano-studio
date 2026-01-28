#!/bin/sh
set -e

echo "=== Starting nanano ==="

# Run database migrations
echo "Running database migrations..."
node /app/scripts/migrate.js

# Start the application (standalone mode)
echo "Starting Next.js server..."
exec node server.js
