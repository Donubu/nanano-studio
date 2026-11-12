"use client";

// Nodo Personaje: ADN escrito en el nodo, estilo global por una entrada de
// texto (compartible entre Personajes), galerías de referencia por otra
// entrada, y etapas (edades, épocas…) con su texto y las fotos elegidas de
// esas galerías. "Generar etapas" crea/actualiza una imagen por etapa (ver
// lib/character.ts).

import { memo, useCallback, useMemo, useState } from "react";
import { Handle, Position, useHandleConnections, useStore, type NodeProps } from "@xyflow/react";
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, Dna, GripVertical, Images, Loader2, Palette, Plus, Trash2, UserRound, Wand2 } from "lucide-react";
import {
  HANDLE_IDS,
  MAX_CHARACTER_STAGES,
  topHandleId,
  type CharacterNodeData,
  type CharacterReferenceImage,
  type CharacterStage,
} from "../lib/canvas-types";
import { externalConnections, newStageId, stagesAsText } from "../lib/character";
import { nodeImages, type OutEdge } from "../lib/node-outputs";
import { NodeDeleteButton } from "./node-status";
import { NodeLabel } from "./node-label";
import { NodeTextarea } from "./node-textarea";
import { ResizeHandle, nodeSizeClass, useHasFixedSize } from "./resize-handle";
import { useNodeUpdate } from "../hooks/use-node-update";
import { useCanvasContext } from "../canvas-context";
import { thumbUrl } from "../lib/thumb";

function stopProp(e: React.SyntheticEvent) {
  e.stopPropagation();
}

interface GalleryPhoto {
  nodeId: string;
  galleryLabel: string;
  url: string;
  caption?: string;
}

export const CharacterNodeComponent = memo(function CharacterNode({ id, data, selected }: NodeProps) {
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
      (state: { nodeLookup: Map<string, { id: string; type?: string; data: Record<string, unknown> }>; edges: OutEdge[] }) => {
        const out: GalleryPhoto[] = [];
        const lookup = (nid: string) => state.nodeLookup.get(nid);
        for (const gid of galleryIdsKey ? galleryIdsKey.split(",") : []) {
          const n = state.nodeLookup.get(gid);
          if (!n) continue;
          const label = String(n.data.label ?? "Galería");
          // Incluye las imágenes conectadas a la galería (node-outputs).
          for (const img of nodeImages(n, lookup, state.edges)) out.push({ nodeId: n.id, galleryLabel: label, url: img.url, caption: img.caption });
        }
        return JSON.stringify(out);
      },
      [galleryIdsKey],
    ) as never,
  ) as unknown as string;
  const photos = useMemo(() => JSON.parse(photosJson) as GalleryPhoto[], [photosJson]);
  // Tamaño fijo = el usuario lo redimensionó (width/height explícitos en el
  // nodo). Las props width/height también llegan con la medida automática,
  // así que no sirven para distinguirlo.
  // Por etapa: nodos conectados por el usuario a su imagen (los que puso
  // "Generar etapas" no cuentan). Borrar esa etapa sin avisar rompería el flujo.
  const managedKey = (nodeData.managedEdgeIds ?? []).join(",");
  const stageLinksJson = useStore(
    useCallback(
      (state: {
        edges: { id: string; source: string; target: string }[];
        nodeLookup: Map<string, { type?: string; data: Record<string, unknown> }>;
      }) => {
        const out: Record<string, string[]> = {};
        for (const st of stages) {
          if (!st.imageNodeId) continue;
          const ids = externalConnections(st.imageNodeId, id, { managedEdgeIds: managedKey ? managedKey.split(",") : [] }, state.edges);
          if (ids.length) out[st.id] = ids.map((nid) => String(state.nodeLookup.get(nid)?.data.label || nid));
        }
        return JSON.stringify(out);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [id, managedKey, stages.map((st) => `${st.id}:${st.imageNodeId ?? ""}`).join("|")],
    ) as never,
  ) as unknown as string;
  const stageLinks = useMemo(() => JSON.parse(stageLinksJson) as Record<string, string[]>, [stageLinksJson]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const removeStage = (stageId: string) => {
    setPendingDelete(null);
    update({ stages: stages.filter((st) => st.id !== stageId), ...(stages.some((st) => st.imageNodeId) ? { chainStale: true } : {}) });
  };

  const hasFixedSize = useHasFixedSize(id);

  const update = useCallback(
    (patch: Partial<CharacterNodeData>) => updateNodeData(id, { ...nodeData, ...patch }),
    [id, nodeData, updateNodeData],
  );
  const setStages = (next: CharacterStage[]) => update({ stages: next });
  const patchStage = (stageId: string, patch: Partial<CharacterStage>) =>
    setStages(stages.map((s) => (s.id === stageId ? { ...s, ...patch } : s)));
  const move = (index: number, delta: number) => {
    reorder(index, index + delta);
  };
  // Mueve la etapa `from` a la posición `to`. Si ya había imágenes creadas, la
  // cadena de continuidad queda desalineada hasta volver a "Generar etapas".
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= stages.length) return;
    const next = [...stages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    update({ stages: next, ...(stages.some((s) => s.imageNodeId) ? { chainStale: true } : {}) });
  };
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Etapas con la galería de fotos abierta (por defecto todas colapsadas).
  const [expandedStages, setExpandedStages] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (stageId: string) =>
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  const [overIndex, setOverIndex] = useState<number | null>(null);
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

  // Copiar etapas al portapapeles (también en solo-ver: es una lectura).
  const [copied, setCopied] = useState<"titles" | "full" | null>(null);
  const copyStages = async (withText: boolean) => {
    try {
      await navigator.clipboard.writeText(stagesAsText(stages, withText));
      setCopied(withText ? "full" : "titles");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setMessage({ text: "No se pudo copiar al portapapeles.", tone: "warn" });
    }
  };

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-pink-400/40 ${selected ? "ring-2 ring-pink-400/40" : ""} transition-all ${nodeSizeClass(hasFixedSize, "min-w-[360px] max-w-[480px]")}`}
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
        <UserRound className="h-[18px] w-[18px] text-pink-400 shrink-0" />
        <NodeLabel value={nodeData.label || ""} placeholder="Personaje" onChange={(label) => update({ label })} />
        <span className="text-[12px] px-1 py-0.5 rounded bg-pink-400/15 text-pink-700 dark:text-pink-300 shrink-0">
          {filledStages} {filledStages === 1 ? "etapa" : "etapas"}
        </span>
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Cuerpo con scroll propio: con tamaño fijo ocupa el alto disponible;
          sin él, se limita para que muchas etapas no estiren el nodo sin fin.
          nowheel: la rueda desplaza el contenido en vez de hacer zoom. */}
      <div
        className={`nowheel px-3 py-2 space-y-2 overflow-y-auto ${hasFixedSize ? "flex-1 min-h-0" : "max-h-[720px]"}`}
      >
        <div className="space-y-0.5 text-[13px]">
          <div className={`flex items-center gap-1 ${styleConnections.length ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"}`}>
            <Palette className="h-4 w-4" />
            {styleConnections.length ? "Estilo global conectado" : "Conecta un texto con el estilo global (opcional)"}
          </div>
          <div className={`flex items-center gap-1 ${galleryConnections.length ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}>
            <Images className="h-4 w-4" />
            {galleryConnections.length
              ? `${photos.length} ${photos.length === 1 ? "foto disponible" : "fotos disponibles"} en ${galleryConnections.length} ${galleryConnections.length === 1 ? "galería" : "galerías"}`
              : "Conecta una galería para elegir fotos de referencia por etapa"}
          </div>
        </div>

        {/* ADN */}
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[12px] uppercase tracking-wider text-muted-foreground">
            <Dna className="h-4 w-4 text-pink-400" /> ADN del personaje
          </div>
          <NodeTextarea
            value={nodeData.dna ?? ""}
            onChange={(dna) => update({ dna })}
            onKeyDown={stopProp}
            disabled={!canEdit}
            placeholder="Rasgos que no cambian entre etapas: rostro, ojos, pelo, marcas, contextura…"
            className="nodrag w-full text-[15px] bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[56px] max-h-[200px] placeholder:text-muted-foreground dark:placeholder:text-muted-foreground/50"
            rows={3}
          />
        </div>

        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 text-[12px] uppercase tracking-wider text-muted-foreground">
            Etapas · cada una usa la anterior como referencia
          </div>
          {filledStages > 0 && (
            <>
              <button
                type="button"
                onClick={() => copyStages(false)}
                title="Copiar los títulos de todas las etapas (uno por línea)"
                className="nodrag flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                {copied === "titles" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                Títulos
              </button>
              <button
                type="button"
                onClick={() => copyStages(true)}
                title="Copiar títulos y descripciones de todas las etapas"
                className="nodrag flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[12px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              >
                {copied === "full" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                + Descripción
              </button>
            </>
          )}
        </div>

        {nodeData.chainStale && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[13px] text-amber-700 dark:text-amber-300">
            Cambiaste el orden: presiona &quot;Generar etapas&quot; para reconectar la cadena.
          </div>
        )}

        {stages.length === 0 && (
          <p className="text-[14px] text-muted-foreground">
            Agrega etapas en el orden en que quieres generarlas (por ejemplo hoy, 25 años, 15 años, 5 años). Cada una genera su imagen.
          </p>
        )}

        <div className="space-y-2">
          {stages.map((stage, i) => {
            const selectedCount = (stage.referenceImages ?? []).filter((r) => photos.some((p) => p.nodeId === r.nodeId && p.url === r.url)).length;
            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  if (overIndex !== i) setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) reorder(dragIndex, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={`rounded-lg border bg-muted/20 p-2 space-y-1.5 ${
                  dragIndex === i ? "opacity-50" : ""
                } ${overIndex === i && dragIndex !== null && dragIndex !== i ? "border-pink-400" : "border-border/60"}`}
              >
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <span
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", stage.id);
                        setDragIndex(i);
                      }}
                      onDragEnd={() => {
                        setDragIndex(null);
                        setOverIndex(null);
                      }}
                      title="Arrastra para reordenar"
                      className="nodrag cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <GripVertical className="h-[18px] w-[18px]" />
                    </span>
                  )}
                  <span className="text-[13px] text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                  <input
                    value={stage.name}
                    onChange={(e) => patchStage(stage.id, { name: e.target.value })}
                    onKeyDown={stopProp}
                    disabled={!canEdit}
                    placeholder="Nombre de la etapa (ej. 12 años)"
                    className="nodrag min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:text-muted-foreground dark:placeholder:text-muted-foreground/50"
                  />
                  {stage.imageNodeId && (
                    <span title="Ya tiene su nodo imagen" className="text-emerald-400">
                      <Check className="h-4 w-4" />
                    </span>
                  )}
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Subir" className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1} title="Bajar" className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => (stageLinks[stage.id] ? setPendingDelete(stage.id) : removeStage(stage.id))} title="Borrar etapa" className="nodrag p-0.5 text-muted-foreground hover:text-red-400">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
                {pendingDelete === stage.id && stageLinks[stage.id] && (
                  <div className="space-y-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[13px] text-red-700 dark:text-red-300">
                    <p>
                      La imagen de esta etapa está conectada a: <strong>{stageLinks[stage.id].join(", ")}</strong>. Si
                      borras la etapa, la imagen se conserva con esas conexiones, pero al volver a &quot;Generar etapas&quot;
                      deja de recibir el ADN y el texto del Personaje.
                    </p>
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => removeStage(stage.id)} className="nodrag rounded bg-red-600 px-2 py-0.5 text-white hover:bg-red-500">
                        Borrar igual
                      </button>
                      <button type="button" onClick={() => setPendingDelete(null)} className="nodrag rounded bg-muted px-2 py-0.5 text-foreground hover:bg-muted/70">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
                <NodeTextarea
                  value={stage.text}
                  onChange={(text) => patchStage(stage.id, { text })}
                  onKeyDown={stopProp}
                  disabled={!canEdit}
                  placeholder="Cómo es el personaje en esta etapa: edad, ropa, pelo, contexto…"
                  className="nodrag w-full text-[15px] bg-muted/30 rounded-md px-2 py-1.5 border-none outline-none resize-y min-h-[52px] max-h-[200px] placeholder:text-muted-foreground dark:placeholder:text-muted-foreground/50"
                  rows={2}
                />
                {photos.length > 0 ? (
                  <div className="space-y-1">
                    {/* Colapsada por defecto: resumen con las fotos elegidas;
                        la galería completa se abre al tocarlo. */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(stage.id)}
                      aria-expanded={expandedStages.has(stage.id)}
                      className="nodrag flex w-full items-center gap-1 text-left text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${expandedStages.has(stage.id) ? "rotate-90" : ""}`} />
                      <span className="shrink-0">
                        {selectedCount > 0
                          ? `${selectedCount} ${selectedCount === 1 ? "foto de referencia" : "fotos de referencia"}`
                          : expandedStages.has(stage.id)
                            ? "Toca una o más fotos para usarlas"
                            : "Elegir fotos de referencia"}
                      </span>
                      {!expandedStages.has(stage.id) && selectedCount > 0 && (
                        <span className="flex min-w-0 gap-0.5 overflow-hidden">
                          {photos
                            .filter((p) => (stage.referenceImages ?? []).some((r) => r.nodeId === p.nodeId && r.url === p.url))
                            .slice(0, 6)
                            .map((p) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={`${p.nodeId}|${p.url}`} src={thumbUrl(p.url, 128)} alt="" className="h-5 w-5 shrink-0 rounded object-cover" loading="lazy" />
                            ))}
                        </span>
                      )}
                    </button>
                    {expandedStages.has(stage.id) && (
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
                            <img src={thumbUrl(p.url, 256)} alt={p.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
                            {on && (
                              <span className="absolute right-0.5 top-0.5 rounded-full bg-pink-500 p-px text-white">
                                <Check className="h-2.5 w-2.5" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    )}
                  </div>
                ) : (stage.referenceImages ?? []).length > 0 ? (
                  <div className="text-[13px] text-amber-700 dark:text-amber-300">
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
              className="nodrag flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[15px] rounded-md bg-muted/40 hover:bg-muted/70 disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Agregar etapa
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy || filledStages === 0}
              className="nodrag flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[15px] rounded-md bg-pink-500/20 text-pink-700 dark:text-pink-200 hover:bg-pink-500/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generar etapas
            </button>
          </div>
        )}
        {message && (
          <p className={`text-[13px] ${message.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-300"}`}>{message.text}</p>
        )}
        <p className="text-[12px] text-muted-foreground">
          Crea una imagen por etapa, en orden: la etapa 1 se genera primero y es la referencia de la 2, la 2 de la 3, y
          así. Cada una recibe además ADN + estilo + su texto y sus fotos (prioridad 1). Luego ejecútalas con RUN.
        </p>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_CHARACTER}
        className="!w-3 !h-3 !bg-pink-400 !border-2 !border-background"
        title="Etapas → imágenes"
      />
      {/* Imagen de UNA etapa hacia otro nodo (referencia, frame de video…);
          la etapa se elige en el selector de cada conexión. */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_CHARACTER_IMAGE}
        className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
        style={{ top: 72 }}
        title="Imagen de una etapa (eliges cuál en la conexión)"
      />
      <span className="pointer-events-none absolute right-2 top-[64px] text-[11px] font-bold text-purple-500 dark:text-purple-300">
        IMAGEN
      </span>
      <ResizeHandle minWidth={340} minHeight={220} />
    </div>
  );
});
