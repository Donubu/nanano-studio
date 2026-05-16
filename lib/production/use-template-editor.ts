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
  findParent,
  cloneWithNewIds,
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
  reorderInParent: (id: string, op: "front" | "back" | "up" | "down") => void;
  centerInParent: (id: string, axis: "h" | "v" | "both") => void;
  toggleLock: (id: string) => void;
  deleteLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;

  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

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

const HISTORY_LIMIT = 50;
// Rapid edits within this window are folded into the same undo entry: dragging
// a slider should be one undo, not one per keystroke.
const SNAPSHOT_MERGE_MS = 500;

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

  // History stacks. `past[top]` is the state right before the latest user edit,
  // i.e. what undo will restore. `future` is filled by undo and consumed by redo.
  const [past, setPast] = useState<TemplateDefinition[]>([]);
  const [future, setFuture] = useState<TemplateDefinition[]>([]);
  const lastSnapshotAtRef = useRef<number>(0);

  // Save plumbing
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

  // User-initiated mutation: push prev into past, clear future, then apply.
  // Rapid sequential edits (slider drag, repeated key) collapse into one undo
  // entry by skipping the snapshot when the previous one was just taken.
  const mutate = useCallback(
    (mutator: (d: TemplateDefinition) => TemplateDefinition) => {
      dirtyRef.current = true;
      setDefinition((prev) => {
        const now = Date.now();
        const shouldSnapshot = now - lastSnapshotAtRef.current >= SNAPSHOT_MERGE_MS;
        lastSnapshotAtRef.current = now;
        if (shouldSnapshot) {
          setPast((p) => {
            const np = [...p, prev];
            if (np.length > HISTORY_LIMIT) np.shift();
            return np;
          });
          setFuture([]);
        }
        return mutator(prev);
      });
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
        const newIdx = next.findIndex((c) => c.id === targetId);
        if (newIdx === -1) return d;
        const insertAt = position === "before" ? newIdx : newIdx + 1;
        next.splice(insertAt, 0, moved);
        return { ...d, children: next };
      });
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

  const reorderInParent = useCallback(
    (id: string, op: "front" | "back" | "up" | "down") => {
      if (id === "tpl_root") return;
      mutate((d) => {
        const parent = findParent(d, id);
        if (!parent) return d;
        const children = [...parent.children];
        const idx = children.findIndex((c) => c.id === id);
        if (idx === -1) return d;
        let newIdx: number;
        switch (op) {
          case "front": newIdx = children.length - 1; break;
          case "back":  newIdx = 0; break;
          case "up":    newIdx = Math.min(children.length - 1, idx + 1); break;
          case "down":  newIdx = Math.max(0, idx - 1); break;
        }
        if (newIdx === idx) return d;
        const [moved] = children.splice(idx, 1);
        children.splice(newIdx, 0, moved);
        return updateLayerInTree(d, parent.id, (l) =>
          l.type === "frame" ? { ...l, children } : l
        );
      });
    },
    [mutate]
  );

  const centerInParent = useCallback(
    (id: string, axis: "h" | "v" | "both") => {
      if (id === "tpl_root") return;
      mutate((d) => {
        const layer = findLayer(d, id);
        const parent = findParent(d, id);
        if (!layer || !parent) return d;
        // Centering doesn't apply in a stack-laid parent (the layout computes
        // position). Caller should hide the option, but guard anyway.
        if (parent.layout.mode === "stack") return d;
        const newX =
          axis === "h" || axis === "both"
            ? Math.round((parent.size.w - layer.size.w) / 2)
            : layer.position.x;
        const newY =
          axis === "v" || axis === "both"
            ? Math.round((parent.size.h - layer.size.h) / 2)
            : layer.position.y;
        return updateLayerInTree(d, id, (l) => ({
          ...l,
          position: { x: newX, y: newY },
        }));
      });
    },
    [mutate]
  );

  const toggleLock = useCallback(
    (id: string) => {
      if (id === "tpl_root") return;
      mutate((d) => updateLayerInTree(d, id, (l) => ({ ...l, locked: !l.locked })));
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

  const duplicateLayer = useCallback(
    (id: string) => {
      if (id === "tpl_root") return;
      // Need to resolve in the current state synchronously, so we read from
      // the closure-captured `definition`. If the user fires duplicate twice
      // in the same tick, the second runs against the same source — acceptable.
      const source = findLayer(definition, id);
      if (!source) return;
      const parent = findParent(definition, id);
      const parentId = parent?.id ?? "tpl_root";
      const cloned = cloneWithNewIds(source);
      // Offset the clone slightly so it's visible next to the original.
      cloned.position = {
        x: source.position.x + 20,
        y: source.position.y + 20,
      };
      mutate((d) => addLayerToFrame(d, parentId, cloned));
      setSelectedId(cloned.id);
    },
    [definition, mutate]
  );

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      const newPast = p.slice(0, -1);
      setDefinition((cur) => {
        setFuture((f) => {
          const nf = [...f, cur];
          if (nf.length > HISTORY_LIMIT) nf.shift();
          return nf;
        });
        return prev;
      });
      dirtyRef.current = true;
      lastSnapshotAtRef.current = 0; // next mutation will snapshot fresh
      return newPast;
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      const newFuture = f.slice(0, -1);
      setDefinition((cur) => {
        setPast((p) => {
          const np = [...p, cur];
          if (np.length > HISTORY_LIMIT) np.shift();
          return np;
        });
        return next;
      });
      dirtyRef.current = true;
      lastSnapshotAtRef.current = 0;
      return newFuture;
    });
  }, []);

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
    reorderInParent,
    centerInParent,
    toggleLock,
    deleteLayer,
    duplicateLayer,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    saveNow,
  };
}
