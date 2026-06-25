# Canvas — Lock de edición (single-editor por presencia)

## Qué hace
En conversaciones tipo **canvas**, solo **un** usuario puede editar a la vez: el
**primer usuario presente** en la sala (sea o no el creador). Todos los demás
entran en modo **solo-ver** (no mueven, no editan, no conectan, no borran, no
ejecutan, no guardan). Si el editor se desconecta, el lock se **traspasa** al
siguiente usuario más antiguo que siga presente; si la sala queda vacía, lo toma
el próximo que llegue.

## ⚠️ OJO: el servidor de colaboración está DUPLICADO
Hay **dos** implementaciones del socket server `/canvas`, y hay que mantenerlas
en sync (cualquier cambio de lógica va en las dos):

- **`server.custom.ts`** (inline) → la que corre en **DEV** (`npm run dev` =
  `tsx server.custom.ts`).
- **`lib/collaboration/collab-server.ts`** (se compila a `dist/collab-server.js`
  con `npm run build:collab`) → la que carga **PROD** vía
  `scripts/server-wrapper.js` (`initCollabServer`).

Si editas solo una, dev y prod divergen. El bug clásico: agregar el editor-lock
en `collab-server.ts` pero no en `server.custom.ts` → en dev el server nunca
manda `editorUserId`, el cliente lo recibe `undefined` y **todos quedan en
solo-lectura**. (Por eso el cliente hace fail-open: `editorUserId ?? null`.)

## Cómo está implementado (cliente + servidor de presencia)
La autoridad vive en el **servidor de colaboración** (`/canvas`, Socket.IO),
en las DOS implementaciones de arriba:

- `lib/collaboration/collab-server.ts` (y su gemelo inline `server.custom.ts`)
  - `roomEditor: Map<room, userId>` — el editor de cada sala.
  - `ensureEditor()` asigna el lock al primer presente (el `Map` de presencia
    preserva orden de inserción).
  - `releaseEditorIfHolder()` lo traspasa en `disconnect` / cambio de sala.
  - Emite `editor:update` al cambiar y manda `editorUserId` en `presence:update`.
- `lib/collaboration/types.ts` — eventos `editor:update` + `editorUserId`.
- `components/canvas/hooks/use-collaboration.ts` — deriva `canEdit = editorUserId
  == null || editorUserId === myUserId` y lo expone.
- `components/canvas/canvas-context.tsx` — propaga `canEdit` a los nodos.
- Gating de UI/escritura: `canvas-workspace.tsx` (props de ReactFlow
  `nodesDraggable/nodesConnectable/edgesReconnectable/deleteKeyCode` + guards en
  `addNode/onConnect/updateNodeData/deleteNode/reorderNodes/lockAllNodes`),
  `use-canvas-persist.ts` (corta TODA persistencia si `!canEdit`), `canvas-toolbar.tsx`
  (badge "Solo lectura · edita X" y oculta herramientas), paneles de config y
  `node-status.tsx` (oculta botón de borrar).

## Limitación conocida / por qué es "frágil" hoy
La presencia es **in-memory por instancia** y NO se sincroniza por el adapter de
Redis (que solo replica broadcasts de Socket.IO, no el `Map` de presencia). Con
nginx apuntando a un solo slot activo (blue **o** green) todos los clientes vivos
están en la misma instancia, así que el orden de llegada y el lock son
consistentes. En un switch de deploy la sala se reforma en el nuevo slot y el
editor se reasigna al primer reconectado.

Además, el gating es **solo de cliente**: los endpoints REST de escritura del
canvas NO verifican quién eres. Un cliente modificado podría escribir igual.

## TODO futuro — enforcement server-side (NO implementado)
Decisión explícita: dejarlo documentado, no hacerlo ahora. Cuando se quiera un
lock robusto:

1. En `collab-server.ts`, espejar el editor actual en Redis al asignarlo/
   traspasarlo: `SET canvas:editor:<conversationId> <userId>` (y `DEL` al quedar
   la sala vacía). Reusar `lib/redis.ts`.
2. En los endpoints de mutación del canvas, rechazar (HTTP 403) si el usuario de
   la sesión no es el editor:
   - `app/api/conversations/[id]/canvas/route.ts` (PUT)
   - `app/api/conversations/[id]/canvas/nodes/route.ts` (POST/PATCH/DELETE)
   - `app/api/conversations/[id]/canvas/edges/route.ts` (POST/DELETE)
   - Leer `canvas:editor:<id>` de Redis; si no hay key (Redis no configurado en
     dev), caer a permitir (gating solo de cliente, como hoy).
3. Considerar un TTL/heartbeat para el lock en Redis por si una instancia muere
   sin liberar (el `disconnect` no llega). El editor cliente puede refrescar el
   TTL mientras esté presente.

## Relacionado
- Cambio gemelo de la misma tanda: se quitó el "Run All" global del toolbar y
  cada **nodo raíz** (sin edges entrantes, con descendientes IA) tiene su propio
  botón "RUN ALL" que ejecuta solo su flujo (`executeFromRoot` en
  `hooks/use-canvas-execution.ts`, `getDescendantNodes` en `lib/topological-sort.ts`).
