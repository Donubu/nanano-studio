"use client";

import { Fragment, memo, useCallback, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps, type Edge, type Node as RFNode } from "@xyflow/react";
import { Loader2, AlertCircle, FileText, Sparkles, Wand2, ChevronDown, ChevronRight, ImageIcon, Video, Bot, MinusCircle, ArrowUp, ArrowDown, X, Plus } from "lucide-react";
import { HANDLE_IDS, type ScriptAnalysis, type ScriptNodeData, type ScriptSceneAnalysis, type SceneTargetNodeType } from "../lib/canvas-types";
import { StatusIndicator, NodeDeleteButton, AIBadge } from "./node-status";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";

const statusColors: Record<string, string> = {
  idle: "border-fuchsia-500/40",
  generating: "border-blue-500 shadow-blue-500/20 shadow-lg",
  completed: "border-fuchsia-500/70",
  error: "border-red-500",
};

const targetTypeOptions: { value: SceneTargetNodeType; label: string }[] = [
  { value: "image", label: "Imagen" },
  { value: "video", label: "Video" },
  { value: "text-practicante", label: "Practicante" },
  { value: "none", label: "Ninguno" },
];

function ensureAnalysis(current: ScriptAnalysis | undefined): ScriptAnalysis {
  if (current) return current;
  return {
    generalInfo: {
      synopsis: "",
      tone: "",
      genre: "",
      visualStyle: "",
      characters: [],
      settings: [],
    },
    scenes: [],
    analyzedAt: new Date().toISOString(),
    modelUsed: "manual",
  };
}

function renumber(scenes: ScriptSceneAnalysis[]): ScriptSceneAnalysis[] {
  return scenes.map((s, i) => ({ ...s, index: i + 1 }));
}

function stopProp(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export const ScriptNodeComponent = memo(function ScriptNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ScriptNodeData;
  const status = nodeData.status || "idle";
  const { updateNodeData } = useNodeUpdate();
  const { conversationId } = useCanvasContext();
  const { setNodes, setEdges } = useReactFlow();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isMaterializing, setIsMaterializing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generalOpen, setGeneralOpen] = useState(false);

  // Local undo/redo history — only for changes inside the script node
  // (add/remove/move scenes, target type, debounced text edits).
  // This prevents the canvas global undo from rolling back unrelated state
  // when the user presses Ctrl+Z while editing scenes.
  const [localHistory, setLocalHistory] = useState<ScriptAnalysis[]>([]);
  const [localFuture, setLocalFuture] = useState<ScriptAnalysis[]>([]);
  const lastTextEditAtRef = useRef<number>(0);
  const TEXT_EDIT_DEBOUNCE_MS = 1500;
  const HISTORY_LIMIT = 30;

  const analysis = nodeData.scriptAnalysis;
  const sceneCount = analysis?.scenes.length || 0;

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { ...nodeData, prompt: e.target.value });
    },
    [id, nodeData, updateNodeData]
  );

  // --- Scene mutations (all re-number indices) ---

  const writeAnalysis = useCallback(
    (updater: (a: ScriptAnalysis) => ScriptAnalysis, opts?: { isTextEdit?: boolean }) => {
      const base = ensureAnalysis(analysis);

      // Push to local history. For text edits we debounce so we don't store
      // one snapshot per keystroke — typing within ~1.5s of the previous edit
      // collapses into a single undo step.
      if (opts?.isTextEdit) {
        const now = Date.now();
        if (now - lastTextEditAtRef.current > TEXT_EDIT_DEBOUNCE_MS) {
          setLocalHistory((h) => [...h, JSON.parse(JSON.stringify(base))].slice(-HISTORY_LIMIT));
          setLocalFuture([]);
        }
        lastTextEditAtRef.current = now;
      } else {
        setLocalHistory((h) => [...h, JSON.parse(JSON.stringify(base))].slice(-HISTORY_LIMIT));
        setLocalFuture([]);
        // Reset debounce so the next text edit also pushes a fresh entry
        lastTextEditAtRef.current = 0;
      }

      const next = updater(base);
      updateNodeData(id, { ...nodeData, scriptAnalysis: next });
    },
    [analysis, id, nodeData, updateNodeData]
  );

  // --- Local undo/redo ---

  const undoLocal = useCallback(() => {
    if (localHistory.length === 0) return false;
    const prev = localHistory[localHistory.length - 1];
    const current = ensureAnalysis(analysis);
    setLocalHistory((h) => h.slice(0, -1));
    setLocalFuture((f) => [...f, JSON.parse(JSON.stringify(current))].slice(-HISTORY_LIMIT));
    lastTextEditAtRef.current = 0;
    updateNodeData(id, { ...nodeData, scriptAnalysis: prev });
    return true;
  }, [analysis, id, localHistory, nodeData, updateNodeData]);

  const redoLocal = useCallback(() => {
    if (localFuture.length === 0) return false;
    const next = localFuture[localFuture.length - 1];
    const current = ensureAnalysis(analysis);
    setLocalFuture((f) => f.slice(0, -1));
    setLocalHistory((h) => [...h, JSON.parse(JSON.stringify(current))].slice(-HISTORY_LIMIT));
    lastTextEditAtRef.current = 0;
    updateNodeData(id, { ...nodeData, scriptAnalysis: next });
    return true;
  }, [analysis, id, localFuture, nodeData, updateNodeData]);

  const handleNodeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "z" && e.key !== "y") return;

      // If user is typing inside a form field, let the browser do its native
      // undo on that field. Stop propagation so the canvas global undo doesn't
      // also fire (defense in depth — the canvas handler already skips editable
      // targets, but inner stopPropagation makes intent explicit).
      const target = e.target as HTMLElement | null;
      const isEditable = !!target?.closest("input, textarea, select, [contenteditable='true']");
      if (isEditable) {
        e.stopPropagation();
        return;
      }

      if (e.key === "z" && !e.shiftKey) {
        // Try local undo first; if nothing local, let the event bubble to the
        // canvas global undo handler.
        if (undoLocal()) {
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        if (redoLocal()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    [undoLocal, redoLocal]
  );

  const addSceneAt = useCallback(
    (position: number) => {
      writeAnalysis((a) => {
        const newScene: ScriptSceneAnalysis = {
          index: position + 1,
          text: "",
          targetNodeType: "image",
        };
        const scenes = renumber([
          ...a.scenes.slice(0, position),
          newScene,
          ...a.scenes.slice(position),
        ]);
        return { ...a, scenes };
      });
    },
    [writeAnalysis]
  );

  const removeSceneAt = useCallback(
    (position: number) => {
      writeAnalysis((a) => ({
        ...a,
        scenes: renumber(a.scenes.filter((_, i) => i !== position)),
      }));
    },
    [writeAnalysis]
  );

  const moveScene = useCallback(
    (from: number, to: number) => {
      writeAnalysis((a) => {
        if (to < 0 || to >= a.scenes.length || from === to) return a;
        const arr = [...a.scenes];
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        return { ...a, scenes: renumber(arr) };
      });
    },
    [writeAnalysis]
  );

  const updateSceneText = useCallback(
    (position: number, text: string) => {
      writeAnalysis(
        (a) => ({
          ...a,
          scenes: a.scenes.map((s, i) => (i === position ? { ...s, text } : s)),
        }),
        { isTextEdit: true }
      );
    },
    [writeAnalysis]
  );

  const updateSceneTarget = useCallback(
    (position: number, targetNodeType: SceneTargetNodeType) => {
      writeAnalysis((a) => ({
        ...a,
        scenes: a.scenes.map((s, i) => (i === position ? { ...s, targetNodeType } : s)),
      }));
    },
    [writeAnalysis]
  );

  // --- Read script (analyze with AI) ---

  const handleReadScript = useCallback(async () => {
    if (!nodeData.prompt?.trim()) {
      setAnalysisError("Ingresa el guion antes de leer.");
      return;
    }
    if (!conversationId) {
      setAnalysisError("Esperando conversación...");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);
    setWarnings([]);
    updateNodeData(id, { ...nodeData, status: "generating", errorMessage: undefined });

    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/script/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: id,
          prompt: nodeData.prompt,
          modelId: nodeData.modelId,
          temperature: nodeData.temperature,
          maxOutputTokens: nodeData.maxOutputTokens,
          systemInstruction: nodeData.systemInstruction,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Error ${res.status}`);
      }

      updateNodeData(id, {
        ...nodeData,
        status: "completed",
        errorMessage: undefined,
        scriptAnalysis: body.analysis,
        modelName: body.modelName || nodeData.modelName,
      });
      if (Array.isArray(body.warnings)) setWarnings(body.warnings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error analizando el guion";
      setAnalysisError(msg);
      updateNodeData(id, { ...nodeData, status: "error", errorMessage: msg });
    } finally {
      setIsAnalyzing(false);
    }
  }, [conversationId, id, nodeData, updateNodeData]);

  // --- Materialize scenes into canvas nodes ---

  const handleMaterialize = useCallback(async () => {
    if (!analysis || analysis.scenes.length === 0) return;
    if (!conversationId) return;

    // Persist any pending edits first via PUT of the entire canvas would be heavy;
    // instead we rely on autosave and on the client-side scriptAnalysis we send to
    // the endpoint. The endpoint reads from DB though — so we need to ensure DB is
    // up-to-date. We force a PATCH of just the script node's config before materializing.
    setIsMaterializing(true);
    setAnalysisError(null);
    try {
      // Sync the current analysis to DB so materialize sees latest manual edits.
      await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: id,
          updates: {
            config: {
              prompt: nodeData.prompt,
              modelId: nodeData.modelId,
              modelName: nodeData.modelName,
              temperature: nodeData.temperature,
              maxOutputTokens: nodeData.maxOutputTokens,
              systemInstruction: nodeData.systemInstruction,
              thinkingLevel: nodeData.thinkingLevel,
              scriptAnalysis: analysis,
            },
          },
        }),
      });

      // Preview cascade
      const previewRes = await fetch(
        `/api/conversations/${conversationId}/canvas/script/materialize?scriptNodeId=${id}`
      );
      const preview = await previewRes.json();
      const downstreamCount = Array.isArray(preview.nodes) ? preview.nodes.length : 0;

      if (downstreamCount > 0) {
        const confirmed = window.confirm(
          `Esto eliminará ${downstreamCount} nodo(s) actualmente conectado(s) al guion (incluida toda la cascada aguas abajo).\n\n¿Continuar?`
        );
        if (!confirmed) {
          setIsMaterializing(false);
          return;
        }
      }

      const sceneTargets = analysis.scenes.map((s, i) => ({
        sceneIndex: i + 1,
        targetNodeType: s.targetNodeType,
      }));
      const res = await fetch(`/api/conversations/${conversationId}/canvas/script/materialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptNodeId: id,
          sceneTargets,
          linkPreviousOutput: !!nodeData.linkPreviousOutput,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Error ${res.status}`);
      }

      const deletedNodeIds = new Set<string>(body.deletedNodeIds || []);
      const deletedEdgeIds = new Set<string>(body.deletedEdgeIds || []);
      const newNodes = (body.addedNodes || []) as Array<{
        id: string;
        type: string;
        position: { x: number; y: number };
        data: Record<string, unknown>;
      }>;
      const newEdges = (body.addedEdges || []) as Array<{
        id: string;
        source: string;
        sourceHandle: string;
        target: string;
        targetHandle: string;
      }>;

      setNodes((nds: RFNode[]) => {
        const filtered = nds.filter((n) => !deletedNodeIds.has(n.id));
        const fresh = newNodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
        }));
        return [...filtered, ...fresh] as RFNode[];
      });
      setEdges((eds: Edge[]) => {
        const filtered = eds.filter((e) => !deletedEdgeIds.has(e.id));
        const cleaned = filtered.filter(
          (e) => !deletedNodeIds.has(e.source) && !deletedNodeIds.has(e.target)
        );
        const fresh = newEdges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle,
          target: e.target,
          targetHandle: e.targetHandle,
        }));
        return [...cleaned, ...fresh] as Edge[];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error generando escenas";
      setAnalysisError(msg);
    } finally {
      setIsMaterializing(false);
    }
  }, [analysis, conversationId, id, nodeData, setNodes, setEdges]);

  const promptPreview = nodeData.prompt
    ? nodeData.prompt.length > 120
      ? `${nodeData.prompt.slice(0, 120)}…`
      : nodeData.prompt
    : "";

  const generalSummary = useMemo(() => {
    if (!analysis) return null;
    const g = analysis.generalInfo;
    return {
      tone: g.tone,
      genre: g.genre,
      characters: g.characters?.length || 0,
    };
  }, [analysis]);

  const hasAnalysis = !!analysis;
  const hasGeneralInfo =
    !!analysis &&
    (analysis.generalInfo.synopsis || analysis.generalInfo.tone || (analysis.generalInfo.characters?.length || 0) > 0);

  return (
    <div
      onKeyDown={handleNodeKeyDown}
      className={`group bg-card rounded-xl border-2 ${statusColors[status]} ${
        selected ? "ring-2 ring-fuchsia-500/40" : ""
      } min-w-[340px] max-w-[380px] transition-all`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Sparkles className="h-3.5 w-3.5 text-fuchsia-400 shrink-0" />
        <AIBadge />
        <input
          value={nodeData.label || ""}
          onChange={(e) => updateNodeData(id, { ...nodeData, label: e.target.value })}
          placeholder="Guión"
          onKeyDown={stopProp}
          className="nodrag text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50"
        />
        {nodeData.modelName && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
            {nodeData.modelName}
          </span>
        )}
        <StatusIndicator status={status} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Prompt input */}
      <div className="px-3 py-2 space-y-1.5 border-b border-border/40">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Guion</span>
        </div>
        <textarea
          value={nodeData.prompt || ""}
          onChange={handlePromptChange}
          onKeyDown={stopProp}
          placeholder="Pega aquí el guion completo (opcional si vas a armar las escenas a mano)..."
          className="nodrag w-full text-xs bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[80px] max-h-[200px] placeholder:text-muted-foreground/50"
          rows={4}
        />
        <div className="flex gap-1.5">
          <button
            onClick={handleReadScript}
            disabled={isAnalyzing || !nodeData.prompt?.trim()}
            className="nodrag flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md bg-fuchsia-500/15 text-fuchsia-400 hover:bg-fuchsia-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Leyendo guion...
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3" />
                {hasAnalysis ? "Re-leer guion" : "Leer guion"}
              </>
            )}
          </button>
          {!hasAnalysis && (
            <button
              onClick={() => addSceneAt(0)}
              className="nodrag flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md bg-muted/40 hover:bg-muted/60 transition-colors"
              title="Agregar escena manual sin leer guion"
            >
              <Plus className="h-3 w-3" />
              Manual
            </button>
          )}
        </div>
        {!hasAnalysis && !isAnalyzing && promptPreview && (
          <p className="text-[10px] text-muted-foreground line-clamp-2">{promptPreview}</p>
        )}
        {analysisError && (
          <div className="flex items-start gap-1 text-[10px] text-red-400">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{analysisError}</span>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="text-[10px] text-amber-400 space-y-0.5">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-1">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Analysis section */}
      {hasAnalysis && (
        <div className="px-3 py-2 space-y-2">
          {/* General info collapsible */}
          {hasGeneralInfo && (
            <>
              <button
                onClick={() => setGeneralOpen((v) => !v)}
                className="nodrag flex items-center gap-1.5 w-full text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                {generalOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span>Información general</span>
                {generalSummary && (
                  <span className="ml-auto normal-case text-muted-foreground/70 truncate">
                    {generalSummary.tone || "—"} · {generalSummary.characters} personaje(s)
                  </span>
                )}
              </button>
              {generalOpen && (
                <div className="bg-muted/30 rounded-md p-2 space-y-1.5 text-[11px]">
                  {analysis!.generalInfo.synopsis && (
                    <div>
                      <span className="text-muted-foreground">Sinopsis: </span>
                      <span>{analysis!.generalInfo.synopsis}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {analysis!.generalInfo.tone && (
                      <span className="px-1.5 py-0.5 rounded bg-background text-[10px]">
                        Tono: {analysis!.generalInfo.tone}
                      </span>
                    )}
                    {analysis!.generalInfo.genre && (
                      <span className="px-1.5 py-0.5 rounded bg-background text-[10px]">
                        Género: {analysis!.generalInfo.genre}
                      </span>
                    )}
                  </div>
                  {analysis!.generalInfo.characters?.length > 0 && (
                    <div>
                      <span className="text-muted-foreground text-[10px]">Personajes:</span>
                      <ul className="mt-0.5 space-y-0.5">
                        {analysis!.generalInfo.characters.map((c, i) => (
                          <li key={i} className="text-[10px]">
                            <span className="font-medium">{c.name}:</span>{" "}
                            <span className="text-muted-foreground">{c.description}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Scenes list */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Escenas ({sceneCount})
              </span>
            </div>
            <div className="space-y-1 max-h-[420px] overflow-y-auto">
              {/* Insert at start */}
              <InsertButton onClick={() => addSceneAt(0)} label="Insertar al inicio" />

              {analysis!.scenes.map((scene, i) => (
                <Fragment key={`${scene.index}-${i}`}>
                  <SceneCard
                    scene={scene}
                    position={i}
                    total={sceneCount}
                    onTextChange={(text) => updateSceneText(i, text)}
                    onTargetChange={(t) => updateSceneTarget(i, t)}
                    onMoveUp={() => moveScene(i, i - 1)}
                    onMoveDown={() => moveScene(i, i + 1)}
                    onRemove={() => removeSceneAt(i)}
                  />
                  <InsertButton
                    onClick={() => addSceneAt(i + 1)}
                    label={i === sceneCount - 1 ? "Agregar al final" : `Insertar entre ${i + 1} y ${i + 2}`}
                  />
                </Fragment>
              ))}
            </div>
          </div>

          {/* Continuity toggle */}
          <label className="nodrag flex items-start gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none px-1 py-1 rounded hover:bg-muted/30 transition-colors">
            <input
              type="checkbox"
              checked={!!nodeData.linkPreviousOutput}
              onChange={(e) =>
                updateNodeData(id, { ...nodeData, linkPreviousOutput: e.target.checked })
              }
              onKeyDown={stopProp}
              className="mt-0.5 accent-violet-500"
            />
            <span>
              <span className="text-foreground/80">Encadenar salidas para continuidad visual</span>
              <br />
              <span className="opacity-70">
                Imagen N → referencia de la imagen N+1 (o first-frame si la siguiente es video).
              </span>
            </span>
          </label>

          {/* Materialize button */}
          <button
            onClick={handleMaterialize}
            disabled={isMaterializing || sceneCount === 0}
            className="nodrag w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isMaterializing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Generando escenas...
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                Generar {sceneCount} escena{sceneCount === 1 ? "" : "s"}
              </>
            )}
          </button>
        </div>
      )}

      {status === "error" && nodeData.errorMessage && !analysisError && (
        <div className="px-3 py-2 flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" />
          <span className="truncate">{nodeData.errorMessage}</span>
        </div>
      )}

      {/* Output handle: chain to first scene */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_SCRIPT_CHAIN}
        className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background"
        title="Hacia primera escena"
      />
    </div>
  );
});

// --- Subcomponents ---

function InsertButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="flex items-center gap-1 group/insert">
      <div className="flex-1 h-px bg-border/30 group-hover/insert:bg-violet-500/30 transition-colors" />
      <button
        onClick={onClick}
        className="nodrag flex items-center gap-0.5 text-[9px] text-muted-foreground hover:text-violet-400 transition-colors px-1.5 py-0.5 rounded"
        title={label}
      >
        <Plus className="h-2.5 w-2.5" />
        <span className="opacity-0 group-hover/insert:opacity-100 transition-opacity">{label}</span>
      </button>
      <div className="flex-1 h-px bg-border/30 group-hover/insert:bg-violet-500/30 transition-colors" />
    </div>
  );
}

function SceneCard({
  scene,
  position,
  total,
  onTextChange,
  onTargetChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  scene: ScriptSceneAnalysis;
  position: number;
  total: number;
  onTextChange: (text: string) => void;
  onTargetChange: (t: SceneTargetNodeType) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const targetIcon =
    scene.targetNodeType === "image" ? <ImageIcon className="h-2.5 w-2.5" /> :
    scene.targetNodeType === "video" ? <Video className="h-2.5 w-2.5" /> :
    scene.targetNodeType === "text-practicante" ? <Bot className="h-2.5 w-2.5" /> :
    <MinusCircle className="h-2.5 w-2.5" />;

  return (
    <div className="bg-muted/30 rounded-md p-2 space-y-1 border border-border/30">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-semibold text-fuchsia-400 shrink-0">
          Escena {scene.index}
        </span>
        <span className="text-[9px] text-muted-foreground inline-flex items-center gap-0.5 ml-1">
          {targetIcon}
        </span>
        <select
          value={scene.targetNodeType}
          onChange={(e) => onTargetChange(e.target.value as SceneTargetNodeType)}
          onKeyDown={stopProp}
          className="nodrag ml-auto text-[10px] bg-background border border-border rounded px-1 py-0.5"
        >
          {targetTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={onMoveUp}
          disabled={position === 0}
          className="nodrag p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          title="Subir"
        >
          <ArrowUp className="h-2.5 w-2.5" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={position === total - 1}
          className="nodrag p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
          title="Bajar"
        >
          <ArrowDown className="h-2.5 w-2.5" />
        </button>
        <button
          onClick={onRemove}
          className="nodrag p-0.5 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400"
          title="Eliminar escena"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
      <textarea
        value={scene.text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={stopProp}
        placeholder="Texto de la escena..."
        className="nodrag w-full text-[10px] bg-background/50 rounded px-1.5 py-1 border border-border/30 outline-none resize-y min-h-[60px] max-h-[160px] whitespace-pre-wrap placeholder:text-muted-foreground/50"
        rows={3}
      />
    </div>
  );
}
