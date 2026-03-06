#!/bin/sh
set -e

APP_MODE="${APP_MODE:-web}"

echo "=== Starting nanano (mode: ${APP_MODE}) ==="

if [ "$APP_MODE" = "worker" ]; then
  echo "Starting worker process..."
  exec node /app/worker/dist/worker.js
else
  # Run database migrations
  echo "Running database migrations..."
  node /app/scripts/migrate.js

  # Start the application (standalone mode)
  echo "Starting Next.js server..."
  exec node server.js
fi
