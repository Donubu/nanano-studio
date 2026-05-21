"use client";

// Editor visual de timeline tipo Cape/After Effects. Panel inferior
// collapsible que vive debajo del canvas en el TemplateEditor.
//
// Layout:
//   [Header]  play/pause, rewind, current/total time, duration/loop, collapse
//   [Time ruler]   marcas de tiempo en segundos
//   [Tracks]  una fila por track existente: layer.name · property · keyframes
//   [Playhead]     línea vertical absoluta sobre las tracks, dragueable
//
// Estado:
//   - currentTime, isPlaying viven en useTimeline (en el TemplateEditor).
//   - AnimationConfig vive en editor.definition.animation. Mutaciones se
//     propagan via onUpdateAnimation que el caller setea con onUpdateRoot.
//
// Acciones:
//   - Click en track row (zona libre) → agregar keyframe en ese t con el
//     valor BASE actual del layer (snapshot del editor.definition).
//   - Drag horizontal de un keyframe → cambiar t.
//   - Click en keyframe → seleccionar (visual; valor se edita después).
//   - "Agregar track" → menú: elegir layer + propiedad.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Plus,
  Rewind,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  TemplateDefinition,
  TemplateLayer,
} from "@/lib/production/types";
import {
  AnimatableProperty,
  AnimationConfig,
  AnimationTrack,
  Easing,
  EasingPreset,
  Keyframe,
  addKeyframe,
  moveKeyframe,
  newAnimationConfig,
  removeKeyframe,
  updateKeyframe,
} from "@/lib/production/animation";

// ---------- Constantes ----------

// Propiedades animables expuestas en el menú "agregar track". Ordenadas por
// frecuencia de uso real en banners.
const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  "position.x": "Posición X",
  "position.y": "Posición Y",
  opacity: "Opacidad",
  scale: "Escala",
  "scale.x": "Escala X",
  "scale.y": "Escala Y",
  rotation: "Rotación",
  "size.w": "Ancho",
  "size.h": "Alto",
  blur: "Blur",
  color: "Color",
};

const PROPERTY_ORDER: AnimatableProperty[] = [
  "position.x",
  "position.y",
  "opacity",
  "scale",
  "scale.x",
  "scale.y",
  "rotation",
  "size.w",
  "size.h",
  "blur",
  "color",
];

// Anchos de columnas izquierdas (en px) — afecta dónde arranca el área de
// keyframes. Coincide con el header del time ruler.
const LEFT_LABEL_W = 200;
const TRACK_HEIGHT = 28;
const HEADER_RULER_HEIGHT = 24;

// ---------- Helpers ----------

// Lista plana de todos los layers (excluyendo el root) con su path para
// que el productor sepa de qué frame son si están anidados. El menú
// "agregar track" usa esto.
function flattenLayers(
  def: TemplateDefinition,
): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  function walk(layer: TemplateLayer, depth: number) {
    if (layer.id !== "tpl_root") {
      out.push({
        id: layer.id,
        name: layer.name || layer.id,
        depth,
      });
    }
    if (layer.type === "frame") {
      for (const c of layer.children) walk(c, depth + 1);
    }
  }
  walk(def, 0);
  return out;
}

// Resuelve el valor BASE de una propiedad del layer — usado cuando se
// agrega un keyframe en current time y queremos sembrarlo con el valor
// actual.
function getBaseValueForProperty(
  layer: TemplateLayer | null,
  property: AnimatableProperty,
): number | string {
  if (!layer) return 0;
  switch (property) {
    case "position.x": return layer.position.x;
    case "position.y": return layer.position.y;
    case "size.w": return layer.size.w;
    case "size.h": return layer.size.h;
    case "opacity": return layer.opacity ?? 1;
    case "rotation": return layer.rotation ?? 0;
    case "scale": return layer.scale ?? 1;
    case "scale.x": return layer.scaleX ?? 1;
    case "scale.y": return layer.scaleY ?? 1;
    case "blur": return layer.blur ?? 0;
    case "color":
      if (layer.type === "text") return layer.style.color;
      if (layer.type === "shape" && typeof layer.fill === "string") return layer.fill;
      if (layer.type === "icon") return layer.color;
      return "#000000";
  }
}

function findLayerById(def: TemplateDefinition, id: string): TemplateLayer | null {
  if (def.id === id) return def;
  function walk(layer: TemplateLayer): TemplateLayer | null {
    if (layer.id === id) return layer;
    if (layer.type === "frame") {
      for (const c of layer.children) {
        const f = walk(c);
        if (f) return f;
      }
    }
    return null;
  }
  return walk(def);
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ---------- Props ----------

export interface TimelinePanelProps {
  definition: TemplateDefinition;
  // currentTime/isPlaying/collapsed vienen de useTimeline (en el caller).
  currentTime: number;
  isPlaying: boolean;
  collapsed: boolean;
  selectedLayerId: string | null;
  onSeek: (t: number) => void;
  onPlayPause: () => void;
  onRewind: () => void;
  onToggleCollapsed: () => void;
  // Mutación del timeline. El caller hace onUpdateRoot que persiste la def
  // entera con la nueva animation.
  onUpdateAnimation: (next: AnimationConfig | undefined) => void;
}

// ---------- Component ----------

export function TimelinePanel(props: TimelinePanelProps) {
  const {
    definition,
    currentTime,
    isPlaying,
    collapsed,
    selectedLayerId,
    onSeek,
    onPlayPause,
    onRewind,
    onToggleCollapsed,
    onUpdateAnimation,
  } = props;

  const animation = definition.animation;
  const duration = animation?.duration ?? 0;
  const loop = animation?.loop ?? 1;
  const tracks = animation?.tracks ?? [];

  const [addingTrack, setAddingTrack] = useState(false);
  // Identidad del keyframe seleccionado para editar value/easing. Se llena
  // al hacer click (no drag) en un diamante. El popover de edición se
  // renderea dentro del KeyframeDiamond cuando coincide con esta key.
  const [selectedKf, setSelectedKf] = useState<{
    layerId: string;
    property: AnimatableProperty;
    t: number;
  } | null>(null);
  // Drag state para keyframes. Guarda el (trackKey, kfIndex, startT,
  // pointerStartX) y el callback resuelve el nuevo t cuando se mueve.
  const dragRef = useRef<{
    layerId: string;
    property: AnimatableProperty;
    fromT: number;
    pointerStartX: number;
    pxPerMs: number;
  } | null>(null);
  const tracksAreaRef = useRef<HTMLDivElement | null>(null);

  // ESC limpia la selección — convención de la app para popovers/modales.
  useEffect(() => {
    if (!selectedKf) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedKf(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedKf]);

  // Keyframe resuelto desde el estado de selección. Si la animation no
  // existe o el keyframe referenciado fue borrado, devuelve null y el
  // editor no se renderiza — eso hace que el cleanup de selectedKf sea
  // innecesario (la state stale no afecta nada visible).
  const selectedKfResolved = useMemo(() => {
    if (!animation || !selectedKf) return null;
    const tr = animation.tracks.find(
      (t) => t.layerId === selectedKf.layerId && t.property === selectedKf.property,
    );
    const kf = tr?.keyframes.find((k) => k.t === selectedKf.t) ?? null;
    return kf && tr ? { track: tr, kf } : null;
  }, [animation, selectedKf]);

  // ---------- Header bar (siempre visible, colapsado o no) ----------

  const header = (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-card/60 shrink-0">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="text-muted-foreground hover:text-foreground p-1 rounded"
        title={collapsed ? "Expandir timeline" : "Colapsar timeline"}
      >
        {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Animación
      </span>
      {animation ? (
        <>
          <div className="h-4 w-px bg-border/50 mx-1" />
          <button
            type="button"
            onClick={onPlayPause}
            disabled={duration <= 0}
            className="flex items-center justify-center w-7 h-7 rounded-md border border-border/50 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            title={isPlaying ? "Pausar (espacio)" : "Reproducir (espacio)"}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onRewind}
            className="flex items-center justify-center w-7 h-7 rounded-md border border-border/50 hover:bg-muted"
            title="Volver al inicio"
          >
            <Rewind className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-muted-foreground font-mono tabular-nums">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <div className="h-4 w-px bg-border/50 mx-1" />
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Duración
            <input
              type="number"
              value={Math.round(duration / 100) / 10}
              step={0.1}
              min={0.1}
              max={60}
              onChange={(e) => {
                const seconds = Math.max(0.1, Math.min(60, Number(e.target.value) || 0));
                onUpdateAnimation({ ...animation, duration: Math.round(seconds * 1000) });
              }}
              className="w-14 bg-muted border border-border/50 rounded px-1.5 py-0.5 text-xs font-mono"
              title="Duración total del loop en segundos"
            />
            s
          </label>
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Loop
            <select
              value={loop === "infinite" ? "infinite" : String(loop)}
              onChange={(e) => {
                const v = e.target.value;
                onUpdateAnimation({
                  ...animation,
                  loop: v === "infinite" ? "infinite" : Number(v),
                });
              }}
              className="bg-muted border border-border/50 rounded px-1 py-0.5 text-xs"
              title="Iteraciones del loop. IAB display cap = 3."
            >
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="3">3× (IAB)</option>
              <option value="infinite">∞</option>
            </select>
          </label>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setAddingTrack(true)}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border/50 hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Agregar un track (layer + propiedad) al timeline"
          >
            <Plus className="h-3 w-3" /> Agregar track
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("¿Eliminar todo el timeline? Se pierden los keyframes.")) {
                onUpdateAnimation(undefined);
              }
            }}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border/50 hover:bg-red-500/20 hover:border-red-500/40 text-muted-foreground hover:text-red-300"
            title="Eliminar el timeline completo"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      ) : (
        <>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => onUpdateAnimation(newAnimationConfig())}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border/50 hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Crear un timeline vacío para esta orientación"
          >
            <Plus className="h-3 w-3" /> Crear timeline
          </button>
        </>
      )}
    </div>
  );

  if (collapsed) {
    return <div className="border-t border-border/50 bg-card/40">{header}</div>;
  }

  // ---------- Tracks panel ----------

  // Conversión píxel ↔ tiempo. pxPerMs depende del ancho del contenedor.
  // Se mide en pointer events; para el render usamos un fixed width via
  // CSS flex.
  const handleTracksClick = (
    e: React.MouseEvent<HTMLDivElement>,
    track: AnimationTrack,
  ) => {
    if (!animation || duration <= 0) return;
    // Solo si el click cae en zona "vacía" (no en un diamante existente).
    const target = e.target as HTMLElement;
    if (target.dataset.kf === "true") return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const xWithin = e.clientX - rect.left;
    const t = Math.round((xWithin / rect.width) * duration);
    const layer = findLayerById(definition, track.layerId);
    const baseValue = getBaseValueForProperty(layer, track.property);
    onUpdateAnimation(
      addKeyframe(animation, track.layerId, track.property, {
        t,
        value: baseValue,
        easing: "linear",
      }),
    );
    onSeek(t);
  };

  const handleRulerScrub = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const updateFromX = (clientX: number) => {
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const t = Math.round((x / rect.width) * duration);
      onSeek(t);
    };
    updateFromX(e.clientX);
    const onMove = (ev: PointerEvent) => updateFromX(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleKfPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    track: AnimationTrack,
    kf: Keyframe,
  ) => {
    if (!animation || duration <= 0) return;
    e.stopPropagation();
    const tracksRect = tracksAreaRef.current?.getBoundingClientRect();
    if (!tracksRect) return;
    const pxPerMs = tracksRect.width / duration;
    dragRef.current = {
      layerId: track.layerId,
      property: track.property,
      fromT: kf.t,
      pointerStartX: e.clientX,
      pxPerMs,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    let lastNewT = kf.t;
    let hasDragged = false;
    const DRAG_THRESHOLD_PX = 4;
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaPx = ev.clientX - drag.pointerStartX;
      // Umbral para distinguir click puro de drag. Sin esto, micro-jitter del
      // pointer dispararía moveKeyframe y haría imposible "solo seleccionar".
      if (!hasDragged && Math.abs(deltaPx) < DRAG_THRESHOLD_PX) return;
      hasDragged = true;
      const deltaMs = deltaPx / drag.pxPerMs;
      const newT = Math.max(0, Math.min(duration, Math.round(drag.fromT + deltaMs)));
      if (newT === lastNewT) return;
      lastNewT = newT;
      onUpdateAnimation(
        moveKeyframe(animation, drag.layerId, drag.property, drag.fromT, newT),
      );
      // Aprovechamos para actualizar el fromT para el siguiente delta —
      // sino, después de mover y volver a mover usaríamos el fromT viejo
      // (que ya no existe). Y si había un keyframe seleccionado en el fromT
      // original, lo seguimos a su nuevo t para que el popover no quede
      // huérfano durante el drag.
      dragRef.current = { ...drag, fromT: newT, pointerStartX: ev.clientX };
      setSelectedKf((prev) =>
        prev &&
        prev.layerId === drag.layerId &&
        prev.property === drag.property &&
        prev.t === drag.fromT
          ? { ...prev, t: newT }
          : prev,
      );
      onSeek(newT);
    };
    const onUp = () => {
      const wasClick = !hasDragged;
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (wasClick) {
        // Click sin drag → seleccionar (o deseleccionar si ya estaba).
        setSelectedKf((prev) =>
          prev &&
          prev.layerId === track.layerId &&
          prev.property === track.property &&
          prev.t === kf.t
            ? null
            : { layerId: track.layerId, property: track.property, t: kf.t },
        );
        onSeek(kf.t);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ---------- Body ----------

  if (!animation) {
    return (
      <div className="border-t border-border/50 bg-card/40 flex flex-col">
        {header}
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          Esta orientación no tiene timeline. Click en{" "}
          <span className="font-medium">Crear timeline</span> para empezar.
        </div>
      </div>
    );
  }

  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="border-t border-border/50 bg-card/40 flex flex-col min-h-0">
      {header}

      {/* Editor del keyframe seleccionado. Aparece como franja docked debajo
          del header. Se prefiere a un popover flotante porque la tracks area
          tiene overflow scroll y queremos que el editor sea robusto a
          scrolls y a tracks rows pequeñas. El key incluye la identidad del
          keyframe para que cambiar de selección remonte el componente y
          reset-ee el valueDraft local sin needs de useEffect. */}
      {selectedKfResolved && animation && (
        <KeyframeEditor
          key={`${selectedKfResolved.track.layerId}-${selectedKfResolved.track.property}-${selectedKfResolved.kf.t}`}
          track={selectedKfResolved.track}
          kf={selectedKfResolved.kf}
          definition={definition}
          onClose={() => setSelectedKf(null)}
          onChangeValue={(value) => {
            onUpdateAnimation(
              updateKeyframe(
                animation,
                selectedKfResolved.track.layerId,
                selectedKfResolved.track.property,
                selectedKfResolved.kf.t,
                { value },
              ),
            );
          }}
          onChangeEasing={(easing) => {
            onUpdateAnimation(
              updateKeyframe(
                animation,
                selectedKfResolved.track.layerId,
                selectedKfResolved.track.property,
                selectedKfResolved.kf.t,
                { easing },
              ),
            );
          }}
          onDelete={() => {
            onUpdateAnimation(
              removeKeyframe(
                animation,
                selectedKfResolved.track.layerId,
                selectedKfResolved.track.property,
                selectedKfResolved.kf.t,
              ),
            );
            setSelectedKf(null);
          }}
        />
      )}

      {/* Time ruler. Scrubbable: pointerdown + drag setea el currentTime. */}
      <div className="flex shrink-0 border-b border-border/50">
        <div
          style={{ width: LEFT_LABEL_W }}
          className="shrink-0 border-r border-border/50 bg-card/60"
        />
        <div
          className="flex-1 relative cursor-pointer select-none"
          style={{ height: HEADER_RULER_HEIGHT }}
          onPointerDown={handleRulerScrub}
        >
          {renderTimeRuler(duration)}
          {/* Playhead arriba (ya cubre tracks abajo via overlay absoluto). */}
          <div
            className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none"
            style={{ left: `${playheadPercent}%` }}
          />
          <div
            className="absolute top-0 -translate-x-1/2 w-2 h-2 rotate-45 bg-primary pointer-events-none"
            style={{ left: `${playheadPercent}%` }}
          />
        </div>
      </div>

      {/* Tracks */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {tracks.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No hay tracks. Click en{" "}
            <span className="font-medium">Agregar track</span> para animar una propiedad.
          </div>
        ) : (
          <div ref={tracksAreaRef} className="relative">
            {tracks.map((track) => (
              <TrackRow
                key={`${track.layerId}-${track.property}`}
                track={track}
                definition={definition}
                duration={duration}
                selectedLayerId={selectedLayerId}
                selectedKfT={
                  selectedKf &&
                  selectedKf.layerId === track.layerId &&
                  selectedKf.property === track.property
                    ? selectedKf.t
                    : null
                }
                onRowClick={(e) => handleTracksClick(e, track)}
                onKfPointerDown={(e, kf) => handleKfPointerDown(e, track, kf)}
                onRemoveTrack={() => {
                  // Removemos todos los keyframes del track. removeKeyframe
                  // descarta el track entero cuando queda vacío.
                  let nextCfg = animation;
                  for (const k of track.keyframes) {
                    nextCfg = removeKeyframe(nextCfg, track.layerId, track.property, k.t);
                  }
                  onUpdateAnimation(nextCfg);
                }}
              />
            ))}
            {/* Playhead que cruza todos los tracks. Posicionado en el área
                de tracks (con offset LEFT_LABEL_W para no entrar en la
                columna de labels). */}
            <div
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{ left: LEFT_LABEL_W, right: 0 }}
            >
              <div
                className="absolute top-0 bottom-0 w-px bg-primary"
                style={{ left: `${playheadPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Modal: agregar track */}
      {addingTrack && (
        <AddTrackModal
          definition={definition}
          existingTracks={tracks}
          onClose={() => setAddingTrack(false)}
          onAdd={(layerId, property) => {
            const layer = findLayerById(definition, layerId);
            const baseValue = getBaseValueForProperty(layer, property);
            onUpdateAnimation(
              addKeyframe(animation, layerId, property, {
                t: currentTime,
                value: baseValue,
                easing: "linear",
              }),
            );
            setAddingTrack(false);
          }}
        />
      )}
    </div>
  );
}

// ---------- TrackRow ----------

function TrackRow({
  track,
  definition,
  duration,
  selectedLayerId,
  selectedKfT,
  onRowClick,
  onKfPointerDown,
  onRemoveTrack,
}: {
  track: AnimationTrack;
  definition: TemplateDefinition;
  duration: number;
  selectedLayerId: string | null;
  selectedKfT: number | null;
  onRowClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onKfPointerDown: (e: React.PointerEvent<HTMLButtonElement>, kf: Keyframe) => void;
  onRemoveTrack: () => void;
}) {
  const layer = findLayerById(definition, track.layerId);
  const isSelected = selectedLayerId === track.layerId;
  return (
    <div
      className={cn(
        "flex border-b border-border/30",
        isSelected && "bg-foreground/[0.03]",
      )}
      style={{ height: TRACK_HEIGHT }}
    >
      <div
        style={{ width: LEFT_LABEL_W }}
        className="shrink-0 border-r border-border/50 px-2 flex items-center gap-1.5 min-w-0 group"
      >
        <span
          className={cn(
            "text-[11px] truncate min-w-0 flex-1",
            isSelected ? "text-foreground font-medium" : "text-muted-foreground",
          )}
          title={`${layer?.name || track.layerId} · ${PROPERTY_LABELS[track.property]}`}
        >
          {layer?.name || track.layerId}
          <span className="text-muted-foreground/60 ml-1.5">
            {PROPERTY_LABELS[track.property]}
          </span>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemoveTrack();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-red-400"
          title="Eliminar track"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div
        className="flex-1 relative cursor-pointer hover:bg-foreground/[0.02]"
        onClick={onRowClick}
        title="Click para agregar un keyframe en este instante"
      >
        {track.keyframes.map((kf) => (
          <KeyframeDiamond
            key={kf.t}
            kf={kf}
            duration={duration}
            isSelected={selectedKfT === kf.t}
            onPointerDown={(e) => onKfPointerDown(e, kf)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- KeyframeDiamond ----------

function KeyframeDiamond({
  kf,
  duration,
  isSelected,
  onPointerDown,
}: {
  kf: Keyframe;
  duration: number;
  isSelected: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const percent = duration > 0 ? (kf.t / duration) * 100 : 0;
  return (
    <button
      type="button"
      data-kf="true"
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: `${percent}%`,
        top: "50%",
        transform: "translate(-50%, -50%) rotate(45deg)",
        width: 10,
        height: 10,
      }}
      className={cn(
        "border transition-colors rounded-sm cursor-grab active:cursor-grabbing",
        isSelected
          ? "bg-primary border-primary ring-2 ring-primary/30"
          : "bg-foreground border-foreground/80 hover:bg-primary hover:border-primary",
      )}
      title={`Keyframe @ ${formatTime(kf.t)} = ${kf.value} (easing: ${typeof kf.easing === "string" ? kf.easing : "cubic-bezier"})`}
    />
  );
}

// ---------- Time ruler ticks ----------

function renderTimeRuler(durationMs: number) {
  if (durationMs <= 0) return null;
  // Elegir un step "redondo" según la duración.
  let step = 1000;
  if (durationMs < 2000) step = 250;
  else if (durationMs < 5000) step = 500;
  else if (durationMs < 20000) step = 1000;
  else step = 2000;
  const ticks: number[] = [];
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);
  return (
    <>
      {ticks.map((t) => {
        const percent = (t / durationMs) * 100;
        return (
          <div
            key={t}
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{ left: `${percent}%` }}
          >
            <div className="absolute top-0 left-0 w-px h-2 bg-border" />
            <div className="absolute top-2.5 left-1 text-[10px] text-muted-foreground font-mono whitespace-nowrap">
              {t === 0 ? "0" : formatTime(t)}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------- KeyframeEditor ----------
//
// Franja docked debajo del header de la timeline. Aparece cuando hay un
// keyframe seleccionado. Permite editar value y easing del keyframe sin
// moverlo en el tiempo (eso se hace dragueando el diamante).

const EASING_PRESETS: { value: EasingPreset; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "ease", label: "Ease" },
  { value: "ease-in", label: "Ease in" },
  { value: "ease-out", label: "Ease out" },
  { value: "ease-in-out", label: "Ease in-out" },
];

// Heurística: ¿la propiedad usa un input numérico o de color? Solo "color"
// usa string en este modelo (ver AnimatableProperty).
function isColorProperty(p: AnimatableProperty): boolean {
  return p === "color";
}

// Step apropiado para el input numérico según la propiedad. opacity/scale
// usan 0.01 (rango ~0-1), rotation usa 1deg, position/size usan 1px.
function numericStep(p: AnimatableProperty): number {
  if (p === "opacity" || p === "scale" || p === "scale.x" || p === "scale.y") return 0.01;
  return 1;
}

function KeyframeEditor({
  track,
  kf,
  definition,
  onClose,
  onChangeValue,
  onChangeEasing,
  onDelete,
}: {
  track: AnimationTrack;
  kf: Keyframe;
  definition: TemplateDefinition;
  onClose: () => void;
  onChangeValue: (value: number | string) => void;
  onChangeEasing: (easing: Easing) => void;
  onDelete: () => void;
}) {
  const layer = findLayerById(definition, track.layerId);
  const propLabel = PROPERTY_LABELS[track.property];
  const isColor = isColorProperty(track.property);
  // Para el easing usamos el preset si existe; cubic-bezier custom se
  // muestra como "custom" sin permitir editar (no hay UI todavía).
  const easingValue =
    typeof kf.easing === "string" ? kf.easing : "custom";

  // Buffer local para el input de value — evita re-render del editor
  // entero por cada keystroke. Se aplica onBlur o Enter. El caller pasa un
  // `key` con la identidad del keyframe, así que cambiar de selección o
  // borrar/recrear remonta el componente y reinicia este state sin
  // necesidad de useEffect.
  const [valueDraft, setValueDraft] = useState<string>(String(kf.value));

  const commitValue = () => {
    if (isColor) {
      // Para color aceptamos cualquier string CSS válido. La validación
      // formal sucede en interpolateColor; valores inválidos no rompen,
      // solo no interpolan.
      if (valueDraft !== kf.value) onChangeValue(valueDraft);
      return;
    }
    const n = Number(valueDraft);
    if (!Number.isFinite(n)) {
      setValueDraft(String(kf.value));
      return;
    }
    if (n !== kf.value) onChangeValue(n);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-foreground/[0.04] shrink-0">
      <span className="text-[11px] text-muted-foreground">
        Keyframe @ <span className="font-mono text-foreground">{formatTime(kf.t)}</span>
      </span>
      <span className="text-[11px] text-muted-foreground truncate max-w-[160px]" title={`${layer?.name || track.layerId} · ${propLabel}`}>
        · {layer?.name || track.layerId} · <span className="text-foreground/80">{propLabel}</span>
      </span>
      <div className="h-4 w-px bg-border/50 mx-1" />
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Valor
        {isColor ? (
          <>
            <input
              type="color"
              value={normalizeHexForInput(valueDraft) ?? "#000000"}
              onChange={(e) => {
                setValueDraft(e.target.value);
                onChangeValue(e.target.value);
              }}
              className="w-7 h-6 bg-transparent border border-border/50 rounded cursor-pointer"
              title="Color del keyframe"
            />
            <input
              type="text"
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              onBlur={commitValue}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setValueDraft(String(kf.value));
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-24 bg-muted border border-border/50 rounded px-1.5 py-0.5 text-xs font-mono"
              placeholder="#000000"
            />
          </>
        ) : (
          <input
            type="number"
            step={numericStep(track.property)}
            value={valueDraft}
            onChange={(e) => setValueDraft(e.target.value)}
            onBlur={commitValue}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setValueDraft(String(kf.value));
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-20 bg-muted border border-border/50 rounded px-1.5 py-0.5 text-xs font-mono tabular-nums"
          />
        )}
      </label>
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Easing
        <select
          value={easingValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") return; // no-op, custom solo lectura
            onChangeEasing(v as EasingPreset);
          }}
          className="bg-muted border border-border/50 rounded px-1 py-0.5 text-xs"
          title="Curva de interpolación HACIA el siguiente keyframe"
        >
          {EASING_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          {easingValue === "custom" && (
            <option value="custom">Custom (cubic-bezier)</option>
          )}
        </select>
      </label>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border/50 hover:bg-red-500/20 hover:border-red-500/40 text-muted-foreground hover:text-red-300"
        title="Eliminar este keyframe"
      >
        <Trash2 className="h-3 w-3" />
        Borrar
      </button>
      <button
        type="button"
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground p-1 rounded"
        title="Cerrar editor (Esc)"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// El input type=color requiere formato #RRGGBB; tokens del brand kit o
// rgba() no son válidos. Devolvemos null para que el caller use un fallback
// y el productor pueda igual editar el texto.
function normalizeHexForInput(s: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const r = s[1], g = s[2], b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

// ---------- AddTrackModal ----------

function AddTrackModal({
  definition,
  existingTracks,
  onClose,
  onAdd,
}: {
  definition: TemplateDefinition;
  existingTracks: AnimationTrack[];
  onClose: () => void;
  onAdd: (layerId: string, property: AnimatableProperty) => void;
}) {
  const [layerId, setLayerId] = useState<string>("");
  const [property, setProperty] = useState<AnimatableProperty>("opacity");
  const layers = useMemo(() => flattenLayers(definition), [definition]);
  // No bloqueamos selección de tracks que ya existen — el addKeyframe del
  // helper sobreescribe el keyframe en el mismo t. El productor puede usar
  // este flow para agregar un nuevo keyframe a un track ya activo.
  const trackExists = (lid: string, prop: AnimatableProperty) =>
    existingTracks.some((t) => t.layerId === lid && t.property === prop);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg p-4 w-[420px] max-w-full space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Agregar track</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">
            Capa
            <select
              value={layerId}
              onChange={(e) => setLayerId(e.target.value)}
              className="w-full bg-muted border border-border/50 rounded px-2 py-1.5 text-sm mt-1"
            >
              <option value="">— Selecciona una capa —</option>
              {layers.map((l) => (
                <option key={l.id} value={l.id}>
                  {"  ".repeat(l.depth)}
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted-foreground">
            Propiedad
            <select
              value={property}
              onChange={(e) => setProperty(e.target.value as AnimatableProperty)}
              className="w-full bg-muted border border-border/50 rounded px-2 py-1.5 text-sm mt-1"
            >
              {PROPERTY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PROPERTY_LABELS[p]}
                  {layerId && trackExists(layerId, p) ? " · (ya existe)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-border/50 hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!layerId}
            onClick={() => layerId && onAdd(layerId, property)}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
