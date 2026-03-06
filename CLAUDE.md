# Nanano (Puerto Studio) - AI Generation Platform

## Overview
Multi-provider AI generation platform for text, images, video, audio, and music. Manages users, projects, clients, costs, billing, and analytics. Deployed on GCP using Docker on a VM with Google Cloud SQL (MySQL).

## Tech Stack
- **Framework**: Next.js 16+ (App Router, standalone output), React 19, TypeScript
- **Database**: MySQL via `mysql2/promise` (Google Cloud SQL in production)
- **Auth**: NextAuth v5 (beta) with Google OAuth (`auth.ts` + `auth.config.ts`)
- **Queue**: BullMQ + Redis for async generation jobs
- **Storage**: AWS S3 for generated files
- **AI Providers**:
  - Google Gemini API / Vertex AI (text streaming, Imagen 4 images, VEO video, Chirp 3 HD TTS, Lyria music)
  - xAI Grok (Grok Imagine Video)
  - Future: more providers planned
- **UI**: Tailwind CSS, Radix UI primitives, Lucide icons
- **Deployment**: Docker + docker-compose on GCP VM, Nginx reverse proxy

## Project Structure

```
app/
  api/                    # API routes
    admin/gcp-costs/      # GCP billing sync & summary
    auth/                 # NextAuth route handler
    calculadora/          # AI cost calculator (budgets, config)
    changelog/            # Release notes
    clients/              # Client management CRUD
    conversations/        # Conversations CRUD + generation endpoints
      [id]/messages/
        stream/           # Text generation (SSE)
        imagen/           # Image generation
        video/            # Video generation
        audio/            # Audio/TTS generation
        music/            # Music generation (save/discard)
    dashboard/            # Stats, analytics, workers, generations
    images/               # Image upscale, Topaz Studio
    messages/             # Message operations (favorite, tags, reference images)
    models/               # AI model management CRUD
    projects/             # Projects CRUD + config, usage, stats, favorites
    users/                # User management CRUD
    videos/               # Video Topaz Studio processing
    upload/               # File uploads
  dashboard/              # Admin dashboard pages
    analytics/            # Usage analytics
    billing/              # Billing/invoicing
    calculadora/          # AI pricing calculator
    clients/              # Client management
    generations/          # Generation history
    models/               # Model administration
    projects/             # Project management
    users/                # User management
    workers/              # BullMQ worker monitoring
  calculadora/            # Public calculator views
  login/                  # Login page
  [...slug]/              # Catch-all chat route

components/
  chat/                   # Chat interface components
    chat-interface.tsx     # Main chat UI
    message-content.tsx   # Message rendering (markdown)
    message-input.tsx     # User input
    image-settings.tsx    # Image generation params
    video-settings.tsx    # Video generation params
    audio-settings.tsx    # Audio/TTS params
    music-settings.tsx    # Music generation params
    generations-gallery.tsx  # Generated content gallery
    tts-composer.tsx      # TTS composition tool
    topaz-studio.tsx      # Topaz AI upscaling
  calculadora/            # Budget calculator components
  dashboard/              # Dashboard layout (sidebar, header)
  ui/                     # Shared UI primitives (Radix-based)

lib/
  db.ts                   # MySQL connection pool
  google-ai.ts            # Gemini text generation + streaming
  google-ai-imagen.ts     # Imagen image generation
  google-ai-video.ts      # VEO video generation
  google-ai-audio.ts      # TTS audio generation
  google-ai-music.ts      # Lyria music generation
  google-cloud-tts.ts     # Google Cloud TTS (Chirp 3 HD)
  xai-video.ts            # xAI Grok video generation
  cost-calculator.ts      # Cost estimation logic
  gcp-billing.ts          # GCP billing integration (BigQuery)
  queue.ts                # BullMQ queue definitions
  redis.ts                # Redis client
  s3.ts                   # S3 upload/download utilities
  topaz-video.ts          # Topaz video processing
  utils.ts                # General utilities

worker/
  index.ts                # BullMQ worker process (runs separately)

scripts/
  migrations/             # SQL migration files (001-073+)
  migrate.js              # Migration runner
  migrate-init.js         # Migration initialization
  build-worker.js         # Worker build script
  bump-version.js         # Version auto-increment
  docker-start.sh         # Docker entrypoint (web vs worker mode)
  recalculate-costs.js    # Cost recalculation utility
  sync-gcp-costs.ts       # GCP cost sync script
```

## Architecture

### Web + Worker Pattern
- `APP_MODE=web` runs the Next.js server
- `APP_MODE=worker` runs the BullMQ worker process
- Both share the same Docker image, differentiated by env var
- Workers process generation jobs (text streaming, images, video, audio, music) from the Redis queue
- SSE (Server-Sent Events) used for real-time streaming to frontend
- Heartbeat mechanism keeps SSE connections alive during long generations

### Auth & Roles
- Users table has `role` field: `"admin"` or `"user"`
- Session contains `user.id` and `user.role` (set in JWT callback)
- Admin check: `session.user.role === "admin"`
- Admins see all data; users see only their own or assigned resources

### Access Control
- **Projects**: Admin sees all, users see only assigned via `project_users` table
- **Conversations**: Admin bypasses `user_id` filter, users see only their own
- Pattern: `WHERE ${isAdmin ? "1=1" : "c.user_id = ?"}` with conditional params

### Database
- MySQL with migration system (numbered SQL files in `scripts/migrations/`)
- Soft delete on conversations (`deleted_at`)
- `project_users` links users to projects with roles and monthly generation limits (per quality tier)
- `project_generation_config` configures allowed models per project per generation type
- `models` table with `api_backend` field for per-model backend selection (Vertex AI vs Gemini API)

### Generation Flow
1. User sends prompt from chat interface
2. Request hits API endpoint (`stream/`, `imagen/`, `video/`, `audio/`, `music/`)
3. Job queued in BullMQ (Redis)
4. Worker picks up job, calls AI provider API
5. Results streamed back via SSE or stored in S3
6. Cost calculated and recorded per generation
7. Conversation title auto-generated after first message

## Key Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build (standalone)
npm run build:worker # Build worker process
npm run migrate      # Run database migrations
```

## Docker Deployment
```bash
docker-compose -f docker-compose.gcp.yml up -d  # Production (GCP)
docker-compose up -d                              # Development
```
- Services: redis, puerto_studio (web), worker_1+ (workers)
- Memory limits: 4GB for web, configured per worker
- Node heap limit: `--max-old-space-size=4096`

## Conventions
- API routes use `mysql2/promise` with raw SQL (no ORM)
- All generation endpoints return SSE streams with retry/heartbeat
- Exponential retry logic for AI API calls (handles 429 rate limits)
- Costs tracked per generation, synced with GCP billing via BigQuery
- Timezone: `America/Santiago` (-03:00)
- Body size limit: 50MB (middleware + server actions)
