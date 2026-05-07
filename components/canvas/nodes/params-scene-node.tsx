"use client";

import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Settings, Palette } from "lucide-react";
import { HANDLE_IDS, type ParamsSceneNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { useNodeUpdate } from "../hooks/use-node-update";

function stopProp(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export const ParamsSceneNodeComponent = memo(function ParamsSceneNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as ParamsSceneNodeData;
  const { updateNodeData } = useNodeUpdate();

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { ...nodeData, content: e.target.value });
    },
    [id, nodeData, updateNodeData]
  );

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-dashed border-yellow-400/40 ${
        selected ? "ring-2 ring-yellow-400/40" : ""
      } min-w-[260px] max-w-[320px] transition-all`}
    >
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
        <span className="text-[9px] px-1 py-0.5 rounded bg-yellow-400/15 text-yellow-400 shrink-0">PRESET</span>
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body */}
      <div className="px-3 py-2 space-y-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
          Estilo / Visual / Técnica
        </span>
        <textarea
          value={nodeData.content || ""}
          onChange={handleContentChange}
          onKeyDown={stopProp}
          placeholder="Ej: cinematográfico, cámara handheld, paleta cálida, lente 35mm, 8K..."
          className="nodrag w-full text-xs bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[80px] max-h-[200px] placeholder:text-muted-foreground/50"
          rows={4}
        />
        <p className="text-[9px] text-muted-foreground">
          Se concatena al prompt de cada nodo destino aguas abajo de las Escenas conectadas.
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
    </div>
  );
});
