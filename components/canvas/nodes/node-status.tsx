"use client";

import { useReactFlow } from "@xyflow/react";
import { Check, Loader2, AlertCircle, AlertTriangle, Trash2, Zap } from "lucide-react";
import { useCanvasContext, useStaleMessage } from "../canvas-context";

export function StatusIndicator({ status }: { status: string }) {
  switch (status) {
    case "generating":
      return <Loader2 className="h-4 w-4 text-blue-400 animate-spin shrink-0" />;
    case "completed":
      return <Check className="h-[18px] w-[18px] text-green-500 shrink-0" />;
    case "error":
      return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />;
    default:
      return <div className="w-2 h-2 rounded-full bg-muted-foreground/50 shrink-0" />;
  }
}

/**
 * Estado del nodo; si el resultado quedó desactualizado (cambió un Personaje
 * o Escena vinculada que lo alimenta), un aviso ámbar en vez del check.
 */
export function NodeStatus({ nodeId, status }: { nodeId: string; status: string }) {
  const stale = useStaleMessage(nodeId);
  if (stale && status === "completed") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[12px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 shrink-0"
        title={`${stale}. Vuelve a ejecutarlo para actualizarlo.`}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Desactualizado
      </span>
    );
  }
  return <StatusIndicator status={status} />;
}

export function AIBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold px-1 py-0.5 rounded bg-primary/10 text-primary shrink-0">
      <Zap className="h-2.5 w-2.5" />IA
    </span>
  );
}

export function NodeDeleteButton({ nodeId }: { nodeId: string }) {
  // getEdges al hacer click (y no useEdges): suscribirse a las conexiones
  // re-renderizaba todos los nodos con cada cambio de cualquier conexión.
  const { deleteElements, getEdges } = useReactFlow();
  const { canEdit } = useCanvasContext();

  // En solo-ver no se puede eliminar nodos.
  if (!canEdit) return null;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    const connected = getEdges().some((edge) => edge.source === nodeId || edge.target === nodeId);
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
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
