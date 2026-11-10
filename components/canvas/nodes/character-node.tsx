"use client";

// Nodo Personaje: ADN escrito en el nodo, estilo global por una entrada de
// texto (compartible entre Personajes), galerías de referencia por otra
// entrada, y etapas (edades, épocas…) con su texto y las fotos elegidas de
// esas galerías. "Generar etapas" crea/actualiza una imagen por etapa (ver
// lib/character.ts).

import { memo, useCallback, useMemo, useState } from "react";
import { Handle, Position, useHandleConnections, useStore, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, Check, Dna, Images, Loader2, Palette, Plus, Trash2, UserRound, Wand2 } from "lucide-react";
import {
  HANDLE_IDS,
  MAX_CHARACTER_STAGES,
  topHandleId,
  type CharacterNodeData,
  type CharacterReferenceImage,
  type CharacterStage,
} from "../lib/canvas-types";
import { galleryImagesOf, newStageId } from "../lib/character";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { NodeTextarea } from "./node-textarea";
import { ResizeHandle, nodeSizeClass } from "./resize-handle";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";

function stopProp(e: React.SyntheticEvent) {
  e.stopPropagation();
}

interface GalleryPhoto {
  nodeId: string;
  galleryLabel: string;
  url: string;
  caption?: string;
}

export const CharacterNodeComponent = memo(function CharacterNode({ id, data, selected, width, height }: NodeProps) {
  const nodeData = data as unknown as CharacterNodeData;
  const stages = nodeData.stages ?? [];
  const { updateNodeData } = useNodeUpdate();
  const { canEdit, materializeCharacter } = useCanvasContext();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "warn" } | null>(null);

  const styleConnections = useHandleConnections({ type: "target", id: HANDLE_IDS.INPUT_CHARACTER_STYLE });
  const galleryConnections = useHandleConnections({ type: "target", id: HANDLE_IDS.INPUT_CHARACTER_GALLERY });
  const galleryIdsKey = galleryConnections.map((c) => c.source).join(",");

  // Fotos de las galerías conectadas, como string para no re-renderizar el
  // nodo en cada movimiento del canvas.
  const photosJson = useStore(
    useCallback(
      (state: { nodeLookup: Map<string, { id: string; type?: string; data: Record<string, unknown> }> }) => {
        const out: GalleryPhoto[] = [];
        for (const gid of galleryIdsKey ? galleryIdsKey.split(",") : []) {
          const n = state.nodeLookup.get(gid);
          if (!n) continue;
          const label = String(n.data.label ?? "Galería");
          for (const img of galleryImagesOf(n)) out.push({ nodeId: n.id, galleryLabel: label, url: img.url, caption: img.caption });
        }
        return JSON.stringify(out);
      },
      [galleryIdsKey],
    ) as never,
  ) as unknown as string;
  const photos = useMemo(() => JSON.parse(photosJson) as GalleryPhoto[], [photosJson]);

  const update = useCallback(
    (patch: Partial<CharacterNodeData>) => updateNodeData(id, { ...nodeData, ...patch }),
    [id, nodeData, updateNodeData],
  );
  const setStages = (next: CharacterStage[]) => update({ stages: next });
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
  const togglePhoto = (stage: CharacterStage, photo: GalleryPhoto) => {
    const current = stage.referenceImages ?? [];
    const has = current.some((r) => r.nodeId === photo.nodeId && r.url === photo.url);
    const next: CharacterReferenceImage[] = has
      ? current.filter((r) => !(r.nodeId === photo.nodeId && r.url === photo.url))
      : [...current, { nodeId: photo.nodeId, url: photo.url }];
    patchStage(stage.id, { referenceImages: next });
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
      className={`group bg-card rounded-xl border-2 border-pink-400/40 ${selected ? "ring-2 ring-pink-400/40" : ""} transition-all ${nodeSizeClass(width, height, "min-w-[360px] max-w-[480px]")}`}
    >
      {/* Entradas: estilo global y galerías de referencia (más sus gemelos superiores) */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_CHARACTER_STYLE}
        className="!w-3 !h-3 !bg-blue-400 !border-2 !border-background"
        style={{ top: 60 }}
        title="Estilo global (texto)"
      />
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_CHARACTER_GALLERY}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
        style={{ top: 84 }}
        title="Galerías o imágenes de referencia"
      />
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_CHARACTER_STYLE)}
        className="!w-3 !h-3 !bg-blue-400 !border-2 !border-background"
        style={{ left: "35%" }}
        title="Estilo global (texto)"
      />
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_CHARACTER_GALLERY)}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-background"
        style={{ left: "65%" }}
        title="Galerías o imágenes de referencia"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <UserRound className="h-3.5 w-3.5 text-pink-400 shrink-0" />
        <NodeLabel value={nodeData.label || ""} placeholder="Personaje" onChange={(label) => update({ label })} />
        <span className="text-[9px] px-1 py-0.5 rounded bg-pink-400/15 text-pink-700 dark:text-pink-300 shrink-0">
          {filledStages} {filledStages === 1 ? "etapa" : "etapas"}
        </span>
        <NodeDeleteButton nodeId={id} />
      </div>

      <div className="px-3 py-2 space-y-2">
        <div className="space-y-0.5 text-[10px]">
          <div className={`flex items-center gap-1 ${styleConnections.length ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"}`}>
            <Palette className="h-3 w-3" />
            {styleConnections.length ? "Estilo global conectado" : "Conecta un texto con el estilo global (opcional)"}
          </div>
          <div className={`flex items-center gap-1 ${galleryConnections.length ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
            <Images className="h-3 w-3" />
            {galleryConnections.length
              ? `${photos.length} ${photos.length === 1 ? "foto disponible" : "fotos disponibles"} en ${galleryConnections.length} ${galleryConnections.length === 1 ? "galería" : "galerías"}`
              : "Conecta una galería para elegir fotos de referencia por etapa"}
          </div>
        </div>

        {/* ADN */}
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
            <Dna className="h-3 w-3 text-pink-400" /> ADN del personaje
          </div>
          <NodeTextarea
            value={nodeData.dna ?? ""}
            onChange={(dna) => update({ dna })}
            onKeyDown={stopProp}
            disabled={!canEdit}
            placeholder="Rasgos que no cambian entre etapas: rostro, ojos, pelo, marcas, contextura…"
            className="nodrag w-full text-xs bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[56px] max-h-[200px] placeholder:text-muted-foreground dark:placeholder:text-muted-foreground/50"
            rows={3}
          />
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
          {stages.map((stage, i) => {
            const selectedCount = (stage.referenceImages ?? []).filter((r) => photos.some((p) => p.nodeId === r.nodeId && p.url === r.url)).length;
            return (
              <div key={stage.id} className="rounded-lg border border-border/60 bg-muted/20 p-2 space-y-1.5">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                  <input
                    value={stage.name}
                    onChange={(e) => patchStage(stage.id, { name: e.target.value })}
                    onKeyDown={stopProp}
                    disabled={!canEdit}
                    placeholder="Nombre de la etapa (ej. 12 años)"
                    className="nodrag min-w-0 flex-1 bg-transparent text-xs font-medium outline-none placeholder:text-muted-foreground dark:placeholder:text-muted-foreground/50"
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
                  className="nodrag w-full text-xs bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[52px] max-h-[200px] placeholder:text-muted-foreground dark:placeholder:text-muted-foreground/50"
                  rows={2}
                />
                {photos.length > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground">
                      {selectedCount > 0
                        ? `${selectedCount} ${selectedCount === 1 ? "foto de referencia" : "fotos de referencia"}`
                        : "Sin fotos de referencia: toca una o más para usarlas"}
                    </div>
                    <div className="nodrag nowheel flex flex-wrap gap-1 max-h-[132px] overflow-y-auto">
                      {photos.map((p) => {
                        const on = (stage.referenceImages ?? []).some((r) => r.nodeId === p.nodeId && r.url === p.url);
                        return (
                          <button
                            key={`${p.nodeId}|${p.url}`}
                            type="button"
                            disabled={!canEdit}
                            onClick={() => togglePhoto(stage, p)}
                            title={`${p.galleryLabel}${p.caption ? ` · ${p.caption}` : ""}`}
                            className={`relative h-12 w-12 rounded overflow-hidden border-2 ${on ? "border-pink-400" : "border-transparent opacity-60 hover:opacity-100"}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt={p.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
                            {on && (
                              <span className="absolute right-0.5 top-0.5 rounded-full bg-pink-500 p-px text-white">
                                <Check className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (stage.referenceImages ?? []).length > 0 ? (
                  <div className="text-[10px] text-amber-700 dark:text-amber-300">
                    Las fotos elegidas ya no están en una galería conectada.
                  </div>
                ) : null}
              </div>
            );
          })}
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
              className="nodrag flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-md bg-pink-500/20 text-pink-700 dark:text-pink-200 hover:bg-pink-500/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              Generar etapas
            </button>
          </div>
        )}
        {message && (
          <p className={`text-[10px] ${message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}`}>{message.text}</p>
        )}
        <p className="text-[9px] text-muted-foreground">
          Crea una imagen por etapa. Cada una recibe ADN + estilo + su texto, sus fotos (prioridad 1) y la imagen de la
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
      <ResizeHandle minWidth={340} minHeight={220} />
    </div>
  );
});
