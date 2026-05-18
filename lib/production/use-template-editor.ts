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
  addLayersToFrame,
  deleteLayer as deleteLayerInTree,
  findLayer,
  findParent,
  cloneWithNewIds,
} from "./types";
import {
  newButtonLayers,
  newDividerLayer,
  newBadgeLayers,
  newRibbonLayers,
} from "./preset-layers";

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

interface UseTemplateEditorOptions {
  initial: TemplateDefinition;
  baseWidth: number;
  baseHeight: number;
  onSave: (definition: TemplateDefinition) => Promise<void>;
  autosaveDelayMs?: number;
}

// Tipo de alineación + distribución para batch operations sobre múltiples
// capas. align se aplica al bounding box común; distribute requiere 3+
// capas y reparte equidistante entre la primera y la última en el eje.
export type AlignDirection =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "center-v"
  | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

interface UseTemplateEditorResult {
  definition: TemplateDefinition;
  selectedId: string | null;
  // Multi-select. Cuando length > 1, properties panel muestra align toolbar.
  // selectedId queda como el "primary" — típicamente el último clickeado,
  // sirve para single-layer ops que no tienen sentido en batch.
  selectedIds: string[];
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;

  // select(id, { additive }) — additive=true (Cmd/Shift+click) toggle en
  // selectedIds. Sin modifier, reemplaza la selección por [id].
  select: (id: string | null, opts?: { additive?: boolean }) => void;
  // Selecciona TODOS los root children (Cmd+A).
  selectAllRoot: () => void;
  selectedLayer: TemplateLayer | null;
  alignSelected: (direction: AlignDirection) => void;
  distributeSelected: (axis: DistributeAxis) => void;

  addText: () => void;
  addImage: () => void;
  addShape: () => void;
  addButton: () => void;
  addDivider: () => void;
  addBadge: () => void;
  addRibbon: () => void;

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
  // Multi-select. Invariante: selectedId siempre está dentro de selectedIds
  // cuando selectedId no es null. Cuando selectedIds.length > 1, selectedId
  // queda como el "primary" (último clickeado/agregado).
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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

  // Reemplaza la selección por un solo id (o limpia). Usado internamente
  // por addX, duplicate, etc. — siempre que la acción produce una nueva
  // selección "primary" y descarta cualquier multi-select previo.
  const selectSingle = useCallback((id: string | null) => {
    setSelectedId(id);
    setSelectedIds(id ? [id] : []);
  }, []);

  // Selección pública: con additive=true (Cmd/Shift+click) hace toggle en
  // el array, mantiene multi. Sin additive (click normal) reemplaza la
  // selección al id.
  const select = useCallback(
    (id: string | null, opts?: { additive?: boolean }) => {
      if (!opts?.additive || !id) {
        selectSingle(id);
        return;
      }
      setSelectedIds((cur) => {
        if (cur.includes(id)) {
          // Deselecciona si ya estaba. El primary cae al último restante.
          const next = cur.filter((x) => x !== id);
          setSelectedId(next.length > 0 ? next[next.length - 1] : null);
          return next;
        }
        // Agrega y lo vuelve primary.
        setSelectedId(id);
        return [...cur, id];
      });
    },
    [selectSingle]
  );

  // Cmd+A: selecciona todos los root children. Útil para batch ops sobre
  // toda la composición (ej. mover todo, aplicar align a todas las capas).
  const selectAllRoot = useCallback(() => {
    const ids = definition.children.map((c) => c.id);
    if (ids.length === 0) {
      selectSingle(null);
      return;
    }
    setSelectedIds(ids);
    setSelectedId(ids[ids.length - 1]);
  }, [definition.children, selectSingle]);

  // Alinea las capas seleccionadas al bounding box común. Para ops L/R/T/B
  // las capas se mueven al borde correspondiente del BB; para center-* al
  // centro del BB. Solo aplica a root children — anidadas tendrían que
  // recalcular coords contra su padre y por ahora postergamos esa lógica.
  const alignSelected = useCallback(
    (direction: AlignDirection) => {
      const layers = selectedIds
        .map((id) => findLayer(definition, id))
        .filter(
          (l): l is TemplateLayer => l != null && l.id !== "tpl_root",
        );
      // Filtramos a root children solo. Si hay capas anidadas en frames,
      // las ignoramos por ahora (no rompemos su layout local).
      const rootChildIds = new Set(definition.children.map((c) => c.id));
      const rootLayers = layers.filter((l) => rootChildIds.has(l.id));
      if (rootLayers.length < 2) return;

      const minX = Math.min(...rootLayers.map((l) => l.position.x));
      const minY = Math.min(...rootLayers.map((l) => l.position.y));
      const maxX = Math.max(...rootLayers.map((l) => l.position.x + l.size.w));
      const maxY = Math.max(...rootLayers.map((l) => l.position.y + l.size.h));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      mutate((d) => {
        let next = d;
        for (const l of rootLayers) {
          let nx = l.position.x;
          let ny = l.position.y;
          switch (direction) {
            case "left":
              nx = minX;
              break;
            case "center-h":
              nx = Math.round(centerX - l.size.w / 2);
              break;
            case "right":
              nx = maxX - l.size.w;
              break;
            case "top":
              ny = minY;
              break;
            case "center-v":
              ny = Math.round(centerY - l.size.h / 2);
              break;
            case "bottom":
              ny = maxY - l.size.h;
              break;
          }
          next = updateLayerInTree(next, l.id, (cur) => ({
            ...cur,
            position: { x: nx, y: ny },
          }));
        }
        return next;
      });
    },
    [selectedIds, definition, mutate]
  );

  // Distribuye las capas en el eje indicado dejando gaps iguales entre
  // ellas, fijando la primera y la última. Requiere 3+ capas (con 2 no
  // hay nada que repartir).
  const distributeSelected = useCallback(
    (axis: DistributeAxis) => {
      const layers = selectedIds
        .map((id) => findLayer(definition, id))
        .filter(
          (l): l is TemplateLayer => l != null && l.id !== "tpl_root",
        );
      const rootChildIds = new Set(definition.children.map((c) => c.id));
      const rootLayers = layers.filter((l) => rootChildIds.has(l.id));
      if (rootLayers.length < 3) return;

      const sorted = [...rootLayers].sort((a, b) => {
        if (axis === "horizontal") return a.position.x - b.position.x;
        return a.position.y - b.position.y;
      });

      const isH = axis === "horizontal";
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = isH
        ? last.position.x + last.size.w - first.position.x
        : last.position.y + last.size.h - first.position.y;
      const totalContent = sorted.reduce(
        (s, l) => s + (isH ? l.size.w : l.size.h),
        0,
      );
      const gap = (span - totalContent) / (sorted.length - 1);

      mutate((d) => {
        let next = d;
        let cursor = isH ? first.position.x : first.position.y;
        for (const l of sorted) {
          const rounded = Math.round(cursor);
          next = updateLayerInTree(next, l.id, (cur) => ({
            ...cur,
            position: isH
              ? { x: rounded, y: cur.position.y }
              : { x: cur.position.x, y: rounded },
          }));
          cursor += (isH ? l.size.w : l.size.h) + gap;
        }
        return next;
      });
    },
    [selectedIds, definition, mutate]
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
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addImage = useCallback(() => {
    const layer = newImageLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addShape = useCallback(() => {
    const layer = newShapeLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  // Inserciones de presets compuestos. Cada uno crea las capas en orden
  // natural de z (background primero, foreground después) y selecciona la
  // última (típicamente el texto, donde el productor suele querer editar
  // primero).
  const addButton = useCallback(() => {
    const layers = newButtonLayers(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayersToFrame(d, "tpl_root", layers));
    selectSingle(layers[layers.length - 1]!.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addDivider = useCallback(() => {
    const layer = newDividerLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addBadge = useCallback(() => {
    const layers = newBadgeLayers(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayersToFrame(d, "tpl_root", layers));
    selectSingle(layers[layers.length - 1]!.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addRibbon = useCallback(() => {
    const layers = newRibbonLayers(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayersToFrame(d, "tpl_root", layers));
    selectSingle(layers[layers.length - 1]!.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

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
      // Limpiamos el id borrado de ambos estados de selección.
      setSelectedIds((cur) => cur.filter((x) => x !== id));
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
      selectSingle(cloned.id);
    },
    [definition, mutate, selectSingle]
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
    selectedIds,
    saveStatus,
    lastSavedAt,
    select,
    selectAllRoot,
    selectedLayer,
    alignSelected,
    distributeSelected,
    addText,
    addImage,
    addShape,
    addButton,
    addDivider,
    addBadge,
    addRibbon,
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
