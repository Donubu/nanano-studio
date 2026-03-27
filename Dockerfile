# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN \
  if [ -f package-lock.json ]; then npm ci; \
  elif [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable && pnpm i --frozen-lockfile; \
  else npm i; fi

# ---- builder ----
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Asegurar que public existe (aunque esté vacía)
RUN mkdir -p /app/public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build
RUN npm run build:worker
RUN npm run build:collab

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app

# Configurar timezone a UTC para consistencia con MySQL
# Instalar ffmpeg para conversión de audio (WAV a MP3)
ENV TZ=UTC
RUN apk add --no-cache tzdata ffmpeg

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy standalone build
COPY --from=builder /app/.next/standalone ./

# Copy full node_modules from deps (worker needs all transitive dependencies)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy migration scripts
COPY --from=builder /app/scripts/migrate.js ./scripts/migrate.js
COPY --from=builder /app/scripts/migrations ./scripts/migrations
COPY --from=builder /app/scripts/docker-start.sh ./scripts/docker-start.sh
COPY --from=builder /app/scripts/server-wrapper.js ./scripts/server-wrapper.js
RUN chmod +x ./scripts/docker-start.sh

# Copy worker build
COPY --from=builder /app/worker/dist ./worker/dist

# Copy collab server build
COPY --from=builder /app/lib/collaboration/dist ./lib/collaboration/dist

EXPOSE 3000

CMD ["./scripts/docker-start.sh"]
