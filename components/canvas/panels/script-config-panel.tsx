"use client";

import { X, Trash2, Lock, Unlock, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Node } from "@xyflow/react";
import type { CanvasNodeData, ScriptNodeData } from "../lib/canvas-types";
import type { CanvasGenerationConfig } from "../canvas-workspace";
import { useCanvasContext } from "../canvas-context";

interface ScriptConfigPanelProps {
  node: Node;
  generationConfig: CanvasGenerationConfig[];
  edges: Array<{ source: string; target: string }>;
  onUpdateData: (nodeId: string, updates: Partial<CanvasNodeData>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

export function ScriptConfigPanel({
  node,
  generationConfig,
  edges,
  onUpdateData,
  onDelete,
  onClose,
}: ScriptConfigPanelProps) {
  const { canEdit } = useCanvasContext();
  const data = node.data as unknown as ScriptNodeData;
  const isLocked = data.locked === true;

  // Modelos del Guión: usa los disponibles para text generation
  const textConfig = generationConfig.find((c) => c.generation_type === "text");
  const availableModels = textConfig?.models || [];

  const selectedModel = data.modelId
    ? availableModels.find((m) => m.id === data.modelId)
    : availableModels.find((m) => m.is_default) || availableModels[0];

  const supportsThinking = selectedModel?.model_id?.startsWith("gemini-3.1-pro") ?? false;

  const analysis = data.scriptAnalysis;
  const generalInfo = analysis?.generalInfo;

  return (
    <div className="w-[360px] h-full border-l border-border bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Sparkles className="h-4 w-4 text-fuchsia-400" />
        <span className="text-sm font-medium flex-1">Configurar Guión</span>
        {canEdit && (
          <>
            <button
              onClick={() => onUpdateData(node.id, { locked: !isLocked } as Partial<CanvasNodeData>)}
              className={`p-1 rounded transition-colors ${
                isLocked
                  ? "text-amber-500 bg-amber-500/10"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={isLocked ? "Desbloquear nodo" : "Bloquear nodo"}
            >
              {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => {
                const connected = edges.some((e) => e.source === node.id || e.target === node.id);
                const msg = connected
                  ? "Este Guión tiene escenas conectadas. Al eliminarlo se borrarán también todas las escenas y nodos aguas abajo. ¿Continuar?"
                  : "¿Eliminar el Guión?";
                if (!window.confirm(msg)) return;
                onDelete(node.id);
                onClose();
              }}
              className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Eliminar Guión"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLocked && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-500 text-xs">
          <Lock className="h-3 w-3" /> Nodo bloqueado
        </div>
      )}
      {!canEdit && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground text-xs">
          <Lock className="h-3 w-3" /> Solo lectura
        </div>
      )}

      <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${isLocked ? "opacity-50 pointer-events-none" : !canEdit ? "pointer-events-none" : ""}`}>
        {/* Model selector */}
        {availableModels.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Modelo (para leer guion)</Label>
            <select
              value={data.modelId || ""}
              onChange={(e) => {
                const modelId = e.target.value ? Number(e.target.value) : undefined;
                const model = modelId
                  ? availableModels.find((m) => m.id === modelId)
                  : availableModels.find((m) => m.is_default) || availableModels[0];
                onUpdateData(node.id, {
                  modelId,
                  modelName: model?.display_name,
                } as Partial<CanvasNodeData>);
              }}
              className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">
                {availableModels.find((m) => m.is_default)?.display_name ||
                  availableModels[0]?.display_name ||
                  "Auto"}{" "}
                (default)
              </option>
              {availableModels
                .filter((m) => !m.is_default)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
            </select>
            {selectedModel && (
              <p className="text-[10px] text-muted-foreground">
                Usando:{" "}
                <span className="font-medium text-foreground/70">{selectedModel.display_name}</span>
                {selectedModel.api_backend && (
                  <span className="ml-1 opacity-60">({selectedModel.api_backend})</span>
                )}
              </p>
            )}
          </div>
        )}

        {/* Thinking level */}
        {supportsThinking && (
          <div className="space-y-1.5">
            <Label className="text-xs">Razonamiento</Label>
            <div className="flex gap-1.5 flex-wrap">
              {(
                [
                  { value: "none", label: "Off" },
                  { value: "low", label: "Bajo" },
                  { value: "medium", label: "Medio" },
                  { value: "high", label: "Alto" },
                ] as const
              ).map((level) => (
                <button
                  key={level.value}
                  onClick={() =>
                    onUpdateData(node.id, { thinkingLevel: level.value } as Partial<CanvasNodeData>)
                  }
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
          </div>
        )}

        {/* Temperature & Max tokens */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Temperature</Label>
            <Input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={data.temperature ?? 0.4}
              onChange={(e) =>
                onUpdateData(node.id, {
                  temperature: parseFloat(e.target.value),
                } as Partial<CanvasNodeData>)
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Max Tokens</Label>
            <Input
              type="number"
              min={1024}
              max={1000000}
              value={data.maxOutputTokens ?? 16384}
              onChange={(e) =>
                onUpdateData(node.id, {
                  maxOutputTokens: parseInt(e.target.value),
                } as Partial<CanvasNodeData>)
              }
              className="h-8 text-sm"
            />
          </div>
        </div>

        {/* Additional system instruction */}
        <div className="space-y-1.5">
          <Label className="text-xs">Instrucciones adicionales</Label>
          <Textarea
            value={data.systemInstruction || ""}
            onChange={(e) =>
              onUpdateData(node.id, { systemInstruction: e.target.value } as Partial<CanvasNodeData>)
            }
            placeholder="Notas extra para el modelo al leer el guion (opcional). El sistema base ya prohíbe modificar el texto."
            className="text-sm min-h-[60px] resize-y"
          />
        </div>

        {/* Analysis summary (read-only) */}
        {analysis && generalInfo && (
          <div className="space-y-1.5 pt-2 border-t border-border/40">
            <Label className="text-xs">Análisis actual</Label>
            <div className="bg-muted/30 rounded-md p-3 space-y-1.5 text-xs">
              {generalInfo.synopsis && (
                <div>
                  <span className="text-muted-foreground">Sinopsis: </span>
                  <span>{generalInfo.synopsis}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {generalInfo.tone && (
                  <span className="px-1.5 py-0.5 rounded bg-background text-[10px]">
                    Tono: {generalInfo.tone}
                  </span>
                )}
                {generalInfo.genre && (
                  <span className="px-1.5 py-0.5 rounded bg-background text-[10px]">
                    Género: {generalInfo.genre}
                  </span>
                )}
                {generalInfo.visualStyle && (
                  <span className="px-1.5 py-0.5 rounded bg-background text-[10px]">
                    Estilo: {generalInfo.visualStyle}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground pt-1">
                {analysis.scenes.length} escena(s) · modelo {analysis.modelUsed} ·{" "}
                {new Date(analysis.analyzedAt).toLocaleString("es-CL")}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
