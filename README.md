# Duaria Studio

Plataforma de chat con inteligencia artificial que integra Google Generative AI (Vertex AI) para conversaciones y generación de imágenes.

## Características

- **Conversaciones en tabs**: Múltiples conversaciones abiertas simultáneamente con persistencia de estado
- **Proyectos**: Organización de conversaciones por proyectos con configuraciones personalizadas
- **Generación de imágenes**: Soporte para modelos con capacidad de generación de imágenes (Imagen 3, Gemini)
- **Galería de generaciones**: Visualización de todas las imágenes generadas por proyecto
- **Archivado**: Sistema de archivado de conversaciones
- **Multi-usuario**: Asignación de usuarios a proyectos con acceso compartido
- **Streaming**: Respuestas en tiempo real con Server-Sent Events
- **Adjuntos**: Soporte para enviar imágenes y archivos en el chat
- **System Instructions**: Instrucciones de sistema por proyecto y por conversación

## Stack Tecnológico

- **Framework**: Next.js 16 (App Router)
- **Base de datos**: MySQL
- **Autenticación**: NextAuth.js v5
- **AI**: Google Generative AI SDK (@google/genai)
- **Almacenamiento**: AWS S3 + CloudFront CDN
- **UI**: Tailwind CSS + Radix UI + Lucide Icons
- **Markdown**: react-markdown + remark-gfm

## Requisitos

- Node.js 20+
- MySQL 8+
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
AUTH_SECRET=
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Google AI (Vertex AI)
GOOGLE_CLOUD_PROJECT=
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=
AWS_S3_FOLDER=
AWS_CLOUDFRONT_DOMAIN=
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
| `npm run build` | Build de producción |
| `npm run start` | Iniciar en producción |
| `npm run lint` | Ejecutar ESLint |
| `npm run migrate` | Ejecutar migraciones de BD |

## Estructura de Proyecto

```
├── app/
│   ├── api/              # API Routes
│   │   ├── auth/         # Autenticación
│   │   ├── conversations/# CRUD conversaciones
│   │   ├── messages/     # Mensajes y streaming
│   │   └── projects/     # Proyectos y generaciones
│   ├── chat/             # Página principal del chat
│   └── page.tsx          # Landing page
├── components/
│   ├── chat/             # Componentes del chat
│   └── ui/               # Componentes UI reutilizables
├── lib/
│   ├── db.ts             # Conexión a MySQL
│   ├── google-ai.ts      # Cliente de Google AI
│   └── s3.ts             # Cliente de AWS S3
└── scripts/
    └── migrations/       # Migraciones de BD
```

## Modelos Soportados

- Gemini 2.0 Flash
- Gemini 2.5 Pro
- Gemini 2.5 Flash (con generación de imágenes)
- Imagen 3

## Licencia

Proyecto privado. Todos los derechos reservados.
