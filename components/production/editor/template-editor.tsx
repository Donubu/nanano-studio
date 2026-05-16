"use client";

import { useEffect } from "react";
import { TemplateDefinition } from "@/lib/production/types";
import { useTemplateEditor } from "@/lib/production/use-template-editor";
import { TemplateCanvas } from "./template-canvas";
import { LayersPanel } from "./layers-panel";
import { PropertiesPanel } from "./properties-panel";
import { EditorToolbar } from "./editor-toolbar";

interface Props {
  initial: TemplateDefinition;
  baseWidth: number;
  baseHeight: number;
  onSave: (definition: TemplateDefinition) => Promise<void>;
}

export function TemplateEditor({ initial, baseWidth, baseHeight, onSave }: Props) {
  const editor = useTemplateEditor({
    initial,
    baseWidth,
    baseHeight,
    onSave,
  });

  // Delete selected layer with Backspace/Delete (ignore when typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      if (!editor.selectedId || editor.selectedId === "tpl_root") return;
      e.preventDefault();
      editor.deleteLayer(editor.selectedId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  return (
    <div className="flex flex-col h-full bg-background">
      <EditorToolbar
        onAddText={editor.addText}
        onAddImage={editor.addImage}
        onAddShape={editor.addShape}
        saveStatus={editor.saveStatus}
        lastSavedAt={editor.lastSavedAt}
      />
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
        />
        <PropertiesPanel
          definition={editor.definition}
          selectedLayer={editor.selectedLayer}
          onUpdateLayer={editor.updateLayer}
          onUpdateRoot={editor.updateRoot}
        />
      </div>
    </div>
  );
}
