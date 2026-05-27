/**
 * Acceso desde las API routes al namespace `/canvas` de Socket.IO.
 *
 * El namespace se expone via `globalThis.__canvasIo` desde server.custom.ts
 * — funciona porque Next.js y Socket.IO corren en el mismo proceso (custom
 * server). Si en algún momento las API routes se separan del proceso, hay
 * que reemplazar esto por un adapter Redis o equivalente.
 */
import type { Namespace } from "socket.io";

type CanvasNamespace = Namespace;

function getCanvasIo(): CanvasNamespace | null {
  const g = globalThis as unknown as { __canvasIo?: CanvasNamespace };
  return g.__canvasIo ?? null;
}

function roomForConversation(conversationId: number | string): string {
  return `canvas:${conversationId}`;
}

/**
 * Broadcastea a todos los clientes conectados a una conversación.
 *
 * `excludeUserId` permite excluir al cliente origen (que ya aplicó el cambio
 * localmente) si el cliente envía su userId al hacer la petición HTTP.
 * Por ahora no filtramos por user — los clientes deduplican por id.
 */
export function broadcastCanvasEvent(
  conversationId: number | string,
  event: string,
  payload: Record<string, unknown>
): void {
  const nsp = getCanvasIo();
  if (!nsp) return;
  nsp.to(roomForConversation(conversationId)).emit(event, payload);
}

/**
 * Emite un evento como "volatile" — para mensajes de alta frecuencia (move)
 * donde perder un frame intermedio no es problema. Socket.IO los descarta
 * si el cliente está saturado en vez de encolarlos.
 */
export function broadcastCanvasEventVolatile(
  conversationId: number | string,
  event: string,
  payload: Record<string, unknown>
): void {
  const nsp = getCanvasIo();
  if (!nsp) return;
  nsp.to(roomForConversation(conversationId)).volatile.emit(event, payload);
}
