# Plan de Integración: Módulo "Calculadora IA"

## Análisis del `public/old.html` - Puerto Budget V18

### Funcionamiento Actual

El archivo es una app standalone con 3 tabs:

**1. Calculadora** — Formulario de presupuesto con:
- **Modo**: Video / Foto / Mixto (selector global)
- **Datos Generales**: Nombre proyecto + Días hábiles
- **Video**: Planos totales, planos complejos, lip-sync, entrenamiento IA, máster (duración + aspect ratio), adaptaciones (16:9, 9:16, 1:1), reducciones
- **Foto**: N° imágenes, entrenamiento IA (+100%), retoque manual (cantidad + nivel básico/medio/complejo), escalado, capas PSD (+50%)
- **Costos Externos**: Lista dinámica de ítems con nombre + precio
- **Motor de cálculo**: Base por plano/imagen × multiplicadores (lip-sync 20%, training 15%, complejo 10%, adaptaciones, reducciones) + Tech Fee (5%)
- **Output**: Genera texto plano con desglose → popup modal → copiar al clipboard

**2. Histórico** — Lista en localStorage con favoritos, ver detalle, borrar

**3. Configuración** — Editar todos los valores base y porcentajes (persiste en localStorage)

---

## Lo que ya existe en la plataforma

- Migration 045 agrega `ai_calculator_access TINYINT(1)` a `users` (pendiente de ejecutar)
- El UI de usuarios ya tiene el toggle "Acceso a Calculadora IA"
- El API de usuarios ya lee/escribe `ai_calculator_access`
- Módulo de Clientes existe con CRUD completo (`clients` table)

---

## Fase 1: Base de Datos

### Nuevas tablas:

```sql
budgets
├── id (PK)
├── client_id (FK → clients) — cruce con módulo existente
├── project_name (VARCHAR) — texto libre, NO linkea con projects
├── created_by (FK → users)
├── status ENUM('draft','accepted','rejected') DEFAULT 'draft'
├── status_note TEXT NULL — nota al aceptar/rechazar
├── status_date DATETIME NULL
├── discount_amount DECIMAL NULL
├── discount_reason TEXT NULL
├── tech_fee_percent DECIMAL
├── subtotal DECIMAL
├── total DECIMAL
├── deleted_at DATETIME NULL — soft delete
├── created_at TIMESTAMP
├── updated_at TIMESTAMP

budget_items
├── id (PK)
├── budget_id (FK → budgets)
├── type ENUM('video','photo') — cada ítem es video O foto
├── sort_order INT
├── mode ENUM('dias_habiles','horas_hombre')
├── dias_habiles INT NULL — si mode = dias_habiles
├── item_data JSON — configuración específica del tipo (planos, lip-sync, etc.)
├── subtotal DECIMAL
├── created_at TIMESTAMP

budget_item_hours
├── id (PK)
├── budget_item_id (FK → budget_items)
├── user_id (FK → users) — persona asignada
├── hours DECIMAL — horas dedicadas

budget_item_externals
├── id (PK)
├── budget_item_id (FK → budget_items)
├── name VARCHAR
├── amount DECIMAL

budget_externals (costos externos globales del presupuesto)
├── id (PK)
├── budget_id (FK → budgets)
├── name VARCHAR
├── amount DECIMAL

budget_config (configuración global, reemplaza localStorage)
├── id (PK)
├── key VARCHAR UNIQUE
├── value JSON
├── updated_by (FK → users)
├── updated_at TIMESTAMP
```

## Fase 2: Acceso y Navegación

- **Ejecutar migration 045** para habilitar `ai_calculator_access`
- **Gate de acceso**: En la API, consultar `ai_calculator_access` del usuario (no está en JWT, se consulta desde DB)
- **Home (ChatInterface)**: Agregar botón "Calculadora IA" junto a los proyectos, visible solo si el usuario tiene `ai_calculator_access = 1`
- **Ruta**: `/calculadora` para usuarios, `/dashboard/calculadora` para admin (configuración)
- **Sidebar admin**: Agregar entrada "Calculadora IA" con ícono `Calculator`

## Fase 3: UI - Listado de Presupuestos (`/calculadora`)

Vista principal al entrar: tabla/lista con histórico de presupuestos del usuario:
- Columnas: **Fecha**, **Cliente** (del módulo clientes), **Proyecto** (texto libre), **Creador** (usuario), **Estado** (badge: Borrador/Aceptado/Rechazado), **Total**
- Botón "Nuevo Presupuesto"
- Admin ve todos los presupuestos, usuario normal ve solo los suyos (patrón existente)

## Fase 4: UI - Formulario de Presupuesto (`/calculadora/nuevo`)

### Datos Generales:
- **Cliente**: Select que consume `/api/clients` (módulo existente)
- **Proyecto**: Input de texto libre (no linkea con projects existentes)

### Items de Cotización (lista dinámica, botón "+ Agregar Ítem"):

Cada ítem tiene:
1. **Tipo**: Video o Foto (selector por ítem, no global)
2. **Modo de cobro**: Días Hábiles u Horas Hombre
   - **Días hábiles**: Input numérico (mínimo 1)
   - **Horas hombre**: Agregar personas (select de usuarios de la plataforma) + horas por cada uno
3. **Configuración específica del tipo**:
   - **Video**: Planos totales, planos complejos, lip-sync, entrenamiento IA, máster (duración + ratio), adaptaciones, reducciones
   - **Foto**: N° imágenes, entrenamiento IA, retoque (cantidad + nivel), escalado, capas PSD
4. **Costos externos del ítem**: Lista dinámica nombre + monto

### Costos Externos Globales (asociados al presupuesto completo):
- Lista dinámica nombre + monto

### Descuento:
- Monto del descuento
- Razón del descuento (textarea)

### Cálculo:
El motor de cálculo se mantiene igual (base × multiplicadores + tech fee), pero se ejecuta por cada ítem y se acumula.

## Fase 5: UI - Ficha del Presupuesto (`/calculadora/[id]`)

Vista tipo "ficha" (no popup) con:
- **Header**: Cliente, Proyecto, Fecha, Creador, Estado (badge)
- **Desglose completo**: Cada ítem con su detalle de cálculo
- **Resumen**: Subtotal, Costos externos globales, Descuento, Tech Fee, Total Final

### Acciones (botones):
- **Editar** → Vuelve al formulario precargado (deshabilitado si estado ≠ draft)
- **Duplicar** → Crea copia en estado draft
- **Borrar** → Soft delete con confirmación
- **Rechazado** → Modal con textarea para nota → cambia estado, guarda fecha, deshabilita edición
- **Aceptado** → Modal con textarea para nota → cambia estado, guarda fecha, deshabilita edición
- **Descargar/Imprimir** → Genera PDF o usa `window.print()` con CSS de impresión

## Fase 6: Configuración Admin (`/dashboard/calculadora`)

Reemplaza el tab "Configuración" del old.html:
- Mismos campos: costos base, porcentajes para video y foto, tech fee
- Se guarda en `budget_config` (DB), no localStorage
- Solo accesible por admin
- Botón "Restaurar valores por defecto"

## Fase 7: API Endpoints

```
GET    /api/calculadora              — Listar presupuestos (filtro por rol)
POST   /api/calculadora              — Crear presupuesto
GET    /api/calculadora/[id]         — Detalle con ítems
PUT    /api/calculadora/[id]         — Editar (solo si draft)
DELETE /api/calculadora/[id]         — Soft delete
PATCH  /api/calculadora/[id]/status  — Cambiar estado (accepted/rejected + nota)
POST   /api/calculadora/[id]/duplicate — Duplicar

GET    /api/calculadora/config       — Leer configuración
PUT    /api/calculadora/config       — Guardar configuración (admin only)
```

---

## Resumen de Diferencias vs. old.html

| old.html | Plataforma |
|---|---|
| Modo global (Video/Foto/Mixto) | Cada ítem es Video o Foto individualmente |
| Días hábiles como input simple | Días hábiles OR Horas hombre (con asignación de personas) |
| Costos externos solo por presupuesto | Costos externos por ítem + costos externos globales |
| Sin descuentos | Área de descuento con monto y razón |
| Output: popup texto plano | Ficha en página dedicada, descargable/imprimible |
| Histórico en localStorage | Tabla en DB con estados (draft/accepted/rejected) |
| Configuración en localStorage | Módulo admin en dashboard, persistido en DB |
| Sin control de acceso | Gated por `ai_calculator_access` del usuario |
| Cliente = texto libre | Cliente = select del módulo Clientes existente |
| Proyecto = texto libre | Proyecto = texto libre (se mantiene) |
