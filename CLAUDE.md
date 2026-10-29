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
  - xAI Grok (Grok Imagine Video), Kling (v3 Omni / v2.6), OpenRouter (ByteDance Seedance 2.5 / 2.0 Fast — caps y pricing por modelo en `lib/openrouter-video-caps.ts`)
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
  openrouter-video.ts     # OpenRouter (Seedance) video generation (+ openrouter-video-caps.ts: tabla compartida UI/backend)
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

## Production Templates — IA de producción

### Principio
El motor arma, la IA decide. Toda la IA de producción llama directo a Gemini
desde nanano (`gemini-3.8-flash` por defecto) con JSON schema forzado y
devuelve decisiones chicas que el código determinista aplica; nunca árboles
completos ni keyframes. Practicante NO arma, adapta ni anima piezas: es solo la
fuente del conocimiento de marca (ver "Guía de marca").

### Rutas
- `POST /api/production/ai/generate-from-prompt` y `.../generate-from-reference`
  — Gemini elige plantillas de `lib/production/layout-templates.ts` y devuelve
  hasta 3 planes (textos por slot, ocultos, recolor, fuentes, prompts de imagen)
  que `lib/production/layout-plan.ts` expande a master + variantes, con
  contraste mínimo (`ensureTextContrast`). Referencias como imagen nativa.
  Flujo en `lib/production/plan-generation.ts`; planificador en `layout-planner.ts`.
- Con referencia, la primera propuesta es "Fiel a la referencia"
  (`reference-planner.ts` + `reference-layout.ts`): Gemini describe la imagen
  como bloques (rol, caja en %, colores, texto para la marca) y el motor los
  arma como capas editables, con el master en la proporción de la referencia;
  las del catálogo quedan como alternativas. En este modo no se mandan las
  piezas reales de la marca (competían con la referencia).
- `POST /api/production/ai/generate-images` — llena los slots de imagen de una
  propuesta con Nano Banana 2 (API Gemini; Imagen 4 no existe en la región
  `global` de Vertex), una imagen por slot y proporción.
- `POST /api/production/designs/[id]/ai/fix-adaptations` — "Revisar con IA" del
  paso Formatos (SSE): lint determinista (`layout-lint.ts`) → correcciones por
  capa (`layout-fixer.ts` / `layout-patch.ts`) → lint, hasta 2 pasadas.
- Toda recomposición (`runLayoutFix` con `recompose`: Readaptar, Pídele a la
  IA "reacomoda", orientaciones desde referencia) suma `lintComposition`
  (layout-lint.ts): franjas vacías >15% del eje largo y letra mínima por rol
  relativa al lado corto (titular 6%, precio 5%, CTA 3,2%…). El modelo recibe
  esos problemas con números y los corrige en sus pasadas.
- `POST /api/production/templates/[id]/ai/adapt-orientation` — botón
  "Readaptar del master" (sin instrucciones), con `mode`:
  - `faithful` (default): `adaptTree` conserva la estructura del master
    (constraints inferidos, paneles de foto con su marco, grupos visuales
    rígidos); si el lint no tiene errores no se llama a la IA, y si los tiene
    `runLayoutFix` solo los corrige (1 pasada, sin recomponer).
  - `recompose`: `runLayoutFix` en modo `recompose` (reubica todo), con la
    captura del master como imagen del original.
  Las orientaciones desde referencia usan el modo fiel.
- `POST /api/production/ai/edit` — barra "Pídele a la IA" del editor (master,
  orientaciones y ajustes manuales): el ÚNICO lugar donde se escribe un pedido
  en lenguaje natural. Instrucción → operaciones (`lib/production/edit-ops.ts`:
  set_text, update, add, remove, set_background, generate_image, frame_subject,
  set_skin, recompose, animate). `recompose` corre el recompositor de
  `runLayoutFix` sobre la pieza editada (master del design como referencia) y
  `animate` el motor de animación; ambos en la misma llamada, después de las
  operaciones por capa aplicadas como un cambio
  deshacible; las imágenes pedidas se generan con `generate-images`. El modelo
  VE las fotos de las capas (hasta 3, desde nuestro bucket) y para reencuadrar
  solo indica dónde está el sujeto en la foto y dónde lo quiere; `frameSubject`
  calcula zoom (≤1.6×), posición y focal exactos con el tamaño real de la foto
  (`image-size.ts`).
- `POST /api/production/ai/generate-skin` — "piel gráfica" de un texto
  (botón o sello): Nano Banana dibuja la forma vacía sobre un color clave
  plano, `lib/production/skin-image.ts` quita el fondo (flood fill desde el
  borde; la clave oscurecida pasa a sombra negra semitransparente) y queda
  como PNG con transparencia en `TextLayer.skin`. El texto sigue vivo encima.
  Modos (`lib/production/skin.ts`): `slice` (botón, 9-slice: los extremos no
  se estiran) y `fit` (sello, proporción fija). Se dibuja con celdas
  `background-image` (html-to-image las embebe en JPG; el export HTML5 inlinea
  cada piel una vez como variable CSS). `backgroundColor` queda con el color
  promedio de la piel para que contraste, roles y proporciones sigan
  funcionando. Se pide desde el panel (sección "Piel gráfica") o con la op
  `set_skin` de "Pídele a la IA".
- Texto gráfico (`lib/production/text-effects.ts`): `style.fill` (degradado o
  textura dentro de las letras), `outline2` (segundo contorno) y `extrude`
  (volumen 3D). Se dibuja como una pila de copias del texto: adelante el
  relleno, detrás contornos, volumen y sombra (así el contorno queda por fuera
  y la sombra no tapa un `background-clip:text`). Estilos rápidos en
  `text-presets.ts` (panel "Efectos" y `text_style` en "Pídele a la IA"). Las
  texturas se generan con `generate-images` (`purpose: "texture"`, JPEG 512 px).
- Catálogo: `layout-templates-modern.ts` (Franja de precio, Editorial
  asimétrico, Bloque de color, Tipografía protagonista, Foto enmarcada, Lujo
  sobrio) va primero; las clásicas siguen después. Todas las modernas tienen
  slot `legal` y `cta`, colores de muestra distintos por rol (el planificador
  recolorea por valor) y pasan el lint en las tres orientaciones (test). Un
  marco simétrico (foto enmarcada) se conserva al adaptar (`insetFrameRatio`).
- Logo: `resolveBrandLogo` (project-brand-kit.ts) usa el primer logo del brand
  kit (token) o, si no hay, `clients.logo`. Las plantillas modernas tienen slot
  de imagen `logo` que se llena solo al instanciar (o se quita si no hay logo);
  "Pídele a la IA" tiene `add kind logo` con la imagen real y su proporción.
- Dirección de arte (`lib/production/art-direction.ts`): direcciones vigentes,
  reglas de composición y lista de lo que se ve anticuado (estrellas de oferta,
  biseles, brillos plásticos, dorado/3D sin pedido). Se inyecta en el
  planificador, "Pídele a la IA", la recomposición (solo composición) y en los
  prompts de fotos, pieles y texturas. Es un borrador editable por el equipo
  creativo; la guía de marca manda sobre ella.
- Guía de marca del lado de practicante: especificación del agente en
  `docs/practicante-agente-guia-de-marca.md`.
- Animación vs. ediciones: los keyframes de posición/tamaño son absolutos;
  `followBaseChanges` (reflow.ts) los desplaza en cada `mutate` del editor
  cuando cambia la base de una capa, y borra tracks de capas eliminadas.
- `POST /api/production/templates/[id]/ai/animate` — Gemini devuelve una
  coreografía por capa (entrada, inicio, duración, énfasis) y
  `lib/production/animation-plan.ts` la traduce a tracks; se valida con
  `validateAnimationConfig`.
Ninguna escribe a la BD el resultado: el usuario ve un preview y acepta.
Todas las llamadas pasan por `lib/production/gemini-json.ts` (reintenta una vez
si Gemini responde vacío o con JSON inválido). En los schemas, evita campos de
texto libre que no hagan falta (Gemini a veces entra en bucle en ellos y no
respeta `maxLength`) y `maxItems` en arrays de objetos grandes (da 400).
Modelos por env: `PRODUCTION_AI_LAYOUT_MODEL`, `PRODUCTION_AI_PLANNER_MODEL`,
`PRODUCTION_AI_ANIMATION_MODEL`, `PRODUCTION_AI_EDIT_MODEL`, `PRODUCTION_AI_IMAGE_MODEL`.

### Zonas seguras por plataforma
`lib/production/safe-zone.ts`: franjas que la interfaz tapa o recorta
(stories/reels, TikTok, Shorts, feed 4:5, portada de X, miniatura de YouTube),
por defecto como fracción del formato según canal y proporción, o fijas en
`production_format_presets.safe_zone_json` (migración 131). Se aplican en
`lintLayout`/`lintComposition` (`opts.safe`), en `adaptTree` (`opts.safe`:
fitChildren, tiras y growToLegible), en el render/export de adaptaciones
(`safe_zone` del objeto adaptación), en "Revisar con IA" (el modelo recibe
`safe_zone`) y en el editor de la adaptación (overlay sombreado, activo por
defecto). Los fondos a sangre no se ven afectados.

### Exportación (paso Descargar)
- HTML5 (`lib/production/html5-export.ts` + `export-assets.ts`): cada imagen se
  redimensiona al tamaño dibujado × dpr y se re-codifica (JPEG, o PNG si hay
  transparencia); las fotos que sangran fuera del formato se recortan a lo
  visible y la capa se reescribe a ese rectángulo; las fuentes de Google van
  embebidas como subconjunto WOFF2 (solo los glifos usados). `maxBytes` (del
  preset `file_size_max_kb`, default 150 KB en display) baja la calidad JPEG
  por pasos hasta caber; si no cabe, el paso Descargar lo avisa. Vista previa
  en iframe con el index.html real.
- Imagen: display (gdn/email) a 1×, social a 2×; JPG o PNG.

### Cost tracking y rate limiting
- Cada invocación (un lote cuenta como una) queda en `production_ai_invocations`
  con `operation`, `agent_name`, `model`, tokens, `estimated_cost` (USD,
  calculado con la tabla de precios del módulo), `duration_ms`, `success`,
  `error_msg` y `rationale`. El panel "Costos IA" del proyecto la suma.
- `lib/production/ai-rate-limit.ts` aplica en todas las rutas de IA (429 con
  `code: PRODUCTION_AI_QUOTA_EXCEEDED`): USD diario por proyecto
  (`PRODUCTION_AI_DAILY_USD_PER_PROJECT`, default 10) y llamadas por usuario en
  la última hora (`PRODUCTION_AI_HOURLY_CALLS_PER_USER`, default 20). 0 desactiva.

### Guía de marca (practicante)
- `clients.slug` es la llave compartida con practicante (`Client.slug` allá);
  los nombres no coinciden entre plataformas.
- `POST /api/clients/[id]/brand-guide` sincroniza a pedido (ficha del cliente →
  Brand Kits) vía `lib/practicante-client.ts` → `/api/external/run`
  (orquestador, con las tools `brandbook_<slug>`), pidiendo JSON de voz,
  tratamiento, vocabulario, ejemplos, colores, tipografías, logo y reglas
  (`lib/production/brand-guide.ts`). Queda en `clients.brand_guide_json`.
- El planificador la recibe como `brand_guide` y la respeta. Practicante nunca
  se consulta durante una generación.
- `desempeno.piezas`: anuncios reales con métricas. Al sincronizar,
  `lib/production/brand-pieces.ts` descarga cada imagen (solo https público,
  sin IPs privadas, con topes) y la re-sube al bucket; las 3 mejores van al
  planificador como referencia visual.
- Contrato completo con practicante: `docs/practicante-agente-guia-de-marca.md`.
- Vars: `PRACTICANTE_URL`, `PRACTICANTE_API_KEY`, `PRACTICANTE_USER_EMAIL`.

### Brand kit: tokens de marca heredados por proyecto
`lib/production/project-brand-kit.ts` es el único resolver. Orden: kit
explícito del template → fork project-scoped → kit client-wide de la marca →
null. Lo usan la creación de templates (POST) y las rutas de IA, así el
editor muestra los mismos tokens que usó la IA. Un fork es un snapshot:
no se mezcla con el kit de la marca.

### Reglas operativas
- La IA nunca escribe a la BD directamente: el backend valida y el usuario
  acepta un preview antes de persistir.
- Las imágenes de una propuesta quedan en `src: null` salvo que el usuario
  pida "Generar imágenes"; después se cambian por el flujo normal de
  `ImagePicker` en el editor.
