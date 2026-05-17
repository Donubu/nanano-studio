"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TemplateDefinition, findLayer, findParent } from "@/lib/production/types";
import { BrandKit, BrandKitContent, EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
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
}: Props) {
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
        <div className={readOnlyClass}>
          <LayersPanel
            definition={editor.definition}
            selectedId={editor.selectedId}
            onSelect={editor.select}
            onDelete={editor.deleteLayer}
            onReorder={editor.reorderRootChildren}
            onToggleLock={editor.toggleLock}
            onLayerContextMenu={previewSize ? undefined : openContextMenu}
          />
        </div>
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
            onLayerContextMenu={openContextMenu}
          />
        </div>
        <div className={readOnlyClass}>
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
          />
        </div>
      </div>
    </div>
  );
}
