"use client";

// Nodo vinculado: un Personaje, una Escena, una imagen o un video que vive en
// otro canvas del mismo proyecto, solo lectura. Muestra la vista guardada (linkSnapshot).
// Personaje: PROMPT (ADN + estilo + etapa), IMAGEN (imagen de una etapa), ADN
// y ESTILO; la etapa se elige en cada conexión. Escena: PROMPT (su texto, con
// el contexto del guion al ejecutar). Se actualiza al abrir el canvas, antes
// de ejecutar y con el botón.

import { memo, useEffect, useState } from "react";
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Dna, ExternalLink, Film, ImageIcon, Link2, Loader2, Palette, RefreshCw, UserRound, Video } from "lucide-react";
import { HANDLE_IDS, type LinkedNodeData } from "../lib/canvas-types";
import { computeLinkPatches } from "../lib/linked-sync";
import { NodeDeleteButton } from "./node-status";
import { useCanvasContext } from "../canvas-context";
import { useNodeUpdate } from "../hooks/use-node-update";
import { thumbUrl } from "../lib/thumb";
import { collapsedPos } from "./lod";

export const LinkedNodeComponent = memo(function LinkedNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as LinkedNodeData;
  // Colapsado: PROMPT e IMAGEN a la derecha, ADN y ESTILO pasan arriba (cuatro
  // conectores no caben en el costado del encabezado). React Flow debe volver
  // a medir los conectores al cambiar de lado.
  const collapsed = (data as { collapsed?: boolean }).collapsed === true;
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [collapsed, id, updateNodeInternals]);
  const snap = d.linkSnapshot?.kind === "character" ? d.linkSnapshot : null;
  const scene = d.linkSnapshot?.kind === "scene" ? d.linkSnapshot : null;
  const isScene = scene != null || d.sourceType === "scene";
  const image = d.linkSnapshot?.kind === "image" ? d.linkSnapshot : null;
  const isImage = image != null || d.sourceType === "image";
  const video = d.linkSnapshot?.kind === "video" ? d.linkSnapshot : null;
  const isVideo = video != null || d.sourceType === "video";
  const vertical = (video?.aspectRatio ?? "").startsWith("9:");
  const { conversationId, canEdit, openCanvas } = useCanvasContext();
  const { updateNodeData, updateNodeDataLocal } = useNodeUpdate();
  const { getNode } = useReactFlow();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const node = getNode(id);
    if (!node) return;
    setBusy(true);
    setError(null);
    try {
      const patches = await computeLinkPatches(conversationId, [node as { id: string; type?: string; data: Record<string, unknown> }]);
      const patch = patches.get(id);
      if (patch) {
        const next = { ...node.data, ...patch };
        if (canEdit) updateNodeData(id, next);
        else updateNodeDataLocal(id, next);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const state = d.linkState ?? "ok";
  const withImage = snap?.stages.filter((s) => s.imageUrl).length ?? 0;

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-dashed ${isVideo ? "border-amber-400/60" : isImage ? "border-purple-400/60" : isScene ? "border-violet-400/60" : "border-pink-400/60"} ${selected ? (isVideo ? "ring-2 ring-amber-400/40" : isImage ? "ring-2 ring-purple-400/40" : isScene ? "ring-2 ring-violet-400/40" : "ring-2 ring-pink-400/40") : ""} transition-all ${isVideo ? "w-[360px]" : isImage ? "w-[330px]" : "min-w-[300px] max-w-[380px]"}`}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        {isVideo ? (
          <Video className="h-[18px] w-[18px] text-amber-400 shrink-0" />
        ) : isImage ? (
          <ImageIcon className="h-[18px] w-[18px] text-purple-400 shrink-0" />
        ) : isScene ? (
          <Film className="h-[18px] w-[18px] text-violet-400 shrink-0" />
        ) : (
          <UserRound className="h-[18px] w-[18px] text-pink-400 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" title={d.linkSnapshot?.label || d.label}>
          {scene ? `Escena ${scene.context.sceneIndex}${scene.context.variant ?? ""}/${scene.context.totalScenes}` : snap?.label || image?.label || (video ? `${d.sourceCanvasTitle ? `${d.sourceCanvasTitle} · ` : ""}${video.label}` : null) || d.label || (isVideo ? "Video" : isImage ? "Imagen" : "Personaje")}
        </span>
        <span
          className="flex shrink-0 items-center gap-0.5 rounded bg-pink-400/15 px-1 py-0.5 text-[12px] text-pink-700 dark:text-pink-300"
          title="Vinculado: se edita en su canvas de origen"
        >
          <Link2 className="h-3.5 w-3.5" /> Vinculado
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          title="Traer la última versión del original"
          className="nodrag p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
        {openCanvas && d.linkState !== "deleted" && d.linkState !== "forbidden" && (
          <button
            type="button"
            onClick={() => openCanvas(d.sourceConversationId, d.sourceNodeId)}
            title={`Abrir el original en "${d.sourceCanvasTitle || "su canvas"}"`}
            className="nodrag p-0.5 text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* pr: deja libres las etiquetas PROMPT / IMAGEN de las salidas. */}
      <div className="px-3 pr-16 py-2 space-y-2">
        <div className="text-[12px] text-muted-foreground truncate" title={d.sourceCanvasTitle}>
          Desde <span className="font-medium text-foreground">{d.sourceCanvasTitle || `canvas ${d.sourceConversationId}`}</span>
          {" · "}
          {scene
            ? scene.scriptLabel
            : isVideo
              ? video?.scene
                ? `video final de la escena ${video.scene.sceneIndex}${video.scene.variant ?? ""}/${video.scene.totalScenes}`
                : "video"
              : isImage
              ? "imagen"
              : snap
              ? `${snap.stages.length} ${snap.stages.length === 1 ? "etapa" : "etapas"}, ${withImage} con imagen`
              : "sin datos"}
        </div>

        {state !== "ok" && (
          <div className="flex items-start gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[13px] text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {state === "deleted"
              ? "El original ya no existe. Se usa la última versión que se trajo."
              : "No tienes acceso al canvas de origen (otro proyecto o sin permiso)."}
          </div>
        )}
        {error && <p className="text-[13px] text-amber-700 dark:text-amber-300">{error}</p>}

        {snap && (
          <>
            {snap.dna.trim() && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[12px] uppercase tracking-wider text-muted-foreground">
                  <Dna className="h-4 w-4 text-pink-400" /> ADN
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-[14px] text-foreground/90">{snap.dna}</p>
              </div>
            )}
            {snap.style.trim() && (
              <div className="flex items-start gap-1 text-[13px] text-muted-foreground">
                <Palette className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span className="line-clamp-2">{snap.style}</span>
              </div>
            )}
            <div className="nowheel max-h-[320px] space-y-1 overflow-y-auto">
              {snap.stages.map((st, i) => (
                <div key={st.id} className="flex items-center gap-2 rounded-md bg-muted/20 p-1">
                  {st.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbUrl(st.imageUrl, 128)} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded bg-muted/50" title="Sin imagen generada en el original" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">
                      {i + 1}. {st.name.trim() || `Etapa ${i + 1}`}
                    </div>
                    {st.text.trim() && <div className="truncate text-[12px] text-muted-foreground">{st.text}</div>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {scene && (
          <>
            <p className="nowheel max-h-[220px] overflow-y-auto whitespace-pre-wrap text-[14px] text-foreground/90">{scene.text}</p>
            {scene.context.sceneParamsContent && (
              <div className="flex items-start gap-1 text-[13px] text-muted-foreground" title="Params Escena conectado a la escena original">
                <Palette className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                <span className="line-clamp-2">{scene.context.sceneParamsContent}</span>
              </div>
            )}
            <div className="text-[12px] text-muted-foreground">
              Lleva el contexto del guion: {scene.context.previousScenes.length} escena(s) anterior(es)
              {scene.context.rulesText ? ", reglas" : ""}
              {scene.context.sceneParamsContent ? ", estilo" : ""}.
            </div>
          </>
        )}
        {image && (
          <>
            {image.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbUrl(image.imageUrl, 640)} alt={image.label} className="w-full rounded-md object-contain bg-muted/30 max-h-[260px]" loading="lazy" />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-md bg-muted/40 text-[13px] text-muted-foreground">
                El original todavía no tiene imagen
              </div>
            )}
            {image.prompt.trim() && <p className="line-clamp-2 text-[12px] text-muted-foreground" title={image.prompt}>{image.prompt}</p>}
          </>
        )}
        {video && (
          <>
            {video.videoUrl ? (
              <video
                src={video.videoUrl}
                controls
                muted
                playsInline
                preload="metadata"
                className="nodrag w-full rounded-md bg-black/80 object-contain"
                style={{ aspectRatio: vertical ? "9/16" : "16/9", maxHeight: vertical ? 420 : undefined }}
              />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-md bg-muted/40 text-[13px] text-muted-foreground">
                El original todavía no tiene video
              </div>
            )}
            {video.prompt.trim() && <p className="line-clamp-2 text-[12px] text-muted-foreground" title={video.prompt}>{video.prompt}</p>}
          </>
        )}
        <p className="text-[12px] text-muted-foreground">
          {isVideo
            ? "Si se regenera en su canvas, aquí cambia. VIDEO se conecta como media de un texto."
            : isImage
            ? "Conecta IMAGEN como fotograma, referencia o a una galería. Si se regenera en su canvas, aquí cambia."
            : isScene
            ? "Conecta PROMPT a una imagen, video o texto. Para cambiarla, edítala en su canvas."
            : "PROMPT e IMAGEN eligen la etapa en la conexión; ADN y ESTILO van por separado. Para cambiarlo, edítalo en su canvas."}
        </p>
      </div>

      {isVideo ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id={HANDLE_IDS.OUTPUT_VIDEO}
            className="!w-3 !h-3 !bg-amber-500 !border-2 !border-background"
            style={{ top: 60 }}
            title="El video vinculado"
          />
          <OutputLabel top={52} className="text-amber-600 dark:text-amber-300">VIDEO</OutputLabel>
        </>
      ) : isImage ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id={HANDLE_IDS.OUTPUT_IMAGE}
            className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
            style={{ top: 60 }}
            title="La imagen vinculada"
          />
          <OutputLabel top={52} className="text-purple-500 dark:text-purple-300">IMAGEN</OutputLabel>
        </>
      ) : isScene ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id={HANDLE_IDS.OUTPUT_TEXT}
            className="!w-3 !h-3 !bg-violet-400 !border-2 !border-background"
            style={{ top: 60 }}
            title="Prompt: el texto de la escena (con el contexto del guion al ejecutar)"
          />
          <OutputLabel top={52} className="text-violet-500 dark:text-violet-300">PROMPT</OutputLabel>
        </>
      ) : (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id={HANDLE_IDS.OUTPUT_CHARACTER}
            className="!w-3 !h-3 !bg-pink-400 !border-2 !border-background"
            style={{ top: 60, ...collapsedPos("30%") }}
            title="Prompt: ADN + estilo + la etapa que elijas en la conexión"
          />
          <OutputLabel top={52} className="text-pink-500 dark:text-pink-300">PROMPT</OutputLabel>
          <Handle
            type="source"
            position={Position.Right}
            id={HANDLE_IDS.OUTPUT_CHARACTER_IMAGE}
            className="!w-3 !h-3 !bg-purple-500 !border-2 !border-background"
            style={{ top: 88, ...collapsedPos("70%") }}
            title="Imagen de una etapa (eliges cuál en la conexión)"
          />
          <OutputLabel top={80} className="text-purple-500 dark:text-purple-300">IMAGEN</OutputLabel>
          <Handle
            type="source"
            position={collapsed ? Position.Top : Position.Right}
            id={HANDLE_IDS.OUTPUT_CHARACTER_DNA}
            className="!w-3 !h-3 !bg-pink-300 !border-2 !border-background"
            style={collapsed ? collapsedPos("35%") : { top: 116 }}
            title="Solo el ADN (rasgos permanentes), como texto"
          />
          <OutputLabel top={108} className="text-pink-500 dark:text-pink-300">ADN</OutputLabel>
          <Handle
            type="source"
            position={collapsed ? Position.Top : Position.Right}
            id={HANDLE_IDS.OUTPUT_CHARACTER_STYLE}
            className="!w-3 !h-3 !bg-blue-400 !border-2 !border-background"
            style={collapsed ? collapsedPos("65%") : { top: 144 }}
            title="Solo el estilo global, como texto (también sirve de estilo para un Personaje de este canvas)"
          />
          <OutputLabel top={136} className="text-blue-500 dark:text-blue-300">ESTILO</OutputLabel>
        </>
      )}
    </div>
  );
});

function OutputLabel({ top, className, children }: { top: number; className: string; children: string }) {
  return (
    <span className={`pointer-events-none absolute right-2 text-[11px] font-bold ${className}`} style={{ top }}>
      {children}
    </span>
  );
}
