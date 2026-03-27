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

function getRoomKey(conversationId: number): string {
  return `canvas:${conversationId}`;
}

function getPresence(room: string): CollabUser[] {
  return Array.from(roomPresence.get(room)?.values() || []);
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

        // Send full presence to the joining user
        socket.emit("presence:update", { users: getPresence(room) });

        // Notify others
        socket.to(room).emit("user:joined", { user });

        console.log(`[Collab] User ${name} joined canvas:${conversationId} (${getPresence(room).length} users)`);
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

          // Cleanup empty rooms
          if (roomPresence.get(room)?.size === 0) {
            roomPresence.delete(room);
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
