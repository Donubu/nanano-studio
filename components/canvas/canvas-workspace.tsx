"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  BackgroundVariant,
  type Connection,
  type NodeTypes,
  type OnConnect,
  type Node,
  type Edge,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { TextNodeComponent } from "./nodes/text-node";
import { ImageNodeComponent } from "./nodes/image-node";
import { VideoNodeComponent } from "./nodes/video-node";
import { NoteNodeComponent } from "./nodes/note-node";
import { StaticTextNodeComponent } from "./nodes/static-text-node";
import { StaticImageNodeComponent } from "./nodes/static-image-node";
import { StaticImageGroupNodeComponent } from "./nodes/static-image-group-node";
import { ParamsNodeComponent } from "./nodes/params-node";
import { CanvasToolbar } from "./canvas-toolbar";
import { NodeConfigPanel } from "./panels/node-config-panel";
import { useAutoSave } from "./hooks/use-auto-save";
import { useCanvasExecution } from "./hooks/use-canvas-execution";
import { useUndoRedo } from "./hooks/use-undo-redo";
import { isValidConnection, wouldCreateCycle, getCompatibleTargetTypes, getCompatibleSourceTypes } from "./lib/connection-rules";
import { getDefaultNodeData, type CanvasNodeType, type CanvasNodeData, HANDLE_IDS } from "./lib/canvas-types";
import { MessageSquare, ImageIcon, Video, Zap, StickyNote, ImagePlus, Images, Type, Settings } from "lucide-react";
import { CanvasProvider } from "./canvas-context";
import { LabeledEdge } from "./edges/labeled-edge";
import { ImagePickerModal } from "@/components/chat/image-picker-modal";
import { useCollaboration } from "./hooks/use-collaboration";
import { CursorOverlay } from "./collaboration/cursor-overlay";
import { PresenceBar } from "./collaboration/presence-bar";
import { ConnectorGhost } from "./collaboration/connector-ghost";

const edgeTypes = {
  labeled: LabeledEdge,
};

const defaultEdgeOptions = {
  type: "labeled",
  animated: true,
};

const nodeTypes: NodeTypes = {
  text: TextNodeComponent,
  image: ImageNodeComponent,
  video: VideoNodeComponent,
  "note": NoteNodeComponent,
  "static-text": StaticTextNodeComponent,
  "static-image": StaticImageNodeComponent,
  "static-image-group": StaticImageGroupNodeComponent,
  "params-text": ParamsNodeComponent,
  "params-image": ParamsNodeComponent,
  "params-video": ParamsNodeComponent,
};

export interface CanvasModel {
  id: number;
  display_name: string;
  model_id: string;
  is_default: boolean;
  api_backend: string | null;
}

export interface CanvasGenerationConfig {
  generation_type: string;
  is_enabled: boolean;
  models: CanvasModel[];
}

interface CanvasWorkspaceProps {
  conversationId: number;
  projectId: number;
  generationConfig?: CanvasGenerationConfig[];
  onConversationCreated?: (newId: number) => void;
  emitNodeDataRef?: React.MutableRefObject<(nodeId: string, updates: Record<string, unknown>) => void>;
}

function CanvasWorkspaceInner({ conversationId, projectId, generationConfig = [], onConversationCreated, emitNodeDataRef }: CanvasWorkspaceProps) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([] as Node[]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([] as Edge[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Undo/redo
  const { takeSnapshot, undo, redo } = useUndoRedo(nodes, edges, setNodes, setEdges);

  // Ref for collab emitters (avoids circular dependency with hooks declared later)
  const collabRef = useRef<{
    emitNodeMove: (id: string, x: number, y: number) => void;
    emitEdgeRemove: (edgeId: string) => void;
    emitNodeRemove: (nodeId: string) => void;
  }>({ emitNodeMove: () => {}, emitEdgeRemove: () => {}, emitNodeRemove: () => {} });

  // Wrap onNodesChange/onEdgesChange to take snapshots
  const onNodesChange = useCallback((changes: Parameters<typeof onNodesChangeBase>[0]) => {
    const hasMeaningful = changes.some((c) => c.type === "remove" || c.type === "add");
    if (hasMeaningful) takeSnapshot();
    onNodesChangeBase(changes);

    // Broadcast changes to other users
    for (const change of changes) {
      if (change.type === "position" && change.position && !change.dragging) {
        collabRef.current.emitNodeMove(change.id, change.position.x, change.position.y);
      }
      if (change.type === "remove") {
        collabRef.current.emitNodeRemove(change.id);
      }
    }
  }, [onNodesChangeBase, takeSnapshot]);

  const onEdgesChange = useCallback((changes: Parameters<typeof onEdgesChangeBase>[0]) => {
    const hasMeaningful = changes.some((c) => c.type === "remove" || c.type === "add");
    if (hasMeaningful) takeSnapshot();
    onEdgesChangeBase(changes);

    // Broadcast edge removals
    for (const change of changes) {
      if (change.type === "remove") {
        collabRef.current.emitEdgeRemove?.(change.id);
      }
    }
  }, [onEdgesChangeBase, takeSnapshot]);
  const [realConversationId, setRealConversationId] = useState(conversationId);
  const nodeIdCounter = useRef(0);
  const creatingConvRef = useRef(false);

  // Sync conversationId from parent (when it changes after creation)
  useEffect(() => {
    if (conversationId && conversationId !== realConversationId) {
      setRealConversationId(conversationId);
    }
  }, [conversationId]);

  // Create conversation in DB if it doesn't exist yet
  const ensureConversation = useCallback(async (): Promise<number> => {
    if (realConversationId) return realConversationId;
    if (creatingConvRef.current) {
      // Wait for ongoing creation
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (realConversationId) {
            clearInterval(check);
            resolve(realConversationId);
          }
        }, 100);
      });
    }

    creatingConvRef.current = true;
    try {
      // Get a default model from the text config
      const textConfig = generationConfig.find((c) => c.generation_type === "text");
      const defaultModel = textConfig?.models?.find((m) => m.is_default) || textConfig?.models?.[0];

      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          model_id: defaultModel?.id || null,
          generation_type: "canvas",
          title: "Canvas",
        }),
      });

      if (!res.ok) throw new Error("Error creando conversación");
      const newConv = await res.json();
      const newId = newConv.id;
      setRealConversationId(newId);
      onConversationCreated?.(newId);
      return newId;
    } finally {
      creatingConvRef.current = false;
    }
  }, [realConversationId, projectId, generationConfig, onConversationCreated]);

  // Load canvas state on mount
  useEffect(() => {
    if (!realConversationId) {
      setIsLoaded(true);
      return;
    }
    async function loadCanvas() {
      try {
        const res = await fetch(`/api/conversations/${realConversationId}/canvas`);
        if (res.ok) {
          const data = await res.json();
          if (data.nodes?.length > 0 || data.edges?.length > 0) {
            setNodes(data.nodes || []);
            setEdges(data.edges || []);
            // Set counter to highest existing node number
            const maxId = data.nodes.reduce((max: number, n: Node) => {
              const num = parseInt(n.id.replace("node-", ""), 10);
              return isNaN(num) ? max : Math.max(max, num);
            }, 0);
            nodeIdCounter.current = maxId;
          }
        }
      } catch (err) {
        console.error("Error loading canvas:", err);
      } finally {
        setIsLoaded(true);
      }
    }
    loadCanvas();
  }, [realConversationId, setNodes, setEdges]);

  // Restore viewport from localStorage
  const defaultViewport = useMemo(() => {
    if (typeof window === "undefined") return { x: 0, y: 0, zoom: 1 };
    try {
      const saved = localStorage.getItem(`canvas-viewport-${realConversationId}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { x: 0, y: 0, zoom: 1 };
  }, [realConversationId]);

  // Auto-save
  const { saveStatus } = useAutoSave({
    conversationId: realConversationId,
    nodes,
    edges,
    enabled: isLoaded,
  });

  // Collaboration
  const { data: session } = useSession();
  const collabUser = useMemo(() => {
    if (!session?.user) return undefined;
    return {
      id: Number((session.user as unknown as { id: number }).id),
      name: session.user.name || "Usuario",
      image: session.user.image,
    };
  }, [session?.user]);

  const collab = useCollaboration({
    conversationId: realConversationId,
    enabled: isLoaded && realConversationId > 0,
    user: collabUser,
  });

  // Sync collab ref for use in callbacks declared before collab hook
  collabRef.current.emitNodeMove = collab.emitNodeMove;
  collabRef.current.emitEdgeRemove = collab.emitEdgeRemove;
  collabRef.current.emitNodeRemove = collab.emitNodeRemove;
  if (emitNodeDataRef) emitNodeDataRef.current = collab.emitNodeData;

  // Handle remote canvas changes from other users
  useEffect(() => {
    collab.onRemoteChange.current = (event, data) => {
      switch (event) {
        case "node:data": {
          const { nodeId, updates } = data as { nodeId: string; updates: Record<string, unknown> };
          console.log("[Collab] Received node:data", nodeId, updates);
          setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n));
          break;
        }
        case "node:move": {
          const { nodeId, x, y } = data as { nodeId: string; x: number; y: number };
          setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, position: { x, y } } : n));
          break;
        }
        case "node:add": {
          const { node } = data as { node: Node };
          setNodes((nds) => [...nds, node]);
          break;
        }
        case "node:remove": {
          const { nodeId } = data as { nodeId: string };
          setNodes((nds) => nds.filter((n) => n.id !== nodeId));
          setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
          break;
        }
        case "edge:add": {
          const { edge } = data as { edge: Edge };
          setEdges((eds) => [...eds, edge]);
          break;
        }
        case "edge:remove": {
          const { edgeId } = data as { edgeId: string };
          setEdges((eds) => eds.filter((e) => e.id !== edgeId));
          break;
        }
        case "node:status": {
          const { nodeId, status } = data as { nodeId: string; status: string };
          setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, status } } : n));
          break;
        }
      }
    };
    return () => { collab.onRemoteChange.current = null; };
  }, [setNodes, setEdges]);

  // Execution
  const { executeNode, executeAll, isExecuting, executionProgress } = useCanvasExecution({
    conversationId: realConversationId,
    nodes,
    edges,
    setNodes,
    generationConfig,
  });

  // Connection handler with validation
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection, nodes, edges)) return;
      if (wouldCreateCycle(edges, connection.source!, connection.target!)) return;
      takeSnapshot();
      const newEdge = { ...connection, animated: false };
      setEdges((eds) => addEdge(newEdge, eds));
      collab.emitEdgeAdd(newEdge as Record<string, unknown>);
    },
    [nodes, edges, setEdges, takeSnapshot, collab.emitEdgeAdd]
  );

  const closeDropMenu = useCallback(() => {
    pendingDropRef.current = null;
    setDropMenu(null);
  }, []);

  // Node selection
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    collab.emitNodeSelect(node.id);
  }, [collab.emitNodeSelect]);

  const justOpenedDropMenuRef = useRef(false);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    collab.emitNodeSelect(null);
    if (justOpenedDropMenuRef.current) {
      justOpenedDropMenuRef.current = false;
      return;
    }
    closeDropMenu();
  }, [closeDropMenu, collab.emitNodeSelect]);

  const { screenToFlowPosition } = useReactFlow();

  // Add node (ensures conversation exists first)
  // Places near toolbar (top-left area of visible canvas)
  const addNode = useCallback(
    async (type: CanvasNodeType) => {
      await ensureConversation();
      takeSnapshot();
      nodeIdCounter.current += 1;
      const id = `node-${nodeIdCounter.current}`;
      const data = getDefaultNodeData(type);
      // Convert toolbar area (screen coords) to flow coords
      const flowPos = screenToFlowPosition({ x: 120, y: 120 });
      const newNode: Node<CanvasNodeData> = {
        id,
        type,
        position: {
          x: flowPos.x + Math.random() * 40,
          y: flowPos.y + Math.random() * 40,
        },
        data,
      };
      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(id);
      collab.emitNodeAdd(newNode as unknown as Record<string, unknown>);
    },
    [setNodes, ensureConversation, takeSnapshot, screenToFlowPosition, collab.emitNodeAdd]
  );

  // Update node data
  const updateNodeData = useCallback(
    (nodeId: string, updates: Partial<CanvasNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n
        )
      );
      collab.emitNodeData(nodeId, updates as Record<string, unknown>);
    },
    [setNodes]
  );

  // Delete node
  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      collab.emitNodeRemove(nodeId);
    },
    [setNodes, setEdges, selectedNodeId]
  );

  // --- Drop-on-empty: create node from dangling connection ---
  const connectStartRef = useRef<{
    nodeId: string;
    handleId: string;
    handleType: "source" | "target";
  } | null>(null);
  const pendingDropRef = useRef<{
    start: { nodeId: string; handleId: string; handleType: "source" | "target" };
    flowPosition: { x: number; y: number };
    options: { type: string; label: string; handle: string }[];
  } | null>(null);
  const [dropMenu, setDropMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const onConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleId: string | null; handleType: "source" | "target" | null }) => {
    if (params.nodeId && params.handleId && params.handleType) {
      connectStartRef.current = {
        nodeId: params.nodeId,
        handleId: params.handleId,
        handleType: params.handleType,
      };
      collab.emitConnectorStart(params.nodeId, params.handleId, params.handleType);
    }
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState?: unknown) => {
    collab.emitConnectorEnd();
    const start = connectStartRef.current;
    connectStartRef.current = null;
    if (!start) return;

    // If the connection was completed successfully (dropped on a valid handle), skip
    const cs = connectionState as { isValid?: boolean | null } | undefined;
    if (cs?.isValid === true) return;

    const sourceNode = nodes.find((n) => n.id === start.nodeId);
    if (!sourceNode || !sourceNode.type) return;

    const clientX = "changedTouches" in event ? event.changedTouches[0].clientX : (event as MouseEvent).clientX;
    const clientY = "changedTouches" in event ? event.changedTouches[0].clientY : (event as MouseEvent).clientY;
    const flowPos = screenToFlowPosition({ x: clientX, y: clientY });

    let options: { type: string; label: string; handle: string }[];

    if (start.handleType === "source") {
      options = getCompatibleTargetTypes(sourceNode.type, start.handleId).map((o) => ({
        type: o.type, label: o.label, handle: o.targetHandle,
      }));
    } else {
      options = getCompatibleSourceTypes(sourceNode.type, start.handleId).map((o) => ({
        type: o.type, label: o.label, handle: o.sourceHandle,
      }));
    }

    if (options.length === 0) return;

    pendingDropRef.current = { start, flowPosition: flowPos, options };
    justOpenedDropMenuRef.current = true;
    setDropMenu({ x: clientX, y: clientY });
  }, [nodes, screenToFlowPosition]);

  const handleDropMenuSelect = useCallback(
    async (option: { type: string; label: string; handle: string }) => {
      const pending = pendingDropRef.current;
      if (!pending) { setDropMenu(null); return; }

      await ensureConversation();
      takeSnapshot();
      nodeIdCounter.current += 1;
      const newId = `node-${nodeIdCounter.current}`;
      const data = getDefaultNodeData(option.type as CanvasNodeType);
      const newNode: Node<CanvasNodeData> = {
        id: newId,
        type: option.type,
        position: pending.flowPosition,
        data,
      };
      setNodes((nds) => [...nds, newNode]);

      const { start } = pending;
      const edge = start.handleType === "source"
        ? { source: start.nodeId, sourceHandle: start.handleId, target: newId, targetHandle: option.handle }
        : { source: newId, sourceHandle: option.handle, target: start.nodeId, targetHandle: start.handleId };

      setEdges((eds) => addEdge(edge, eds));
      setSelectedNodeId(newId);
      pendingDropRef.current = null;
      setDropMenu(null);
    },
    [ensureConversation, setNodes, setEdges, takeSnapshot]
  );

  // (closeDropMenu moved earlier, before onPaneClick)

  // Clone canvas into a new conversation
  const cloneCanvas = useCallback(async () => {
    if (!realConversationId || nodes.length === 0) return;
    if (!window.confirm("¿Clonar todo el canvas en una nueva conversación?")) return;

    try {
      // Get a default text model for the new conversation
      const textConfig = generationConfig.find((c) => c.generation_type === "text");
      const defaultModel = textConfig?.models?.find((m) => m.is_default) || textConfig?.models?.[0];

      // Create new conversation
      const convRes = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          model_id: defaultModel?.id || null,
          generation_type: "canvas",
          title: "Canvas (clon)",
        }),
      });
      if (!convRes.ok) throw new Error("Error creando conversación");
      const newConv = await convRes.json();

      // Save current canvas state to the new conversation
      const saveRes = await fetch(`/api/conversations/${newConv.id}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodes, edges }),
      });
      if (!saveRes.ok) throw new Error("Error guardando canvas clonado");

      // Navigate to the new conversation
      window.open(`${window.location.pathname.split("/conversation/")[0]}/conversation/${newConv.id}`, "_blank");
    } catch (err) {
      console.error("Error cloning canvas:", err);
      alert("Error al clonar el canvas");
    }
  }, [realConversationId, nodes, edges, projectId, generationConfig]);

  // Lock/unlock all nodes
  const isAllLocked = nodes.length > 0 && nodes.every((n) => (n.data as Record<string, unknown>).locked === true);

  const lockAllNodes = useCallback(() => {
    const newLocked = !isAllLocked;
    takeSnapshot();
    setNodes((nds) =>
      nds.map((n) => ({ ...n, data: { ...n.data, locked: newLocked } }))
    );
  }, [isAllLocked, setNodes, takeSnapshot]);

  // Save viewport to localStorage on move
  const onMoveEnd = useCallback(
    (_: unknown, viewport: { x: number; y: number; zoom: number }) => {
      if (typeof window !== "undefined") {
        localStorage.setItem(`canvas-viewport-${realConversationId}`, JSON.stringify(viewport));
      }
    },
    [realConversationId]
  );

  // Capture Escape inside the canvas to prevent it from closing the conversation
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (dropMenu) {
          closeDropMenu();
        } else if (selectedNodeId) {
          setSelectedNodeId(null);
        }
      }
      // Undo: Ctrl+Z / Cmd+Z
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undo();
      }
      // Redo: Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z
      if ((e.key === "y" && (e.ctrlKey || e.metaKey)) || (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        redo();
      }
    };
    el.addEventListener("keydown", handleKeyDown, true);
    return () => el.removeEventListener("keydown", handleKeyDown, true);
  }, [dropMenu, selectedNodeId, closeDropMenu, undo, redo]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div ref={canvasContainerRef} className="flex h-full w-full relative" tabIndex={-1}>
      <div className="flex-1 h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onMoveEnd={onMoveEnd}
          onMouseMove={(e: React.MouseEvent) => {
            const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            collab.emitCursorMove(flowPos.x, flowPos.y);
          }}
          nodeTypes={nodeTypes}
          defaultViewport={defaultViewport}
          fitView={!isLoaded || nodes.length === 0}
          deleteKeyCode={["Backspace", "Delete"]}
          minZoom={0.1}
          maxZoom={2}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="var(--color-border)" className="opacity-30" />
          <Controls position="bottom-left" showInteractive={false} />
          <Panel position="top-left" className="!left-12">
            <CanvasToolbar
              onAddNode={addNode}
              onRunAll={executeAll}
              onClone={cloneCanvas}
              onLockAll={lockAllNodes}
              isExecuting={isExecuting}
              isAllLocked={isAllLocked}
              executionProgress={executionProgress}
              saveStatus={saveStatus}
              nodeCount={nodes.length}
            />
          </Panel>
          <Panel position="top-right">
            <PresenceBar
              remoteUsers={collab.remoteUsers}
              localUser={collabUser && collab.myColor ? { name: collabUser.name, image: collabUser.image, color: collab.myColor } : undefined}
              isConnected={collab.isConnected}
            />
          </Panel>
          <CursorOverlay remoteUsers={collab.remoteUsers} />
          <ConnectorGhost remoteUsers={collab.remoteUsers} />
        </ReactFlow>
      </div>

      {/* Drop-on-empty context menu */}
      {dropMenu && pendingDropRef.current && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeDropMenu} />
          <div
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl p-1 min-w-[160px]"
            style={{ left: dropMenu.x, top: dropMenu.y }}
          >
            <div className="px-3 py-1.5 text-[10px] text-muted-foreground uppercase tracking-wider">
              Crear nodo
            </div>
            {pendingDropRef.current.options.map(({ type, label, handle }) => {
              const iconMap: Record<string, typeof MessageSquare> = { text: MessageSquare, image: ImageIcon, video: Video, note: StickyNote, "static-text": Type, "static-image": ImagePlus, "static-image-group": Images, "params-text": Settings, "params-image": Settings, "params-video": Settings };
              const colorMap: Record<string, string> = { text: "text-blue-400", image: "text-purple-400", video: "text-amber-400", note: "text-amber-500", "static-text": "text-blue-400", "static-image": "text-emerald-400", "static-image-group": "text-teal-400", "params-text": "text-yellow-400", "params-image": "text-yellow-400", "params-video": "text-yellow-400" };
              const isAI = !type.startsWith("static-");
              const Icon = iconMap[type] || MessageSquare;
              const color = colorMap[type] || "text-muted-foreground";
              return (
                <button
                  key={`${type}-${handle}`}
                  onClick={() => handleDropMenuSelect({ type, label, handle })}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
                >
                  <Icon className={`h-3.5 w-3.5 ${color}`} />
                  {label}
                  {isAI && <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded bg-primary/10 text-primary ml-auto"><Zap className="h-2.5 w-2.5" />IA</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Node config panel - only for AI generation nodes */}
      {selectedNode && ["text", "image", "video"].includes(selectedNode.type!) && (
        <NodeConfigPanel
          node={selectedNode}
          nodes={nodes}
          generationConfig={generationConfig}
          edges={edges}
          onUpdateData={updateNodeData}
          onDelete={deleteNode}
          onExecute={executeNode}
          isExecuting={isExecuting}
          onClose={() => setSelectedNodeId(null)}
        />
      )}
    </div>
  );
}

export function CanvasWorkspace(props: CanvasWorkspaceProps) {
  const [pickerState, setPickerState] = useState<{
    isOpen: boolean;
    onSelect: ((url: string) => void) | null;
    title: string;
  }>({ isOpen: false, onSelect: null, title: "" });

  const openImagePicker = useCallback((onSelect: (url: string) => void, title = "Seleccionar imagen") => {
    setPickerState({ isOpen: true, onSelect, title });
  }, []);

  const closeImagePicker = useCallback(() => {
    setPickerState({ isOpen: false, onSelect: null, title: "" });
  }, []);

  // Ref for collab emitNodeData - populated by CanvasWorkspaceInner
  const emitNodeDataRef = useRef<(nodeId: string, updates: Record<string, unknown>) => void>(() => {});
  const emitNodeDataStable = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    emitNodeDataRef.current(nodeId, updates);
  }, []);

  return (
    <CanvasProvider value={{ projectId: props.projectId, generationConfig: props.generationConfig || [], openImagePicker, emitNodeData: emitNodeDataStable }}>
      <ReactFlowProvider>
        <CanvasWorkspaceInner {...props} emitNodeDataRef={emitNodeDataRef} />
      </ReactFlowProvider>

      {/* Image picker modal - rendered outside ReactFlow to avoid transform issues */}
      <ImagePickerModal
        projectId={props.projectId}
        isOpen={pickerState.isOpen}
        onClose={closeImagePicker}
        onSelect={(imageUrl) => {
          pickerState.onSelect?.(imageUrl);
          closeImagePicker();
        }}
        title={pickerState.title}
      />
    </CanvasProvider>
  );
}
