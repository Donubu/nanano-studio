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

## Canvas — asistente IA ("Pídele a la IA")
- Barra en la parte inferior del canvas (`components/canvas/canvas-ai-bar.tsx`). `POST /api/conversations/[id]/canvas/ai/assist` recibe el pedido + un snapshot compacto del canvas y llama a Gemini (`CANVAS_AI_ASSIST_MODEL`, default `gemini-3.8-flash`) vía `lib/production/gemini-json.ts`. Devuelve un plan validado, NO escribe el canvas.
- `lib/canvas-ai/assist-plan.ts` (puro, con tests) valida las ops (add/update/remove node, connect/disconnect) con `VALID_CONNECTIONS`, `isValidConnection`, `wouldCreateCycle` y `reconcileVideoSettings`; no crea escenas ni toca nodos bloqueados. El manual que recibe el modelo se genera desde esas mismas reglas (`assist-prompt.ts`).
- El cliente aplica el plan con la persistencia granular y los eventos de colaboración de siempre; los nodos nuevos se ubican a la derecha de lo existente (`ai-assist-apply.ts`). "Deshacer lo que hizo la IA" revierte y persiste solo lo que tocó la IA (un nivel). Reordenar todo el canvas solo si el pedido lo menciona.
- Costo y límite: `canvas_ai_invocations` (migración 136); `CANVAS_AI_HOURLY_CALLS_PER_USER` (default 30, 0 desactiva).
- El asistente crea Personajes: separa un texto pegado en ADN (campo `dna`), estilo global (texto conectado) y etapas (`stages`); las fotos se eligen por número dentro de una galería (el snapshot lleva las URLs numeradas y la galería se conecta sola al Personaje); con `generate_stages` ejecuta "Generar etapas" (lo creado entra al mismo Deshacer). Las etapas existentes se editan por su id (renombrar no pierde la imagen). `dropInventedStageText` vacía textos de etapa que el modelo inventó cuando el pedido solo las nombra (no aplica si se pide describir/mejorar/ajustar).
- El asistente VE resultados: con un Personaje o imágenes seleccionados (o sin selección, si el pedido nombra al Personaje y habla del resultado) la ruta manda hasta 4 imágenes generadas (`pickResultImages`, solo de nuestro bucket vía `downloadReference`, achicadas a 1024 px con sharp) para que proponga ajustes de ADN, etapas, estilo o prompts.

## Canvas — rendimiento con muchos nodos
- Vista alejada (`components/canvas/nodes/lod.tsx`): bajo 30% de zoom (el % redondeado de los controles) cada nodo se tapa con una tarjeta liviana (nombre legible a cualquier zoom, imagen); el nodo real queda con `visibility: hidden` sin desmontarse (conserva estado y conectores). Se ocultan etiquetas de conexiones y RUN ALL. Con nodos seleccionados, sus conexiones se destacan (color primario, grosor en px de pantalla) y las demás se atenúan; solo se animan las de un nodo generándose.
- Miniaturas (`components/canvas/lib/thumb.ts` + `nodes/canvas-img.tsx`): las imágenes del canvas se muestran vía `/_next/image` (ancho fijo, mismo aspecto; solo hosts de `images.remotePatterns`, calidad 75). `CanvasImg` cambia al original solo si el nodo está en pantalla y el zoom lo pide. La URL guardada no cambia (referencias, visor y descargas usan el original). Caché persistente en el volumen `next_image_cache` (`/app/.next/cache/images`).

## Canvas — nodos colapsados
- Por nodo: `data.collapsed` (se guarda y se comparte). `withLod` (`nodes/lod.tsx`) pone la clase `canvas-node-collapsed` y el botón "Colapsar/Expandir" sobre el borde superior del nodo (al pasar el puntero o seleccionado; tamaño fijo en pantalla). Los estilos van en `CollapsedNodeStyles` (un `<style>` del canvas, NO en globals.css: el dev server no recompilaba esos cambios): queda solo el encabezado (el primer hijo del nodo que no es conector), alto automático (también con tamaño fijo) y los conectores juntos a los costados del encabezado. Por eso cada nodo debe tener su encabezado como primer elemento después de sus `<Handle>`.
- Por defecto nada se colapsa. Barra: "Colapsar todos" / "Expandir todos" (todos los nodos del canvas, un solo deshacer).
- "Reordenar" (`auto-layout.ts`) usa el alto real de los colapsados.
- "Reordenar" con Guión, Personajes o vinculados usa `storyLayout` (mismo archivo, con tests): fila de lo compartido (estilo global), reparto (una columna por Personaje con sus etapas + vinculados), y por Guión su cabecera y una fila por escena con columnas alineadas (Escena → destino → lo que sale de él; la B en la fila siguiente). Las conexiones entre grupos (Personaje → destino, continuidad entre destinos) no mueven nada. Lo que no cae en un grupo va al final con el orden por capas.

## Canvas — generaciones desactualizadas
- Al ejecutar, cada nodo guarda `data.inputStamps` (id de conexión → huella) de lo que le entregó cada Personaje local o vinculado y cada Escena vinculada (`computeInputStamps`, `components/canvas/lib/input-stamps.ts`, puro y con tests). La huella es del CONTENIDO de esa conexión (ADN, estilo, texto y fotos de SU etapa, imagen de la etapa, texto de la escena), así cambiar otra etapa no desactualiza nada.
- El workspace compara con lo actual (`staleInputs`) y lo entrega por `StaleNodesProvider`: Imagen, Video y Texto muestran "Desactualizado" (`NodeStatus` en `node-status.tsx`) y la barra "N desactualizados" (selecciona y centra). Los nodos generados antes de esto no tienen huella y no avisan. Los vinculados se actualizan al abrir el canvas, así que el aviso aparece al abrir el Acto.

## Canvas — "Conectar con…" (clic en un conector)
- Clic sin arrastrar en un conector abre `ConnectPicker` (`components/canvas/connect-picker.tsx`): los conectores de otros nodos con los que se puede conectar, buscable y del más cercano al más lejano, más "Crear nodo nuevo". Arrastrar sigue igual (soltar en vacío abre el menú "Crear nodo").
- `listConnectCandidates` (`lib/connect-candidates.ts`, puro y con tests) usa los conectores que React Flow midió en cada nodo (`internals.handleBounds`, solo los que el nodo muestra) y las mismas reglas del arrastre (`isValidConnection`, sin ciclos, sin repetir). Conectar pasa por `onConnect`. `connectOnClick` de React Flow va apagado; el clic se detecta en el contenedor.

## Canvas — guías inteligentes y cuadrícula
- Botones en la barra (imán = guías, cuadrícula), preferencia por navegador (`useSnapPrefs`, localStorage `canvas-snap-prefs`; guías encendidas y cuadrícula apagada por defecto). Alt mientras se arrastra = movimiento libre.
- Guías: `applySnapGuides` en `onNodesChange` del workspace pega el bloque arrastrado (uno o varios nodos) a bordes y centros de los nodos VISIBLES (umbral 6 px de pantalla) con `computeSnap` (`lib/snap-guides.ts`, puro y con tests); las líneas se dibujan con `SnapGuidesOverlay` (ViewportPortal). Se re-aplica al cambio final (`dragging: false`), que React Flow manda sin el ajuste; el teclado no se ajusta.
- Cuadrícula: `snapToGrid` de React Flow con la grilla de 24 px del fondo. Si hay guía en un eje, manda la guía.

## Canvas — Guión: "Generar escenas" incremental
- `planScriptMaterialize` (`components/canvas/lib/script-materialize.ts`, puro y con tests), aplicado en el cliente por `materializeScript` del workspace (persistencia granular + colaboración; ya no existe la ruta `script/materialize`, que borraba en duro toda la cascada). Escenas con id fijo `scene-<guion>-<N>`: si existen se actualiza su data sin moverlas; se crean solo las que faltan y se quitan las que ya no están en el análisis.
- Destino por escena (`data.sceneTargetIds`, sin entrada = `dst-<guion>-<N>`): se reusa si es del mismo tipo (con sus resultados). Si cambió el tipo o la escena desaparece, el viejo se elimina solo si está vacío y sin conexiones del usuario; si no, se conserva con aviso y el nuevo lleva sufijo.
- Params Escena: el conectado al Guión; si no, el que YA alimenta las escenas de ese Guión (propio del usuario aunque no esté conectado al Guión); si no, el automático `params-scene-<guion>` (se crea vacío solo si falta). Una escena con otro Params Escena puesto a mano lo conserva (no se le agrega un segundo).
- Versión B (casos puntuales, botón "+ B" en la escena del Guión): `variantB` en la escena del análisis = segundo texto con su propio nodo Escena (`scene-<guion>-<N>-b`, `variant: "B"`) y destino (`dst-<guion>-<N>-b`, clave `"Nb"` en `sceneTargetIds`). La B recibe el contexto de las escenas anteriores pero la cadena sigue por la A. Quitarla borra su escena y su destino si está vacío. "Re-leer guion" produce un análisis nuevo sin versiones B.
- Editar el texto en el nodo Escena lo escribe también en el Guión (su escena o su `variantB`, y la alternativa activa) con `sceneEditToScript` (mismo archivo, con tests), así no hay que volver a "Generar escenas". Solo si es la escena de id fijo y su texto coincide con el del Guión; si el Guión cambió después, la escena queda en solo lectura con aviso hasta volver a "Generar escenas". Escenas sueltas (copiadas, de plantilla, sin Guión) se editan solo en el nodo.
- Solo se reconcilian las conexiones con ids del plan (`edge-chain-`, `edge-target-`, `edge-params-scene-`, `edge-link-`, `edge-visual-ref-` + id del guion; las de la B terminan en `Nb`); las del usuario no se tocan.

## Canvas — nodo Personaje (desarrollo por etapas)
- Tipo `character` (`components/canvas/nodes/character-node.tsx`; migración 137 lo agrega al ENUM `canvas_nodes.type`). El ADN se escribe en el nodo (`data.dna`). Entradas: estilo global (`input-character-style`, un texto; el mismo texto puede alimentar varios Personajes) y galerías de referencia (`input-character-gallery`: galería, imagen estática o imagen generada; varias). Las etapas viven en `data.stages` en el orden de generación que define el usuario (se reordenan arrastrando o con flechas), cada una con su texto y las fotos elegidas de esas galerías (`referenceImages: {nodeId, url}[]`).
- "Generar etapas" (`planCharacterMaterialize` en `components/canvas/lib/character.ts`, puro y con tests) crea una imagen por etapa conectada al Personaje (prompt) y encadena las imágenes en el orden de la lista: la etapa 1 es la referencia de la 2, la 2 de la 3… (continuidad, neutra). Reordenar o borrar etapas que ya tienen imagen marca `chainStale` y el nodo pide volver a "Generar etapas", que solo reconecta. Las galerías NO se conectan a las imágenes (mandarían todas sus fotos). Es incremental: reusa `stage.imageNodeId`, reconcilia solo las conexiones que puso él (`managedEdgeIds`) y borra imágenes de etapas eliminadas solo si nunca se generaron.
- Vínculo vivo: al ejecutar, la imagen recibe del Personaje ADN + estilo + SU etapa (`composeCharacterPrompt`) y las fotos de la etapa como referencia con prioridad 1 (`characterStagePhotos` en `resolveNodeInputs`; solo fotos de galerías todavía conectadas). La etapa se encuentra por `imageNodeId` porque `canvas_edges` solo guarda `priority`, no data. Copiar/pegar y plantillas remapean esos ids (`remapCharacterIds`).
- Salida IMAGEN (`output-character-image`): entrega la imagen de UNA etapa a otro nodo (referencia de imagen, first/last frame o referencia de video, media de texto). La etapa se elige en un selector sobre cada conexión (`edges/character-stage-picker.tsx`; visible solo con el destino o el Personaje seleccionado, y siempre en el panel lateral del destino) y se guarda en el Personaje (`data.imageOutputs[edgeId] = stageId`). Al ejecutar, `resolveCharacterImageEdges` reescribe esas conexiones como si salieran de la imagen de la etapa (orden topológico, dependencias y prioridad sin casos especiales); sin etapa elegida o sin imagen, la conexión no entrega nada.

## Canvas — salidas armadas (texto estático y galería con entradas)
- `components/canvas/lib/node-outputs.ts` es el ÚNICO lugar que arma lo que entrega un nodo considerando sus entradas; ejecución, paneles, Personaje, contexto de escenas y servidor (vinculados) leen de ahí. Puro y tolerante a ciclos.
- Texto estático: entrada TEXTOS (`input-text-parts`, varias: estático, IA, Practicante, Escena, vinculado PROMPT/ADN/ESTILO/escena). Salida = piezas en el orden de `data.partOrder` (ids de conexión; el nodo las reordena con flechas) + su propio texto al final, separados por una línea en blanco (`staticTextOutput`). Una IA sin generar no aporta (el nodo lo avisa).
- Galería: entrada de imágenes (`input-gallery-images`, varias: imagen, imagen estática, galería, IMAGEN de etapa de un Personaje local o vinculado). Entrega sus fotos subidas + las conectadas, sin repetir (`galleryOutput`); el nodo las muestra marcadas y no se borran desde ahí. El Personaje puede elegir fotos de esas imágenes conectadas.
- Guión: entrada "Galería" (`input-gallery-images`): las imágenes van como referencia neutra a lo que genera CADA escena (`sceneReferenceImages`, también en escenas vinculadas vía `scriptImageUrls`). Distinta de la referencia visual (`input-visual-reference`), que "Leer guion" conecta solo a la primera escena.
- El servidor de vínculos carga el canvas de origen completo una vez por llamada y arma la vista con estas mismas funciones.

## Canvas — nodos vinculados entre canvas
- Tipo `linked` (migración 138; `nodes/linked-node.tsx`): muestra en solo lectura un Personaje, una Escena o una imagen (generada o estática) de OTRO canvas del mismo proyecto (botón "Vincular" del toolbar → `link-picker.tsx`). Origen en `data.sourceConversationId`/`sourceNodeId`/`sourceType`; vista resuelta en `data.linkSnapshot` con `linkHash` y `linkState` (`ok`/`deleted`/`forbidden`; borrado o sin acceso conserva la última vista).
- Servidor: `lib/canvas-links.ts` (`resolveLinks`, `listLinkables`). Acceso: origen del MISMO proyecto (no nulo) y usuario admin, dueño del origen o miembro del proyecto. Rutas: `GET …/canvas/linkables`, `POST …/canvas/links/resolve` (no escribe).
- Se actualiza al abrir el canvas (y otra vez al pasar a ser el editor, para persistir), antes de cada ejecución (`syncLinkedNodes` en `useCanvasExecution`) y con su botón. No se ejecuta nada en el canvas de origen.
- Personaje vinculado (`buildCharacterSnapshot`, `components/canvas/lib/linked.ts`): ADN, estilo conectado y por etapa texto, fotos e imagen. Salidas PROMPT (`output-character`: ADN + estilo + etapa), IMAGEN (`output-character-image`), ADN (`output-character-dna`) y ESTILO (`output-character-style`, también como estilo global de un Personaje local). PROMPT e IMAGEN eligen la etapa en la conexión (`data.imageOutputs[edgeId]`; PROMPT sin etapa = solo ADN + estilo). Todo texto de un vinculado sale de `linkedTextForHandle`.
- Uso en otros canvas (`listLinkUsage` en `lib/canvas-links.ts`, `GET …/canvas/links/usage`; mismo acceso que leer el origen): el Personaje y la Escena muestran "Vinculado en ACTO 1 · 5…" (`nodes/link-usage.tsx`; clic abre ese canvas centrado en el vinculado), cada etapa usada lleva una marca y borrarla pide confirmación; borrar un nodo vinculado en otros canvas pasa por `onBeforeDelete` con confirmación. El vinculado tiene "Abrir original". Navegación: prop `onOpenCanvas` del workspace (chat-interface abre la pestaña) + `focusNodeId`.
- Imagen vinculada (`LinkedImageSnapshot`: URL actual + prompt): salida IMAGEN (`output-image`) con las mismas conexiones que una imagen estática, salvo la referencia visual del Guión / Params Escena. El selector lista las imágenes con resultado de cada canvas (sin las de etapas de Personajes). `galleryImagesOf` la entrega, así sirve en galerías, Personajes y referencias. - Video vinculado (`LinkedVideoSnapshot`: URL actual, prompt, formato y, si es el video final de una escena, cuál): reproductor en el nodo y salida VIDEO (`output-video`, media de un texto). NO sirve de fotograma (eso necesitaría extraer el último cuadro con ffmpeg en el servidor).
- Montaje: pestaña "Videos" del selector de "Vincular" (`link-videos.tsx`, `GET …/canvas/links/videos` → `listVideoLinkables`). "Traer videos del guion" vincula de una vez el video final de cada escena de los canvas marcados (`sceneFinalVideos` en `components/canvas/lib/scene-videos.ts`, puro y con tests: lo que alcanza el destino de la escena sin pasar a otra escena; lo que alcanzan dos escenas es de la primera) y los deja como línea de tiempo: una fila por canvas (orden natural del título), una columna por escena, la B después de su A. No repite los ya vinculados. "Reordenar" mantiene ese orden (sección montaje de `storyLayout`). `fetchLinkResolutions` resuelve en tandas de 100 (el servidor acepta hasta 200).
- Botón "Videos (N)" del toolbar (también en solo lectura) → `panels/videos-panel.tsx`: todos los videos del canvas en orden (`listCanvasVideos` en `lib/canvas-videos.ts`, con tests: vinculados por canvas de origen y escena, luego los finales de las escenas propias como "Escena N", luego los demás) con link, copiar, abrir, descargar y "Ver en el canvas". Las descargas las hace el servidor con nombres numerados (`videoFileName`: "03 - ACTO 1 - Escena 3.mp4"): `GET …/canvas/videos/file?node=` (un video) y `GET …/canvas/videos/zip` ("Descargar todos": UN ZIP sin comprimir en streaming, `lib/zip-stream.ts` con ZIP64; Chrome cortaba las series largas de descargas sueltas en ~20). La lista sale del canvas guardado (`lib/canvas-video-downloads.ts`, mismo orden que el panel; acceso admin/dueño/miembro; solo URLs de nuestro bucket), nunca de URLs del cliente.
- Escena vinculada: la vista guarda el texto y los INGREDIENTES del contexto de guion (`SceneContextInputs`: info general, escenas anteriores, Params Escena conectado a la escena, reglas del Guión), no el texto armado. `components/canvas/lib/scene-context.ts` (`collectSceneContext` + `composeScriptContext` + `resolveScriptContext`) es el mismo código para escena local y vinculada (test de paridad), así las reglas obligatorias siempre son las vigentes.

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
- `POST /api/production/ai/verify-reference` — ciclo de verificación visual
  de "Fiel a la referencia" (`ReferenceVerifier` en layout-template-picker):
  el cliente renderiza la propuesta off-screen, la captura (≤1024 px) y la
  manda con la referencia; Gemini (`reference-verifier.ts`) devuelve
  `fidelity` 0-100 y correcciones chicas por capa (caja objetivo en %,
  color, `font_scale`, `hidden`) que `reference-verify.ts` aplica con topes
  (mover ≤20% del formato, escalar 0,5–2×, letra 0,6–1,6×, el logo nunca se
  oculta). Hasta 2 pasadas o hasta `FIDELITY_TARGET` (90); corre solo al
  generar y con "Verificar de nuevo". Las orientaciones se re-derivan con
  `adaptTree`. Invocación `VERIFY_REFERENCE`.
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

### Masters de tira
"+ Formato" ofrece, además de cuadrado/vertical/horizontal, "Tira horizontal"
1920×240 (8:1, para 728×90, 970×90, 468×60, 320×50) y "Tira vertical"
480×1800 (para 160×600). Las orientaciones nuevas se arman con `adaptTree`
(en tiras, `linearize`): los formatos alargados eligen la orientación de
proporción más cercana, así un 728×90 sale de la tira aprobada y no del 16:9.
En `linearize` un texto sobre su franja o caja se lleva el color como fondo
propio (la forma se oculta), los roles se infieren antes de absorber, una foto
panel es el fondo de la tira, los textos largos con fondo se componen como
texto, y legal/bajada no pasan de 0,4/0,6 de la letra del titular. El render
de adaptaciones aplica `ensureTextContrast` como red de seguridad.

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

### Chequeo de marca
`lib/production/brand-lint.ts` (`lintBrand(def, guide)`, puro): lo que exige
la guía de marca y el lint de diseño no mira — logo bajo `ancho_min_px` (o
<16 px), algo invadiendo el área de seguridad del logo (`area_seguridad`,
25% del lado corto si el manual no da cifra), legales obligatorios ausentes
(frases entre comillas/URLs de `legales.textos_obligatorios`), claims
prohibidos (`legales.restricciones` entre comillas) y `palabras_evitar`, y la
marca escrita distinto al manual. Son issues `brand_*` (LintIssue) que se
muestran aparte en "Revisar con IA" (líneas "Marca:") y como preflight del
paso Descargar (chip por fila + aviso); NO se le pasan al modelo de
corrección: se arreglan a mano o con "Pídele a la IA". La página carga la
guía con `GET /api/clients/[id]/brand-guide`.

### Resolución de fotos (Topaz)
`lib/production/image-resolution.ts` (puro) compara el tamaño natural de
cada foto con la caja más grande en que se exporta (× pixel ratio) y pide
un factor entero 2–4 (`upscaleFactor`, tolerancia 0,8). El paso Descargar
carga los tamaños en el browser y ofrece "Reescalar ×N":
`POST /api/production/designs/[id]/upscale-image` baja la foto (solo https
público), la pasa por Topaz Standard V2 (`lib/topaz-image.ts`, costo =
créditos × `TOPAZ_CREDIT_USD`, default 0.05), la sube a
`templates/{client}/ai/<stem>--Nx.png` y reemplaza la URL en todos los
templates del design (version+1) y en los `manual_layout` de las
adaptaciones. Invocación `UPSCALE_IMAGE` (cuenta en la cuota de IA).

### Nomenclatura y previsualización en contexto
- Archivos: `lib/production/export-naming.ts` —
  `cliente_proyecto_pieza_canal_WxH_vN.ext` (slug del cliente, título del
  proyecto, nombre del template, canal del preset, versión del master; en
  lotes del dataset se agrega `filaN`); los ZIP son
  `cliente_proyecto_pieza_vN_<sufijo>.zip`. `GET /api/production/projects/[id]`
  devuelve `client_slug` para esto.
- "Ver en contexto" (`components/production/context-mockup.tsx`, botón por
  fila en Descargar): la pieza dentro de un teléfono con la interfaz de
  Instagram (feed o story, cover como en el teléfono; TikTok si el canal es
  tiktok) o de una página de noticias (leaderboard arriba, rectángulo en el
  cuerpo, half page al lado). Marcos CSS, sin imágenes; el tipo se elige
  por canal y proporción (`mockupKindFor`) y se puede cambiar.

### Versiones del design
`production_design_versions` (migración 132) congela master + orientaciones
+ adaptaciones como vN con etiqueta y notas (`lib/production/design-versions.ts`:
`createDesignVersion`, `listDesignVersions`, `restoreDesignVersion`). Sin
flujo de aprobación (el cliente es interno). Restaurar guarda antes un
respaldo `kind='pre_restore'` (numerado aparte),
actualiza los templates que siguen existiendo (version+1) y recrea las
adaptaciones que faltan. Rutas: `GET/POST /api/production/designs/[id]/versions`,
`PATCH(label/notes)/POST(restore) …/versions/[versionId]`. Panel en el paso
Descargar (`design-versions-panel.tsx`); la última versión manual es la vN
de los nombres de archivo y el panel avisa si el contenido cambió después
(comparación por contenido). `production_templates.version` sigue siendo el
contador de guardados.

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
