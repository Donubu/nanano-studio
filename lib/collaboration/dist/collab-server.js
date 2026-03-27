"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/redis.ts
var redis_exports = {};
__export(redis_exports, {
  createRedisConnection: () => createRedisConnection,
  getRedisConnection: () => getRedisConnection,
  isRedisConfigured: () => isRedisConfigured
});
function getRedisConnection() {
  if (!sharedConnection) {
    sharedConnection = new import_ioredis.default(REDIS_URL, REDIS_COMMON_OPTIONS);
  }
  return sharedConnection;
}
function createRedisConnection() {
  return new import_ioredis.default(REDIS_URL, REDIS_COMMON_OPTIONS);
}
function isRedisConfigured() {
  return !!process.env.REDIS_URL;
}
var import_ioredis, REDIS_URL, REDIS_COMMON_OPTIONS, sharedConnection;
var init_redis = __esm({
  "lib/redis.ts"() {
    "use strict";
    import_ioredis = __toESM(require("ioredis"));
    REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
    REDIS_COMMON_OPTIONS = {
      maxRetriesPerRequest: null,
      // Required by BullMQ
      enableReadyCheck: false,
      keepAlive: 3e4,
      // Send TCP keepAlive every 30s
      connectTimeout: 3e4,
      // 30s connection timeout
      retryStrategy(times) {
        return Math.min(times * 500, 15e3);
      }
    };
    sharedConnection = null;
  }
});

// lib/collaboration/collab-server.ts
var collab_server_exports = {};
__export(collab_server_exports, {
  initCollabServer: () => initCollabServer
});
module.exports = __toCommonJS(collab_server_exports);
var import_socket = require("socket.io");
var import_redis_adapter = require("@socket.io/redis-adapter");

// lib/collaboration/colors.ts
var COLLAB_COLORS = [
  "#FF6B6B",
  // rojo
  "#4ECDC4",
  // teal
  "#45B7D1",
  // azul
  "#96CEB4",
  // verde
  "#FFEAA7",
  // amarillo
  "#DDA0DD",
  // púrpura
  "#FF8C42",
  // naranja
  "#6C5CE7"
  // violeta
];
function getUserColor(userId) {
  return COLLAB_COLORS[userId % COLLAB_COLORS.length];
}

// lib/collaboration/collab-server.ts
var createRedisConnection2 = null;
try {
  const redis = (init_redis(), __toCommonJS(redis_exports));
  if (redis.isRedisConfigured && redis.isRedisConfigured()) {
    createRedisConnection2 = redis.createRedisConnection;
  }
} catch {
}
var roomPresence = /* @__PURE__ */ new Map();
function getRoomKey(conversationId) {
  return `canvas:${conversationId}`;
}
function getPresence(room) {
  return Array.from(roomPresence.get(room)?.values() || []);
}
function initCollabServer(httpServer) {
  try {
    const io = new import_socket.Server(httpServer, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      pingInterval: 15e3,
      pingTimeout: 3e4,
      cors: {
        origin: process.env.NEXTAUTH_URL || "*",
        credentials: true
      }
    });
    if (createRedisConnection2) {
      try {
        const pubClient = createRedisConnection2();
        const subClient = createRedisConnection2();
        io.adapter((0, import_redis_adapter.createAdapter)(pubClient, subClient));
        console.log("[Collab] Redis adapter configured");
      } catch (err) {
        console.warn("[Collab] Redis adapter failed, running single-instance:", err);
      }
    } else {
      console.log("[Collab] Running without Redis adapter (single instance)");
    }
    const canvasNsp = io.of("/canvas");
    canvasNsp.use(async (socket, next) => {
      const auth = socket.handshake.auth || {};
      const userId = Number(auth.userId);
      if (!userId) {
        return next(new Error("No userId in auth"));
      }
      socket.data = {
        userId,
        name: auth.name || `User ${userId}`,
        image: auth.image || null,
        color: getUserColor(userId)
      };
      next();
    });
    canvasNsp.on("connection", (rawSocket) => {
      const socket = rawSocket;
      const { userId, name, image, color } = socket.data;
      console.log(`[Collab] User ${name} (${userId}) connected`);
      socket.emit("auth:success", { userId, color });
      socket.on("join", ({ conversationId }) => {
        if (socket.data.conversationId) {
          const prevRoom = getRoomKey(socket.data.conversationId);
          socket.leave(prevRoom);
          roomPresence.get(prevRoom)?.delete(userId);
          socket.to(prevRoom).emit("user:left", { userId });
        }
        const room = getRoomKey(conversationId);
        socket.join(room);
        socket.data.conversationId = conversationId;
        if (!roomPresence.has(room)) {
          roomPresence.set(room, /* @__PURE__ */ new Map());
        }
        const user = { userId, name, image, color };
        roomPresence.get(room).set(userId, user);
        socket.emit("presence:update", { users: getPresence(room) });
        socket.to(room).emit("user:joined", { user });
        console.log(`[Collab] User ${name} joined canvas:${conversationId} (${getPresence(room).length} users)`);
      });
      socket.on("cursor:move", ({ x, y }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        const presence = roomPresence.get(room)?.get(userId);
        if (presence) presence.cursor = { x, y };
        socket.to(room).volatile.emit("cursor:update", { userId, x, y });
      });
      socket.on("node:select", ({ nodeId }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        const presence = roomPresence.get(room)?.get(userId);
        if (presence) presence.selectedNodeId = nodeId;
        socket.to(room).emit("node:selected", { userId, nodeId });
      });
      socket.on("connector:start", ({ nodeId, handleId, handleType }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        const presence = roomPresence.get(room)?.get(userId);
        if (presence) presence.connectorDrag = { nodeId, handleId, handleType };
        socket.to(room).emit("connector:update", {
          userId,
          action: "start",
          nodeId,
          handleId,
          handleType
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
      socket.on("node:data", ({ nodeId, updates }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:data:update", { userId, nodeId, updates });
      });
      socket.on("node:move", ({ nodeId, x, y }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).volatile.emit("node:moved", { userId, nodeId, x, y });
      });
      socket.on("node:add", ({ node }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:added", { userId, node });
      });
      socket.on("node:remove", ({ nodeId }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:removed", { userId, nodeId });
      });
      socket.on("edge:add", ({ edge }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("edge:added", { userId, edge });
      });
      socket.on("edge:remove", ({ edgeId }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("edge:removed", { userId, edgeId });
      });
      socket.on("node:status", ({ nodeId, status }) => {
        if (!socket.data.conversationId) return;
        const room = getRoomKey(socket.data.conversationId);
        socket.to(room).emit("node:status:update", { userId, nodeId, status });
      });
      socket.on("disconnect", () => {
        if (socket.data.conversationId) {
          const room = getRoomKey(socket.data.conversationId);
          roomPresence.get(room)?.delete(userId);
          socket.to(room).emit("user:left", { userId });
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  initCollabServer
});
