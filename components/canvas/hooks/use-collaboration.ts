"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { CollabUser, ClientToServerEvents, ServerToClientEvents } from "@/lib/collaboration/types";

type CollabSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface UseCollaborationOptions {
  conversationId: number;
  enabled: boolean;
  user?: { id: number; name: string; image?: string | null };
}

export interface UseCollaborationReturn {
  remoteUsers: CollabUser[];
  isConnected: boolean;
  myColor: string;
  emitCursorMove: (x: number, y: number) => void;
  emitNodeSelect: (nodeId: string | null) => void;
  emitConnectorStart: (nodeId: string, handleId: string, handleType: "source" | "target") => void;
  emitConnectorMove: (x: number, y: number) => void;
  emitConnectorEnd: () => void;
  emitNodeStatus: (nodeId: string, status: string) => void;
  emitNodeData: (nodeId: string, updates: Record<string, unknown>) => void;
  emitNodeMove: (nodeId: string, x: number, y: number) => void;
  emitNodeAdd: (node: Record<string, unknown>) => void;
  emitNodeRemove: (nodeId: string) => void;
  emitEdgeAdd: (edge: Record<string, unknown>) => void;
  emitEdgeRemove: (edgeId: string) => void;
  onRemoteChange: React.MutableRefObject<((event: string, data: Record<string, unknown>) => void) | null>;
}

const CURSOR_THROTTLE_MS = 50;

export function useCollaboration({
  conversationId,
  enabled,
  user,
}: UseCollaborationOptions): UseCollaborationReturn {
  const [remoteUsers, setRemoteUsers] = useState<CollabUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<CollabSocket | null>(null);
  const myUserIdRef = useRef<number>(0);
  const [myColor, setMyColor] = useState("");
  const lastCursorEmitRef = useRef(0);
  const onRemoteChangeRef = useRef<((event: string, data: Record<string, unknown>) => void) | null>(null);

  // Connect/disconnect
  useEffect(() => {
    if (!enabled || !conversationId) return;

    if (!user?.id) return;

    const socket: CollabSocket = io("/canvas", {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      withCredentials: true,
      auth: {
        userId: user.id,
        name: user.name,
        image: user.image || null,
      },
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      socket.emit("join", { conversationId });
    });

    socket.on("auth:success", ({ userId, color }) => {
      myUserIdRef.current = userId;
      setMyColor(color);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // Presence events
    socket.on("presence:update", ({ users }) => {
      setRemoteUsers(users.filter((u) => u.userId !== myUserIdRef.current));
    });

    socket.on("user:joined", ({ user }) => {
      setRemoteUsers((prev) => {
        if (prev.some((u) => u.userId === user.userId)) return prev;
        return [...prev, user];
      });
    });

    socket.on("user:left", ({ userId }) => {
      setRemoteUsers((prev) => prev.filter((u) => u.userId !== userId));
    });

    // Cursor events
    socket.on("cursor:update", ({ userId, x, y }) => {
      setRemoteUsers((prev) =>
        prev.map((u) =>
          u.userId === userId ? { ...u, cursor: { x, y } } : u
        )
      );
    });

    // Selection events
    socket.on("node:selected", ({ userId, nodeId }) => {
      setRemoteUsers((prev) =>
        prev.map((u) =>
          u.userId === userId ? { ...u, selectedNodeId: nodeId } : u
        )
      );
    });

    // Connector events
    socket.on("connector:update", ({ userId, action, nodeId, handleId, handleType, x, y }) => {
      setRemoteUsers((prev) =>
        prev.map((u) => {
          if (u.userId !== userId) return u;
          if (action === "start") {
            return { ...u, connectorDrag: { nodeId: nodeId!, handleId: handleId!, handleType: handleType!, endPoint: undefined } };
          }
          if (action === "move" && u.connectorDrag) {
            return { ...u, connectorDrag: { ...u.connectorDrag, endPoint: { x: x!, y: y! } } };
          }
          if (action === "end") {
            return { ...u, connectorDrag: null };
          }
          return u;
        })
      );
    });

    // Node execution status
    socket.on("node:status:update", ({ userId, nodeId, status }) => {
      onRemoteChangeRef.current?.("node:status", { userId, nodeId, status });
    });

    // Granular canvas changes from other users
    socket.on("node:data:update", ({ userId, nodeId, updates }) => {
      onRemoteChangeRef.current?.("node:data", { userId, nodeId, updates });
    });

    socket.on("node:moved", ({ userId, nodeId, x, y }) => {
      onRemoteChangeRef.current?.("node:move", { userId, nodeId, x, y });
    });

    socket.on("node:added", ({ userId, node }) => {
      onRemoteChangeRef.current?.("node:add", { userId, node });
    });

    socket.on("node:removed", ({ userId, nodeId }) => {
      onRemoteChangeRef.current?.("node:remove", { userId, nodeId });
    });

    socket.on("edge:added", ({ userId, edge }) => {
      onRemoteChangeRef.current?.("edge:add", { userId, edge });
    });

    socket.on("edge:removed", ({ userId, edgeId }) => {
      onRemoteChangeRef.current?.("edge:remove", { userId, edgeId });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setRemoteUsers([]);
      setIsConnected(false);
    };
  }, [conversationId, enabled, user?.id]);

  // Emit helpers
  const emitCursorMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastCursorEmitRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorEmitRef.current = now;
    socketRef.current?.emit("cursor:move", { x, y });
  }, []);

  const emitNodeSelect = useCallback((nodeId: string | null) => {
    socketRef.current?.emit("node:select", { nodeId });
  }, []);

  const emitConnectorStart = useCallback((nodeId: string, handleId: string, handleType: "source" | "target") => {
    socketRef.current?.emit("connector:start", { nodeId, handleId, handleType });
  }, []);

  const emitConnectorMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastCursorEmitRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorEmitRef.current = now;
    socketRef.current?.emit("connector:move", { x, y });
  }, []);

  const emitConnectorEnd = useCallback(() => {
    socketRef.current?.emit("connector:end");
  }, []);

  const emitNodeStatus = useCallback((nodeId: string, status: string) => {
    socketRef.current?.emit("node:status", { nodeId, status });
  }, []);

  const emitNodeData = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    socketRef.current?.emit("node:data", { nodeId, updates });
  }, []);

  const emitNodeMove = useCallback((nodeId: string, x: number, y: number) => {
    const now = Date.now();
    if (now - lastCursorEmitRef.current < CURSOR_THROTTLE_MS) return;
    lastCursorEmitRef.current = now;
    socketRef.current?.emit("node:move", { nodeId, x, y });
  }, []);

  const emitNodeAdd = useCallback((node: Record<string, unknown>) => {
    socketRef.current?.emit("node:add", { node });
  }, []);

  const emitNodeRemove = useCallback((nodeId: string) => {
    socketRef.current?.emit("node:remove", { nodeId });
  }, []);

  const emitEdgeAdd = useCallback((edge: Record<string, unknown>) => {
    socketRef.current?.emit("edge:add", { edge });
  }, []);

  const emitEdgeRemove = useCallback((edgeId: string) => {
    socketRef.current?.emit("edge:remove", { edgeId });
  }, []);

  return {
    remoteUsers,
    isConnected,
    myColor,
    emitCursorMove,
    emitNodeSelect,
    emitConnectorStart,
    emitConnectorMove,
    emitConnectorEnd,
    emitNodeStatus,
    emitNodeData,
    emitNodeMove,
    emitNodeAdd,
    emitNodeRemove,
    emitEdgeAdd,
    emitEdgeRemove,
    onRemoteChange: onRemoteChangeRef,
  };
}

