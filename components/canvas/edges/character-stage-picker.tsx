"use client";

// Selector sobre una conexión de la salida "imagen de una etapa" del
// Personaje: elige qué etapa entrega esa conexión. La elección se guarda en el
// Personaje (data.imageOutputs[edgeId]) porque canvas_edges solo guarda la
// prioridad.

import { memo, useCallback, useState } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import type { CharacterNodeData, LinkedNodeData } from "../lib/canvas-types";
import { resolveCharacterImageEdges } from "../lib/character";
import { wouldCreateCycle } from "../lib/connection-rules";
import { useCanvasContext } from "../canvas-context";

interface StageOption {
  id: string;
  label: string;
  hasImage: boolean;
  imageNodeId?: string;
}

export const CharacterStagePicker = memo(function CharacterStagePicker({
  edgeId,
  characterId,
  targetId,
  dimmed,
  promptOutput = false,
}: {
  edgeId: string;
  // Personaje local o nodo vinculado a un Personaje de otro canvas.
  characterId: string;
  targetId: string;
  dimmed: boolean;
  // Salida PROMPT de un vinculado: sin etapa entrega solo ADN + estilo.
  promptOutput?: boolean;
}) {
  const { canEdit, persistNodeData } = useCanvasContext();
  const { getNodes, getEdges } = useReactFlow();
  // Etapas + elegida, como string para no re-renderizar en cada movimiento.
  const json = useStore(
    useCallback(
      (s: { nodeLookup: Map<string, { data: Record<string, unknown> }> }) => {
        const node = s.nodeLookup.get(characterId) as { type?: string; data: Record<string, unknown> } | undefined;
        let stages: StageOption[] = [];
        if (node?.type === "linked") {
          // Vinculado: etapas de la vista guardada (sin ciclos posibles: sus
          // imágenes no son nodos de este canvas).
          const ld = node.data as unknown as LinkedNodeData;
          const snap = ld.linkSnapshot?.kind === "character" ? ld.linkSnapshot : null;
          stages = (snap?.stages ?? []).map((st, i) => ({
            id: st.id,
            label: st.name.trim() || `Etapa ${i + 1}`,
            hasImage: !!st.imageUrl,
          }));
        } else {
          const d = node?.data as unknown as CharacterNodeData | undefined;
          stages = (d?.stages ?? []).map((st, i) => ({
            id: st.id,
            label: st.name.trim() || `Etapa ${i + 1}`,
            hasImage: !!st.imageNodeId && !!s.nodeLookup.get(st.imageNodeId)?.data.outputUrl,
            imageNodeId: st.imageNodeId,
          }));
        }
        const map = (node?.data as { imageOutputs?: Record<string, string> } | undefined)?.imageOutputs;
        return JSON.stringify({ stages, selected: map?.[edgeId] ?? "" });
      },
      [characterId, edgeId],
    ) as never,
  ) as unknown as string;
  const { stages, selected } = JSON.parse(json) as { stages: StageOption[]; selected: string };
  const current = stages.find((s) => s.id === selected);

  // Etapas que formarían un ciclo (la imagen de la etapa depende del destino,
  // o es el destino mismo). Se calcula al abrir el selector.
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set());
  const computeBlocked = () => {
    const nodes = getNodes();
    // Sin esta conexión: se evalúa cada etapa como si fuera la nueva fuente.
    const resolved = resolveCharacterImageEdges(nodes, getEdges().filter((e) => e.id !== edgeId));
    const next = new Set<string>();
    for (const st of stages) {
      if (!st.imageNodeId) continue;
      if (st.imageNodeId === targetId || wouldCreateCycle(resolved, st.imageNodeId, targetId)) next.add(st.id);
    }
    setBlocked(next);
  };

  const choose = (stageId: string) => {
    const node = getNodes().find((n) => n.id === characterId);
    if (!node) return;
    const prev = (node.data as { imageOutputs?: Record<string, string> }).imageOutputs ?? {};
    const next = { ...prev };
    if (stageId) next[edgeId] = stageId;
    else delete next[edgeId];
    persistNodeData(characterId, { ...node.data, imageOutputs: next });
  };

  // En PROMPT la imagen no importa: basta con haber elegido (o no) la etapa.
  const warn = promptOutput ? false : !current || !current.hasImage;
  return (
    <select
      value={current ? current.id : ""}
      disabled={!canEdit}
      onMouseDown={(e) => {
        e.stopPropagation();
        computeBlocked();
      }}
      onFocus={computeBlocked}
      onChange={(e) => choose(e.target.value)}
      title={
        promptOutput
          ? current
            ? `Entrega ADN + estilo + la etapa "${current.label}"`
            : "Entrega solo ADN + estilo; elige una etapa para sumarla"
          : !current
            ? "Elige qué etapa del Personaje entrega esta conexión"
            : !current.hasImage
              ? "Esa etapa todavía no tiene imagen: genérala en su canvas"
              : `Entrega la imagen de la etapa "${current.label}"`
      }
      className={`nodrag nopan pointer-events-auto max-w-[180px] truncate rounded border bg-background px-1 py-0.5 text-[12px] font-semibold outline-none ${
        warn ? "border-amber-500/60 text-amber-600 dark:text-amber-300" : "border-pink-400/50 text-pink-600 dark:text-pink-300"
      } ${dimmed ? "opacity-20" : ""}`}
    >
      <option value="">{promptOutput ? "Solo ADN y estilo" : stages.length ? "Elegir etapa…" : "Sin etapas"}</option>
      {stages.map((st) => (
        <option key={st.id} value={st.id} disabled={blocked.has(st.id)}>
          {st.label}
          {blocked.has(st.id) ? " · formaría un ciclo" : st.hasImage || promptOutput ? "" : " · sin imagen"}
        </option>
      ))}
    </select>
  );
});
