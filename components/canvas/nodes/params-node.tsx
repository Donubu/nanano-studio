"use client";

import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Settings, MessageSquare, ImageIcon, Video } from "lucide-react";
import { HANDLE_IDS, type ParamsTextNodeData, type ParamsImageNodeData, type ParamsVideoNodeData } from "../lib/canvas-types";
import { NodeDeleteButton } from "./node-status";
import { useCanvasContext } from "../canvas-context";
import { useNodeUpdate } from "../hooks/use-node-update";
import type { CanvasGenerationConfig } from "../canvas-workspace";

type ParamsData = ParamsTextNodeData | ParamsImageNodeData | ParamsVideoNodeData;

const subtypeConfig = {
  "params-text": { icon: MessageSquare, color: "text-blue-400", borderColor: "border-blue-400/30", label: "Texto" },
  "params-image": { icon: ImageIcon, color: "text-purple-400", borderColor: "border-purple-400/30", label: "Imagen" },
  "params-video": { icon: Video, color: "text-amber-400", borderColor: "border-amber-400/30", label: "Video" },
};

// Map params type → generation config type
const paramsToGenType: Record<string, string> = {
  "params-text": "text",
  "params-image": "image",
  "params-video": "video",
};

export const ParamsNodeComponent = memo(function ParamsNode({ id, data, selected, type }: NodeProps) {
  const nodeData = data as unknown as ParamsData;
  const { updateNodeData } = useNodeUpdate();
  const { projectId, generationConfig } = useCanvasContext();
  const config = subtypeConfig[type as keyof typeof subtypeConfig] || subtypeConfig["params-text"];
  const Icon = config.icon;

  // Get models for this params type
  const genType = paramsToGenType[type as string] || "text";
  const typeConfig = (generationConfig || []).find((c: CanvasGenerationConfig) => c.generation_type === genType);
  const availableModels = typeConfig?.models || [];
  const selectedModel = nodeData.modelId
    ? availableModels.find((m) => m.id === nodeData.modelId)
    : availableModels.find((m) => m.is_default) || availableModels[0];

  const update = useCallback((updates: Partial<ParamsData>) => {
    updateNodeData(id, { ...nodeData, ...updates });
  }, [id, nodeData, updateNodeData]);

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-dashed ${config.borderColor} ${
        selected ? "ring-2 ring-primary/50" : ""
      } min-w-[240px] max-w-[300px] transition-all`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Icon className={`h-3.5 w-3.5 ${config.color} shrink-0`} />
        <input
          value={nodeData.label || ""}
          onChange={(e) => update({ label: e.target.value } as Partial<ParamsData>)}
          placeholder={`Params ${config.label}`}
          className="text-xs font-medium flex-1 min-w-0 bg-transparent border-none outline-none truncate placeholder:text-muted-foreground/50"
        />
        <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">PRESET</span>
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body - settings */}
      <div className="px-3 py-2 space-y-2">
        {/* Model */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground">Modelo</label>
          <select
            value={nodeData.modelId || ""}
            onChange={(e) => {
              const modelId = e.target.value ? Number(e.target.value) : undefined;
              const model = modelId ? availableModels.find((m) => m.id === modelId) : selectedModel;
              update({ modelId, modelName: model?.display_name } as Partial<ParamsData>);
            }}
            className="w-full h-7 rounded border border-input bg-background px-2 text-[11px]"
          >
            <option value="">
              {availableModels.find((m) => m.is_default)?.display_name || "Default"}
            </option>
            {availableModels.filter((m) => !m.is_default).map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>

        {/* Text params */}
        {type === "params-text" && (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="space-y-0.5">
                <label className="text-[10px] text-muted-foreground">Temp</label>
                <input type="number" min={0} max={2} step={0.1}
                  value={(nodeData as ParamsTextNodeData).temperature ?? 1.0}
                  onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                  className="w-full h-7 rounded border border-input bg-background px-2 text-[11px]"
                />
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] text-muted-foreground">Max Tokens</label>
                <input type="number" min={1} max={1000000}
                  value={(nodeData as ParamsTextNodeData).maxOutputTokens ?? 8192}
                  onChange={(e) => update({ maxOutputTokens: parseInt(e.target.value) })}
                  className="w-full h-7 rounded border border-input bg-background px-2 text-[11px]"
                />
              </div>
            </div>
            <div className="flex gap-1.5">
              {(["none", "low", "medium", "high"] as const).map((level) => (
                <button key={level} onClick={() => update({ thinkingLevel: level })}
                  className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                    ((nodeData as ParamsTextNodeData).thinkingLevel || "none") === level
                      ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                      : "border-border hover:bg-accent"
                  }`}
                >{level === "none" ? "Off" : level === "low" ? "Bajo" : level === "medium" ? "Med" : "Alto"}</button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => update({ outputAsPrompt: true })}
                className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                  (nodeData as ParamsTextNodeData).outputAsPrompt !== false
                    ? "bg-purple-500/15 text-purple-400 border-purple-500/30" : "border-border hover:bg-accent"
                }`}>Prompt</button>
              <button onClick={() => update({ outputAsPrompt: false })}
                className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                  (nodeData as ParamsTextNodeData).outputAsPrompt === false
                    ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "border-border hover:bg-accent"
                }`}>Libre</button>
            </div>
          </>
        )}

        {/* Image params */}
        {type === "params-image" && (
          <>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Aspect Ratio</label>
              <div className="flex gap-1">
                {["16:9", "9:16", "1:1", "4:3", "3:4"].map((ar) => (
                  <button key={ar} onClick={() => update({ aspectRatio: ar })}
                    className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                      (nodeData as ParamsImageNodeData).aspectRatio === ar
                        ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                    }`}>{ar}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Resolution</label>
              <div className="flex gap-1">
                {["1K", "2K", "4K"].map((res) => (
                  <button key={res} onClick={() => update({ resolution: res })}
                    className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                      (nodeData as ParamsImageNodeData).resolution === res
                        ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                    }`}>{res}</button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Video params */}
        {type === "params-video" && (
          <>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Duración</label>
              <div className="flex gap-1">
                {[4, 6, 8, 10, 15].map((d) => (
                  <button key={d} onClick={() => update({ duration: d })}
                    className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                      (nodeData as ParamsVideoNodeData).duration === d
                        ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                    }`}>{d}s</button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Aspect Ratio</label>
              <div className="flex gap-1">
                {["16:9", "9:16", "1:1"].map((ar) => (
                  <button key={ar} onClick={() => update({ aspectRatio: ar })}
                    className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                      (nodeData as ParamsVideoNodeData).aspectRatio === ar
                        ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                    }`}>{ar}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Resolution</label>
              <div className="flex gap-1">
                {["480p", "720p", "1080p"].map((res) => (
                  <button key={res} onClick={() => update({ resolution: res })}
                    className={`flex-1 py-1 text-[10px] rounded border transition-colors ${
                      (nodeData as ParamsVideoNodeData).resolution === res
                        ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-accent"
                    }`}>{res}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <input type="checkbox" checked={(nodeData as ParamsVideoNodeData).audioEnabled}
                onChange={(e) => update({ audioEnabled: e.target.checked })} className="rounded" />
              <label className="text-[10px]">Audio</label>
            </div>
          </>
        )}

        {selectedModel && (
          <p className="text-[9px] text-muted-foreground">
            Modelo: <span className="text-foreground/70">{selectedModel.display_name}</span>
          </p>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_PARAMS}
        className="!w-3 !h-3 !border-2 !border-background"
        style={{ backgroundColor: "#fc0" }}
        title="Params output"
      />
    </div>
  );
});
