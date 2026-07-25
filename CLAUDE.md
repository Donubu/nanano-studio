# Nanano (Puerto Studio) - AI Generation Platform

## Overview
Multi-provider AI generation platform for text, images, video, audio, and music. Manages users, projects, clients, costs, billing, and analytics. Deployed on AWS EC2 via Coolify (Docker Compose), with MySQL on AWS RDS and assets on Google Cloud Storage.

## Tech Stack
- **Framework**: Next.js 16+ (App Router, standalone output), React 19, TypeScript
- **Database**: MySQL 8.4 via `mysql2/promise` (AWS RDS `puertocl_studio` in production, sa-east-1)
- **Auth**: NextAuth v5 (beta) with Google OAuth (`auth.ts` + `auth.config.ts`)
- **Queue**: BullMQ + Redis for async generation jobs
- **Storage**: Google Cloud Storage for generated files (public `storage.googleapis.com` URLs). NOTE: `lib/s3.ts` keeps S3-named exports (`uploadToS3`, etc.) for compatibility but uses `@google-cloud/storage` internally. Auth via `GOOGLE_APPLICATION_CREDENTIALS` (service account JSON)
- **AI Providers**:
  - Google Gemini API / Vertex AI (text streaming, Imagen 4 images, VEO video, Chirp 3 HD TTS, Lyria music)
  - Google Gemini Omni (`api_backend='omni'`, video via interactions API — `lib/omni-video.ts`)
  - xAI Grok (Grok Imagine Video), Kling (v3 Omni / v2.6), OpenRouter (ByteDance Seedance)
- **UI**: Tailwind CSS, Radix UI primitives, Lucide icons
- **Deployment**: Coolify on AWS EC2 (m5.2xlarge) — Docker Compose stack behind Coolify's Traefik proxy

## Production Environment
- **Domain**: `https://puerto.studio` → EC2 `18.231.67.114` (AWS)
- **Platform**: Coolify manages the stack from `docker-compose.coolify.yml` (web + worker-1/2/3 + redis). Traefik handles reverse proxy and automatic Let's Encrypt SSL
- **Env vars**: defined in the Coolify UI (injected as `.env` next to the compose at deploy time). `.env.production` in the local repo mirrors the production values (gitignored)
- **credentials.json**: pasted once into Coolify → Storages for each of the 4 app services (bind mount `/run/secrets/credentials.json`). Required by Vertex AI AND GCS uploads — without it no generation can save its output
- **Database**: AWS RDS MySQL 8.4, same region as the EC2. Access via RDS security group
- **Legacy (stopped, kept as cold rollback)**: previous GCP VM (`34.176.106.54`) + Cloud SQL `puerto-sql`. Migrated 2026-07-25; do not assume they are running

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
    health/               # Health check endpoint (excluded from auth)
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
  omni-video.ts           # Gemini Omni video (interactions API)
  xai-video.ts            # xAI Grok video generation
  kling-video.ts          # Kling video generation
  openrouter-video.ts     # OpenRouter (Seedance) video generation
  cost-calculator.ts      # Cost estimation logic
  gcp-billing.ts          # GCP billing integration (BigQuery)
  queue.ts                # BullMQ queue definitions
  redis.ts                # Redis client
  s3.ts                   # Storage utilities (Google Cloud Storage; S3-named exports are legacy)
  topaz-video.ts          # Topaz video processing
  utils.ts                # General utilities

worker/
  index.ts                # BullMQ worker process (runs separately)

scripts/
  migrations/             # SQL migration files (001-124+)
  migrate.js              # Migration runner
  migrate-init.js         # Migration initialization
  build-worker.js         # Worker build script
  bump-version.js         # Version auto-increment
  docker-start.sh         # Docker entrypoint (web vs worker mode; web runs migrations first)
  recalculate-costs.js    # Cost recalculation utility
  sync-gcp-costs.ts       # GCP cost sync script

docker-compose.coolify.yml  # Production stack (Coolify): web + 3 workers + redis
```

## Architecture

### Deployment (Coolify)
- Coolify deploys the stack from `docker-compose.coolify.yml` on the AWS EC2
- On redeploy, services are recreated (brief downtime; the `web` healthcheck against `/api/health` gates routing). Redis is not recreated unless its config changes; its data persists in the `redis_data` volume
- Workers get `stop_grace_period: 120s`: SIGTERM → BullMQ `worker.close()` drains active jobs; longer jobs are re-queued as stalled and retried
- The `web` container runs `scripts/migrate.js` at startup before serving (see `scripts/docker-start.sh`)
- Video generation runs inline in the `web` container (SSE), NOT in the BullMQ workers — only text streaming and image jobs go through the queue

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
- `project_users` links users to projects with roles (its monthly-limit columns are legacy and NOT enforced; the real quota is the per-client credit system in `lib/client-credits.ts`)
- `project_generation_config` (enabled flag) + `project_generation_models` (N models per project per generation type, with label/sort_order/is_default — no quality tiers)
- `models` table with `api_backend` field for per-model backend selection: `vertex`, `gemini`, `omni`, `xai`, `kling`, `openrouter`, `chirp`

### Generation Flow
1. User sends prompt from chat interface (or canvas / full mode — all surfaces hit the same endpoints)
2. Request hits API endpoint (`stream/`, `imagen/`, `video/`, `audio/`, `music/`)
3. Text and image jobs are queued in BullMQ (Redis) and processed by workers; video and audio run inline in the web container
4. The AI provider is dispatched by the resolved model's `api_backend`
5. Results streamed back via SSE and stored in Google Cloud Storage
6. Cost calculated and recorded per generation (`messages.estimated_cost`)
7. Conversation title auto-generated after first message

## Key Commands
```bash
npm run dev          # Start dev server
npm run build        # Production build (standalone)
npm run build:worker # Build worker process
npm run migrate      # Run database migrations
```

## Docker Deployment
Production runs on Coolify from `docker-compose.coolify.yml` (see the file's header comments for the full setup checklist):
- Services: `web` (Next.js + collab socket.io on port 3000), `worker-1/2/3` (BullMQ), `redis`
- Single Docker image for web and workers, differentiated by `APP_MODE`
- No nginx/certbot: Coolify's Traefik terminates TLS (automatic Let's Encrypt)
- Local dev does not use Docker for the app: `npm run dev` + local MySQL 8.4 (`mysql84` container on port 3307)

## Conventions
- API routes use `mysql2/promise` with raw SQL (no ORM)
- All generation endpoints return SSE streams with retry/heartbeat
- Exponential retry logic for AI API calls (handles 429 rate limits)
- Costs tracked per generation, synced with GCP billing via BigQuery
- Timezone: `America/Santiago` (-03:00)
- Body size limit: 50MB (middleware + server actions)
- Env files: `.env.local` (dev), `.env.production` (mirror of production values — the live env vars are defined in the Coolify UI), `.env.gcp` / `.env.private` (legacy, outdated — do not trust for current infra)

## Production Templates — Banner Designer (Practicante AI)

### Visión general
Los templates de producción tienen integración con un agente especialista de
**Practicante** (plataforma de agentes interna del usuario, Sonnet 4.6) llamado
**Banner Designer**. El agente acepta dos operaciones:

- `ADAPT_ORIENTATION`: recibe un master + dims target, devuelve una nueva
  `TemplateDefinition` adaptada a la nueva orientación.
- `GENERATE_FROM_PROMPT`: recibe intent + dims + brand kit, genera master +
  variantes coherentes.

El system prompt completo del agente vive en `BANNERS.md` (raíz del repo).
Ese archivo se copia tal cual en la configuración del agente "Banner
Designer" en practicante. **Cualquier cambio en lo que el agente sabe/decide
se hace ahí y se re-pega en practicante.** No hay otro origen de verdad.

### Wiring existente con Practicante
- Proxy: `app/api/practicante/run/route.ts` — POSTea a
  `${PRACTICANTE_URL}/api/external/run` con `X-API-Key` y `X-User-Email`.
- Listado: `app/api/practicante/agents/route.ts` — proxy a
  `/api/external/agents` para que el cliente vea agentes disponibles.
- Vars: `PRACTICANTE_URL`, `PRACTICANTE_API_KEY`, `PRACTICANTE_USER_EMAIL`
  (fallback si el email del session no existe en practicante).
- Targeting de agente: enviar `agentName: "Banner Designer"` en el body.
  Sin esto, va al orquestador (más caro/lento).

### Contrato de llamada al Banner Designer
- `message` (string): prompt humano corto. Ej. `"Adapta este master a 1080x1920 vertical"`.
- `promptSuffix` (string JSON): contexto estructurado completo. Incluye
  `operation`, `master`, `master_dims`, `target_dims`, `brand_kit`,
  `instructions`, etc. Ver §3 de `BANNERS.md`.
- `agentName: "Banner Designer"` (forceAgent vía proxy).
- `returnOnlyFinalText: true` (la respuesta es JSON parseable).
- `existingConversationId` (opcional): permite retry contextual cuando la
  validación zod falla en el lado puerto.studio.

### Respuesta del agente
```json
{
  "definition": { "id": "tpl_root", "type": "frame", "...": "..." },
  "variants": [{ "dims": { "w": 1080, "h": 1080 }, "definition": {...} }],
  "rationale": "Una frase explicando la decisión"
}
```
- `variants` solo en `GENERATE_FROM_PROMPT`.
- `rationale` siempre (UI lo muestra en el preview antes de aceptar).

### Validación server-side
1. `JSON.parse` el `response` del proxy.
2. Zod schema validation de la `definition` contra
   `TemplateDefinition` (declarar en `lib/production/types.ts` o un
   `lib/production/template-schema.ts` separado).
3. Si falla validación: reintento (max 1) usando `existingConversationId` y
   un `message` describiendo el error específico. El agente corrige solo
   ese error (ver §10 de `BANNERS.md`).
4. Si tras retry sigue fallando: error visible al usuario con la opción de
   regenerar manualmente.

### Cost tracking
La respuesta de `/api/practicante/run` incluye:
```json
{
  "response": "...",
  "tokenUsage": {
    "inputTokens": 18234,
    "outputTokens": 3120,
    "estimatedCost": 0.0473
  },
  "toolsUsed": ["..."],
  "conversationId": "...",
  "delegatedTo": "..."
}
```

- **Origen del costo**: `tokenUsage.estimatedCost` (USD) viene directo del
  agente. Lo calcula practicante con los pricing actuales de Anthropic.
- **Almacenamiento**: cada invocación queda registrada en
  `production_ai_invocations` (tabla nueva, ver migración pendiente). Campos:
  `id`, `production_project_id`, `template_id`, `operation`, `agent_name`,
  `input_tokens`, `output_tokens`, `estimated_cost`, `success`, `error_msg`,
  `conversation_id`, `created_by`, `created_at`.
- **Acumulación**: el dashboard de costos del proyecto suma `estimated_cost`
  de las invocaciones del proyecto y lo expone junto a los costos de GCP.
- **Rate limiting**: opcional, por proyecto/día. Se chequea contra la suma
  acumulada de `estimated_cost` del día actual.

### Endpoints que invocan al agente
Por crear (estos NO existen aún):
- `POST /api/production/templates/[id]/ai/adapt-orientation`
  - Body: `{ target_template_id: number, instructions?: string }`.
  - Resuelve master + target + brand_kit, llama al agente, valida, retorna
    `{ proposal: TemplateDefinition, rationale: string, cost: number }`.
- `POST /api/production/designs/ai/generate`
  - Body: `{ production_project_id: number, intent: string, tone?: string, master_dims?: {w,h}, secondary_aspects?: [{w,h}], instructions?: string }`.
  - Genera master + variantes, retorna lo mismo + variantes.

### UI integration points (planeados)
- Botón ✨ "Adaptar con IA" en cada mini preview no-master del `VariantsStrip`
  (`app/produccion/template/[id]/producir/page.tsx`). Click → modal con
  `instructions` opcional → preview side-by-side actual vs propuesta →
  Aceptar / Regenerar / Cancelar.
- Card "Crear con IA" en el `LayoutTemplatePicker`
  (`components/dashboard/layout-template-picker.tsx`). Click → prompt
  textbox → genera master + 3 orientaciones.

### Reglas operativas
- El agente NUNCA escribe a la BD directamente. Solo devuelve JSON. El backend
  de puerto.studio es responsable de PUT al template tras validar.
- El usuario SIEMPRE ve un preview antes de aplicar. Sin aceptación explícita,
  no se persiste.
- Imágenes generadas en `src: null`. El productor las sube después por el
  flujo normal de `ImagePicker` en el editor.
- Los `rationale` quedan registrados en `production_ai_invocations.rationale`
  (TEXT) por si el usuario quiere auditar después.

### Si el agente "Banner Designer" no existe todavía en practicante
- `/api/practicante/agents` GET no lo retorna → el botón ✨ debe deshabilitarse
  con tooltip "Banner Designer no configurado en practicante".
- Fallback alternativo: usar el orquestador (sin `agentName`) con todo el
  contexto de BANNERS.md inyectado como `promptSuffix`. Es más caro y lento
  pero funciona como bridge mientras se crea el agente especialista.
