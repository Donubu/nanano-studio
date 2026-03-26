"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";
import { HANDLE_IDS } from "../lib/canvas-types";

const HANDLE_LABELS: Record<string, string> = {
  [HANDLE_IDS.INPUT_PROMPT]: "PROMPT",
  [HANDLE_IDS.INPUT_REFERENCE]: "REF",
  [HANDLE_IDS.INPUT_FIRST_FRAME]: "FIRST",
  [HANDLE_IDS.INPUT_LAST_FRAME]: "LAST",
  [HANDLE_IDS.INPUT_MEDIA]: "MEDIA",
};

const HANDLE_COLORS: Record<string, string> = {
  [HANDLE_IDS.INPUT_PROMPT]: "bg-background text-blue-400 border-blue-500/40",
  [HANDLE_IDS.INPUT_REFERENCE]: "bg-background text-purple-400 border-purple-500/40",
  [HANDLE_IDS.INPUT_FIRST_FRAME]: "bg-background border-purple-500/40",
  [HANDLE_IDS.INPUT_LAST_FRAME]: "bg-background border-purple-500/40",
  [HANDLE_IDS.INPUT_MEDIA]: "bg-background text-emerald-400 border-emerald-500/40",
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
};

export const LabeledEdge = memo(function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  targetHandleId,
  style,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const label = targetHandleId ? HANDLE_LABELS[targetHandleId] : null;
  const colorClass = targetHandleId ? HANDLE_COLORS[targetHandleId] : "bg-muted text-muted-foreground border-border";
  const dualLabel = targetHandleId ? HANDLE_DUAL_LABEL[targetHandleId] : null;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <div
            className={`absolute text-[8px] font-bold px-1.5 py-0.5 rounded border pointer-events-none z-10 ${colorClass}`}
            style={{
              transform: `translate(-50%, -120%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {dualLabel ? (
              <span className="flex items-center gap-0.5">
                {dualLabel.map((part, i) => (
                  <span key={i} className={part.color}>{part.text}</span>
                ))}
              </span>
            ) : (
              label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
