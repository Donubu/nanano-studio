"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  TemplateDefinition,
  TemplateLayer,
  FrameLayer,
  newRootFrame,
  newTextLayer,
  newImageLayer,
  newShapeLayer,
  newIconLayer,
  updateLayer as updateLayerInTree,
  addLayerToFrame,
  deleteLayer as deleteLayerInTree,
  findLayer,
  findParent,
  cloneWithNewIds,
} from "./types";
import {
  newButtonLayer,
  newDividerLayer,
  newBadgeLayer,
  newRibbonLayer,
} from "./preset-layers";
import {
  isMergeableShape,
  isMergeableText,
  mergeShapeAndText,
} from "./composites";

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
  // true cuando la selección es exactamente un shape + un text fusionables.
  canMergeSelection: boolean;
  mergeSelectedIntoButton: () => void;
  // Grupos: frame libre que envuelve la selección (mismo padre). Ungroup
  // devuelve los hijos al padre del frame conservando su posición visual.
  canGroupSelection: boolean;
  groupSelected: () => void;
  canUngroupSelection: boolean;
  ungroupSelected: () => void;
  // Mover la selección con las flechas (dx/dy en px del canvas).
  nudgeSelected: (dx: number, dy: number) => void;
  toggleVisible: (id: string) => void;

  addText: () => void;
  addImage: () => void;
  addShape: () => void;
  addIcon: () => void;
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

// Filtra `layers` a las que comparten padre con la primera. Las coordenadas
// son locales al padre, así que alinear/distribuir solo tiene sentido entre
// hermanos.
function siblingsOf(definition: TemplateDefinition, layers: TemplateLayer[]): TemplateLayer[] {
  if (layers.length === 0) return [];
  const parentId = (findParent(definition, layers[0].id) ?? definition).id;
  return layers.filter((l) => (findParent(definition, l.id) ?? definition).id === parentId);
}

function newLayerId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
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
      // Solo alineamos capas que comparten padre (las coordenadas son
      // locales a ese padre). Tomamos el padre de la primera seleccionada y
      // filtramos las demás a ese mismo padre.
      const rootLayers = siblingsOf(definition, layers);
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

  // Agrupar: envuelve la selección (2+ capas con el mismo padre, en layout
  // libre) en un frame libre con el bounding box común. Las capas pasan a
  // coordenadas locales del frame y conservan su orden z relativo; el frame
  // ocupa la posición z del miembro más alto para no cambiar qué tapa a qué.
  const groupCandidate = (() => {
    if (selectedIds.length < 2) return null;
    const layers = selectedIds
      .map((id) => findLayer(definition, id))
      .filter((l): l is TemplateLayer => l != null && l.id !== "tpl_root");
    if (layers.length < 2) return null;
    const parent = findParent(definition, layers[0].id) ?? definition;
    if (parent.layout.mode !== "free") return null;
    for (const l of layers) {
      const pl = findParent(definition, l.id) ?? definition;
      if (pl.id !== parent.id) return null;
    }
    return { layers, parent };
  })();
  const canGroupSelection = groupCandidate != null;

  const groupSelected = useCallback(() => {
    if (!groupCandidate) return;
    const { layers, parent } = groupCandidate;
    const ids = new Set(layers.map((l) => l.id));
    const minX = Math.min(...layers.map((l) => l.position.x));
    const minY = Math.min(...layers.map((l) => l.position.y));
    const maxX = Math.max(...layers.map((l) => l.position.x + l.size.w));
    const maxY = Math.max(...layers.map((l) => l.position.y + l.size.h));
    const groupId = newLayerId();
    mutate((d) => {
      const p = parent.id === "tpl_root" ? d : (findLayer(d, parent.id) as FrameLayer | null);
      if (!p || p.type !== "frame") return d;
      const members = p.children.filter((c) => ids.has(c.id));
      const insertAt = Math.max(...p.children.map((c, idx) => (ids.has(c.id) ? idx : -1)));
      const group: FrameLayer = {
        id: groupId,
        type: "frame",
        name: "Grupo",
        position: { x: Math.round(minX), y: Math.round(minY) },
        size: { w: Math.round(maxX - minX), h: Math.round(maxY - minY) },
        background: { type: "transparent" },
        layout: { mode: "free" },
        children: members.map((c) => ({
          ...c,
          position: { x: c.position.x - Math.round(minX), y: c.position.y - Math.round(minY) },
        })),
      };
      const rest = p.children.filter((c) => !ids.has(c.id));
      // insertAt es el índice original del miembro más alto; tras quitar los
      // miembros, la cantidad de no-miembros antes de esa posición es el
      // índice de inserción correcto.
      const before = p.children.slice(0, insertAt).filter((c) => !ids.has(c.id)).length;
      const nextChildren = [...rest.slice(0, before), group, ...rest.slice(before)];
      const nextParent: FrameLayer = { ...p, children: nextChildren };
      return parent.id === "tpl_root"
        ? (nextParent as TemplateDefinition)
        : updateLayerInTree(d, parent.id, () => nextParent);
    });
    selectSingle(groupId);
  }, [groupCandidate, mutate, selectSingle]);

  // Desagrupar: la capa seleccionada es un frame (no root); sus hijos suben
  // al padre del frame, sumando la posición del frame para que no se muevan.
  const ungroupCandidate = (() => {
    if (!selectedId || selectedId === "tpl_root") return null;
    const l = findLayer(definition, selectedId);
    if (!l || l.type !== "frame") return null;
    const parent = findParent(definition, l.id) ?? definition;
    if (parent.layout.mode !== "free" || l.layout.mode !== "free") return null;
    return { frame: l, parent };
  })();
  const canUngroupSelection = ungroupCandidate != null;

  const ungroupSelected = useCallback(() => {
    if (!ungroupCandidate) return;
    const { frame, parent } = ungroupCandidate;
    const childIds = frame.children.map((c) => c.id);
    mutate((d) => {
      const p = parent.id === "tpl_root" ? d : (findLayer(d, parent.id) as FrameLayer | null);
      if (!p || p.type !== "frame") return d;
      const idx = p.children.findIndex((c) => c.id === frame.id);
      if (idx === -1) return d;
      const lifted = frame.children.map((c) => ({
        ...c,
        position: { x: c.position.x + frame.position.x, y: c.position.y + frame.position.y },
      }));
      const nextChildren = [...p.children.slice(0, idx), ...lifted, ...p.children.slice(idx + 1)];
      const nextParent: FrameLayer = { ...p, children: nextChildren };
      return parent.id === "tpl_root"
        ? (nextParent as TemplateDefinition)
        : updateLayerInTree(d, parent.id, () => nextParent);
    });
    setSelectedIds(childIds);
    setSelectedId(childIds[childIds.length - 1] ?? null);
  }, [ungroupCandidate, mutate]);

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const ids = (selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []).filter(
        (id) => id !== "tpl_root",
      );
      if (ids.length === 0) return;
      mutate((d) => {
        let next = d;
        for (const id of ids) {
          const l = findLayer(next, id);
          if (!l || l.locked) continue;
          const parent = findParent(next, id);
          if (parent && parent.layout.mode === "stack") continue;
          next = updateLayerInTree(next, id, (cur) => ({
            ...cur,
            position: { x: cur.position.x + dx, y: cur.position.y + dy },
          }));
        }
        return next;
      });
    },
    [selectedIds, selectedId, mutate],
  );

  const toggleVisible = useCallback(
    (id: string) => {
      if (id === "tpl_root") return;
      mutate((d) =>
        updateLayerInTree(d, id, (l) => ({ ...l, visible: l.visible === false ? undefined : false })),
      );
    },
    [mutate],
  );

  // Fusión shape + text → un solo TextLayer con fondo (botón / badge). Aplica
  // cuando la selección es exactamente un shape fusionable y un text sin
  // fondo propio, hermanos en el mismo padre. La caja resultante es la del
  // shape; el id que sobrevive es el del texto (conserva tracks de animación).
  const mergeCandidate = (() => {
    if (selectedIds.length !== 2) return null;
    const a = findLayer(definition, selectedIds[0]);
    const b = findLayer(definition, selectedIds[1]);
    if (!a || !b) return null;
    const shape = isMergeableShape(a) ? a : isMergeableShape(b) ? b : null;
    const text = isMergeableText(a) ? a : isMergeableText(b) ? b : null;
    if (!shape || !text || shape.id === text.id) return null;
    const pa = findParent(definition, shape.id);
    const pb = findParent(definition, text.id);
    if ((pa?.id ?? "tpl_root") !== (pb?.id ?? "tpl_root")) return null;
    return { shape, text };
  })();
  const canMergeSelection = mergeCandidate != null;

  const mergeSelectedIntoButton = useCallback(() => {
    if (!mergeCandidate) return;
    const { shape, text } = mergeCandidate;
    const merged = mergeShapeAndText(shape, text);
    mutate((d) => {
      const withText = updateLayerInTree(d, text.id, () => merged);
      return deleteLayerInTree(withText, shape.id);
    });
    selectSingle(text.id);
  }, [mergeCandidate, mutate, selectSingle]);

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
      const rootLayers = siblingsOf(definition, layers);
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

  const addIcon = useCallback(() => {
    const layer = newIconLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  // Inserciones de presets. Cada uno crea UNA capa (TextLayer con fondo
  // nativo para botón/badge/ribbon, ShapeLayer para divider) y la selecciona.
  const addButton = useCallback(() => {
    const layer = newButtonLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addDivider = useCallback(() => {
    const layer = newDividerLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addBadge = useCallback(() => {
    const layer = newBadgeLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
  }, [baseWidth, baseHeight, mutate, selectSingle]);

  const addRibbon = useCallback(() => {
    const layer = newRibbonLayer(baseWidth / 2, baseHeight / 2);
    mutate((d) => addLayerToFrame(d, "tpl_root", layer));
    selectSingle(layer.id);
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
    // Sin cambios no hay nada que mandar: evita crear un manual_layout en
    // una pieza que solo se abrió y se cerró.
    if (!dirtyRef.current) return;
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
    canMergeSelection,
    mergeSelectedIntoButton,
    canGroupSelection,
    groupSelected,
    canUngroupSelection,
    ungroupSelected,
    nudgeSelected,
    toggleVisible,
    addText,
    addImage,
    addShape,
    addIcon,
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
