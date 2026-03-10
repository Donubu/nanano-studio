#!/bin/bash
set -e

# ============================================
# Blue-Green Zero-Downtime Deploy
# ============================================
# Usage: ./scripts/deploy.sh
#
# How it works:
# 1. Detects which slot (blue/green) is currently active
# 2. Builds the new image
# 3. Starts the inactive slot with the new image
# 4. Waits for it to pass health checks
# 5. Switches Nginx to the new slot
# 6. Stops the old slot
# 7. Rolling-restarts workers (one at a time)
# ============================================

COMPOSE_FILE="docker-compose.gcp.yml"
COMPOSE="docker compose -f $COMPOSE_FILE"
NGINX_UPSTREAM="./nginx/conf.d/upstream.active"
MAX_WAIT=90  # seconds to wait for health check (must exceed healthcheck start_period)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $1"; }
err()  { echo -e "${RED}[deploy]${NC} $1"; }

# ---- Detect active slot ----
detect_active_slot() {
  if grep -q "blue" "$NGINX_UPSTREAM" 2>/dev/null; then
    echo "blue"
  else
    echo "green"
  fi
}

# ---- Check if infrastructure is running ----
NGINX_RUNNING=$(docker ps -q -f name=puerto_nginx 2>/dev/null || true)
if [ -z "$NGINX_RUNNING" ]; then
  warn "First deploy detected — starting infrastructure (redis, nginx, workers)..."
  log "Building image..."
  $COMPOSE build puerto_studio_blue
  log "Starting all services..."
  $COMPOSE up -d
  # Set upstream to blue
  echo "set \$backend puerto_studio_blue:3000;" > "$NGINX_UPSTREAM"
  # Wait for blue to be healthy
  log "Waiting for puerto_studio_blue to be healthy (max ${MAX_WAIT}s)..."
  SECONDS_WAITED=0
  while [ $SECONDS_WAITED -lt $MAX_WAIT ]; do
    HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "puerto_studio_blue" 2>/dev/null || echo "missing")
    if [ "$HEALTH" = "healthy" ]; then
      break
    fi
    sleep 2
    SECONDS_WAITED=$((SECONDS_WAITED + 2))
    echo -n "."
  done
  echo ""
  if [ "$HEALTH" != "healthy" ]; then
    err "puerto_studio_blue failed health check. Check logs: docker logs puerto_studio_blue"
    exit 1
  fi
  docker exec puerto_nginx nginx -s reload
  log "First deploy complete! Blue is active."
  exit 0
fi

# ---- Normal blue-green deploy ----
ACTIVE=$(detect_active_slot)
if [ "$ACTIVE" = "blue" ]; then
  NEW="green"
else
  NEW="blue"
fi

log "Active slot: $ACTIVE"
log "Deploying to: $NEW"

# ---- Build new image ----
log "Building new image..."
$COMPOSE --profile donotstart build puerto_studio_${NEW}

# ---- Start new slot ----
log "Starting puerto_studio_${NEW}..."
$COMPOSE --profile donotstart up -d puerto_studio_${NEW}

# ---- Wait for health check ----
log "Waiting for puerto_studio_${NEW} to be healthy (max ${MAX_WAIT}s)..."
SECONDS_WAITED=0
while [ $SECONDS_WAITED -lt $MAX_WAIT ]; do
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "puerto_studio_${NEW}" 2>/dev/null || echo "missing")
  if [ "$HEALTH" = "healthy" ]; then
    log "puerto_studio_${NEW} is healthy!"
    break
  fi
  sleep 2
  SECONDS_WAITED=$((SECONDS_WAITED + 2))
  echo -n "."
done
echo ""

if [ "$HEALTH" != "healthy" ]; then
  err "puerto_studio_${NEW} failed health check after ${MAX_WAIT}s. Aborting."
  err "Rolling back: stopping failed container..."
  $COMPOSE --profile donotstart stop puerto_studio_${NEW}
  exit 1
fi

# ---- Switch Nginx upstream ----
log "Switching Nginx to ${NEW}..."
echo "set \$backend puerto_studio_${NEW}:3000;" > "$NGINX_UPSTREAM"
docker exec puerto_nginx nginx -s reload
log "Nginx now points to ${NEW}"

# ---- Stop old slot ----
log "Stopping old slot (${ACTIVE})..."
$COMPOSE stop puerto_studio_${ACTIVE}

# ---- Rolling worker restart ----
WORKERS=$(docker ps --format '{{.Names}}' | grep "puerto_worker_" | sort || true)
if [ -n "$WORKERS" ]; then
  log "Rolling restart of workers (reusing already-built image)..."
  for WORKER in $WORKERS; do
    WORKER_SERVICE=$(echo "$WORKER" | sed 's/puerto_//')
    log "  Restarting ${WORKER_SERVICE}..."
    $COMPOSE up -d --no-build --no-deps "$WORKER_SERVICE"
    # Wait for worker to be ready
    sleep 5
    log "  ${WORKER_SERVICE} restarted"
  done
fi

log "Deploy complete! Active slot: ${NEW}"
