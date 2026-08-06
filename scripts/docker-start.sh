#!/bin/sh
set -e

APP_MODE="${APP_MODE:-web}"

echo "=== Starting nanano (mode: ${APP_MODE}) ==="

if [ "$APP_MODE" = "worker" ]; then
  echo "Starting worker process..."
  exec node /app/worker/dist/worker.js
else
  # Run database migrations. Timestamps: si un deploy queda inaccesible,
  # el gap entre estas líneas dice si la demora fue una migración lenta
  # o el arranque/healthcheck posterior.
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running database migrations..."
  node /app/scripts/migrate.js
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Migrations done."

  # Start the application (standalone mode)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Next.js server with collaboration..."
  exec node scripts/server-wrapper.js
fi
