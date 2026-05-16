"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TemplateDefinition,
  TemplateLayer,
  newRootFrame,
  newTextLayer,
  newImageLayer,
  newShapeLayer,
  updateLayer as updateLayerInTree,
  addLayerToFrame,
  deleteLayer as deleteLayerInTree,
  findLayer,
} from "./types";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface UseTemplateEditorOptions {
  initial: TemplateDefinition;
  baseWidth: number;
  baseHeight: number;
  onSave: (definition: TemplateDefinition) => Promise<void>;
  autosaveDelayMs?: number;
}

interface UseTemplateEditorResult {
  definition: TemplateDefinition;
  selectedId: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;

  select: (id: string | null) => void;
  selectedLayer: TemplateLayer | null;

  addText: () => void;
  addImage: () => void;
  addShape: () => void;

  updateLayer: (id: string, mutator: (layer: TemplateLayer) => TemplateLayer) => void;
  updateRoot: (mutator: (root: TemplateDefinition) => TemplateDefinition) => void;
  updateBounds: (id: string, bounds: { x: number; y: number; w: number; h: number }) => void;
  reorderRootChildren: (sourceId: string, targetId: string, position: "before" | "after") => void;
  deleteLayer: (id: string) => void;

  saveNow: () => Promise<void>;
}

// Validate that the loaded definition is well-formed. If not, return a fresh root.
function ensureValid(
  def: unknown,
  baseWidth: number,
  baseHeight: number
): TemplateDefinition {
  if (
    def &&
    typeof def === "object" &&
    (def as { type?: string }).type === "frame" &&
    (def as { id?: string }).id === "tpl_root"
  ) {
    const d = def as TemplateDefinition;
    if (!Array.isArray(d.children)) {
      return { ...d, children: [] };
    }
    return d;
  }
  return newRootFrame(baseWidth, baseHeight);
}

export function useTemplateEditor({
  initial,
  baseWidth,
  baseHeight,
  onSave,
  autosaveDelayMs = 1000,
}: UseTemplateEditorOptions): UseTemplateEditorResult {
  const [definition, setDefinition] = useState<TemplateDefinition>(() =>
    ensureValid(initial, baseWidth, baseHeight)
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Track whether definition has been touched after mount; otherwise the
  // initial load itself would trigger an autosave.
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<TemplateDefinition | null>(null);

  const flushSave = useCallback(
    async (def: TemplateDefinition) => {
      if (inFlightRef.current) {
        pendingRef.current = def;
        return;
      }
      inFlightRef.current = true;
      setSaveStatus("saving");
      try {
        await onSave(def);
        setSaveStatus("saved");
        setLastSavedAt(new Date());
      } catch (err) {
        console.error("Error guardando template:", err);
        setSaveStatus("error");
      } finally {
        inFlightRef.current = false;
        if (pendingRef.current) {
          const next = pendingRef.current;
          pendingRef.current = null;
          await flushSave(next);
        }
      }
    },
    [onSave]
  );

  // Debounced autosave on definition changes.
  useEffect(() => {
    if (!dirtyRef.current) return;
    setSaveStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushSave(definition);
    }, autosaveDelayMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [definition, autosaveDelayMs, flushSave]);

  const mutate = useCallback(
    (mutator: (d: TemplateDefinition) => TemplateDefinition) => {
      dirtyRef.current = true;
      setDefinition((prev) => mutator(prev));
    },
    []
  );

  const updateLayer = useCallback(
    (id: string, layerMutator: (layer: TemplateLayer) => TemplateLayer) => {
      mutate((d) => updateLayerInTree(d, id, layerMutator));
    },
    [mutate]
  );

  const updateRoot = useCallback(
    (rootMutator: (root: TemplateDefinition) => TemplateDefinition) => {
      mutate(rootMutator);
    },
    [mutate]
  );

  const addText = useCallback(() => {
    const layer = newTextLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    setSelectedId(layer.id);
  }, [baseWidth, baseHeight, mutate]);

  const addImage = useCallback(() => {
    const layer = newImageLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    setSelectedId(layer.id);
  }, [baseWidth, baseHeight, mutate]);

  const addShape = useCallback(() => {
    const layer = newShapeLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    setSelectedId(layer.id);
  }, [baseWidth, baseHeight, mutate]);

  const updateBounds = useCallback(
    (id: string, bounds: { x: number; y: number; w: number; h: number }) => {
      mutate((d) =>
        updateLayerInTree(d, id, (l) => ({
          ...l,
          position: { x: bounds.x, y: bounds.y },
          size: { w: bounds.w, h: bounds.h },
        }))
      );
    },
    [mutate]
  );

  const reorderRootChildren = useCallback(
    (sourceId: string, targetId: string, position: "before" | "after") => {
      if (sourceId === targetId) return;
      mutate((d) => {
        const ids = d.children.map((c) => c.id);
        const srcIdx = ids.indexOf(sourceId);
        const tgtIdx = ids.indexOf(targetId);
        if (srcIdx === -1 || tgtIdx === -1) return d;
        const next = [...d.children];
        const [moved] = next.splice(srcIdx, 1);
        // Recompute target index after removal
        const newIdx = next.findIndex((c) => c.id === targetId);
        if (newIdx === -1) return d;
        const insertAt = position === "before" ? newIdx : newIdx + 1;
        next.splice(insertAt, 0, moved);
        return { ...d, children: next };
      });
    },
    [mutate]
  );

  const deleteLayer = useCallback(
    (id: string) => {
      if (id === "tpl_root") return;
      mutate((d) => deleteLayerInTree(d, id));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [mutate]
  );

  const saveNow = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await flushSave(definition);
  }, [definition, flushSave]);

  const selectedLayer = selectedId ? findLayer(definition, selectedId) : null;

  return {
    definition,
    selectedId,
    saveStatus,
    lastSavedAt,
    select: setSelectedId,
    selectedLayer,
    addText,
    addImage,
    addShape,
    updateLayer,
    updateRoot,
    updateBounds,
    reorderRootChildren,
    deleteLayer,
    saveNow,
  };
}
