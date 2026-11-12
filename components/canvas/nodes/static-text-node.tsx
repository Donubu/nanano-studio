"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, ChevronRight, Type } from "lucide-react";
import { HANDLE_IDS, topHandleId, type StaticTextNodeData } from "../lib/canvas-types";
import { staticTextOutput, textFromEdge, textPartEdges, type OutEdge, type OutNode } from "../lib/node-outputs";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";
import { ResizeHandle, nodeSizeClass, useHasFixedSize } from "./resize-handle";

export const StaticTextNodeComponent = memo(function StaticTextNode({ id, data, selected }: NodeProps) {
  const hasFixedSize = useHasFixedSize(id);
  const nodeData = data as unknown as StaticTextNodeData;
  const { updateNodeData } = useNodeUpdate();
  const { canEdit } = useCanvasContext();

  // Local state mirrors the textarea so typing stays in sync with the DOM.
  // Without this, the controlled value can lag a keystroke while the update
  // round-trips through React Flow / collab, and React resets the caret to the
  // end — making it impossible to insert text in the middle.
  // (El label ya no necesita espejo local: NodeLabel maneja su propio draft.)
  const [localContent, setLocalContent] = useState(nodeData.content || "");

  // Sync from external updates (remote collab, undo/redo). The equality guard
  // prevents clobbering local edits before our own update has round-tripped.
  useEffect(() => {
    const incoming = nodeData.content || "";
    setLocalContent((prev) => (prev === incoming ? prev : incoming));
  }, [nodeData.content]);

  // Piezas conectadas a TEXTOS (en orden) y la salida armada, como string
  // para no re-renderizar el nodo en cada movimiento del canvas.
  const partsJson = useStore(
    useCallback(
      (state: { nodeLookup: Map<string, OutNode>; edges: OutEdge[] }) => {
        const self = state.nodeLookup.get(id);
        if (!self) return "{\"parts\":[],\"output\":\"\"}";
        const lookup = (nid: string) => state.nodeLookup.get(nid);
        const parts = textPartEdges(self, state.edges).map((e) => {
          const src = state.nodeLookup.get(e.source);
          const text = textFromEdge(e, lookup, state.edges);
          return {
            edgeId: e.id,
            label: String(src?.data.label || src?.type || "Texto"),
            text,
            // IA sin generar todavía: se avisa en la vista previa.
            pending: !text && (src?.type === "text" || src?.type === "text-practicante"),
          };
        });
        return JSON.stringify({ parts, output: parts.length ? staticTextOutput(self, lookup, state.edges) : "" });
      },
      [id],
    ) as never,
  ) as unknown as string;
  const { parts, output } = useMemo(
    () => JSON.parse(partsJson) as { parts: { edgeId: string; label: string; text: string; pending: boolean }[]; output: string },
    [partsJson],
  );
  const [showPreview, setShowPreview] = useState(false);
  const movePart = (index: number, delta: number) => {
    const to = index + delta;
    if (!canEdit || to < 0 || to >= parts.length) return;
    const order = parts.map((p) => p.edgeId);
    const [moved] = order.splice(index, 1);
    order.splice(to, 0, moved);
    updateNodeData(id, { partOrder: order });
  };

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!canEdit) return;
    const value = e.target.value;
    setLocalContent(value);
    updateNodeData(id, { content: value });
  }, [id, updateNodeData, canEdit]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-blue-400/30 ${
        selected ? "ring-2 ring-blue-400/50" : ""
      } transition-all ${nodeSizeClass(hasFixedSize, "min-w-[200px] max-w-[300px]")}`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Type className="h-[18px] w-[18px] text-blue-400 shrink-0" />
        <NodeLabel value={nodeData.label || ""} placeholder="Texto" onChange={(label) => updateNodeData(id, { label })} />
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Entradas: textos que se concatenan antes del propio (izquierda + gemelo superior) */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_TEXT_PARTS}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
        title="Textos a concatenar (van antes de este texto, en el orden de la lista)"
      />
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_TEXT_PARTS)}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
        title="Textos a concatenar (van antes de este texto, en el orden de la lista)"
      />

      {parts.length > 0 && (
        <div className="px-3 pt-2 space-y-1">
          <div className="text-[12px] uppercase tracking-wider text-muted-foreground">Se concatenan antes de tu texto</div>
          {parts.map((p, i) => (
            <div key={p.edgeId} className="flex items-center gap-1 rounded-md bg-muted/30 px-1.5 py-1">
              <span className="w-4 shrink-0 text-[12px] text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{p.label}</span>
                <span className={`block truncate text-[12px] ${p.pending ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground"}`}>
                  {p.pending ? "Todavía sin generar" : p.text || "Vacío"}
                </span>
              </span>
              {canEdit && parts.length > 1 && (
                <>
                  <button type="button" onClick={() => movePart(i, -1)} disabled={i === 0} title="Subir" className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => movePart(i, 1)} disabled={i === parts.length - 1} title="Bajar" className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Body - editable textarea */}
      <div className="px-3 py-2">
        <textarea
          value={localContent}
          onChange={handleContentChange}
          readOnly={!canEdit}
          placeholder="Escribe texto que se usará como input..."
          className="nodrag nowheel w-full text-[15px] bg-transparent border-none outline-none resize-y min-h-[50px] max-h-[200px] placeholder:text-muted-foreground dark:placeholder:text-muted-foreground/50"
          rows={3}
        />
        {parts.length > 0 && (
          <div className="mt-1 space-y-1">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="nodrag flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${showPreview ? "rotate-90" : ""}`} />
              Ver el texto que entrega
            </button>
            {showPreview && (
              <p className="nowheel max-h-[200px] overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/30 px-2 py-1 text-[13px]">
                {output || "Vacío"}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_TEXT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
        title="Text output"
      />

      <ResizeHandle minWidth={180} minHeight={100} />
    </div>
  );
});
