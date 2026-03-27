export interface CollabUser {
  userId: number;
  name: string;
  image: string | null;
  color: string;
  cursor?: { x: number; y: number };
  selectedNodeId?: string | null;
  connectorDrag?: {
    nodeId: string;
    handleId: string;
    handleType: "source" | "target";
    endPoint?: { x: number; y: number };
  } | null;
}

// Client → Server events
export interface ClientToServerEvents {
  join: (data: { conversationId: number }) => void;
  "cursor:move": (data: { x: number; y: number }) => void;
  "node:select": (data: { nodeId: string | null }) => void;
  "connector:start": (data: { nodeId: string; handleId: string; handleType: "source" | "target" }) => void;
  "connector:move": (data: { x: number; y: number }) => void;
  "connector:end": () => void;
  "node:status": (data: { nodeId: string; status: string }) => void;
  "node:data": (data: { nodeId: string; updates: Record<string, unknown> }) => void;
  "edge:add": (data: { edge: Record<string, unknown> }) => void;
  "edge:remove": (data: { edgeId: string }) => void;
  "node:add": (data: { node: Record<string, unknown> }) => void;
  "node:remove": (data: { nodeId: string }) => void;
  "node:move": (data: { nodeId: string; x: number; y: number }) => void;
}

// Server → Client events
export interface ServerToClientEvents {
  "auth:success": (data: { userId: number; color: string }) => void;
  "presence:update": (data: { users: CollabUser[] }) => void;
  "user:joined": (data: { user: CollabUser }) => void;
  "user:left": (data: { userId: number }) => void;
  "cursor:update": (data: { userId: number; x: number; y: number }) => void;
  "node:selected": (data: { userId: number; nodeId: string | null }) => void;
  "connector:update": (data: {
    userId: number;
    action: "start" | "move" | "end";
    nodeId?: string;
    handleId?: string;
    handleType?: "source" | "target";
    x?: number;
    y?: number;
  }) => void;
  "node:status:update": (data: { userId: number; nodeId: string; status: string }) => void;
  "node:data:update": (data: { userId: number; nodeId: string; updates: Record<string, unknown> }) => void;
  "edge:added": (data: { userId: number; edge: Record<string, unknown> }) => void;
  "edge:removed": (data: { userId: number; edgeId: string }) => void;
  "node:added": (data: { userId: number; node: Record<string, unknown> }) => void;
  "node:removed": (data: { userId: number; nodeId: string }) => void;
  "node:moved": (data: { userId: number; nodeId: string; x: number; y: number }) => void;
}
