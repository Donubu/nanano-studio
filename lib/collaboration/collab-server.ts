import { Server as SocketIOServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as HTTPServer } from "http";
import type { ClientToServerEvents, ServerToClientEvents, CollabUser } from "./types";
import { getUserColor } from "./colors";

// Try to import Redis - graceful fallback if not available
let createRedisConnection: (() => import("ioredis").default) | null = null;
try {
  // Dynamic import to avoid issues when Redis is not configured
  const redis = require("../redis");
  if (redis.isRedisConfigured && redis.isRedisConfigured()) {
    createRedisConnection = redis.createRedisConnection;
  }
} catch {
  // Redis not available - run without adapter (single instance only)
}

type CollabSocket = import("socket.io").Socket<ClientToServerEvents, ServerToClientEvents> & {
  data: {
    userId: number;
    name: string;
    image: string | null;
    color: string;
    conversationId?: number;
  };
};

// In-memory presence per room (also stored in Redis if available)
const roomPresence = new Map<string, Map<number, CollabUser>>();

// Editor lock por sala: solo el primer usuario presente puede editar; el resto
// queda en solo-ver. Si el editor se desconecta, el lock se traspasa al
// siguiente presente (el Map de presencia preserva orden de inserción, así que
// el "siguiente más antiguo" es el primer key restante). Estado efímero
// in-memory: con nginx apuntando a un solo slot activo todos los clientes vivos
// están en la misma instancia, así que el orden de llegada es consistente.
// TODO(futuro): para enforcement server-side de las escrituras REST, espejar
// este editor en Redis (`canvas:editor:<convId>`) y rechazar en los endpoints
// de canvas las mutaciones de quien no sea el editor. Ver docs/canvas-editor-lock.md.
const roomEditor = new Map<string, number>();

function getRoomKey(conversationId: number): string {
  return `canvas:${conversationId}`;
}

function getPresence(room: string): CollabUser[] {
  return Array.from(roomPresence.get(room)?.values() || []);
}

function getEditor(room: string): number | null {
  return roomEditor.get(room) ?? null;
}

// Resuelve el editor de la sala con auto-saneo: si el editor guardado ya no
// está presente (desconexión perdida, ghost por HMR/reconexión, estado viejo
// del proceso en dev), reasigna al primer presente. Así un usuario solo nunca
// queda atrapado viendo un editor fantasma. Idempotente.
function ensureEditor(room: string): number | null {
  const presence = roomPresence.get(room);
  if (!presence || presence.size === 0) {
    roomEditor.delete(room);
    return null;
  }
  const current = roomEditor.get(room);
  // Solo conservamos el editor guardado si SIGUE presente.
  if (current !== undefined && presence.has(current)) return current;
  const first = presence.keys().next().value!;
  roomEditor.set(room, first);
  return first;
}

// Si el usuario que sale tenía el lock, lo libera y reasigna al siguiente
// presente. Asume que `leavingUserId` YA fue removido de la presencia.
// Devuelve true si el editor cambió (para emitir editor:update).
function releaseEditorIfHolder(room: string, leavingUserId: number): boolean {
  if (roomEditor.get(room) !== leavingUserId) return false;
  roomEditor.delete(room);
  const next = roomPresence.get(room)?.keys().next().value;
  if (next !== undefined) roomEditor.set(room, next);
  return true;
}


/**
 * Initialize the collaboration WebSocket server.
 */
export function initCollabServer(httpServer: HTTPServer): SocketIOServer | null {
  try {
    const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      pingInterval: 15000,
      pingTimeout: 30000,
      cors: {
        origin: process.env.NEXTAUTH_URL || "*",
        credentials: true,
      },
    });

    // Redis adapter for multi-instance support (blue-green deploy)
    if (createRedisConnection) {
      try {
        const pubClient = createRedisConnection();
        const subClient = createRedisConnection();
        io.adapter(createAdapter(pubClient, subClient));
        console.log("[Collab] Redis adapter configured");
      } catch (err) {
        console.warn("[Collab] Redis adapter failed, running single-instance:", err);
      }
    } else {
      console.log("[Collab] Running without Redis adapter (single instance)");
    }

    // Canvas namespace
    const canvasNsp = io.of("/canvas");

    // Auth middleware — uses auth data sent by client from session
    canvasNsp.use(async (socket, next) => {
      const auth = socket.handshake.auth || {};
      const userId = Number(auth.userId);
      if (!userId) {
        return next(new Error("No userId in auth"));
      }

      (socket as CollabSocket).data = {
        userId,
        name: (auth.name as string) || `User ${userId}`,
        image: (auth.image as string) || null,
        color: getUserColor(userId),
      };

      next();
    });

    // Connection handler
    canvasNsp.on("connection", (rawSocket) => {
      const socket = rawSocket as CollabSocket;
      const { userId, name, image, color } = socket.data;

      console.log(`[Collab] User ${name} (${userId}) connected`);

      // Send auth info back to client
      socket.emit("auth:success", { userId, color });

      // Join room
      socket.on("join", ({ conversationId }) => {
        // Leave previous room if any
        if (socket.data.conversationId) {
          const prevRoom = getRoomKey(socket.data.conversationId);
          socket.leave(prevRoom);
          roomPresence.get(prevRoom)?.delete(userId);
          socket.to(prevRoom).emit("user:left", { userId });
          // Si tenía el lock en la sala anterior, traspasarlo.
          if (releaseEditorIfHolder(prevRoom, userId)) {
            socket.to(prevRoom).emit("editor:update", { editorUserId: getEditor(prevRoom) });
          }
          if (roomPresence.get(prevRoom)?.size === 0) roomPresence.delete(prevRoom);
        }

        const room = getRoomKey(conversationId);
        socket.join(room);
        socket.data.conversationId = conversationId;

        // Add to presence
        if (!roomPresence.has(room)) {
          roomPresence.set(room, new Map());
        }
        const user: CollabUser = { userId, name, image, color };
        roomPresence.get(room)!.set(userId, user);

        // Resuelve el editor (auto-sanea si el guardado ya no está presente).
        const prevEditor = getEditor(room);
        const editorUserId = ensureEditor(room);

        // Send full presence + editor actual to the joining user
        socket.emit("presence:update", { users: getPresence(room), editorUserId });

        // Notify others
        socket.to(room).emit("user:joined", { user });

        // Si el editor cambió por el saneo (p.ej. el guardado era un fantasma),
        // avisar al resto para que recalculen su canEdit.
        if (editorUserId !== prevEditor) {
          socket.to(room).emit("editor:update", { editorUserId });
        }

        console.log(`[Collab] User ${name} joined canvas:${conversationId} (${getPresence(room).length} users, editor=${editorUserId})`);
      });

      // Cursor movement
      socket.on("cursor:move", ({ x, y }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);

        // Update presence
        const presence = roomPresence.get(room)?.get(userId);
        if (presence) presence.cursor = { x, y };

        socket.to(room).volatile.emit("cursor:update", { userId, x, y });
      });

      // Node selection
      socket.on("node:select", ({ nodeId }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);

        const presence = roomPresence.get(room)?.get(userId);
        if (presence) presence.selectedNodeId = nodeId;

        socket.to(room).emit("node:selected", { userId, nodeId });
      });

      // Connector drag
      socket.on("connector:start", ({ nodeId, handleId, handleType }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);

        const presence = roomPresence.get(room)?.get(userId);
        if (presence) presence.connectorDrag = { nodeId, handleId, handleType };

        socket.to(room).emit("connector:update", {
          userId, action: "start", nodeId, handleId, handleType,
        });
      });

      socket.on("connector:move", ({ x, y }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);

        const presence = roomPresence.get(room)?.get(userId);
        if (presence?.connectorDrag) presence.connectorDrag.endPoint = { x, y };

        socket.to(room).volatile.emit("connector:update", { userId, action: "move", x, y });
      });

      socket.on("connector:end", () => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);

        const presence = roomPresence.get(room)?.get(userId);
        if (presence) presence.connectorDrag = null;

        socket.to(room).emit("connector:update", { userId, action: "end" });
      });

      // Granular canvas changes
      socket.on("node:data", ({ nodeId, updates }: { nodeId: string; updates: Record<string, unknown> }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:data:update", { userId, nodeId, updates });
      });

      socket.on("node:move", ({ nodeId, x, y }: { nodeId: string; x: number; y: number }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).volatile.emit("node:moved", { userId, nodeId, x, y });
      });

      socket.on("node:add", ({ node }: { node: Record<string, unknown> }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:added", { userId, node });
      });

      socket.on("node:remove", ({ nodeId }: { nodeId: string }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:removed", { userId, nodeId });
      });

      socket.on("edge:add", ({ edge }: { edge: Record<string, unknown> }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("edge:added", { userId, edge });
      });

      socket.on("edge:remove", ({ edgeId }: { edgeId: string }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("edge:removed", { userId, edgeId });
      });

      // Node execution status
      socket.on("node:status", ({ nodeId, status }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:status:update", { userId, nodeId, status });
      });

      // Disconnect
      socket.on("disconnect", () => {
        if (socket.data.conversationId) {
          const room = getRoomKey(socket.data.conversationId);
          roomPresence.get(room)?.delete(userId);
          socket.to(room).emit("user:left", { userId });

          // Si el que se va tenía el lock de edición, traspasarlo al siguiente
          // presente (o liberarlo si la sala queda vacía) y avisar al resto.
          if (releaseEditorIfHolder(room, userId)) {
            socket.to(room).emit("editor:update", { editorUserId: getEditor(room) });
          }

          // Cleanup empty rooms
          if (roomPresence.get(room)?.size === 0) {
            roomPresence.delete(room);
            roomEditor.delete(room);
          }

          console.log(`[Collab] User ${name} left canvas:${socket.data.conversationId}`);
        }
      });
    });

    console.log("[Collab] WebSocket server initialized on /canvas namespace");
    return io;
  } catch (err) {
    console.error("[Collab] Failed to initialize:", err);
    return null;
  }
}
