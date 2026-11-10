"use client";

// Nodo Personaje: ADN + estilo global por sus entradas y etapas (edades,
// épocas…) definidas dentro del nodo. "Generar etapas" crea/actualiza una
// imagen por etapa (ver lib/character.ts).

import { memo, useCallback, useState } from "react";
import { Handle, Position, useHandleConnections, useStore, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, Check, Dna, ImageIcon, Loader2, Palette, Plus, Trash2, UserRound, Wand2 } from "lucide-react";
import {
  HANDLE_IDS,
  MAX_CHARACTER_STAGES,
  topHandleId,
  type CharacterNodeData,
  type CharacterStage,
} from "../lib/canvas-types";
import { REFERENCE_SOURCE_TYPES, newStageId } from "../lib/character";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { NodeTextarea } from "./node-textarea";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";

function stopProp(e: React.SyntheticEvent) {
  e.stopPropagation();
}

const REF_TYPE_LABEL: Record<string, string> = {
  image: "Imagen",
  "static-image": "Imagen estática",
  "static-image-group": "Galería",
};

// Lista compacta de nodos que pueden ser referencia. Se compara como string
// para no re-renderizar el nodo en cada movimiento del canvas.
function selectReferenceOptions(state: { nodes: { id: string; type?: string; data: Record<string, unknown> }[] }): string {
  return JSON.stringify(
    state.nodes
      .filter((n) => n.type && REFERENCE_SOURCE_TYPES.has(n.type))
      .map((n) => [n.id, n.type, String(n.data.label ?? "")]),
  );
}

export const CharacterNodeComponent = memo(function CharacterNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as CharacterNodeData;
  const stages = nodeData.stages ?? [];
  const { updateNodeData } = useNodeUpdate();
  const { canEdit, materializeCharacter } = useCanvasContext();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  const dnaConnections = useHandleConnections({ type: "target", id: HANDLE_IDS.INPUT_CHARACTER_DNA });
  const styleConnections = useHandleConnections({ type: "target", id: HANDLE_IDS.INPUT_CHARACTER_STYLE });
  const refOptionsJson = useStore(selectReferenceOptions as never) as unknown as string;
  const ownImageIds = new Set(stages.map((s) => s.imageNodeId).filter(Boolean));
  const refOptions = (JSON.parse(refOptionsJson) as [string, string, string][]).filter(([nid]) => nid !== id);

  const setStages = useCallback(
    (next: CharacterStage[]) => updateNodeData(id, { ...nodeData, stages: next }),
    [id, nodeData, updateNodeData],
  );
  const patchStage = (stageId: string, patch: Partial<CharacterStage>) =>
    setStages(stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
  };
  const addStage = () => {
    if (stages.length >= MAX_CHARACTER_STAGES) return;
    setStages([...stages, { id: newStageId(), name: "", text: "" }]);
  };

  const generate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await materializeCharacter(id);
      setMessage(
        r.warnings.length
          ? { text: r.warnings.join(" · "), tone: "warn" }
          : { text: r.summary || "Etapas al día.", tone: "ok" },
      );
    } catch (e) {
      setMessage({ text: (e as Error).message, tone: "warn" });
    } finally {
      setBusy(false);
    }
  };

  const filledStages = stages.filter((s) => s.name.trim() || s.text.trim()).length;

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-pink-400/40 ${selected ? "ring-2 ring-pink-400/40" : ""} transition-all ${nodeSizeClass(width, height, "min-w-[340px] max-w-[460px]")}`}
    >
      {/* Entradas: ADN y estilo global (más el gemelo superior de cada una) */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_CHARACTER_DNA}
        className="!w-3 !h-3 !bg-pink-400 !border-2 !border-background"
        style={{ top: 70 }}
        title="ADN del personaje (texto)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_CHARACTER_STYLE}
        className="!w-3 !h-3 !bg-blue-400 !border-2 !border-background"
        style={{ top: 96 }}
        title="Estilo global (texto)"
      />
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_CHARACTER_DNA)}
        className="!w-3 !h-3 !bg-pink-400 !border-2 !border-background"
        style={{ left: "35%" }}
        title="ADN del personaje (texto)"
      />
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_CHARACTER_STYLE)}
        className="!w-3 !h-3 !bg-blue-400 !border-2 !border-background"
        style={{ left: "65%" }}
        title="Estilo global (texto)"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <UserRound className="h-3.5 w-3.5 text-pink-400 shrink-0" />
        <NodeLabel
          value={nodeData.label || ""}
          placeholder="Personaje"
          onChange={(label) => updateNodeData(id, { ...nodeData, label })}
        />
        <span className="text-[9px] px-1 py-0.5 rounded bg-pink-400/15 text-pink-300 shrink-0">
          {filledStages} {filledStages === 1 ? "etapa" : "etapas"}
        </span>
        <NodeDeleteButton nodeId={id} />
      </div>

      <div className="px-3 py-2 space-y-2">
        {/* Estado de las entradas */}
        <div className="space-y-0.5 text-[10px]">
          <div className={`flex items-center gap-1 ${dnaConnections.length ? "text-pink-300" : "text-muted-foreground"}`}>
            <Dna className="h-3 w-3" />
            {dnaConnections.length ? "ADN conectado" : "Conecta un texto con el ADN (rasgos permanentes)"}
          </div>
          <div className={`flex items-center gap-1 ${styleConnections.length ? "text-blue-300" : "text-muted-foreground"}`}>
            <Palette className="h-3 w-3" />
            {styleConnections.length ? "Estilo global conectado" : "Estilo global (opcional): estilo, colores…"}
          </div>
        </div>

        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
          Etapas · de la más antigua a la más reciente
        </div>

        {stages.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            Agrega etapas (por ejemplo 5 años, 15 años, 35 años). Cada una genera su imagen.
          </p>
        )}

        <div className="space-y-2">
          {stages.map((stage, i) => (
            <div key={stage.id} className="rounded-lg border border-border/60 bg-muted/20 p-2 space-y-1.5">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                <input
                  value={stage.name}
                  onChange={(e) => patchStage(stage.id, { name: e.target.value })}
                  onKeyDown={stopProp}
                  disabled={!canEdit}
                  placeholder="Nombre de la etapa (ej. 12 años)"
                  className="nodrag min-w-0 flex-1 bg-transparent text-xs font-medium outline-none placeholder:text-muted-foreground/50"
                />
                {stage.imageNodeId && (
                  <span title="Ya tiene su nodo imagen" className="text-emerald-400">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                {canEdit && (
                  <>
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Más antigua" className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1} title="Más reciente" className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={() => setStages(stages.filter((s) => s.id !== stage.id))} title="Borrar etapa" className="nodrag p-0.5 text-muted-foreground hover:text-red-400">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
              <NodeTextarea
                value={stage.text}
                onChange={(text) => patchStage(stage.id, { text })}
                onKeyDown={stopProp}
                disabled={!canEdit}
                placeholder="Cómo es el personaje en esta etapa: edad, ropa, pelo, contexto…"
                className="nodrag w-full text-xs bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[52px] max-h-[200px] placeholder:text-muted-foreground/50"
                rows={2}
              />
              <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ImageIcon className="h-3 w-3 shrink-0" />
                <select
                  value={stage.referenceNodeId ?? ""}
                  onChange={(e) => patchStage(stage.id, { referenceNodeId: e.target.value || undefined })}
                  onKeyDown={stopProp}
                  disabled={!canEdit}
                  className="nodrag min-w-0 flex-1 bg-muted/40 rounded px-1 py-0.5 text-[10px] text-foreground outline-none"
                >
                  <option value="">Sin referencia propia</option>
                  {refOptions
                    .filter(([nid]) => nid !== stage.imageNodeId)
                    .map(([nid, type, label]) => (
                      <option key={nid} value={nid}>
                        {label || REF_TYPE_LABEL[type] || nid}
                        {ownImageIds.has(nid) ? " (etapa)" : ""} · {REF_TYPE_LABEL[type] ?? type}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={addStage}
              disabled={stages.length >= MAX_CHARACTER_STAGES}
              className="nodrag flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md bg-muted/40 hover:bg-muted/70 disabled:opacity-40"
            >
              <Plus className="h-3 w-3" /> Agregar etapa
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy || filledStages === 0}
              className="nodrag flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md bg-pink-500/20 text-pink-200 hover:bg-pink-500/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              Generar etapas
            </button>
          </div>
        )}
        {message && (
          <p className={`text-[10px] ${message.tone === "ok" ? "text-emerald-400" : "text-amber-300"}`}>{message.text}</p>
        )}
        <p className="text-[9px] text-muted-foreground">
          Crea una imagen por etapa. Cada una recibe ADN + estilo + su texto, su referencia (prioridad 1) y la imagen de la
          etapa más reciente siguiente, para mantener la continuidad. Luego ejecútalas con RUN.
        </p>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_CHARACTER}
        className="!w-3 !h-3 !bg-pink-400 !border-2 !border-background"
        title="Etapas → imágenes"
      />
      <ResizeHandle minWidth={320} minHeight={200} />
    </div>
  );
});
