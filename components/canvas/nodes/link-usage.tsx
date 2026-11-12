"use client";

// "Vinculado en…": en un Personaje o Escena, los otros canvas del proyecto
// que lo usan como vinculado (clic = abre ese canvas en el vinculado).

import { Link2 } from "lucide-react";
import { useCanvasContext } from "../canvas-context";
import type { LinkUsageCanvas } from "../lib/canvas-types";

const EMPTY: LinkUsageCanvas[] = [];

/** Canvas que vinculan este nodo (vacío si nadie lo usa). */
export function useLinkUsage(nodeId: string): LinkUsageCanvas[] {
  return useCanvasContext().linkUsage[nodeId] ?? EMPTY;
}

/** Dónde se usa una etapa: "ACTO 1 (2), ACTO 2 (1)". */
export function stageUsageText(usage: LinkUsageCanvas[], stageId: string): string | null {
  const parts = usage.filter((u) => u.stageUses[stageId]).map((u) => `${u.title} (${u.stageUses[stageId]})`);
  return parts.length ? parts.join(", ") : null;
}

export function LinkUsageRow({ nodeId, kind }: { nodeId: string; kind: "character" | "scene" }) {
  const usage = useLinkUsage(nodeId);
  const { openCanvas } = useCanvasContext();
  if (usage.length === 0) return null;
  const what = kind === "character" ? "este Personaje" : "esta Escena";
  return (
    <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
      <Link2 className="h-3.5 w-3.5 text-pink-400 shrink-0" />
      <span>Vinculado en</span>
      {usage.map((u) => (
        <button
          key={u.conversationId}
          type="button"
          onClick={() => openCanvas?.(u.conversationId, u.linkedNodeIds[0])}
          disabled={!openCanvas}
          title={`${u.connections} ${u.connections === 1 ? "conexión usa" : "conexiones usan"} ${what} en "${u.title}". Clic para abrirlo.`}
          className="nodrag rounded bg-pink-400/15 px-1.5 py-0.5 text-pink-700 dark:text-pink-300 hover:bg-pink-400/25 disabled:cursor-default"
        >
          {u.title} · {u.connections}
        </button>
      ))}
    </div>
  );
}
