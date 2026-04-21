/**
 * Custom server that runs Next.js + socket.io on the same port.
 * Used in both dev (via `npx tsx server.custom.ts`) and production (via server-wrapper.js).
 */
import { createServer } from "http";
import next from "next";
import { loadEnvConfig } from "@next/env";
import { Server as SocketIOServer } from "socket.io";
import { getUserColor } from "./lib/collaboration/colors";

const dev = process.env.NODE_ENV !== "production";
// Load .env* files into process.env before reading PORT / HOSTNAME so
// values placed in .env.local are honored by the custom server.
loadEnvConfig(process.cwd(), dev);

const hostname = process.env.HOSTNAME || "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// In-memory presence per room
const roomPresence = new Map<string, Map<number, { userId: number; name: string; image: string | null; color: string }>>();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  // Attach socket.io
  const io = new SocketIOServer(httpServer, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    pingInterval: 15000,
    pingTimeout: 30000,
    cors: { origin: "*", credentials: true },
    addTrailingSlash: false,
  });

  const canvasNsp = io.of("/canvas");

  // Auth: use handshake auth data passed from client (session info)
  canvasNsp.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const userId = Number(auth.userId);
    if (!userId) {
      return next(new Error("No userId in auth"));
    }
    socket.data = {
      userId,
      name: (auth.name as string) || `User ${userId}`,
      image: (auth.image as string) || null,
      color: getUserColor(userId),
    };
    next();
  });

  canvasNsp.on("connection", (socket) => {
    const { userId, name, color, image } = socket.data as {
      userId: number; name: string; image: string | null; color: string;
    };

    console.log(`[Collab] User ${name} (${userId}) connected`);
    socket.emit("auth:success", { userId, color });

    // Join room
    socket.on("join", ({ conversationId }: { conversationId: number }) => {
      if (socket.data.conversationId) {
        const prevRoom = `canvas:${socket.data.conversationId}`;
        socket.leave(prevRoom);
        roomPresence.get(prevRoom)?.delete(userId);
        socket.to(prevRoom).emit("user:left", { userId });
      }

      const room = `canvas:${conversationId}`;
      socket.join(room);
      socket.data.conversationId = conversationId;

      if (!roomPresence.has(room)) roomPresence.set(room, new Map());
      roomPresence.get(room)!.set(userId, { userId, name, image, color });

      const users = Array.from(roomPresence.get(room)!.values());
      socket.emit("presence:update", { users });
      socket.to(room).emit("user:joined", { user: { userId, name, image, color } });

      console.log(`[Collab] ${name} joined canvas:${conversationId} (${users.length} users)`);
    });

    // Cursor
    socket.on("cursor:move", ({ x, y }: { x: number; y: number }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).volatile.emit("cursor:update", { userId, x, y });
    });

    // Selection
    socket.on("node:select", ({ nodeId }: { nodeId: string | null }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("node:selected", { userId, nodeId });
    });

    // Connector drag
    socket.on("connector:start", (data: { nodeId: string; handleId: string; handleType: "source" | "target" }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("connector:update", { userId, action: "start" as const, ...data });
    });

    socket.on("connector:move", ({ x, y }: { x: number; y: number }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).volatile.emit("connector:update", { userId, action: "move" as const, x, y });
    });

    socket.on("connector:end", () => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("connector:update", { userId, action: "end" as const });
    });

    // Granular canvas changes
    socket.on("node:data", ({ nodeId, updates }: { nodeId: string; updates: Record<string, unknown> }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("node:data:update", { userId, nodeId, updates });
    });

    socket.on("node:move", ({ nodeId, x, y }: { nodeId: string; x: number; y: number }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).volatile.emit("node:moved", { userId, nodeId, x, y });
    });

    socket.on("node:add", ({ node }: { node: Record<string, unknown> }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("node:added", { userId, node });
    });

    socket.on("node:remove", ({ nodeId }: { nodeId: string }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("node:removed", { userId, nodeId });
    });

    socket.on("edge:add", ({ edge }: { edge: Record<string, unknown> }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("edge:added", { userId, edge });
    });

    socket.on("edge:remove", ({ edgeId }: { edgeId: string }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("edge:removed", { userId, edgeId });
    });

    // Node status
    socket.on("node:status", ({ nodeId, status }: { nodeId: string; status: string }) => {
      if (!socket.data.conversationId) return;
      socket.to(`canvas:${socket.data.conversationId}`).emit("node:status:update", { userId, nodeId, status });
    });

    // Disconnect
    socket.on("disconnect", () => {
      if (socket.data.conversationId) {
        const room = `canvas:${socket.data.conversationId}`;
        roomPresence.get(room)?.delete(userId);
        socket.to(room).emit("user:left", { userId });
        if (roomPresence.get(room)?.size === 0) roomPresence.delete(room);
        console.log(`[Collab] ${name} left canvas:${socket.data.conversationId}`);
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Collaboration WebSocket on /canvas namespace`);
  });
});
