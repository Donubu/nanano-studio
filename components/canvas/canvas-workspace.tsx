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
  SelectionMode,
  NodeToolbar,
  Position,
  type Connection,
  type NodeTypes,
  type OnConnect,
  type Node,
  type Edge,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { TextNodeComponent } from "./nodes/text-node";
import { TextPracticanteNodeComponent } from "./nodes/text-practicante-node";
import { ImageNodeComponent } from "./nodes/image-node";
import { VideoNodeComponent } from "./nodes/video-node";
import { NoteNodeComponent } from "./nodes/note-node";
import { StaticTextNodeComponent } from "./nodes/static-text-node";
import { StaticImageNodeComponent } from "./nodes/static-image-node";
import { StaticImageGroupNodeComponent } from "./nodes/static-image-group-node";
import { ParamsNodeComponent } from "./nodes/params-node";
import { ScriptNodeComponent } from "./nodes/script-node";
import { SceneNodeComponent } from "./nodes/scene-node";
import { ParamsSceneNodeComponent } from "./nodes/params-scene-node";
import { CanvasToolbar } from "./canvas-toolbar";
import { NodeConfigPanel } from "./panels/node-config-panel";
import { PracticanteConfigPanel } from "./panels/practicante-config-panel";
import { ScriptConfigPanel } from "./panels/script-config-panel";
import { DryRunPanel } from "./panels/dryrun-panel";
import { HistoryPanel } from "./panels/history-panel";
import { useCanvasPersist } from "./hooks/use-canvas-persist";
import { useCanvasExecution } from "./hooks/use-canvas-execution";
import { useUndoRedo } from "./hooks/use-undo-redo";
import { isValidConnection, wouldCreateCycle, getCompatibleTargetTypes, getCompatibleSourceTypes } from "./lib/connection-rules";
import { autoLayoutPositions } from "./lib/auto-layout";
import { getDefaultNodeData, type CanvasNodeType, type CanvasNodeData, type CanvasEdge, HANDLE_IDS } from "./lib/canvas-types";
import { getDescendantNodes } from "./lib/topological-sort";
import { MessageSquare, ImageIcon, Video, Zap, StickyNote, ImagePlus, Images, Type, Settings, Bot, Sparkles, Film, Play, Loader2 } from "lucide-react";
import { CanvasProvider } from "./canvas-context";
import { LabeledEdge } from "./edges/labeled-edge";
import { ImagePickerModal } from "@/components/chat/image-picker-modal";
import { useCollaboration } from "./hooks/use-collaboration";
import { SaveTemplateModal } from "./save-template-modal";
import { TemplatePicker } from "./template-picker";
import { buildClipboardPayload, writeCanvasClipboard, readCanvasClipboard, remapClipboardForPaste } from "./lib/canvas-clipboard";
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
  "text-practicante": TextPracticanteNodeComponent,
  image: ImageNodeComponent,
  video: VideoNodeComponent,
  "note": NoteNodeComponent,
  "static-text": StaticTextNodeComponent,
  "static-image": StaticImageNodeComponent,
  "static-image-group": StaticImageGroupNodeComponent,
  "params-text": ParamsNodeComponent,
  "params-image": ParamsNodeComponent,
  "params-video": ParamsNodeComponent,
  "params-scene": ParamsSceneNodeComponent,
  "script": ScriptNodeComponent,
  "scene": SceneNodeComponent,
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
  openImagePicker?: (onSelect: (url: string) => void, title?: string) => void;
}

function CanvasWorkspaceInner({ conversationId, projectId, generationConfig = [], onConversationCreated, emitNodeDataRef, openImagePicker }: CanvasWorkspaceProps) {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>([] as Node[]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>([] as Edge[]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [canvasMode, setCanvasMode] = useState<"pan" | "select">("pan");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  // Toast transitorio para feedback de copy/paste de nodos.
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Evita reabrir el picker en cada re-render: se auto-abre una sola vez por
  // conversación, al cargar un canvas vacío.
  const pickerShownForConvRef = useRef<number | null>(null);

  // Undo/redo
  const { takeSnapshot, undo, redo } = useUndoRedo(nodes, edges, setNodes, setEdges);

  const { screenToFlowPosition } = useReactFlow();

  // Ref for collab emitters (avoids circular dependency with hooks declared later)
  const collabRef = useRef<{
    emitNodeMove: (id: string, x: number, y: number) => void;
    emitEdgeRemove: (edgeId: string) => void;
    emitNodeRemove: (nodeId: string) => void;
  }>({ emitNodeMove: () => {}, emitEdgeRemove: () => {}, emitNodeRemove: () => {} });

  // Persist ref para invocar desde callbacks declarados antes del hook.
  const persistRef = useRef<{
    moveNode: (id: string, x: number, y: number) => void;
    resizeNode: (id: string, width: number, height: number) => void;
    deleteNodes: (ids: string[]) => Promise<void>;
    deleteEdges: (ids: string[]) => Promise<void>;
  }>({
    moveNode: () => {},
    resizeNode: () => {},
    deleteNodes: async () => {},
    deleteEdges: async () => {},
  });

  // Wrap onNodesChange/onEdgesChange to take snapshots
  const onNodesChange = useCallback((changes: Parameters<typeof onNodesChangeBase>[0]) => {
    // Cascade-remove: when a script or scene is deleted, also remove all its
    // downstream descendants (chained scenes, generated targets, etc.).
    // Scenes can't live without their script.
    const additionalRemoves = new Set<string>();
    for (const change of changes) {
      if (change.type !== "remove") continue;
      const node = nodes.find((n) => n.id === change.id);
      if (!node) continue;
      if (node.type !== "script" && node.type !== "scene") continue;

      const queue: string[] = [change.id];
      const visited = new Set<string>([change.id]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const e of edges) {
          if (e.source === current && !visited.has(e.target)) {
            visited.add(e.target);
            additionalRemoves.add(e.target);
            queue.push(e.target);
          }
        }
      }
    }

    const expandedChanges: Parameters<typeof onNodesChangeBase>[0] = [...changes];
    for (const id of additionalRemoves) {
      if (!changes.some((c) => c.type === "remove" && c.id === id)) {
        expandedChanges.push({ type: "remove", id });
      }
    }

    const hasMeaningful = expandedChanges.some((c) => c.type === "remove" || c.type === "add");
    if (hasMeaningful) takeSnapshot();
    onNodesChangeBase(expandedChanges);

    // Build set of all node IDs being removed and clean orphan edges that
    // touch any of them. Without this, edges remain in state pointing to
    // non-existent nodes, get persisted by autosave, and break re-materialize
    // with duplicate-ID errors.
    const allRemovedIds = new Set<string>();
    for (const change of expandedChanges) {
      if (change.type === "remove") allRemovedIds.add(change.id);
    }
    if (allRemovedIds.size > 0) {
      // Calcula los edges huérfanos antes del filter para persistir el delete.
      const orphanEdgeIds: string[] = [];
      for (const e of edges) {
        if (allRemovedIds.has(e.source) || allRemovedIds.has(e.target)) {
          orphanEdgeIds.push(e.id);
        }
      }
      setEdges((eds) =>
        eds.filter((e) => !allRemovedIds.has(e.source) && !allRemovedIds.has(e.target))
      );
      // El DELETE de nodos en el backend ya soft-deletea los edges incidentes,
      // pero igual mandamos el delete explícito por si los edges existieran sin
      // un nodo removido (caso teórico de desincronización).
      if (orphanEdgeIds.length > 0) persistRef.current.deleteEdges(orphanEdgeIds);
    }

    // Persistencia granular + broadcast a otros usuarios.
    const removedNodeIds: string[] = [];
    for (const change of expandedChanges) {
      if (change.type === "position" && change.position && !change.dragging) {
        persistRef.current.moveNode(change.id, change.position.x, change.position.y);
        collabRef.current.emitNodeMove(change.id, change.position.x, change.position.y);
      }
      // Resize manual terminado (resizing === false). Las mediciones automáticas
      // del montaje no traen `resizing`, así que no se persisten por error.
      if (change.type === "dimensions" && change.resizing === false && change.dimensions) {
        persistRef.current.resizeNode(change.id, change.dimensions.width, change.dimensions.height);
      }
      if (change.type === "remove") {
        removedNodeIds.push(change.id);
        collabRef.current.emitNodeRemove(change.id);
      }
    }
    if (removedNodeIds.length > 0) {
      persistRef.current.deleteNodes(removedNodeIds);
    }
  }, [onNodesChangeBase, takeSnapshot, nodes, edges, setEdges]);

  const onEdgesChange = useCallback((changes: Parameters<typeof onEdgesChangeBase>[0]) => {
    const hasMeaningful = changes.some((c) => c.type === "remove" || c.type === "add");
    if (hasMeaningful) takeSnapshot();
    onEdgesChangeBase(changes);

    const removedEdgeIds: string[] = [];
    for (const change of changes) {
      if (change.type === "remove") {
        removedEdgeIds.push(change.id);
        collabRef.current.emitEdgeRemove?.(change.id);
      }
    }
    if (removedEdgeIds.length > 0) {
      persistRef.current.deleteEdges(removedEdgeIds);
    }
  }, [onEdgesChangeBase, takeSnapshot]);
  const [realConversationId, setRealConversationId] = useState(conversationId);
  const nodeIdCounter = useRef(0);
  const creatingConvRef = useRef(false);
  // Espejo síncrono de realConversationId. La persistencia lee de acá: cuando
  // ensureConversation crea la conversación, el ref se setea ANTES del
  // re-render, así el saveNode inmediato del primer nodo ya tiene id válido.
  const realConversationIdRef = useRef<number | null>(conversationId || null);
  realConversationIdRef.current = realConversationId || null;
  // Cuando el cambio de realConversationId viene de ensureConversation (canvas
  // creado desde este cliente), el estado en memoria ya es el correcto y NO se
  // debe limpiar + recargar desde la BD (perdería el primer nodo agregado).
  const skipNextLoadRef = useRef(false);

  // Sync conversationId from parent (when it changes after creation)
  useEffect(() => {
    if (conversationId && conversationId !== realConversationId) {
      setRealConversationId(conversationId);
    }
  }, [conversationId]);

  // Create conversation in DB if it doesn't exist yet
  const ensureConversation = useCallback(async (): Promise<number> => {
    if (realConversationIdRef.current) return realConversationIdRef.current;
    if (creatingConvRef.current) {
      // Wait for ongoing creation (vía ref: el state en clausura queda stale)
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (realConversationIdRef.current) {
            clearInterval(check);
            resolve(realConversationIdRef.current);
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
      realConversationIdRef.current = newId;
      skipNextLoadRef.current = true;
      setRealConversationId(newId);
      onConversationCreated?.(newId);
      return newId;
    } finally {
      creatingConvRef.current = false;
    }
  }, [projectId, generationConfig, onConversationCreated]);

  // Carga el canvas desde el servidor — reutilizable tras un restore.
  // Bloquea el autosave (isLoaded=false) durante el GET para no sobreescribir.
  const loadCanvas = useCallback(async (convId: number, resetSelection = true) => {
    setIsLoaded(false);
    if (resetSelection) setSelectedNodeId(null);
    try {
      const res = await fetch(`/api/conversations/${convId}/canvas`);
      if (res.ok) {
        const data = await res.json();
        const loadedNodes: Node[] = data.nodes || [];
        const loadedEdges: Edge[] = data.edges || [];
        setNodes(loadedNodes);
        setEdges(loadedEdges);
        const maxId = loadedNodes.reduce((max: number, n: Node) => {
          const num = parseInt(n.id.replace("node-", ""), 10);
          return isNaN(num) ? max : Math.max(max, num);
        }, 0);
        nodeIdCounter.current = maxId;
      }
    } catch (err) {
      console.error("Error loading canvas:", err);
    } finally {
      setIsLoaded(true);
    }
  }, [setNodes, setEdges]);

  // Load canvas state when the active conversation changes.
  useEffect(() => {
    // Conversación recién creada por ensureConversation: el estado en memoria
    // (ej. el primer nodo recién agregado) ES el estado real; recargar desde
    // la BD acá lo borraría.
    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      return;
    }
    setIsLoaded(false);
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    nodeIdCounter.current = 0;

    if (!realConversationId) {
      setIsLoaded(true);
      return;
    }
    loadCanvas(realConversationId);
  }, [realConversationId, setNodes, setEdges, loadCanvas]);

  // Restore viewport from localStorage
  const defaultViewport = useMemo(() => {
    if (typeof window === "undefined") return { x: 0, y: 0, zoom: 1 };
    try {
      const saved = localStorage.getItem(`canvas-viewport-${realConversationId}`);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { x: 0, y: 0, zoom: 1 };
  }, [realConversationId]);

  // Collaboration — declarado antes de la persistencia porque el lock de
  // edición (`canEdit`) sale de acá y la persistencia se corta cuando es false.
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

  // Lock de edición: solo el primer usuario presente edita; el resto, solo-ver.
  const canEdit = collab.canEdit;
  // Nombre del editor actual (para el badge de solo-lectura). Solo relevante
  // cuando NO soy el editor, así que el editor vive en remoteUsers.
  const editorName = useMemo(() => {
    if (collab.editorUserId == null) return null;
    if (collab.editorUserId === collab.myUserId) return "tú";
    return collab.remoteUsers.find((u) => u.userId === collab.editorUserId)?.name ?? null;
  }, [collab.editorUserId, collab.myUserId, collab.remoteUsers]);

  // Persistencia granular: cada acción del usuario (add, move-stop, update,
  // delete, connect, disconnect) se persiste inmediatamente vía endpoints
  // granulares. Reemplaza el auto-save bulk que era destructivo en multi-user.
  // Con canEdit=false toda escritura se corta dentro del hook.
  const persist = useCanvasPersist(realConversationIdRef, canEdit);

  const handleCanvasRestored = useCallback(() => {
    if (!realConversationId) return;
    loadCanvas(realConversationId, false);
  }, [realConversationId, loadCanvas]);

  // Auto-abre el picker de templates al cargar un canvas vacío (una vez por
  // conversación; si el usuario lo cierra, puede reabrirlo desde el toolbar).
  useEffect(() => {
    if (!isLoaded || !canEdit) return;
    if (pickerShownForConvRef.current === realConversationId) return;
    pickerShownForConvRef.current = realConversationId;
    if (nodes.length === 0) setTemplatePickerOpen(true);
  }, [isLoaded, canEdit, realConversationId, nodes.length]);

  // Inserta un template estilo snippet: funciona sobre canvas vacío o con
  // contenido. El server inserta transaccionalmente con IDs remapeados y
  // devuelve los nodos/edges nuevos; acá se agregan al estado en vivo y se
  // emiten por el socket de colaboración (mismo flujo que agregar a mano).
  const applyTemplate = useCallback(async (templateId: number) => {
    if (!canEdit) return;
    const convId = await ensureConversation();
    // Ancla el template al centro del viewport visible.
    const flowPos = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const res = await fetch(`/api/conversations/${convId}/canvas/from-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, position: flowPos }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const insertedNodes = (data.nodes || []) as Node[];
    const insertedEdges = (data.edges || []) as Edge[];
    takeSnapshot();
    setNodes((nds) => [...nds, ...insertedNodes]);
    setEdges((eds) => [...eds, ...insertedEdges]);
    for (const node of insertedNodes) {
      collab.emitNodeAdd(node as unknown as Record<string, unknown>);
    }
    for (const edge of insertedEdges) {
      collab.emitEdgeAdd(edge as unknown as Record<string, unknown>);
    }
    setTemplatePickerOpen(false);
  }, [canEdit, ensureConversation, screenToFlowPosition, takeSnapshot, setNodes, setEdges, collab.emitNodeAdd, collab.emitEdgeAdd]);

  // --- Copy/paste de nodos (Ctrl+C / Ctrl+Shift+C / Ctrl+V) ---

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current);
    copyToastTimerRef.current = setTimeout(() => setCopyToast(null), 4000);
  }, []);

  useEffect(() => () => {
    if (copyToastTimerRef.current) clearTimeout(copyToastTimerRef.current);
  }, []);

  // Copia la selección actual al clipboard del canvas (localStorage, así el
  // paste funciona también en otro canvas u otra pestaña). Con
  // includeDescendants se agrega la clausura de descendientes de cada nodo
  // seleccionado (mismo criterio que RUN ALL: el flujo que depende del nodo).
  // Copiar está permitido incluso en solo-ver; es una operación de lectura.
  const copySelection = useCallback((includeDescendants: boolean): boolean => {
    const selectedIds = new Set(
      nodes.filter((n) => n.selected || n.id === selectedNodeId).map((n) => n.id)
    );
    if (selectedIds.size === 0) return false;

    const allIds = new Set(selectedIds);
    if (includeDescendants) {
      for (const id of selectedIds) {
        for (const desc of getDescendantNodes(id, edges as unknown as CanvasEdge[])) {
          allIds.add(desc);
        }
      }
    }

    const toCopy = nodes.filter((n) => allIds.has(n.id));
    const payload = buildClipboardPayload(toCopy, edges);
    writeCanvasClipboard(payload);

    const n = payload.nodes.length;
    const m = payload.edges.length;
    if (includeDescendants) {
      showCopyToast(
        `Flujo copiado: ${n} nodo${n === 1 ? "" : "s"} y ${m} conexi${m === 1 ? "ón" : "ones"} · Ctrl+V para pegar`
      );
    } else {
      // Si el nodo tiene flujo aguas abajo que NO se copió, sugiere el atajo.
      const hasDownstream = edges.some((e) => allIds.has(e.source) && !allIds.has(e.target));
      showCopyToast(
        `${n} nodo${n === 1 ? "" : "s"} copiado${n === 1 ? "" : "s"} · Ctrl+V para pegar` +
        (hasDownstream ? " · Ctrl+Shift+C copia también todo el flujo que depende del nodo" : "")
      );
    }
    return true;
  }, [nodes, edges, selectedNodeId, showCopyToast]);

  // Pega el clipboard del canvas: IDs remapeados (sin colisiones), anclado al
  // centro del viewport con un jitter para que pastes repetidos no queden
  // exactamente encima. Mismo flujo de persistencia/colaboración que agregar
  // nodos a mano.
  const pasteClipboard = useCallback(async () => {
    if (!canEdit) return;
    const payload = readCanvasClipboard();
    if (!payload) return;
    await ensureConversation();
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const anchor = {
      x: center.x + Math.random() * 40 - 20,
      y: center.y + Math.random() * 40 - 20,
    };
    const { nodes: pastedNodes, edges: pastedEdges } = remapClipboardForPaste(
      payload,
      anchor,
      new Set(nodes.map((n) => n.id))
    );
    takeSnapshot();
    // Los pegados quedan como única selección (selected: true viene del remap).
    setNodes((nds) => [
      ...nds.map((node) => (node.selected ? { ...node, selected: false } : node)),
      ...pastedNodes,
    ]);
    setEdges((eds) => [...eds, ...pastedEdges]);
    for (const node of pastedNodes) {
      persist.saveNode(node);
      collab.emitNodeAdd(node as unknown as Record<string, unknown>);
    }
    for (const edge of pastedEdges) {
      persist.createEdge(edge);
      collab.emitEdgeAdd(edge as unknown as Record<string, unknown>);
    }
    const n = pastedNodes.length;
    showCopyToast(`${n} nodo${n === 1 ? "" : "s"} pegado${n === 1 ? "" : "s"}`);
  }, [canEdit, ensureConversation, screenToFlowPosition, takeSnapshot, setNodes, setEdges, persist, collab.emitNodeAdd, collab.emitEdgeAdd, showCopyToast, nodes]);

  // Ref para el handler de teclado (declarado en un effect con otras deps).
  const copyPasteRef = useRef<{ copy: (withDescendants: boolean) => boolean; paste: () => void }>({
    copy: () => false,
    paste: () => {},
  });
  copyPasteRef.current.copy = copySelection;
  copyPasteRef.current.paste = pasteClipboard;

  // Sync collab ref for use in callbacks declared before collab hook
  collabRef.current.emitNodeMove = collab.emitNodeMove;
  collabRef.current.emitEdgeRemove = collab.emitEdgeRemove;
  collabRef.current.emitNodeRemove = collab.emitNodeRemove;
  if (emitNodeDataRef) emitNodeDataRef.current = collab.emitNodeData;

  // Idem para persist (mismo patrón: callbacks declarados arriba usan el ref).
  persistRef.current.moveNode = persist.moveNode;
  persistRef.current.resizeNode = persist.resizeNode;
  persistRef.current.deleteNodes = persist.deleteNodes;
  persistRef.current.deleteEdges = persist.deleteEdges;

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
          // Upsert: el mismo evento se usa para crear un edge y para
          // actualizar su data (p. ej. prioridad de referencia).
          setEdges((eds) =>
            eds.some((e) => e.id === edge.id)
              ? eds.map((e) => (e.id === edge.id ? edge : e))
              : [...eds, edge]
          );
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
  const { executeNode, executeFromRoot, isExecuting } = useCanvasExecution({
    conversationId: realConversationId,
    nodes,
    edges,
    setNodes,
    generationConfig,
  });

  // Nodos raíz (sin edges entrantes) cuya clausura de descendientes contiene al
  // menos un nodo IA ejecutable. Cada uno muestra su propio botón "RUN ALL" que
  // corre SOLO su flujo. Reemplaza al "Run All" global del toolbar.
  const flowRoots = useMemo(() => {
    const aiNodeTypes = new Set(["text", "text-practicante", "image", "video"]);
    const hasIncoming = new Set(edges.map((e) => e.target));
    return nodes.filter((n) => {
      if (hasIncoming.has(n.id)) return false;
      const closure = [n.id, ...getDescendantNodes(n.id, edges as unknown as CanvasEdge[])];
      return closure.some((id) => {
        const node = nodes.find((x) => x.id === id);
        return node ? aiNodeTypes.has(node.type!) : false;
      });
    });
  }, [nodes, edges]);

  // Connection handler with validation. We generate a short edge ID instead of
  // letting xyflow concatenate source+sourceHandle+target+targetHandle, which
  // can exceed canvas_edges.id VARCHAR(255) when handles and node IDs stack up.
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit) return;
      if (!isValidConnection(connection, nodes, edges)) return;
      if (wouldCreateCycle(edges, connection.source!, connection.target!)) return;
      takeSnapshot();
      const id = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const newEdge: Edge = { ...connection, id, animated: false };
      setEdges((eds) => addEdge(newEdge, eds));
      persist.createEdge(newEdge);
      collab.emitEdgeAdd(newEdge as unknown as Record<string, unknown>);
    },
    [nodes, edges, setEdges, takeSnapshot, persist, collab.emitEdgeAdd]
  );

  // Prioridad de un edge de referencia (null = neutro). Reusa el POST de
  // edges (upsert) para persistir y el evento edge:add (upsert en el remoto)
  // para colaborar.
  const updateEdgePriority = useCallback(
    (edgeId: string, priority: number | null) => {
      if (!canEdit) return;
      const current = edges.find((e) => e.id === edgeId);
      if (!current) return;
      takeSnapshot();
      const { priority: _prev, ...restData } = (current.data ?? {}) as Record<string, unknown>;
      const updated: Edge = {
        ...current,
        data: priority != null ? { ...restData, priority } : restData,
      };
      setEdges((eds) => eds.map((e) => (e.id === edgeId ? updated : e)));
      persist.createEdge(updated);
      collab.emitEdgeAdd(updated as unknown as Record<string, unknown>);
    },
    [canEdit, edges, takeSnapshot, setEdges, persist, collab.emitEdgeAdd]
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

  // Add node (ensures conversation exists first)
  // Places near toolbar (top-left area of visible canvas)
  const addNode = useCallback(
    async (type: CanvasNodeType) => {
      if (!canEdit) return;
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
      persist.saveNode(newNode);
      collab.emitNodeAdd(newNode as unknown as Record<string, unknown>);
    },
    [setNodes, ensureConversation, takeSnapshot, screenToFlowPosition, persist, collab.emitNodeAdd]
  );

  // Update node data — persiste el nodo completo tras el merge (UPSERT
  // en backend). Se invoca el persist con el state ya merged para evitar
  // leer del nodes en clausura (que puede estar desactualizado).
  const updateNodeData = useCallback(
    (nodeId: string, updates: Partial<CanvasNodeData>) => {
      // En solo-ver no se edita nada (chokepoint del context persistNodeData
      // y de onUpdateData de los paneles de config).
      if (!canEdit) return;
      let mergedNode: Node | null = null;
      setNodes((nds) => {
        return nds.map((n) => {
          if (n.id !== nodeId) return n;
          const next = { ...n, data: { ...n.data, ...updates } };
          mergedNode = next;
          return next;
        });
      });
      if (mergedNode) persist.saveNodeData(mergedNode);
      collab.emitNodeData(nodeId, updates as Record<string, unknown>);
    },
    [setNodes, persist, collab.emitNodeData]
  );

  // Delete node — el backend soft-deletea también los edges incidentes.
  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!canEdit) return;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      persist.deleteNodes([nodeId]);
      collab.emitNodeRemove(nodeId);
    },
    [setNodes, setEdges, selectedNodeId, persist]
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
      persist.saveNode(newNode);

      const { start } = pending;
      const edgeId = `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const edge: Edge = start.handleType === "source"
        ? { id: edgeId, source: start.nodeId, sourceHandle: start.handleId, target: newId, targetHandle: option.handle }
        : { id: edgeId, source: newId, sourceHandle: option.handle, target: start.nodeId, targetHandle: start.handleId };

      setEdges((eds) => addEdge(edge, eds));
      persist.createEdge(edge);
      setSelectedNodeId(newId);
      pendingDropRef.current = null;
      setDropMenu(null);
    },
    [ensureConversation, setNodes, setEdges, takeSnapshot, persist]
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

  // Auto-layout: reposition every node into columns based on topological depth
  const reorderNodes = useCallback(() => {
    if (!canEdit || nodes.length === 0) return;
    const confirmed = window.confirm(
      "¿Reordenar todos los nodos?\n\n" +
      "Se reorganizarán en formato timeline vertical (de arriba hacia abajo): " +
      "los orígenes quedan arriba y sus dependientes bajan en la misma columna. " +
      "Cuando un nodo tiene varios hijos, las ramas extras se abren a la derecha.\n\n" +
      "Las posiciones actuales se perderán (puedes deshacer con Ctrl+Z)."
    );
    if (!confirmed) return;
    const positions = autoLayoutPositions(nodes, edges);
    if (positions.size === 0) return;
    takeSnapshot();
    setNodes((nds) =>
      nds.map((n) => {
        const pos = positions.get(n.id);
        if (!pos) return n;
        return { ...n, position: pos };
      })
    );
    // Persiste y broadcastea cada nueva posición.
    // persist.moveNode batchea internamente todos los movimientos en un PATCH.
    for (const [nodeId, pos] of positions.entries()) {
      persist.moveNode(nodeId, pos.x, pos.y);
      collab.emitNodeMove(nodeId, pos.x, pos.y);
    }
  }, [nodes, edges, setNodes, takeSnapshot, persist, collab.emitNodeMove]);

  // Lock/unlock all nodes
  const isAllLocked = nodes.length > 0 && nodes.every((n) => (n.data as Record<string, unknown>).locked === true);

  const lockAllNodes = useCallback(() => {
    if (!canEdit) return;
    const newLocked = !isAllLocked;
    takeSnapshot();
    let updatedNodes: Node[] = [];
    setNodes((nds) => {
      updatedNodes = nds.map((n) => ({ ...n, data: { ...n.data, locked: newLocked } }));
      return updatedNodes;
    });
    // Persiste por nodo. Con muchos nodos esto dispara N fetches; en una
    // iteración futura conviene un endpoint batch para esto.
    for (const node of updatedNodes) {
      persist.saveNode(node);
    }
  }, [isAllLocked, setNodes, takeSnapshot, persist]);

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

    // Escape stays in CAPTURE so it pre-empts the conversation modal close.
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      if (dropMenu) {
        closeDropMenu();
      } else if (selectedNodeId) {
        setSelectedNodeId(null);
      }
    };

    // Undo/Redo runs in BUBBLE so inner nodes (e.g. script-node with local
    // history) can intercept first via stopPropagation. Native browser undo
    // inside form fields is preserved by skipping editable targets here.
    const handleUndoRedo = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, [contenteditable='true']")) {
        return; // let the browser handle native undo within inputs
      }

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undo();
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        redo();
      }
    };

    // Copy/paste de nodos. BUBBLE y saltando campos editables para no pisar
    // el copy/paste nativo de texto. Ctrl+C copia la selección, Ctrl+Shift+C
    // agrega los descendientes, Ctrl+V pega. Lee vía ref para no re-registrar
    // el listener en cada cambio de nodes/edges.
    const handleCopyPaste = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v") return;

      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, [contenteditable='true']")) {
        return; // copy/paste nativo dentro de campos de texto
      }

      if (key === "c") {
        // Si hay texto seleccionado en la página, respeta el copy nativo.
        if (window.getSelection()?.toString()) return;
        if (copyPasteRef.current.copy(e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else {
        if (e.shiftKey) return;
        if (!readCanvasClipboard()) return;
        e.preventDefault();
        e.stopPropagation();
        copyPasteRef.current.paste();
      }
    };

    // Figma-style V/H to toggle select/pan mode. Skip when typing.
    const handleModeShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        setCanvasMode("select");
      } else if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setCanvasMode("pan");
      }
    };

    el.addEventListener("keydown", handleEscape, true);
    el.addEventListener("keydown", handleUndoRedo, false);
    el.addEventListener("keydown", handleCopyPaste, false);
    el.addEventListener("keydown", handleModeShortcut, false);
    return () => {
      el.removeEventListener("keydown", handleEscape, true);
      el.removeEventListener("keydown", handleUndoRedo, false);
      el.removeEventListener("keydown", handleCopyPaste, false);
      el.removeEventListener("keydown", handleModeShortcut, false);
    };
  }, [dropMenu, selectedNodeId, closeDropMenu, undo, redo]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  // Stable emit fn for context (always points to current collab impl)
  const emitNodeDataStable = useCallback((nodeId: string, updates: Record<string, unknown>) => {
    collab.emitNodeData(nodeId, updates);
  }, [collab.emitNodeData]);

  return (
    <CanvasProvider
      value={{
        projectId,
        conversationId: realConversationId,
        generationConfig,
        openImagePicker: openImagePicker || (() => {}),
        emitNodeData: emitNodeDataStable,
        persistNodeData: updateNodeData,
        canEdit,
      }}
    >
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
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          edgesReconnectable={canEdit}
          deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
          minZoom={0.1}
          maxZoom={2}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          proOptions={{ hideAttribution: true }}
          panOnDrag={canvasMode === "pan" ? true : [1, 2]}
          selectionOnDrag={canvasMode === "select"}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode={canvasMode === "select" ? null : "Shift"}
        >
          <Background variant={BackgroundVariant.Lines} gap={24} size={1} color="var(--color-border)" className="opacity-30" />
          <Controls position="bottom-left" showInteractive={false} />

          {/* Botón "RUN ALL" por nodo raíz: corre solo el flujo de esa raíz.
              Solo para el editor (en solo-ver no se ejecuta nada). */}
          {canEdit && flowRoots.map((root) => (
            <NodeToolbar
              key={`run-${root.id}`}
              nodeId={root.id}
              isVisible
              position={Position.Top}
              align="start"
              offset={8}
            >
              <button
                onClick={() => executeFromRoot(root.id)}
                disabled={isExecuting}
                title="Ejecutar solo este flujo (este nodo y todo lo que depende de él)"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExecuting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                RUN ALL
              </button>
            </NodeToolbar>
          ))}

          <Panel position="top-left" className="!left-12">
            <CanvasToolbar
              onAddNode={addNode}
              onClone={cloneCanvas}
              onLockAll={lockAllNodes}
              onReorder={reorderNodes}
              onSaveTemplate={() => setSaveTemplateOpen(true)}
              onOpenTemplates={() => setTemplatePickerOpen(true)}
              isExecuting={isExecuting}
              isAllLocked={isAllLocked}
              saveStatus={persist.saveStatus}
              lastSavedAt={persist.lastSavedAt}
              nodeCount={nodes.length}
              canvasMode={canvasMode}
              onCanvasModeChange={setCanvasMode}
              onOpenHistory={() => setHistoryOpen(true)}
              canEdit={canEdit}
              editorName={editorName}
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
              const iconMap: Record<string, typeof MessageSquare> = { text: MessageSquare, "text-practicante": Bot, image: ImageIcon, video: Video, note: StickyNote, "static-text": Type, "static-image": ImagePlus, "static-image-group": Images, "params-text": Settings, "params-image": Settings, "params-video": Settings, "params-scene": Settings, script: Sparkles, scene: Film };
              const colorMap: Record<string, string> = { text: "text-blue-400", "text-practicante": "text-amber-400", image: "text-purple-400", video: "text-amber-400", note: "text-amber-500", "static-text": "text-blue-400", "static-image": "text-emerald-400", "static-image-group": "text-teal-400", "params-text": "text-yellow-400", "params-image": "text-yellow-400", "params-video": "text-yellow-400", "params-scene": "text-yellow-400", script: "text-fuchsia-400", scene: "text-violet-400" };
              const isAI = !type.startsWith("static-") && type !== "scene" && type !== "note";
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
          onUpdateEdgePriority={updateEdgePriority}
          onDelete={deleteNode}
          onExecute={executeNode}
          isExecuting={isExecuting}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {/* Practicante config panel */}
      {selectedNode && selectedNode.type === "text-practicante" && (
        <PracticanteConfigPanel
          node={selectedNode}
          edges={edges}
          onUpdateData={updateNodeData}
          onDelete={deleteNode}
          onExecute={executeNode}
          isExecuting={isExecuting}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {/* Script config panel */}
      {selectedNode && selectedNode.type === "script" && (
        <ScriptConfigPanel
          node={selectedNode}
          generationConfig={generationConfig}
          edges={edges}
          onUpdateData={updateNodeData}
          onDelete={deleteNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {/* Dry-run analysis panel (third column) */}
      {selectedNode &&
        selectedNode.type === "text-practicante" &&
        (selectedNode.data as { dryRunResponse?: string } | null)?.dryRunResponse && (
          <DryRunPanel node={selectedNode} onClose={() => {
            updateNodeData(selectedNode.id, { dryRunResponse: undefined } as Record<string, unknown>);
          }} />
        )}

      {/* Toast de copy/paste de nodos */}
      {copyToast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 bg-popover border border-border rounded-lg shadow-xl px-3.5 py-2 text-xs text-foreground pointer-events-none max-w-[90%] text-center">
          {copyToast}
        </div>
      )}

      {/* Guardar canvas como template global */}
      <SaveTemplateModal
        isOpen={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        conversationId={realConversationId}
        nodeCount={nodes.length}
      />

      {/* Picker de templates: inserción estilo snippet, solo para el editor.
          Se auto-abre en canvas vacío y también se abre desde el toolbar
          sobre un canvas con contenido. */}
      {canEdit && (
        <TemplatePicker
          isOpen={templatePickerOpen}
          onClose={() => setTemplatePickerOpen(false)}
          onUseTemplate={applyTemplate}
          emptyCanvas={nodes.length === 0}
        />
      )}

      {/* History / Trash panel */}
      {realConversationId > 0 && (
        <HistoryPanel
          conversationId={realConversationId}
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onCanvasRestored={handleCanvasRestored}
        />
      )}
    </div>
    </CanvasProvider>
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

  return (
    <>
      <ReactFlowProvider>
        <CanvasWorkspaceInner {...props} emitNodeDataRef={emitNodeDataRef} openImagePicker={openImagePicker} />
      </ReactFlowProvider>

      {/* Image picker modal - rendered outside ReactFlow to avoid transform issues */}
      <ImagePickerModal
        projectId={props.projectId}
        isOpen={pickerState.isOpen}
        onClose={closeImagePicker}
        onSelect={(imageUrl) => {
          pickerState.onSelect?.(imageUrl);
        }}
        title={pickerState.title}
        multiSelect
      />
    </>
  );
}
