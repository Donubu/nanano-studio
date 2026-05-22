"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { TemplateDefinition, TemplateLayer, findLayer, findParent, updateLayer as updateLayerInTree } from "@/lib/production/types";
import { BrandKit, BrandKitContent, EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { DataRow } from "@/lib/production/variables";
import { useTemplateEditor } from "@/lib/production/use-template-editor";
import { useTimeline } from "@/lib/production/use-timeline";
import {
  AnimatableProperty,
  applyAnimationAtTime,
  getBaseValue,
  updateKeyframe,
} from "@/lib/production/animation";
import { TemplateCanvas } from "./template-canvas";
import { LayersPanel } from "./layers-panel";
import { PropertiesPanel } from "./properties-panel";
import { EditorToolbar } from "./editor-toolbar";
import { PreviewThumbnails, ThumbnailPreset } from "./preview-thumbnails";
import { LayerContextMenu, LayerContextMenuPosition } from "./layer-context-menu";
import { TimelinePanel } from "./timeline-panel";

interface Props {
  initial: TemplateDefinition;
  baseWidth: number;
  baseHeight: number;
  onSave: (definition: TemplateDefinition) => Promise<void>;
  brandKit?: BrandKitContent;
  clientId?: number | null;
  projectId?: number;
  // ID del template activo. Lo necesita el TimelinePanel para invocar al
  // agente IA de animación (POST /api/production/templates/[id]/ai/animate).
  // Si no se pasa, la opción IA del picker queda deshabilitada.
  templateId?: number;
  allBrandKits?: BrandKit[];
  onBrandKitsChange?: () => void;
  // Custom node rendered above the canvas en lugar del PreviewThumbnails
  // default. Lo usa producir para mostrar variantes reales del master.
  topAccessory?: React.ReactNode;
  // Banner opcional que se renderiza dentro del editor, después del
  // topAccessory/PreviewThumbnails y antes del toolbar/canvas. Pensado para
  // avisos contextuales (ej. "Editando pieza independiente") que deben vivir
  // visualmente dentro del editor en vez de afuera de la sección.
  topBanner?: React.ReactNode;
  // Custom node renderizado en la columna derecha, abajo del PropertiesPanel.
  // Lo usa producir para meter la sección de Variables / Dataset cerca del
  // contexto del editor.
  rightAccessory?: React.ReactNode;
  // Fila activa del dataset CSV: cuando viene, las variables {{var}} del
  // árbol se sustituyen visualmente en el canvas. El estado del editor
  // permanece raw — al editar un text layer el productor ve "{{var}}", no
  // el valor.
  dataRow?: DataRow | null;
}

export function TemplateEditor({
  initial,
  baseWidth,
  baseHeight,
  onSave,
  brandKit = EMPTY_KIT_CONTENT,
  clientId,
  projectId,
  templateId,
  allBrandKits = [],
  onBrandKitsChange,
  topAccessory,
  topBanner,
  rightAccessory,
  dataRow,
}: Props) {
  // Estado de colapso de los paneles laterales. Por default abiertos.
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [propsCollapsed, setPropsCollapsed] = useState(false);
  // Top accessory (strip de variantes en producir o PreviewThumbnails en el
  // editor del template raw) colapsable: cuando true, ocultamos su
  // contenido y dejamos solo una banda con un botón para re-expandir. Da
  // más alto al canvas en monitores chicos.
  const [topAccessoryCollapsed, setTopAccessoryCollapsed] = useState(false);
  // Acordeón de la columna derecha. Default: Propiedades abierta, Variables
  // y datos colapsada — al seleccionar una capa abrimos automáticamente
  // Propiedades y cerramos Variables y datos (efecto reactivo más abajo).
  const [propsSectionOpen, setPropsSectionOpen] = useState(true);
  const [dataSectionOpen, setDataSectionOpen] = useState(false);
  const editor = useTemplateEditor({
    initial,
    baseWidth,
    baseHeight,
    onSave,
  });

  // Timeline state. Vive arriba del TimelinePanel pero también arriba del
  // canvas, porque el canvas renderea el snapshot animado en tiempo de
  // playhead. La AnimationConfig misma vive en editor.definition.animation
  // — el hook solo gestiona currentTime / isPlaying / colapso.
  const timeline = useTimeline({
    duration: editor.definition.animation?.duration,
    loop: editor.definition.animation?.loop,
  });

  // Snapshot del árbol en el instante actual del playhead. Cuando
  // currentTime es 0, applyAnimationAtTime devuelve la def original
  // (misma referencia), así que no rompemos memos del renderer mientras
  // el productor edita sin animación activa.
  const canvasDefinition = useMemo(
    () => applyAnimationAtTime(editor.definition, timeline.currentTime),
    [editor.definition, timeline.currentTime],
  );

  // Tolerancia para "playhead está sobre un keyframe": 16ms ≈ 1 frame a
  // 60fps. Después de clickear o draguear un keyframe, currentTime queda
  // exactamente en su t, así que esta tolerancia solo absorbe scrubs
  // imprecisos del ruler.
  const KEYFRAME_HIT_TOLERANCE_MS = 16;

  // Auto-keyframe: cuando el productor edita una propiedad animable de un
  // layer que tiene un track activo Y el playhead está sobre uno de los
  // keyframes de ese track, la mutación va al keyframe (updateKeyframe vía
  // addKeyframe upsert) en lugar del valor base del layer. Esto replica el
  // comportamiento de After Effects / Cape para edit-on-keyframe.
  //
  // Si el playhead NO está sobre un keyframe, o la propiedad no está
  // animada, la mutación cae al path normal (editor.updateLayer). No
  // creamos keyframes nuevos automáticamente — eso evita generar ruido si
  // el productor scrubea y edita sin querer.
  const updateLayerAutoKf = useCallback(
    (id: string, layerMutator: (layer: TemplateLayer) => TemplateLayer) => {
      const cur = findLayer(editor.definition, id);
      if (!cur) {
        editor.updateLayer(id, layerMutator);
        return;
      }
      const anim = editor.definition.animation;
      if (!anim || anim.tracks.length === 0) {
        editor.updateLayer(id, layerMutator);
        return;
      }
      // Tracks de este layer indexados por propiedad.
      const tracksByProp = new Map<AnimatableProperty, true>();
      const propsOnKeyframe = new Map<AnimatableProperty, number>();
      const t = timeline.currentTime;
      for (const tr of anim.tracks) {
        if (tr.layerId !== id) continue;
        tracksByProp.set(tr.property, true);
        // ¿Hay un keyframe en este track dentro de la tolerancia?
        const hit = tr.keyframes.find(
          (k) => Math.abs(k.t - t) <= KEYFRAME_HIT_TOLERANCE_MS,
        );
        if (hit) propsOnKeyframe.set(tr.property, hit.t);
      }
      if (propsOnKeyframe.size === 0) {
        // No estamos sobre un keyframe → comportamiento normal.
        editor.updateLayer(id, layerMutator);
        return;
      }
      // Corremos el mutator para calcular el siguiente layer y diff por
      // propiedad. Solo las animables que cayeron sobre un keyframe se
      // redirigen al timeline; las demás (incluyendo otras animables que
      // NO están en hit-zone) van al valor base.
      const next = layerMutator(cur);
      const kfChanges: { property: AnimatableProperty; t: number; value: number | string }[] = [];
      for (const [property, kfT] of propsOnKeyframe) {
        const oldVal = getBaseValue(cur, property);
        const newVal = getBaseValue(next, property);
        if (oldVal !== newVal) {
          kfChanges.push({ property, t: kfT, value: newVal });
        }
      }
      if (kfChanges.length === 0) {
        // El mutator cambió cosas, pero ninguna de las animadas sobre un
        // keyframe. Path normal.
        editor.updateLayer(id, layerMutator);
        return;
      }
      // Mutación atómica: aplicamos el layer mutator (mantiene la base en
      // sync) Y actualizamos los keyframes en el mismo updateRoot para que
      // sea una sola entrada en el undo stack. Usamos updateKeyframe (no
      // addKeyframe) para preservar el easing existente del keyframe.
      editor.updateRoot((root) => {
        const updatedRoot = updateLayerInTree(root, id, layerMutator);
        let nextAnim = updatedRoot.animation ?? root.animation;
        if (!nextAnim) return updatedRoot;
        for (const ch of kfChanges) {
          nextAnim = updateKeyframe(nextAnim, id, ch.property, ch.t, {
            value: ch.value,
          });
        }
        return { ...updatedRoot, animation: nextAnim };
      });
    },
    [editor, timeline.currentTime],
  );

  const previewPresets: ThumbnailPreset[] = useMemo(
    () => [
      { id: "square", label: "1:1", size: { w: 1080, h: 1080 } },
      { id: "vertical", label: "9:16", size: { w: 1080, h: 1920 } },
      { id: "horizontal", label: "16:9", size: { w: 1920, h: 1080 } },
    ],
    []
  );
  // null = master (no preview overlay). Selecting a preset shows it in the
  // main canvas; clicking the active thumb again returns to null/master.
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<LayerContextMenuPosition | null>(null);
  // Zona segura: toggle por sesión. No persistido — es una herramienta de
  // visualización, no un atributo del template. Si el productor quiere
  // distintos márgenes para distintas piezas, abre el toggle, edita, lo
  // apaga. La constante de 5% vive en TemplateCanvas.
  const [showSafetyZone, setShowSafetyZone] = useState(false);

  const openContextMenu = useCallback(
    (clientX: number, clientY: number, layerId: string) => {
      setContextMenu({ x: clientX, y: clientY, layerId });
    },
    []
  );
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Resolve current state for the context menu in render so reorder/lock from
  // the menu reflect the latest definition.
  const ctxLayer = contextMenu ? findLayer(editor.definition, contextMenu.layerId) : null;
  const ctxParent = contextMenu ? findParent(editor.definition, contextMenu.layerId) : null;
  const ctxParentIsStack = ctxParent?.layout.mode === "stack";

  // null when no preview is active → main canvas shows the master.
  const activePreview = activePreviewId
    ? previewPresets.find((p) => p.id === activePreviewId)
    : null;
  const previewSize = activePreview?.size ?? null;

  // When entering preview mode, deselect to avoid showing handles for a layer
  // whose bounds were reflowed and don't match what the user could resize.
  useEffect(() => {
    if (previewSize) editor.select(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSize?.w, previewSize?.h]);

  // Al seleccionar una capa (no-root), priorizamos Propiedades: la abrimos si
  // estaba colapsada y cerramos Variables y datos para que no compita por el
  // alto. El productor puede re-abrir Variables manualmente cuando quiera.
  // Cuando deselecciona o vuelve al root, no tocamos el acordeón (respetamos
  // su elección).
  const selectedLayerId = editor.selectedLayer?.id;
  useEffect(() => {
    if (!selectedLayerId || selectedLayerId === "tpl_root") return;
    setPropsSectionOpen(true);
    setDataSectionOpen(false);
  }, [selectedLayerId]);

  // Style clipboard. No vive en localStorage — es per-sesión y per-editor.
  // Guarda solo properties visuales (style/fill/stroke/cornerRadius/opacity/
  // rotation), NO position/size/content. Pegar style mantiene el contenido
  // del target intacto y solo le aplica el look del source.
  const styleClipboardRef = useRef<TemplateLayer | null>(null);

  // Keyboard shortcuts. Skip when typing in an input/textarea or in preview mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;

      // Undo / redo work even in text fields when no native handler claims them,
      // but to avoid breaking native input undo we skip if a text field is focused.
      // Both are also blocked while in preview mode since preview is read-only.
      if (mod && !isTextField) {
        const key = e.key.toLowerCase();
        // Cmd+A: seleccionar todos los root children. Necesita ir antes de
        // que el browser intercepte para "seleccionar todo el body".
        if (key === "a" && !e.shiftKey && !e.altKey) {
          if (previewSize) return;
          e.preventDefault();
          editor.selectAllRoot();
          return;
        }
        if (key === "z" && !e.shiftKey) {
          if (previewSize) return;
          e.preventDefault();
          editor.undo();
          return;
        }
        if ((key === "z" && e.shiftKey) || key === "y") {
          if (previewSize) return;
          e.preventDefault();
          editor.redo();
          return;
        }
        if (key === "d" && editor.selectedId && editor.selectedId !== "tpl_root" && !previewSize) {
          e.preventDefault();
          editor.duplicateLayer(editor.selectedId);
          return;
        }
        // Z-order keyboard shortcuts (Figma convention):
        //   Cmd+]        → forward (sube 1 nivel)
        //   Cmd+[        → backward (baja 1 nivel)
        //   Cmd+Shift+]  → bring to front (al tope)
        //   Cmd+Shift+[  → send to back (al fondo)
        // Solo aplica a capas root-level (que es donde reorderInParent funciona).
        if ((key === "]" || key === "[") && editor.selectedId && editor.selectedId !== "tpl_root" && !previewSize) {
          e.preventDefault();
          const op =
            key === "]"
              ? e.shiftKey
                ? "front"
                : "up"
              : e.shiftKey
                ? "back"
                : "down";
          editor.reorderInParent(editor.selectedId, op);
          return;
        }
        // Copy/paste style (Figma: Cmd+Opt+C / Cmd+Opt+V).
        //   Copia: snapshot del layer entero al clipboard ref.
        //   Pega: aplica style/fill/stroke/cornerRadius/opacity/rotation del
        //         source al target SOLO si comparten type (text→text,
        //         shape→shape, image→image). NO copia position/size/content.
        if (e.altKey && key === "c" && editor.selectedLayer && !previewSize) {
          e.preventDefault();
          styleClipboardRef.current = editor.selectedLayer;
          return;
        }
        if (e.altKey && key === "v" && editor.selectedLayer && styleClipboardRef.current && !previewSize) {
          e.preventDefault();
          const src = styleClipboardRef.current;
          const targetId = editor.selectedLayer.id;
          editor.updateLayer(targetId, (l) => applyStyleFromSource(l, src));
          return;
        }
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !isTextField) {
        if (previewSize) return;
        // En multi-select, borramos todas las del set en una pasada.
        // El hook clean-up de selectedIds por cada deleteLayer asegura que
        // el estado quede coherente. Excluimos tpl_root.
        const targets = (editor.selectedIds.length > 0
          ? editor.selectedIds
          : editor.selectedId
            ? [editor.selectedId]
            : []
        ).filter((id) => id !== "tpl_root");
        if (targets.length === 0) return;
        e.preventDefault();
        for (const id of targets) {
          editor.deleteLayer(id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, previewSize]);

  // Disable every editing surface (toolbar + side panels) while a preview is
  // active. The thumbnail bar and the "Volver al master" link stay
  // interactive because they live outside this wrapper.
  const readOnlyClass = previewSize
    ? "pointer-events-none opacity-60 select-none"
    : "";

  return (
    <div className="flex flex-col h-full bg-background">
      {contextMenu && ctxLayer && (
        <LayerContextMenu
          position={contextMenu}
          layer={ctxLayer}
          parentIsStack={!!ctxParentIsStack}
          onClose={closeContextMenu}
          onCenter={(axis) => editor.centerInParent(contextMenu.layerId, axis)}
          onReorder={(op) => editor.reorderInParent(contextMenu.layerId, op)}
          onDuplicate={() => editor.duplicateLayer(contextMenu.layerId)}
          onToggleLock={() => editor.toggleLock(contextMenu.layerId)}
          onDelete={() => editor.deleteLayer(contextMenu.layerId)}
        />
      )}

      <div className="flex flex-1 min-h-0">
        {/* Columna izquierda — Capas. Colapsable: cuando cerrada se ve
            como una banda fina con botón expand. */}
        {layersCollapsed ? (
          <div className="w-8 shrink-0 border-r border-border/50 bg-card/40 flex items-start justify-center py-2">
            <button
              type="button"
              onClick={() => setLayersCollapsed(false)}
              className="text-muted-foreground hover:text-foreground p-1 rounded"
              title="Mostrar capas"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          // h-full + flex propaga el alto al LayersPanel (que es h-full
          // flex-col internamente). Sin esto el aside queda sin altura y
          // muestra solo lo que cabe en el contenido natural.
          <div className={cn("flex h-full min-h-0", readOnlyClass)}>
            <LayersPanel
              definition={editor.definition}
              selectedId={editor.selectedId}
              selectedIds={editor.selectedIds}
              onSelect={editor.select}
              onDelete={editor.deleteLayer}
              onReorder={editor.reorderRootChildren}
              onToggleLock={editor.toggleLock}
              onLayerContextMenu={previewSize ? undefined : openContextMenu}
              onCollapse={() => setLayersCollapsed(true)}
            />
          </div>
        )}

        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Cuando el caller pasa un topAccessory (ej. la strip de
              variantes en producir), reemplaza al PreviewThumbnails
              auto-generated. Así la zona arriba del canvas sirve para
              cambiar de variante real en vez de ver previews read-only.
              Colapsable: el productor gana alto vertical para el canvas
              cuando ya identificó la variante en la que trabaja. */}
          {topAccessoryCollapsed ? (
            <div className="flex items-center justify-center gap-1.5 px-3 py-1 border-b border-border/50 bg-card/30">
              <button
                type="button"
                onClick={() => setTopAccessoryCollapsed(false)}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                title="Mostrar previews"
              >
                <ChevronDown className="h-3 w-3" />
                Mostrar previews
              </button>
            </div>
          ) : (
            <div className="relative">
              {topAccessory ?? (
                <PreviewThumbnails
                  definition={editor.definition}
                  brandKit={brandKit}
                  presets={previewPresets}
                  activePreviewId={activePreviewId}
                  onSelectPreview={setActivePreviewId}
                />
              )}
              <button
                type="button"
                onClick={() => setTopAccessoryCollapsed(true)}
                className="absolute top-1 right-1 z-10 flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Colapsar previews"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {topBanner}
          {previewSize && (
            <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-blue-500/10 text-blue-300 border-b border-blue-500/20">
              <span>
                Vista previa · {previewSize.w} × {previewSize.h} px ·
                Las ediciones están deshabilitadas.
              </span>
              <button
                type="button"
                onClick={() => setActivePreviewId(null)}
                className="underline hover:no-underline"
              >
                Volver al master
              </button>
            </div>
          )}
          {/* Toolbar vertical pegado al borde izquierdo del canvas (estilo
              Figma/Photoshop). Vive DENTRO de la columna central — no
              encima — para que el ancho ganado al colapsar Capas
              beneficie directo al canvas. En preview mode queda inactiva
              pero visible. */}
          <div className="flex flex-1 min-h-0">
            <div className={cn("flex", readOnlyClass)}>
              <EditorToolbar
                orientation="vertical"
                onAddText={editor.addText}
                onAddImage={editor.addImage}
                onAddShape={editor.addShape}
                onAddIcon={editor.addIcon}
                onAddButton={editor.addButton}
                onAddDivider={editor.addDivider}
                onAddBadge={editor.addBadge}
                onAddRibbon={editor.addRibbon}
                saveStatus={editor.saveStatus}
                lastSavedAt={editor.lastSavedAt}
                onOpenProjectBrandKit={undefined}
                onUndo={editor.undo}
                onRedo={editor.redo}
                canUndo={editor.canUndo}
                canRedo={editor.canRedo}
                showSafetyZone={showSafetyZone}
                onToggleSafetyZone={() => setShowSafetyZone((v) => !v)}
              />
            </div>
            <TemplateCanvas
              definition={canvasDefinition}
              selectedId={editor.selectedId}
              selectedIds={editor.selectedIds}
              onSelect={editor.select}
              onUpdateBounds={editor.updateBounds}
              previewSize={previewSize}
              brandKit={brandKit}
              dataRow={dataRow}
              onLayerContextMenu={openContextMenu}
              showSafetyZone={showSafetyZone}
            />
          </div>
          <TimelinePanel
            definition={editor.definition}
            templateId={templateId}
            currentTime={timeline.currentTime}
            isPlaying={timeline.isPlaying}
            collapsed={timeline.timelineCollapsed}
            selectedLayerId={editor.selectedId}
            onSeek={timeline.setCurrentTime}
            onPlayPause={timeline.togglePlayPause}
            onRewind={timeline.rewind}
            onToggleCollapsed={timeline.toggleTimelineCollapsed}
            onUpdateAnimation={(next) =>
              editor.updateRoot((root) => ({ ...root, animation: next }))
            }
          />
        </div>

        {/* Columna derecha — acordeón con Propiedades + rightAccessory.
            Cada sección se puede colapsar independiente; al menos una abierta
            ocupa el alto restante con scroll propio. Antes las secciones se
            apilaban sin scroll y se cortaba el contenido cuando había mucho
            que editar (texto + variables + dataset). */}
        {propsCollapsed ? (
          <div className="w-8 shrink-0 border-l border-border/50 bg-card/40 flex items-start justify-center py-2">
            <button
              type="button"
              onClick={() => setPropsCollapsed(false)}
              className="text-muted-foreground hover:text-foreground p-1 rounded"
              title="Mostrar propiedades"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-col shrink-0 w-64 border-l border-border/50 bg-card/40 min-h-0",
              readOnlyClass,
            )}
          >
            <AccordionSection
              title={
                editor.selectedIds.length > 1
                  ? `${editor.selectedIds.length} capas`
                  : accordionPropsTitle(editor.selectedLayer)
              }
              open={propsSectionOpen}
              onToggle={() => setPropsSectionOpen((v) => !v)}
              trailing={
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPropsCollapsed(true);
                  }}
                  className="text-muted-foreground hover:text-foreground p-0.5 rounded"
                  title="Colapsar columna"
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                </button>
              }
            >
              <PropertiesPanel
                definition={editor.definition}
                selectedLayer={editor.selectedLayer}
                selectedIds={editor.selectedIds}
                onAlign={editor.alignSelected}
                onDistribute={editor.distributeSelected}
                onUpdateLayer={updateLayerAutoKf}
                onUpdateRoot={editor.updateRoot}
                brandKit={brandKit}
                clientId={clientId ?? null}
                projectId={projectId}
                allBrandKits={allBrandKits}
                onBrandKitsChange={onBrandKitsChange}
                embedded
              />
            </AccordionSection>
            {rightAccessory && (
              <AccordionSection
                title="Variables y datos"
                open={dataSectionOpen}
                onToggle={() => setDataSectionOpen((v) => !v)}
              >
                {rightAccessory}
              </AccordionSection>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Título de la sección Propiedades — varía según la capa seleccionada (la
// lógica vivía adentro de PropertiesPanel; al embeberlo en el acordeón
// movemos el cálculo acá para que el header del acordeón refleje el contexto).
// Aplica las propiedades visuales del source al target preservando contenido
// estructural (position, size, content/src/shape). Solo aplica si comparten
// type — pegar style de un text en una image no tiene sentido y se ignora.
//
// Properties que viajan:
//   - todos: opacity, rotation, constraints.
//   - text → text: style completo (font, size, color, align, etc.).
//   - shape → shape: fill, stroke, cornerRadius (NO el shape kind para no
//     transformar rect en ellipse).
//   - image → image: cornerRadius, fit.
//   - frame → frame: background, cornerRadius (NO layout, no children).
function applyStyleFromSource(target: TemplateLayer, source: TemplateLayer): TemplateLayer {
  if (target.type !== source.type) return target;
  const common: Partial<TemplateLayer> = {
    opacity: source.opacity,
    rotation: source.rotation,
    constraints: source.constraints,
  };
  if (target.type === "text" && source.type === "text") {
    return { ...target, ...common, style: source.style } as TemplateLayer;
  }
  if (target.type === "shape" && source.type === "shape") {
    return {
      ...target,
      ...common,
      fill: source.fill,
      stroke: source.stroke,
      cornerRadius: source.cornerRadius,
    } as TemplateLayer;
  }
  if (target.type === "image" && source.type === "image") {
    return {
      ...target,
      ...common,
      cornerRadius: source.cornerRadius,
      fit: source.fit,
    } as TemplateLayer;
  }
  if (target.type === "frame" && source.type === "frame") {
    return {
      ...target,
      ...common,
      background: source.background,
      cornerRadius: source.cornerRadius,
    } as TemplateLayer;
  }
  if (target.type === "icon" && source.type === "icon") {
    return {
      ...target,
      ...common,
      color: source.color,
      strokeWidth: source.strokeWidth,
    } as TemplateLayer;
  }
  return target;
}

function accordionPropsTitle(selectedLayer: TemplateLayer | null): string {
  if (!selectedLayer) return "Propiedades";
  if (selectedLayer.id === "tpl_root") return "Canvas";
  switch (selectedLayer.type) {
    case "text":
      return "Texto";
    case "image":
      return "Imagen";
    case "shape":
      return "Forma";
    case "icon":
      return "Ícono";
    case "frame":
      return "Frame";
  }
}

// Sección colapsable del acordeón. Header clickable con chevron + título +
// slot opcional para acciones (ej. cerrar la columna entera). Cuando open
// el body ocupa el espacio disponible (flex-1) con scroll propio; cuando
// cerrado solo se ve el header. Varias secciones abiertas comparten alto
// equitativamente — las cerradas se aplastan al header.
function AccordionSection({
  title,
  open,
  onToggle,
  trailing,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col border-b border-border/50 last:border-b-0 min-h-0",
        open ? "flex-1" : "shrink-0",
      )}
    >
      <header className="flex items-center justify-between px-3 py-2 bg-card/60 hover:bg-card/80 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
        </button>
        {trailing}
      </header>
      {open && <div className="flex-1 min-h-0 overflow-hidden">{children}</div>}
    </section>
  );
}
