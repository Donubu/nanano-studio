"use client";

import { useEffect, useMemo, useState } from "react";
import { TemplateDefinition } from "@/lib/production/types";
import { BrandKit, BrandKitContent, EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { useTemplateEditor } from "@/lib/production/use-template-editor";
import { TemplateCanvas } from "./template-canvas";
import { LayersPanel } from "./layers-panel";
import { PropertiesPanel } from "./properties-panel";
import { EditorToolbar, PreviewPreset } from "./editor-toolbar";
import { ProjectBrandKitModal } from "./project-brand-kit-modal";

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

  const canOpenProjectKit = !!(clientId && projectId);

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

  // Delete selected layer with Backspace/Delete (ignore when typing or previewing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      if (previewSize) return;
      if (!editor.selectedId || editor.selectedId === "tpl_root") return;
      e.preventDefault();
      editor.deleteLayer(editor.selectedId);
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
        />
        <TemplateCanvas
          definition={editor.definition}
          selectedId={editor.selectedId}
          onSelect={editor.select}
          onUpdateBounds={editor.updateBounds}
          previewSize={previewSize}
          brandKit={brandKit}
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
