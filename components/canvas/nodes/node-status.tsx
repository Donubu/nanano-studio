"use client";

import { useReactFlow, useEdges } from "@xyflow/react";
import { Check, Loader2, AlertCircle, Trash2, Zap } from "lucide-react";
import { useCanvasContext } from "../canvas-context";

export function StatusIndicator({ status }: { status: string }) {
  switch (status) {
    case "generating":
      return <Loader2 className="h-3 w-3 text-blue-400 animate-spin shrink-0" />;
    case "completed":
      return <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    case "error":
      return <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />;
    default:
      return <div className="w-2 h-2 rounded-full bg-muted-foreground/50 shrink-0" />;
  }
}

export function AIBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1 py-0.5 rounded bg-primary/10 text-primary shrink-0">
      <Zap className="h-2.5 w-2.5" />IA
    </span>
  );
}

export function NodeDeleteButton({ nodeId }: { nodeId: string }) {
  const { deleteElements } = useReactFlow();
  const edges = useEdges();
  const { canEdit } = useCanvasContext();

  // En solo-ver no se puede eliminar nodos.
  if (!canEdit) return null;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    const connected = edges.some((edge) => edge.source === nodeId || edge.target === nodeId);
    if (connected) {
      if (!window.confirm("Este nodo tiene conexiones. ¿Eliminar?")) return;
    }
    deleteElements({ nodes: [{ id: nodeId }] });
  };

  return (
    <button
      onClick={handleDelete}
      className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/15 text-muted-foreground hover:text-red-400 shrink-0"
      title="Eliminar nodo"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  );
}
