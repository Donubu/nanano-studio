# Puerto Studio

Plataforma multi-proveedor de generación con IA para texto, imágenes, video, audio y música. Gestiona usuarios, proyectos, clientes, costos, facturación y analíticas.

## Características

- **Conversaciones en tabs**: Múltiples conversaciones abiertas simultáneamente con persistencia de estado
- **Proyectos**: Organización de conversaciones por proyectos con configuraciones personalizadas
- **Generación multi-modal**: Texto (streaming), imágenes (Imagen 4), video (VEO, Grok), audio/TTS (Chirp 3 HD), música (Lyria)
- **Galería de generaciones**: Visualización de todo el contenido generado por proyecto
- **Dashboard admin**: Estadísticas, analíticas de uso, monitoreo de workers, gestión de modelos
- **Calculadora de costos**: Estimación de presupuestos por tipo de generación
- **Multi-usuario**: Asignación de usuarios a proyectos con roles y límites mensuales por calidad
- **Streaming**: Respuestas en tiempo real con Server-Sent Events
- **Adjuntos**: Soporte para enviar imágenes y archivos en el chat
- **System Instructions**: Instrucciones de sistema por proyecto y por conversación
- **Topaz Studio**: Upscaling de imágenes y video con Topaz AI
- **TTS Composer**: Herramienta de composición de texto a voz

## Stack Tecnológico

- **Framework**: Next.js 16+ (App Router, standalone output), React 19, TypeScript
- **Base de datos**: MySQL via `mysql2/promise` (Google Cloud SQL en producción)
- **Autenticación**: NextAuth v5 (beta) con Google OAuth
- **Cola de trabajos**: BullMQ + Redis para jobs de generación asíncronos
- **Almacenamiento**: AWS S3 + CloudFront CDN
- **Proveedores AI**:
  - Google Gemini API / Vertex AI (texto, Imagen 4, VEO video, Chirp 3 HD TTS, Lyria música)
  - xAI Grok (Grok Imagine Video)
- **UI**: Tailwind CSS + Radix UI + Lucide Icons
- **Markdown**: react-markdown + remark-gfm
- **Deployment**: Docker + docker-compose en GCP VM, Nginx reverse proxy

## Requisitos

- Node.js 20+
- MySQL 8+ (Google Cloud SQL en producción)
- Redis (para BullMQ)
- Cuenta de Google Cloud con Vertex AI habilitado
- Cuenta de AWS (S3 + CloudFront)

## Variables de Entorno

```env
# Base de datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=nanano

# Autenticación
NEXTAUTH_URL=https://puerto.studio
NEXTAUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Google AI (Vertex AI / Gemini API)
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=global
GOOGLE_APPLICATION_CREDENTIALS=
GOOGLE_API_KEY=
GEMINI_API_KEY=
GOOGLE_GENAI_USE_VERTEXAI=true

# AWS S3
AWS_REGION=sa-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
AWS_S3_FOLDER=
AWS_CLOUDFRONT_DOMAIN=

# Topaz AI
TOPAZ_API_KEY=

# Cost Configuration
COST_CORRECTION_MULTIPLIER=1.05

# GCP Billing (BigQuery)
GCP_BILLING_ACCOUNT_ID=
GCP_BILLING_DATASET=
GCP_BILLING_PROJECT=
GCP_BILLING_LOCATION=
```

## Instalación

```bash
# Instalar dependencias
npm install

# Ejecutar migraciones
npm run migrate

# Iniciar servidor de desarrollo
npm run dev
```

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción (standalone) |
| `npm run build:worker` | Build del worker process |
| `npm run start` | Iniciar en producción |
| `npm run migrate` | Ejecutar migraciones de BD |
| `npm run lint` | Ejecutar ESLint |

## Deployment (Producción)

- **Dominio**: `https://puerto.studio`
- **Branch**: `main`
- **Auto-deploy**: Webhook de GitHub dispara deploy automático en push a `main`
- **Blue-green**: Zero-downtime deployment via `scripts/deploy.sh`
- **SSL**: Certificados Let's Encrypt (certbot instalado en el host)

```bash
# Deploy manual
./scripts/deploy.sh

# Inicializar SSL (primera vez)
./scripts/init-ssl.sh

# Docker (producción GCP)
docker compose -f docker-compose.gcp.yml up -d
```

### Arquitectura de servicios
- **nginx**: Reverse proxy con SSL, blue-green upstream switching
- **puerto_studio_blue/green**: Slots de la app Next.js (blue-green)
- **worker_1+**: Workers BullMQ para procesamiento de generaciones
- **redis**: Cola de trabajos y cache

## Estructura de Proyecto

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
    health/               # Health check endpoint
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
  calculadora/            # Budget calculator components
  dashboard/              # Dashboard layout (sidebar, header)
  ui/                     # Shared UI primitives (Radix-based)

lib/                      # Shared utilities and API clients
worker/                   # BullMQ worker process
scripts/
  migrations/             # SQL migration files
  deploy.sh               # Blue-green zero-downtime deploy
  init-ssl.sh             # SSL certificate initialization
  docker-start.sh         # Docker entrypoint (web vs worker mode)
  build-worker.js         # Worker build script
  bump-version.js         # Version auto-increment
  migrate.js              # Migration runner
nginx/
  conf.d/default.conf     # Nginx config (puerto.studio + v2.puerto.studio)
  conf.d/upstream.active  # Active blue/green slot
```

## Modelos Soportados

- Gemini 2.0 Flash / 2.5 Pro / 2.5 Flash (texto + imágenes)
- Imagen 4 (generación de imágenes)
- VEO (generación de video)
- Chirp 3 HD (text-to-speech)
- Lyria (generación de música)
- Grok Imagine Video (xAI)

## Licencia

Proyecto privado. Todos los derechos reservados.
