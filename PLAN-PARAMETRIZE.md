# Plan: Parametrizar instalacion para multiples agencias

## Variables de entorno nuevas

Toda la configuracion especifica de una instalacion se controla con estas env vars:

| Variable | Ejemplo Puerto Studio | Ejemplo Agencia X |
|---|---|---|
| `INSTANCE_NAME` | `puerto` | `agenciax` |
| `APP_DOMAIN` | `puerto.studio` | `studio.agenciax.com` |
| `NEXT_PUBLIC_APP_NAME` | `Puerto Studio` | `Agencia X Studio` |
| `NEXT_PUBLIC_APP_LOGO_TEXT` | `PS` | `AX` |
| `NEXT_PUBLIC_APP_TAGLINE` | `Potenciado con Vertex AI` | `Powered by AI` |
| `GCP_BILLING_URL` | `https://console.cloud.google.com/billing/...` | (otra URL o vacio) |
| `CDN_DOMAIN` | `static.puer.to` | `cdn.agenciax.com` |
| `NEXT_PUBLIC_TIMEZONE` | `America/Santiago` | `America/Mexico_City` |
| `ADMIN_EMAIL` | `mgomez@puer.to` | `admin@agenciax.com` |

Las que ya existen (`NEXTAUTH_URL`, `DB_HOST`, `GCS_BUCKET`, etc.) siguen funcionando igual — cada agencia las configura en su `.env.production`.

## Cambios por area

### 1. Docker Compose (`docker-compose.gcp.yml`)
- Reemplazar todos los `container_name: puerto_*` por `container_name: ${INSTANCE_NAME}_*`
- Docker Compose soporta variable substitution nativamente desde `.env`
- Los service names internos (que usa deploy.sh) tambien usan `${INSTANCE_NAME}`
- **Nota**: `docker-compose.yml` (dev/legacy) se actualiza igual pero es menos critico
- **Nota**: `docker-compose.yml` tiene rutas de host hardcodeadas (`/var/www/vhosts/puerto.to/private/.env` y `credentials.json`) en volumenes de cada servicio. Cada agencia las configurara en su propio compose override o directamente — no parametrizar con variable, documentar en provisioning.

**Archivos**: `docker-compose.gcp.yml`, `docker-compose.yml`
**Referencias**: 11 container_name en gcp, 5 en dev, 10 rutas de host en dev compose

### 2. Deploy Script (`scripts/deploy.sh`)
- Leer `INSTANCE_NAME` del `.env.production` o recibirlo como parametro
- Reemplazar las ~19 referencias hardcodeadas a `puerto_*` por `${INSTANCE_NAME}_*`
- Ejemplo: `puerto_studio_blue` -> `${INSTANCE_NAME}_studio_blue`

**Archivos**: `scripts/deploy.sh`
**Referencias**: 19 referencias a puerto_*

### 3. Nginx Config (`nginx/conf.d/default.conf`)
- Convertir a template: `nginx/conf.d/default.conf.template`
- Usar `envsubst` en el entrypoint de nginx para generar el config final
- Variables: `${APP_DOMAIN}` para server_name y cert paths
- Eliminar el server block de `v2.puerto.studio` (redirect legacy) — cada agencia solo tiene un dominio

**Archivos**: `nginx/conf.d/default.conf` -> `nginx/conf.d/default.conf.template`
**Referencias**: 8 referencias a puerto.studio, 2 a v2.puerto.studio

### 4. Upstream Active (`nginx/conf.d/upstream.active`)
- Deploy script ya lo genera dinamicamente, solo cambiar la referencia de `puerto_studio_blue` a `${INSTANCE_NAME}_studio_blue`

**Archivos**: `nginx/conf.d/upstream.active`

### 5. SSL Init Script (`scripts/init-ssl.sh`)
- Parametrizar `DOMAIN` y `EMAIL` desde env vars (`APP_DOMAIN`, `ADMIN_EMAIL`) o argumentos
- Actualmente hardcodea `DOMAIN="puerto.studio"` y `EMAIL="mgomez@puer.to"`
- Uso: `./scripts/init-ssl.sh studio.agenciax.com admin@agenciax.com`

**Archivos**: `scripts/init-ssl.sh`
**Referencias**: DOMAIN (linea 4) y EMAIL (linea 5) hardcodeados, multiples refs a puerto.studio

### 6. UI Branding — Login (`app/login/page.tsx`)
- Mover logo text, app name, tagline a env vars con `NEXT_PUBLIC_` prefix
- `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_LOGO_TEXT`, `NEXT_PUBLIC_APP_TAGLINE`
- El gradiente amarillo se mantiene como default

**Archivos**: `app/login/page.tsx`
**Referencias**: "PS" (linea 30), "Puerto Studio" (linea 34-35), "Potenciado con Vertex AI" (linea 38)

### 7. UI Branding — Dashboard Header & Welcome (`components/dashboard/header.tsx`, `app/dashboard/page.tsx`)
- Header: leer de `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_LOGO_TEXT`
- Dashboard welcome: "Bienvenido a Puerto Studio" -> usar `NEXT_PUBLIC_APP_NAME`

**Archivos**: `components/dashboard/header.tsx`, `app/dashboard/page.tsx`
**Referencias**: "PS" (header linea 43), "Puerto Studio" (header linea 46), "Bienvenido a Puerto Studio" (dashboard linea 75)

### 8. UI Branding — Layout Metadata (`app/layout.tsx`)
- `title` y `description` de Metadata -> leer de env vars con fallback

**Archivos**: `app/layout.tsx`
**Referencias**: "Puerto Studio" (linea 19), "Potenciado con Vertex AI" (linea 20)

### 9. Share/Public Pages
- `app/share/[token]/page.tsx` -> usar `NEXT_PUBLIC_APP_NAME` en title, eliminar fallback hardcodeado a `https://puerto.studio` (linea 25)
- `app/api/conversations/[id]/share/route.ts` -> ya usa `NEXTAUTH_URL` con fallback, eliminar fallback hardcodeado a `https://puerto.studio` (linea 7)
- `components/share/shared-gallery.tsx` -> footer "Creado con Puerto Studio" y link a `puerto.studio` (lineas 455-463) -> usar `NEXT_PUBLIC_APP_NAME` y `NEXT_PUBLIC_APP_URL` (o `NEXTAUTH_URL`)

**Archivos**: `app/share/[token]/page.tsx`, `app/api/conversations/[id]/share/route.ts`, `components/share/shared-gallery.tsx`

### 10. Next.js Config (`next.config.ts`)
- `hostname: "static.puer.to"` -> mover a env var `CDN_DOMAIN` y agregar dinamicamente al array de remote patterns

**Archivos**: `next.config.ts`
**Referencias**: "static.puer.to" (linea 18)

### 11. Sidebar GCP Link (`components/dashboard/sidebar.tsx`)
- El link hardcodeado a la facturacion GCP -> leer de `GCP_BILLING_URL` env var
- Si esta vacio, no mostrar el item del menu

**Archivos**: `components/dashboard/sidebar.tsx`
**Referencias**: URL completa de billing GCP (linea 104)

### 12. Timezone en UI
- Reemplazar `"America/Santiago"` hardcodeado por `process.env.NEXT_PUBLIC_TIMEZONE || "America/Santiago"`
- Solo afecta formateo de fechas en UI, no logica de servidor

**Archivos**: `app/dashboard/changelog/page.tsx` (linea 256), `app/dashboard/workers/page.tsx` (linea 113)
**Referencias**: 2 usos de `timeZone: "America/Santiago"`

### 13. Script de Provisioning (nuevo: `scripts/provision.sh`)
- Recibe: nombre de instancia, dominio, email admin
- Genera: `.env.production` con todas las variables necesarias
- Ejecuta: `init-ssl.sh` para obtener certificados
- Crea: base de datos y corre migraciones
- Output: instrucciones para configurar OAuth en Google Console

## Lo que NO cambia

- Estructura de codigo, rutas API, logica de negocio
- Esquema de base de datos
- Flujo de autenticacion (solo cambia el redirect URL por env)
- Worker, queue, Redis — ya se configuran por env

## Orden de ejecucion

1. Variables de entorno + next.config.ts (base)
2. UI branding (login, header, dashboard welcome, layout, share, sidebar, timezone)
3. Docker compose parametrizado
4. Deploy script parametrizado
5. Nginx template + envsubst
6. SSL init parametrizado
7. Script de provisioning

## Riesgos

- **Docker Compose variable substitution** requiere que las vars esten definidas al momento del `docker compose up`. Si falta `INSTANCE_NAME`, los containers se crean con nombres vacios. Mitigar con defaults en el compose file y validacion en deploy.sh.
- **Nginx envsubst** puede sobreescribir variables de nginx (`$host`, `$request_uri`). Usar solo las variables especificas en envsubst, no todas.
- **NEXT_PUBLIC_*** requiere rebuild para cambiar. Es correcto porque cada agencia tiene su propio build.
