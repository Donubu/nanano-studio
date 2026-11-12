"use client";

// Nodo vinculado: un Personaje que vive en otro canvas del mismo proyecto,
// solo lectura. Muestra la vista guardada (linkSnapshot) y entrega PROMPT
// (ADN + estilo + etapa) e IMAGEN (la imagen de una etapa); la etapa se elige
// en cada conexión. Se actualiza solo al abrir el canvas y antes de ejecutar,
// o con el botón.

import { memo, useState } from "react";
import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Dna, Link2, Loader2, Palette, RefreshCw, UserRound } from "lucide-react";
import { HANDLE_IDS, type LinkedNodeData } from "../lib/canvas-types";
import { computeLinkPatches } from "../lib/linked-sync";
import { NodeDeleteButton } from "./node-status";
import { useCanvasContext } from "../canvas-context";
import { useNodeUpdate } from "../hooks/use-node-update";
import { thumbUrl } from "../lib/thumb";

export const LinkedNodeComponent = memo(function LinkedNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as LinkedNodeData;
  const snap = d.linkSnapshot?.kind === "character" ? d.linkSnapshot : null;
  const { conversationId, canEdit } = useCanvasContext();
  const { updateNodeData, updateNodeDataLocal } = useNodeUpdate();
  const { getNode } = useReactFlow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const node = getNode(id);
    if (!node) return;
    setBusy(true);
    setError(null);
    try {
      const patches = await computeLinkPatches(conversationId, [node as { id: string; type?: string; data: Record<string, unknown> }]);
      const patch = patches.get(id);
      if (patch) {
        const next = { ...node.data, ...patch };
        if (canEdit) updateNodeData(id, next);
        else updateNodeDataLocal(id, next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const state = d.linkState ?? "ok";
  const withImage = snap?.stages.filter((s) => s.imageUrl).length ?? 0;

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-dashed border-pink-400/60 ${selected ? "ring-2 ring-pink-400/40" : ""} transition-all min-w-[300px] max-w-[380px]`}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <UserRound className="h-[18px] w-[18px] text-pink-400 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={snap?.label || d.label}>
          {snap?.label || d.label || "Personaje"}
        </span>
        <span
          className="flex shrink-0 items-center gap-0.5 rounded bg-pink-400/15 px-1 py-0.5 text-[12px] text-pink-700 dark:text-pink-300"
          title="Vinculado: se edita en su canvas de origen"
        >
          <Link2 className="h-3.5 w-3.5" /> Vinculado
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          title="Traer la última versión del original"
          className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* pr: deja libres las etiquetas PROMPT / IMAGEN de las salidas. */}
      <div className="px-3 pr-16 py-2 space-y-2">
        <div className="text-[12px] text-muted-foreground truncate" title={d.sourceCanvasTitle}>
          Desde <span className="font-medium text-foreground">{d.sourceCanvasTitle || `canvas ${d.sourceConversationId}`}</span>
          {" · "}
          {snap ? `${snap.stages.length} ${snap.stages.length === 1 ? "etapa" : "etapas"}, ${withImage} con imagen` : "sin datos"}
        </div>

        {state !== "ok" && (
          <div className="flex items-start gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[13px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {state === "deleted"
              ? "El original ya no existe. Se usa la última versión que se trajo."
              : "No tienes acceso al canvas de origen (otro proyecto o sin permiso)."}
          </div>
        )}
        {error && <p className="text-[13px] text-amber-700 dark:text-amber-300">{error}</p>}

        {snap && (
          <>
            {snap.dna.trim() && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[12px] uppercase tracking-wider text-muted-foreground">
                  <Dna className="h-4 w-4 text-pink-400" /> ADN
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-[14px] text-foreground/90">{snap.dna}</p>
              </div>
            )}
            {snap.style.trim() && (
              <div className="flex items-start gap-1 text-[13px] text-muted-foreground">
                <Palette className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span className="line-clamp-2">{snap.style}</span>
              </div>
            )}
            <div className="nowheel max-h-[320px] space-y-1 overflow-y-auto">
              {snap.stages.map((st, i) => (
                <div key={st.id} className="flex items-center gap-2 rounded-md bg-muted/20 p-1">
                  {st.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl(st.imageUrl, 128)} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded bg-muted/50" title="Sin imagen generada en el original" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">
                      {i + 1}. {st.name.trim() || `Etapa ${i + 1}`}
                    </div>
                    {st.text.trim() && <div className="truncate text-[12px] text-muted-foreground">{st.text}</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="text-[12px] text-muted-foreground">
          Conecta PROMPT o IMAGEN y elige la etapa en la conexión. Para cambiarlo, edítalo en su canvas.
        </p>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_CHARACTER}
        className="!w-3 !h-3 !bg-pink-400 !border-2 !border-background"
        style={{ top: 60 }}
        title="Prompt: ADN + estilo + la etapa que elijas en la conexión"
      />
      <span className="pointer-events-none absolute right-2 top-[52px] text-[11px] font-bold text-pink-500 dark:text-pink-300">
        PROMPT
      </span>
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_CHARACTER_IMAGE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
        style={{ top: 88 }}
        title="Imagen de una etapa (eliges cuál en la conexión)"
      />
      <span className="pointer-events-none absolute right-2 top-[80px] text-[11px] font-bold text-purple-500 dark:text-purple-300">
        IMAGEN
      </span>
    </div>
  );
});
