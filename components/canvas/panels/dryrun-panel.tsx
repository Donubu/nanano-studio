"use client";

import { FlaskConical, X } from "lucide-react";
import type { Node } from "@xyflow/react";
import type { TextPracticanteNodeData } from "../lib/canvas-types";

interface DryRunPanelProps {
  node: Node;
  onClose: () => void;
}

export function DryRunPanel({ node, onClose }: DryRunPanelProps) {
  const data = node.data as unknown as TextPracticanteNodeData;
  const analysis = data.dryRunResponse;

  return (
    <div className="w-[360px] h-full border-l border-border bg-background flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <FlaskConical className="h-4 w-4 text-purple-400" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">Análisis dry-run</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {data.label || "Practicante"} — sin ejecutar herramientas
          </div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {data.delegatedTo && (
          <div className="text-xs">
            <span className="text-muted-foreground">Delegaría a: </span>
            <span className="font-medium">{data.delegatedTo}</span>
          </div>
        )}
        {data.toolsUsed && data.toolsUsed.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tools que invocaría</div>
            <div className="flex flex-wrap gap-1">
              {data.toolsUsed.map((t, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Análisis</div>
          <div className="bg-muted/50 rounded-md p-3 text-xs whitespace-pre-wrap leading-relaxed">
            {analysis || "(sin respuesta)"}
          </div>
        </div>
      </div>
    </div>
  );
}
