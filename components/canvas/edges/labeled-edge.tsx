"use client";

import { memo, useCallback } from "react";
import {
  BaseEdge,
  useStore,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { HANDLE_IDS, baseHandleId } from "../lib/canvas-types";
import { ZOOM_CSS_VAR, useIsZoomedOut } from "../nodes/lod";
import { useSelectedNodeIds } from "../canvas-context";
import { CharacterStagePicker } from "./character-stage-picker";

const HANDLE_LABELS: Record<string, string> = {
  [HANDLE_IDS.INPUT_PROMPT]: "PROMPT",
  [HANDLE_IDS.INPUT_REFERENCE]: "REF",
  [HANDLE_IDS.INPUT_FIRST_FRAME]: "FIRST",
  [HANDLE_IDS.INPUT_LAST_FRAME]: "LAST",
  [HANDLE_IDS.INPUT_MEDIA]: "MEDIA",
  [HANDLE_IDS.INPUT_PARAMS]: "PARAMS",
};

const HANDLE_COLORS: Record<string, string> = {
  [HANDLE_IDS.INPUT_PROMPT]: "bg-background text-blue-400 border-blue-500/40",
  [HANDLE_IDS.INPUT_REFERENCE]: "bg-background text-purple-400 border-purple-500/40",
  [HANDLE_IDS.INPUT_FIRST_FRAME]: "bg-background border-purple-500/40",
  [HANDLE_IDS.INPUT_LAST_FRAME]: "bg-background border-purple-500/40",
  [HANDLE_IDS.INPUT_MEDIA]: "bg-background text-emerald-400 border-emerald-500/40",
  [HANDLE_IDS.INPUT_PARAMS]: "bg-background border-yellow-400/40",
};

// Labels with dual-color for image-related handles
const HANDLE_DUAL_LABEL: Record<string, { text: string; color: string }[]> = {
  [HANDLE_IDS.INPUT_FIRST_FRAME]: [
    { text: "FIRST", color: "text-green-400" },
    { text: "FRAME", color: "text-purple-400" },
  ],
  [HANDLE_IDS.INPUT_LAST_FRAME]: [
    { text: "LAST", color: "text-orange-400" },
    { text: "FRAME", color: "text-purple-400" },
  ],
  [HANDLE_IDS.INPUT_REFERENCE]: [
    { text: "REF", color: "text-purple-400" },
  ],
  [HANDLE_IDS.INPUT_PARAMS]: [
    { text: "PARAMS", color: "text-yellow-400" },
  ],
};

export const LabeledEdge = memo(function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Normalize the top-edge twin (e.g. "input-prompt__top") to its base id so the
  // edge still shows its label/color regardless of which side it connects to.
  const baseTargetHandle = baseHandleId(targetHandleId);
  const label = baseTargetHandle ? HANDLE_LABELS[baseTargetHandle] : null;
  const colorClass = baseTargetHandle ? HANDLE_COLORS[baseTargetHandle] : "bg-muted text-muted-foreground border-border";
  const dualLabel = baseTargetHandle ? HANDLE_DUAL_LABEL[baseTargetHandle] : null;
  // Prioridad asignada por el usuario (solo referencias). Neutro = sin badge.
  const priority =
    baseTargetHandle === HANDLE_IDS.INPUT_REFERENCE && typeof (data as { priority?: unknown } | undefined)?.priority === "number"
      ? ((data as { priority: number }).priority)
      : null;

  // Con nodos seleccionados, sus conexiones se destacan (más gruesas, color
  // primario) y las demás se atenúan.
  const selectedIds = useSelectedNodeIds();
  const highlighted = selectedIds.has(source) || selectedIds.has(target);
  const dimmed = selectedIds.size > 0 && !highlighted;
  // Animada solo si toca un nodo que se está generando: animar todas las
  // conexiones repintaba cada línea en cada cuadro.
  const generating = useStore(
    useCallback(
      (s: { nodeLookup: Map<string, { data: Record<string, unknown> }> }) =>
        s.nodeLookup.get(source)?.data.status === "generating" ||
        s.nodeLookup.get(target)?.data.status === "generating",
      [source, target],
    ) as never,
  ) as unknown as boolean;
  // Con el canvas alejado las etiquetas (PROMPT/REF…) no se leen.
  const zoomedOut = useIsZoomedOut();
  // Salida "imagen de una etapa" del Personaje: la conexión lleva su selector.
  // También la salida PROMPT de un Personaje vinculado (elige la etapa).
  const baseSource = baseHandleId(sourceHandleId);
  const linkedPrompt = useStore(
    useCallback(
      (s: { nodeLookup: Map<string, { type?: string }> }) =>
        baseSource === HANDLE_IDS.OUTPUT_CHARACTER && s.nodeLookup.get(source)?.type === "linked",
      [baseSource, source],
    ) as never,
  ) as unknown as boolean;
  const stagePicker = baseSource === HANDLE_IDS.OUTPUT_CHARACTER_IMAGE || linkedPrompt;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          ...(highlighted
            ? {
                stroke: "var(--color-primary)",
                // Grosor en px de pantalla: se nota igual con el canvas alejado.
                strokeWidth: `max(2.5px, calc(2.5px / var(${ZOOM_CSS_VAR}, 1)))`,
              }
            : {}),
          ...(dimmed ? { opacity: 0.2 } : {}),
          ...(generating ? { strokeDasharray: 5, animation: "dashdraw 0.5s linear infinite" } : {}),
          transition: "opacity 150ms, stroke 150ms",
        }}
        markerEnd={markerEnd}
      />
      {stagePicker && !zoomedOut && (
        <EdgeLabelRenderer>
          <div
            className="absolute z-10"
            style={{ transform: `translate(-50%, 15%) translate(${labelX}px,${labelY}px)` }}
          >
            <CharacterStagePicker edgeId={id} characterId={source} targetId={target} dimmed={dimmed} promptOutput={linkedPrompt} />
          </div>
        </EdgeLabelRenderer>
      )}
      {label && !zoomedOut && (
        <EdgeLabelRenderer>
          <div
            className={`absolute text-[12px] font-bold px-1.5 py-0.5 rounded border pointer-events-none z-10 ${colorClass} ${
              dimmed ? "opacity-20" : ""
            }`}
            style={{
              transform: `translate(-50%, -120%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <span className="flex items-center gap-0.5">
              {dualLabel ? (
                dualLabel.map((part, i) => (
                  <span key={i} className={part.color}>{part.text}</span>
                ))
              ) : (
                label
              )}
              {priority != null && (
                <span className="ml-0.5 px-1 rounded-sm bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  {priority}
                </span>
              )}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
