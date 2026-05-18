# Nanano (Puerto Studio) - AI Generation Platform

## Overview
Multi-provider AI generation platform for text, images, video, audio, and music. Manages users, projects, clients, costs, billing, and analytics. Deployed on GCP using Docker on a VM with Google Cloud SQL (MySQL).

## Tech Stack
- **Framework**: Next.js 16+ (App Router, standalone output), React 19, TypeScript
- **Database**: MySQL via `mysql2/promise` (Google Cloud SQL in production)
- **Auth**: NextAuth v5 (beta) with Google OAuth (`auth.ts` + `auth.config.ts`)
- **Queue**: BullMQ + Redis for async generation jobs
- **Storage**: AWS S3 for generated files, CloudFront CDN for delivery
- **AI Providers**:
  - Google Gemini API / Vertex AI (text streaming, Imagen 4 images, VEO video, Chirp 3 HD TTS, Lyria music)
  - xAI Grok (Grok Imagine Video)
  - Future: more providers planned
- **UI**: Tailwind CSS, Radix UI primitives, Lucide icons
- **Deployment**: Docker + docker-compose on GCP VM, Nginx reverse proxy

## Production Environment
- **Domain**: `https://puerto.studio` (primary), `https://v2.puerto.studio` (temporary alias)
- **Branch**: `main` (auto-deployed via GitHub webhook on push)
- **Deploy script**: `scripts/deploy.sh` (blue-green zero-downtime)
- **SSL**: Let's Encrypt certificates via certbot (installed on host, certs copied to Docker volume `nanano-studio_certbot_certs`)
- **Auto-deploy webhook**: GitHub pushes to `main` trigger `/home/mgomez/deploy.sh` on the server
- **Server**: GCP VM at `34.176.106.54`, user `mgomez`, root for docker commands
- **Git on server**: Must run as `mgomez` user (SSH key), not root: `su - mgomez -c "cd /home/mgomez/nanano-studio && git pull origin main"`

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
  deploy.sh               # Blue-green zero-downtime deploy script
  docker-start.sh         # Docker entrypoint (web vs worker mode)
  init-ssl.sh             # SSL certificate initialization (puerto.studio)
  recalculate-costs.js    # Cost recalculation utility
  sync-gcp-costs.ts       # GCP cost sync script

nginx/
  conf.d/default.conf     # Nginx config (serves puerto.studio + v2.puerto.studio)
  conf.d/upstream.active  # Active blue/green backend slot
```

## Architecture

### Blue-Green Deployment
- `scripts/deploy.sh` manages zero-downtime deploys
- Two slots: `puerto_studio_blue` and `puerto_studio_green`
- `nginx/conf.d/upstream.active` contains `set $backend puerto_studio_blue:3000;` or green
- Deploy builds new slot, health checks it, switches nginx upstream, stops old slot
- Workers are rolling-restarted after web deploy

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
docker compose -f docker-compose.gcp.yml up -d  # Production (GCP)
docker compose up -d                              # Development
```
- Services: nginx, redis, puerto_studio_blue/green (web), worker_1+ (workers), certbot
- Memory limits: 4GB for web, configured per worker
- Node heap limit: `--max-old-space-size=4096`
- Docker volumes: `nanano-studio_certbot_certs` (SSL certs), `certbot_webroot` (ACME challenges)

## Conventions
- API routes use `mysql2/promise` with raw SQL (no ORM)
- All generation endpoints return SSE streams with retry/heartbeat
- Exponential retry logic for AI API calls (handles 429 rate limits)
- Costs tracked per generation, synced with GCP billing via BigQuery
- Timezone: `America/Santiago` (-03:00)
- Body size limit: 50MB (middleware + server actions)
- Env files: `.env.local` (dev), `.env.gcp` (production, gitignored), `.env.private` (reference)

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
