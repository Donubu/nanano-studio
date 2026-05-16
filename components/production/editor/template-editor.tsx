"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TemplateDefinition, findLayer, findParent } from "@/lib/production/types";
import { BrandKit, BrandKitContent, EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { useTemplateEditor } from "@/lib/production/use-template-editor";
import { TemplateCanvas } from "./template-canvas";
import { LayersPanel } from "./layers-panel";
import { PropertiesPanel } from "./properties-panel";
import { EditorToolbar, PreviewPreset } from "./editor-toolbar";
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
}: Props) {
  const editor = useTemplateEditor({
    initial,
    baseWidth,
    baseHeight,
    onSave,
  });

  const previewPresets: PreviewPreset[] = useMemo(
    () => [
      { id: "master", label: "Master", size: null },
      { id: "square", label: "□ 1:1", size: { w: 1080, h: 1080 } },
      { id: "vertical", label: "↕ 9:16", size: { w: 1080, h: 1920 } },
      { id: "horizontal", label: "↔ 16:9", size: { w: 1920, h: 1080 } },
    ],
    []
  );
  const [activePreviewId, setActivePreviewId] = useState("master");
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

  // If editor.selectedId changes, clear preview? No — keep preview persistent
  // until user toggles. They may want to inspect different selections.
  const activePreview = previewPresets.find((p) => p.id === activePreviewId) ?? previewPresets[0];
  const previewSize = activePreview.size; // null = master (full edit)

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
      if (mod && !isTextField) {
        const key = e.key.toLowerCase();
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          editor.undo();
          return;
        }
        if ((key === "z" && e.shiftKey) || key === "y") {
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

  return (
    <div className="flex flex-col h-full bg-background">
      <EditorToolbar
        onAddText={editor.addText}
        onAddImage={editor.addImage}
        onAddShape={editor.addShape}
        saveStatus={editor.saveStatus}
        lastSavedAt={editor.lastSavedAt}
        previewPresets={previewPresets}
        activePreviewId={activePreviewId}
        onSelectPreview={setActivePreviewId}
        onOpenProjectBrandKit={
          canOpenProjectKit ? () => setShowProjectKit(true) : undefined
        }
        onUndo={editor.undo}
        onRedo={editor.redo}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
      />

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

      {previewSize && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-blue-500/10 text-blue-300 border-b border-blue-500/20">
          <span>
            Vista previa · {previewSize.w} × {previewSize.h} px ·
            Las ediciones están deshabilitadas.
          </span>
          <button
            type="button"
            onClick={() => setActivePreviewId("master")}
            className="underline hover:no-underline"
          >
            Volver al master
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <LayersPanel
          definition={editor.definition}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          onDelete={editor.deleteLayer}
          onReorder={editor.reorderRootChildren}
          onToggleLock={editor.toggleLock}
          onLayerContextMenu={previewSize ? undefined : openContextMenu}
        />
        <TemplateCanvas
          definition={editor.definition}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          onUpdateBounds={editor.updateBounds}
          previewSize={previewSize}
          brandKit={brandKit}
          onLayerContextMenu={openContextMenu}
        />
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
  );
}
