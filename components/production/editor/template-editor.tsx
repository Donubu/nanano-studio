"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { TemplateDefinition, TemplateLayer, findLayer, findParent } from "@/lib/production/types";
import { BrandKit, BrandKitContent, EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { DataRow } from "@/lib/production/variables";
import { useTemplateEditor } from "@/lib/production/use-template-editor";
import { TemplateCanvas } from "./template-canvas";
import { LayersPanel } from "./layers-panel";
import { PropertiesPanel } from "./properties-panel";
import { EditorToolbar } from "./editor-toolbar";
import { PreviewThumbnails, ThumbnailPreset } from "./preview-thumbnails";
import { ProjectBrandKitModal } from "./project-brand-kit-modal";
import { LayerContextMenu, LayerContextMenuPosition } from "./layer-context-menu";

interface Props {
  initial: TemplateDefinition;
  baseWidth: number;
  baseHeight: number;
  onSave: (definition: TemplateDefinition) => Promise<void>;
  brandKit?: BrandKitContent;
  clientId?: number | null;
  projectId?: number;
  allBrandKits?: BrandKit[];
  onBrandKitsChange?: () => void;
  // Custom node rendered above the canvas en lugar del PreviewThumbnails
  // default. Lo usa producir para mostrar variantes reales del master.
  topAccessory?: React.ReactNode;
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
  allBrandKits = [],
  onBrandKitsChange,
  topAccessory,
  rightAccessory,
  dataRow,
}: Props) {
  // Estado de colapso de los paneles laterales. Por default abiertos.
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [propsCollapsed, setPropsCollapsed] = useState(false);
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
  const [showProjectKit, setShowProjectKit] = useState(false);
  const [contextMenu, setContextMenu] = useState<LayerContextMenuPosition | null>(null);

  const canOpenProjectKit = !!(clientId && projectId);

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
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !isTextField) {
        if (previewSize) return;
        if (!editor.selectedId || editor.selectedId === "tpl_root") return;
        e.preventDefault();
        editor.deleteLayer(editor.selectedId);
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
      <div className={readOnlyClass}>
        <EditorToolbar
          onAddText={editor.addText}
          onAddImage={editor.addImage}
          onAddShape={editor.addShape}
          saveStatus={editor.saveStatus}
          lastSavedAt={editor.lastSavedAt}
          onOpenProjectBrandKit={
            canOpenProjectKit ? () => setShowProjectKit(true) : undefined
          }
          onUndo={editor.undo}
          onRedo={editor.redo}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
        />
      </div>

      {showProjectKit && clientId && projectId && (
        <ProjectBrandKitModal
          clientId={clientId}
          projectId={projectId}
          existingKits={allBrandKits}
          onClose={() => setShowProjectKit(false)}
          onChanged={() => onBrandKitsChange?.()}
        />
      )}

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
          <div className={readOnlyClass}>
            <LayersPanel
              definition={editor.definition}
              selectedId={editor.selectedId}
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
              cambiar de variante real en vez de ver previews read-only. */}
          {topAccessory ?? (
            <PreviewThumbnails
              definition={editor.definition}
              brandKit={brandKit}
              presets={previewPresets}
              activePreviewId={activePreviewId}
              onSelectPreview={setActivePreviewId}
            />
          )}
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
          <TemplateCanvas
            definition={editor.definition}
            selectedId={editor.selectedId}
            onSelect={editor.select}
            onUpdateBounds={editor.updateBounds}
            previewSize={previewSize}
            brandKit={brandKit}
            dataRow={dataRow}
            onLayerContextMenu={openContextMenu}
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
              title={accordionPropsTitle(editor.selectedLayer)}
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
                onUpdateLayer={editor.updateLayer}
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
