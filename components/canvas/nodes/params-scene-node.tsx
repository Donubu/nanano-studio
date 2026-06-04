"use client";

import { memo, useCallback, useState } from "react";
import {
  Handle,
  Position,
  useHandleConnections,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { Settings, Palette, Wand2, Loader2, AlertCircle } from "lucide-react";
import {
  HANDLE_IDS,
  topHandleId,
  type ParamsSceneNodeData,
  type StaticImageGroupNodeData,
  type StaticImageNodeData,
} from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";
import { NodeTextarea } from "./node-textarea";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";

function stopProp(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export const ParamsSceneNodeComponent = memo(function ParamsSceneNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps) {
  const nodeData = data as unknown as ParamsSceneNodeData;
  const { updateNodeData } = useNodeUpdate();
  const { conversationId } = useCanvasContext();
  const { getNode } = useReactFlow();

  const visualRefConnections = useHandleConnections({
    type: "target",
    id: HANDLE_IDS.INPUT_VISUAL_REFERENCE,
  });
  const hasGallery = visualRefConnections.length > 0;

  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const handleContentChange = useCallback(
    (value: string) => {
      updateNodeData(id, { ...nodeData, content: value });
    },
    [id, nodeData, updateNodeData]
  );

  const handleExtractStyle = useCallback(async () => {
    if (!conversationId) {
      setExtractError("Esperando conversación...");
      return;
    }
    if (visualRefConnections.length === 0) {
      setExtractError("Conecta una galería o imagen estática primero.");
      return;
    }

    // Collect URLs from connected gallery / static-image nodes
    const urls: string[] = [];
    for (const conn of visualRefConnections) {
      const sourceNode = getNode(conn.source);
      if (!sourceNode) continue;
      if (sourceNode.type === "static-image-group") {
        const d = sourceNode.data as unknown as StaticImageGroupNodeData;
        for (const img of d.images || []) {
          if (img.url) urls.push(img.url);
        }
      } else if (sourceNode.type === "static-image") {
        const d = sourceNode.data as unknown as StaticImageNodeData;
        if (d.imageUrl) urls.push(d.imageUrl);
      }
    }

    if (urls.length === 0) {
      setExtractError("La galería conectada no tiene imágenes.");
      return;
    }

    setIsExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/canvas/script/extract-style`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrls: urls }),
        }
      );
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || `Error ${res.status}`);
      }
      updateNodeData(id, { ...nodeData, content: body.stylePrompt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error extrayendo estilo";
      setExtractError(msg);
    } finally {
      setIsExtracting(false);
    }
  }, [conversationId, getNode, id, nodeData, updateNodeData, visualRefConnections]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-dashed border-yellow-400/40 ${
        selected ? "ring-2 ring-yellow-400/40" : ""
      } transition-all ${nodeSizeClass(width, height, "min-w-[260px] max-w-[320px]")}`}
    >
      {/* Input handle: gallery / static-image as visual reference for "Extract style" */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_VISUAL_REFERENCE}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
        style={{ top: "30%" }}
        title="Galería de referencia (para extraer estilo)"
      />

      {/* Input handle (top twin — same logical input, reachable from above) */}
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_VISUAL_REFERENCE)}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
        style={{ left: "50%" }}
        title="Galería de referencia (para extraer estilo)"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Palette className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
        <input
          value={nodeData.label || ""}
          onChange={(e) => updateNodeData(id, { ...nodeData, label: e.target.value })}
          onKeyDown={stopProp}
          placeholder="Params Escena"
          className="nodrag text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50"
        />
        <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/15 text-yellow-400 shrink-0">
          PRESET
        </span>
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            Estilo / Visual / Técnica
          </span>
          {hasGallery && (
            <span className="text-[9px] text-emerald-400 inline-flex items-center gap-0.5">
              <Palette className="h-2.5 w-2.5" />
              galería
            </span>
          )}
        </div>
        <NodeTextarea
          value={nodeData.content || ""}
          onChange={handleContentChange}
          onKeyDown={stopProp}
          placeholder="Ej: cinematográfico, cámara handheld, paleta cálida, lente 35mm, 8K..."
          className="nodrag w-full text-xs bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[80px] max-h-[200px] placeholder:text-muted-foreground/50"
          rows={4}
        />
        {hasGallery && (
          <button
            onClick={handleExtractStyle}
            disabled={isExtracting}
            className="nodrag w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isExtracting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Extrayendo estilo...
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3" />
                {nodeData.content ? "Re-extraer estilo desde galería" : "Extraer estilo desde galería"}
              </>
            )}
          </button>
        )}
        {extractError && (
          <div className="flex items-start gap-1 text-[10px] text-red-400">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{extractError}</span>
          </div>
        )}
        <p className="text-[9px] text-muted-foreground">
          Se concatena al contexto de cada nodo destino aguas abajo de las Escenas conectadas.
        </p>
      </div>

      {/* Output handle: connects to scene.INPUT_SCENE_PARAMS */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_PARAMS}
        className="!w-3 !h-3 !border-2 !border-background"
        style={{ backgroundColor: "#fc0" }}
        title="Params Escena output"
      />

      <ResizeHandle minWidth={240} minHeight={160} />
    </div>
  );
});
