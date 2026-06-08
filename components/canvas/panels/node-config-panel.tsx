"use client";

import { X, Play, Trash2, MessageSquare, ImageIcon, Video, Loader2, Lock, Unlock, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Node } from "@xyflow/react";
import type { CanvasNodeData, TextNodeData, ImageNodeData, VideoNodeData, HANDLE_IDS } from "../lib/canvas-types";
import { HANDLE_IDS as HANDLES, baseHandleId } from "../lib/canvas-types";
import type { CanvasGenerationConfig, CanvasModel } from "../canvas-workspace";
import { getVideoCapabilities, reconcileVideoSettings, veoForcesEightSeconds } from "../lib/video-capabilities";

interface NodeConfigPanelProps {
  node: Node;
  nodes: Node[];
  generationConfig: CanvasGenerationConfig[];
  edges: Array<{ source: string; target: string; targetHandle?: string | null }>;
  onUpdateData: (nodeId: string, updates: Partial<CanvasNodeData>) => void;
  onDelete: (nodeId: string) => void;
  onExecute: (nodeId: string) => void;
  isExecuting: boolean;
  onClose: () => void;
}

const typeIcons = {
  text: MessageSquare,
  image: ImageIcon,
  video: Video,
};

const typeColors = {
  text: "text-blue-400",
  image: "text-purple-400",
  video: "text-amber-400",
};

// Map node type to generation_type for config lookup
const typeToGenType: Record<string, string> = {
  text: "text",
  image: "image",
  video: "video",
};

export function NodeConfigPanel({
  node,
  nodes,
  generationConfig,
  edges,
  onUpdateData,
  onDelete,
  onExecute,
  isExecuting,
  onClose,
}: NodeConfigPanelProps) {
  const data = node.data as unknown as CanvasNodeData;
  const type = node.type as "text" | "image" | "video";
  const Icon = typeIcons[type] || MessageSquare;
  const isGenerating = data.status === "generating";
  const isLocked = data.locked === true;

  // Check if a params node is connected (handle can come in from the left or top twin)
  const paramsEdge = edges.find((e) => e.target === node.id && baseHandleId(e.targetHandle) === HANDLES.INPUT_PARAMS);
  const paramsNode = paramsEdge ? nodes.find((n) => n.id === paramsEdge.source) : null;
  const paramsData = paramsNode?.data as Record<string, unknown> | null;
  const hasParams = !!paramsData;
  const isReadOnly = isLocked || hasParams;

  // Get models for this node type from generation config
  const genType = typeToGenType[type];
  const typeConfig = generationConfig.find((c) => c.generation_type === genType);
  const availableModels = typeConfig?.models || [];

  // Resolve current model name
  const nodeData = data as TextNodeData | ImageNodeData | VideoNodeData;
  const selectedModel = nodeData.modelId
    ? availableModels.find((m) => m.id === nodeData.modelId)
    : availableModels.find((m) => m.is_default) || availableModels[0];

  // Video nodes: detect image inputs that make the Gemini API force 8s, so the
  // duration picker can disable 4s/6s instead of silently overriding the choice.
  const videoInputEdges = edges.filter((e) => e.target === node.id);
  const hasInterpolation =
    videoInputEdges.some((e) => baseHandleId(e.targetHandle) === HANDLES.INPUT_FIRST_FRAME) &&
    videoInputEdges.some((e) => baseHandleId(e.targetHandle) === HANDLES.INPUT_LAST_FRAME);
  const hasReference = videoInputEdges.some((e) => baseHandleId(e.targetHandle) === HANDLES.INPUT_REFERENCE);

  return (
    <div className="w-[360px] h-full border-l border-border bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Icon className={`h-4 w-4 ${typeColors[type]}`} />
        <span className="text-sm font-medium flex-1">Configurar {type === "text" ? "Texto" : type === "image" ? "Imagen" : "Video"}</span>
        <button
          onClick={() => onUpdateData(node.id, { locked: !isLocked } as Partial<CanvasNodeData>)}
          className={`p-1 rounded transition-colors ${isLocked ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-foreground"}`}
          title={isLocked ? "Desbloquear nodo" : "Bloquear nodo"}
        >
          {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => {
            const connected = edges.some((e) => e.source === node.id || e.target === node.id);
            if (connected && !window.confirm("Este nodo tiene conexiones. ¿Eliminar?")) return;
            onDelete(node.id);
            onClose();
          }}
          className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Eliminar nodo"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Locked banner */}
      {isLocked && !hasParams && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-500 text-xs">
          <Lock className="h-3 w-3" /> Nodo bloqueado
        </div>
      )}
      {/* Params connected banner */}
      {hasParams && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ backgroundColor: "rgba(255,204,0,0.1)", color: "#fc0" }}>
          <Settings className="h-3 w-3" /> Parámetros externos ({paramsNode?.data ? (paramsNode.data as Record<string,unknown>).label as string : "Params"})
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${isLocked ? "opacity-50 pointer-events-none" : ""}`}>
        {/* Prompt - always editable (unless locked) */}
        <div className="space-y-1.5">
          <Label className="text-xs">Prompt</Label>
          <Textarea
            value={nodeData.prompt || ""}
            onChange={(e) => onUpdateData(node.id, { prompt: e.target.value } as Partial<CanvasNodeData>)}
            placeholder="Escribe el prompt..."
            className="text-sm min-h-[80px] resize-y"
          />
        </div>

        {/* Negative prompt - always editable for image/video (unless locked) */}
        {(type === "image" || type === "video") && (
          <div className="space-y-1.5">
            <Label className="text-xs">Negative Prompt</Label>
            <Textarea
              value={(nodeData as ImageNodeData | VideoNodeData).negativePrompt || ""}
              onChange={(e) => onUpdateData(node.id, { negativePrompt: e.target.value } as Partial<CanvasNodeData>)}
              placeholder="Lo que no quieres en la generación (opcional)"
              className="text-sm min-h-[50px] resize-y"
            />
          </div>
        )}

        {/* Settings section - hidden when params connected, disabled when locked */}
        {!hasParams && (
          <>
            {/* Model selector */}
            {availableModels.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Modelo</Label>
                <select
                  value={nodeData.modelId || ""}
                  onChange={(e) => {
                    const modelId = e.target.value ? Number(e.target.value) : undefined;
                    const model = modelId ? availableModels.find((m) => m.id === modelId) : (availableModels.find((m) => m.is_default) || availableModels[0]);
                    const patch: Partial<CanvasNodeData> = { modelId, modelName: model?.display_name } as Partial<CanvasNodeData>;
                    // For video nodes: snap duration/aspect/resolution to a valid combo for the new model.
                    if (type === "video") {
                      const caps = getVideoCapabilities(model);
                      const videoData = data as VideoNodeData;
                      const reconciled = reconcileVideoSettings(
                        { duration: videoData.duration, aspectRatio: videoData.aspectRatio, resolution: videoData.resolution },
                        caps,
                      );
                      Object.assign(patch, reconciled);
                    }
                    onUpdateData(node.id, patch);
                  }}
                  className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">
                    {availableModels.find((m) => m.is_default)?.display_name || availableModels[0]?.display_name || "Auto"} (default)
                  </option>
                  {availableModels.filter((m) => !m.is_default).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
                {selectedModel && (
                  <p className="text-[10px] text-muted-foreground">
                    Usando: <span className="font-medium text-foreground/70">{selectedModel.display_name}</span>
                    {selectedModel.api_backend && <span className="ml-1 opacity-60">({selectedModel.api_backend})</span>}
                  </p>
                )}
              </div>
            )}

            {/* Type-specific settings */}
            {type === "text" && <TextSettings data={data as TextNodeData} onUpdate={(u) => onUpdateData(node.id, u as Partial<CanvasNodeData>)} models={availableModels} />}
            {type === "image" && <ImageSettings data={data as ImageNodeData} onUpdate={(u) => onUpdateData(node.id, u as Partial<CanvasNodeData>)} />}
            {type === "video" && <VideoSettings data={data as VideoNodeData} model={selectedModel} hasInterpolation={hasInterpolation} hasReference={hasReference} onUpdate={(u) => onUpdateData(node.id, u as Partial<CanvasNodeData>)} />}
          </>
        )}

        {/* Output preview */}
        {data.status === "completed" && (
          <div className="space-y-1.5">
            <Label className="text-xs">Resultado</Label>
            {type === "text" && (data as TextNodeData).outputText && (
              <div className="bg-muted/50 rounded-md p-3 text-xs max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                {(data as TextNodeData).outputText}
              </div>
            )}
            {type === "image" && (data as ImageNodeData).outputUrl && (
              <img
                src={(data as ImageNodeData).outputUrl}
                alt="Generated"
                className="w-full rounded-md"
              />
            )}
            {type === "video" && (data as VideoNodeData).outputUrl && (
              <video
                src={(data as VideoNodeData).outputUrl}
                controls
                className="w-full rounded-md"
              />
            )}
          </div>
        )}

        {data.status === "error" && data.errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 text-xs text-red-400">
            {data.errorMessage}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
        <Button
          size="sm"
          onClick={() => onExecute(node.id)}
          disabled={isGenerating || isExecuting || isLocked}
          title={hasParams ? "Ejecutar con parámetros externos" : undefined}
          className="flex-1 gap-1.5"
        >
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isGenerating ? "Generando..." : "Generar"}
        </Button>
      </div>
    </div>
  );
}

// --- Type-specific settings ---

function TextSettings({ data, onUpdate, models }: { data: TextNodeData; onUpdate: (u: Partial<TextNodeData>) => void; models: CanvasModel[] }) {
  // Check if selected model supports thinking (gemini-3.1-pro)
  const selectedModel = data.modelId
    ? models.find((m) => m.id === data.modelId)
    : models.find((m) => m.is_default) || models[0];
  const supportsThinking = selectedModel?.model_id?.startsWith("gemini-3.1-pro") ?? false;

  return (
    <>
      {/* Output as prompt toggle */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Modo de salida</Label>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => onUpdate({ outputAsPrompt: true })}
            className={`flex-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
              data.outputAsPrompt !== false
                ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                : "border-border hover:bg-accent"
            }`}
          >
            Prompt
          </button>
          <button
            onClick={() => onUpdate({ outputAsPrompt: false })}
            className={`flex-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
              data.outputAsPrompt === false
                ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                : "border-border hover:bg-accent"
            }`}
          >
            Libre
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {data.outputAsPrompt !== false
            ? "El modelo responderá solo con un prompt limpio para nodos downstream"
            : "El modelo responderá libremente sin restricción de formato"}
        </p>
      </div>

      {/* Reasoning / Thinking level */}
      {supportsThinking && (
        <div className="space-y-1.5">
          <Label className="text-xs">Razonamiento</Label>
          <div className="flex gap-1.5 flex-wrap">
            {([
              { value: "none", label: "Off" },
              { value: "low", label: "Bajo" },
              { value: "medium", label: "Medio" },
              { value: "high", label: "Alto" },
            ] as const).map((level) => (
              <button
                key={level.value}
                onClick={() => onUpdate({ thinkingLevel: level.value })}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  (data.thinkingLevel || "none") === level.value
                    ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                    : "border-border hover:bg-accent"
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>
          {data.thinkingLevel && data.thinkingLevel !== "none" && (
            <p className="text-[10px] text-purple-400/70">
              {data.thinkingLevel === "low" ? "~1K tokens" : data.thinkingLevel === "medium" ? "~8K tokens" : "~24K tokens"} de razonamiento
            </p>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">System Instruction</Label>
        <Textarea
          value={data.systemInstruction || ""}
          onChange={(e) => onUpdate({ systemInstruction: e.target.value })}
          placeholder="Instrucciones del sistema (opcional)"
          className="text-sm min-h-[60px] resize-y"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Temperature</Label>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={data.temperature ?? 1.0}
            onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Max Tokens</Label>
          <Input
            type="number"
            min={1}
            max={1000000}
            value={data.maxOutputTokens ?? 8192}
            onChange={(e) => onUpdate({ maxOutputTokens: parseInt(e.target.value) })}
            className="h-8 text-sm"
          />
        </div>
      </div>
    </>
  );
}

function ImageSettings({ data, onUpdate }: { data: ImageNodeData; onUpdate: (u: Partial<ImageNodeData>) => void }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Aspect Ratio</Label>
        <div className="flex gap-1.5 flex-wrap">
          {["16:9", "9:16", "1:1", "4:3", "3:4"].map((ar) => (
            <button
              key={ar}
              onClick={() => onUpdate({ aspectRatio: ar })}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                data.aspectRatio === ar
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {ar}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Resolution</Label>
        <div className="flex gap-1.5">
          {["1K", "2K", "4K"].map((res) => (
            <button
              key={res}
              onClick={() => onUpdate({ resolution: res })}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                data.resolution === res
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {res}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function VideoSettings({ data, model, hasInterpolation, hasReference, onUpdate }: { data: VideoNodeData; model?: CanvasModel; hasInterpolation?: boolean; hasReference?: boolean; onUpdate: (u: Partial<VideoNodeData>) => void }) {
  // Options come from per-model capabilities so each backend (VEO / xAI / Kling /
  // OpenRouter Seedance) shows only the values it can actually accept.
  const caps = getVideoCapabilities(model);
  // VEO-specific quirk: 1080p / 4K only work at 8s.
  const isVeo = !model?.api_backend || model.api_backend === "gemini" || model.api_backend === "vertex";

  // VEO on the Gemini API silently forces 8s with 1080p/4K, reference images or
  // first+last interpolation. Surface that here so 4s/6s are clearly unavailable
  // instead of being accepted and overridden behind the user's back.
  const forced8s = veoForcesEightSeconds(model, { resolution: data.resolution, hasInterpolation, hasReference });
  const forced8sLabel =
    forced8s === "resolution" ? `${data.resolution} obliga a 8s`
    : forced8s === "interpolation" ? "first + last frame obliga a 8s"
    : forced8s === "reference" ? "las imágenes de referencia obligan a 8s"
    : null;
  // When 8s is forced, show 8s as the effective selection regardless of the
  // stored value (the backend will generate 8s anyway).
  const effectiveDuration = forced8s ? 8 : data.duration;

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Duration</Label>
        <div className="flex gap-1.5 flex-wrap">
          {caps.durations.map((d) => {
            const disabled = !!forced8s && d !== 8;
            return (
              <button
                key={d}
                disabled={disabled}
                onClick={() => { if (!disabled) onUpdate({ duration: d }); }}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  effectiveDuration === d
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-accent"
                } ${disabled ? "opacity-40 cursor-not-allowed hover:bg-transparent" : ""}`}
                title={disabled && forced8sLabel ? `No disponible: ${forced8sLabel} (Veo en Gemini API)` : undefined}
              >
                {d}s
              </button>
            );
          })}
        </div>
        {forced8sLabel && (
          <p className="text-[10px] text-amber-500">En Veo (Gemini API), {forced8sLabel}. 4s/6s solo en 720p sin imágenes.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Aspect Ratio</Label>
        <div className="flex gap-1.5 flex-wrap">
          {caps.aspectRatios.map((ar) => (
            <button
              key={ar}
              onClick={() => onUpdate({ aspectRatio: ar })}
              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                data.aspectRatio === ar
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:bg-accent"
              }`}
            >
              {ar}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Resolution</Label>
        <div className="flex gap-1.5 flex-wrap">
          {caps.resolutions.map((res) => {
            const needsDuration8 = isVeo && (res === "1080p" || res === "4K");
            return (
              <button
                key={res}
                onClick={() => {
                  const updates: Partial<VideoNodeData> = { resolution: res };
                  if (needsDuration8 && data.duration !== 8) updates.duration = 8;
                  onUpdate(updates);
                }}
                className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                  data.resolution === res
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border hover:bg-accent"
                }`}
                title={needsDuration8 ? "Solo disponible con duración de 8s" : undefined}
              >
                {res}{needsDuration8 ? " (8s)" : ""}
              </button>
            );
          })}
          {data.resolution && !caps.resolutions.includes(data.resolution) && (
            <p className="text-[10px] text-amber-500 mt-1">Resolución no soportada por este modelo, selecciona otra</p>
          )}
        </div>
      </div>
      {caps.supportsAudio && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.audioEnabled}
            onChange={(e) => onUpdate({ audioEnabled: e.target.checked })}
            id="audio-enabled"
            className="rounded"
          />
          <Label htmlFor="audio-enabled" className="text-xs">Audio habilitado</Label>
        </div>
      )}
    </>
  );
}
