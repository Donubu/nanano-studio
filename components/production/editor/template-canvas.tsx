"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  PointerEvent as ReactPointerEvent,
  CSSProperties,
} from "react";
import {
  TemplateDefinition,
  TemplateLayer,
  StackLayout,
  findLayer,
  findParent,
} from "@/lib/production/types";
import { reflowForPreview } from "@/lib/production/reflow";
import { BrandKitContent, EMPTY_KIT_CONTENT, resolveTreeTokens } from "@/lib/production/brand-kit";
import { TemplateLayerView, stackToFlexStyle } from "./template-layer";

interface Props {
  definition: TemplateDefinition;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateBounds: (id: string, bounds: Bounds) => void;
  // When set, the canvas renders the template reflowed to this size (read-only).
  // Used by the editor's preview-format selector to inspect adaptations.
  previewSize?: { w: number; h: number } | null;
  brandKit?: BrandKitContent;
  onLayerContextMenu?: (clientX: number, clientY: number, layerId: string) => void;
}

type Bounds = { x: number; y: number; w: number; h: number };
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type DragOp =
  | {
      kind: "move";
      layerId: string;
      startMouseX: number;
      startMouseY: number;
      startBounds: Bounds;
    }
  | {
      kind: "resize";
      layerId: string;
      handle: Handle;
      startMouseX: number;
      startMouseY: number;
      startBounds: Bounds;
      aspectRatio: number;
    };

interface Guide {
  axis: "v" | "h"; // vertical line = fixed x, horizontal line = fixed y
  position: number; // world coord
}

const CANVAS_PADDING = 32;
const SNAP_THRESHOLD_PX = 6; // in screen pixels
const MIN_SIZE = 8;

export function TemplateCanvas({
  definition,
  selectedId,
  onSelect,
  onUpdateBounds,
  previewSize,
  brandKit = EMPTY_KIT_CONTENT,
  onLayerContextMenu,
}: Props) {
  const isPreview = !!previewSize;
  // In preview mode, render against a reflowed clone derived from constraints.
  // The master `definition` is never mutated.
  const reflowed: TemplateDefinition = isPreview
    ? reflowForPreview(definition, previewSize!)
    : definition;
  // Token references ({color.x}, {font.x}, {scale.x}, {spacing.x}, {logo.x})
  // are resolved to literal values before the renderer consumes them. The
  // selection logic still operates on the unresolved tree via the original
  // `definition` (handles, bounds, drag) so editing keeps the references.
  const baseTree: TemplateDefinition = resolveTreeTokens(reflowed, brandKit);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!hostRef.current) return;
    const el = hostRef.current;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setContainerSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const baseW = baseTree.size.w;
  const baseH = baseTree.size.h;
  const availableW = Math.max(1, containerSize.w - CANVAS_PADDING * 2);
  const availableH = Math.max(1, containerSize.h - CANVAS_PADDING * 2);
  const scale = Math.min(availableW / baseW, availableH / baseH, 1);
  const snapThresholdWorld = SNAP_THRESHOLD_PX / scale;

  const dragRef = useRef<DragOp | null>(null);
  const [ghost, setGhost] = useState<{ id: string; bounds: Bounds } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);

  const startMove = (e: ReactPointerEvent<HTMLDivElement>, layerId: string) => {
    if (isPreview) return; // read-only
    const layer = findLayer(definition, layerId);
    if (!layer || layer.locked) return;
    // In stack-laid parents the child's position is computed by flex; dragging
    // to move would have no visual effect. Click still selects (handled by the
    // layer view) but we don't initiate a move op here.
    const parent = findParent(definition, layerId);
    if (parent && parent.layout.mode === "stack") return;
    dragRef.current = {
      kind: "move",
      layerId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBounds: layerToBounds(layer),
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const startResize = (
    e: ReactPointerEvent<HTMLDivElement>,
    layerId: string,
    handle: Handle
  ) => {
    if (isPreview) return; // read-only
    e.stopPropagation();
    const layer = findLayer(definition, layerId);
    if (!layer || layer.locked) return;
    const startBounds = layerToBounds(layer);
    dragRef.current = {
      kind: "resize",
      layerId,
      handle,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBounds,
      aspectRatio: startBounds.w / Math.max(1, startBounds.h),
    };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = (e.clientX - drag.startMouseX) / scale;
    const dy = (e.clientY - drag.startMouseY) / scale;
    let nextBounds: Bounds;
    let activeEdges: { x: ("left" | "centerX" | "right")[]; y: ("top" | "centerY" | "bottom")[] };

    if (drag.kind === "move") {
      nextBounds = {
        x: drag.startBounds.x + dx,
        y: drag.startBounds.y + dy,
        w: drag.startBounds.w,
        h: drag.startBounds.h,
      };
      activeEdges = {
        x: ["left", "centerX", "right"],
        y: ["top", "centerY", "bottom"],
      };
    } else {
      const aspectLock = e.shiftKey;
      nextBounds = applyResize(drag.startBounds, drag.handle, dx, dy, aspectLock, drag.aspectRatio);
      activeEdges = edgesForHandle(drag.handle);
    }

    // Snap is disabled when the dragged layer's parent is in stack mode,
    // since its sibling positions are layout-driven and not meaningful as
    // reference lines. Resize still works in that case, just without snap.
    const parent = findParent(definition, drag.layerId);
    const parentIsStack = parent?.layout.mode === "stack";

    let snapped: Bounds;
    let nextGuides: Guide[];
    if (parentIsStack) {
      snapped = nextBounds;
      nextGuides = [];
    } else {
      const snapTargets = collectSnapTargets(definition, drag.layerId);
      const result = applySnap(
        nextBounds,
        activeEdges,
        snapTargets,
        snapThresholdWorld
      );
      snapped = result.snapped;
      nextGuides = result.guides;
    }

    // Round to keep stored values clean.
    const finalBounds: Bounds = {
      x: Math.round(snapped.x),
      y: Math.round(snapped.y),
      w: Math.max(MIN_SIZE, Math.round(snapped.w)),
      h: Math.max(MIN_SIZE, Math.round(snapped.h)),
    };

    setGhost({ id: drag.layerId, bounds: finalBounds });
    setGuides(nextGuides);
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    const g = ghost;
    dragRef.current = null;
    if (drag && g && g.id === drag.layerId) {
      onUpdateBounds(drag.layerId, g.bounds);
    }
    setGhost(null);
    setGuides([]);
  };

  const handleHostPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onSelect(null);
    }
  };

  // Click directly on the stage (not on a layer) selects the canvas root so
  // its properties show up in the right panel.
  const handleStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.stopPropagation();
    onSelect("tpl_root");
  };

  // Apply ghost to selected layer for live drag preview (only outside preview mode).
  const renderTree = ghost
    ? applyGhostBounds(baseTree, ghost.id, ghost.bounds)
    : baseTree;
  const selectedLayer = selectedId ? findLayer(renderTree, selectedId) : null;

  // When the selected layer is laid out by a stack parent its rendered
  // position differs from layer.position (flex decides). Read the DOM rect
  // and convert it into canvas-space coords so the resize handles overlay
  // where the user actually sees the layer.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const selectedParent = selectedId ? findParent(definition, selectedId) : null;
  const selectedParentIsStack = selectedParent?.layout.mode === "stack";
  const [stackHandleBounds, setStackHandleBounds] = useState<Bounds | null>(null);
  // Stable primitives only: depending on selectedLayer or renderTree directly
  // loops infinitely — those are fresh references each render (token resolver
  // rebuilds the tree). Track the data that actually changes the rendered
  // layer size/position: selection id, layer size, scale.
  const selW = selectedLayer?.size.w;
  const selH = selectedLayer?.size.h;
  /* eslint-disable react-hooks/set-state-in-effect */
  // setState in a layout effect is the right pattern for DOM measurement:
  // the rect can't be known during render and the handles must overlay the
  // committed layout.
  useLayoutEffect(() => {
    if (!selectedId || !selectedParentIsStack) {
      setStackHandleBounds((cur) => (cur === null ? cur : null));
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const node = stage.querySelector<HTMLElement>(`[data-layer-id="${selectedId}"]`);
    if (!node) {
      setStackHandleBounds((cur) => (cur === null ? cur : null));
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const next: Bounds = {
      x: (rect.left - stageRect.left) / scale,
      y: (rect.top - stageRect.top) / scale,
      w: rect.width / scale,
      h: rect.height / scale,
    };
    setStackHandleBounds((cur) =>
      cur && cur.x === next.x && cur.y === next.y && cur.w === next.w && cur.h === next.h
        ? cur
        : next
    );
  }, [selectedId, selectedParentIsStack, selW, selH, scale]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const scaledW = baseW * scale;
  const scaledH = baseH * scale;
  const rootBackground =
    renderTree.background && renderTree.background.type === "color"
      ? renderTree.background.value
      : "#ffffff";

  // The canvas root can be in stack mode just like nested frames. Without
  // applying the flex styles here, root children stayed at their stored x/y
  // while drag was disabled (because parent.layout.mode === "stack"), so the
  // user could neither move them nor see the layout react.
  const rootIsStack = renderTree.layout.mode === "stack";
  const stageStyle: CSSProperties = {
    width: baseW,
    height: baseH,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    background: rootBackground,
    position: "relative",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 10px 30px rgba(0,0,0,0.18)",
    ...(rootIsStack ? stackToFlexStyle(renderTree.layout as StackLayout) : {}),
  };
  const rootChildParentMode: "free" | "stack" = rootIsStack ? "stack" : "free";

  return (
    <div
      ref={hostRef}
      onPointerDown={handleHostPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="flex-1 min-w-0 min-h-0 bg-muted/30 overflow-hidden flex items-center justify-center select-none"
    >
      {containerSize.w > 0 && (
        <div style={{ width: scaledW, height: scaledH, position: "relative" }}>
          <div
            ref={stageRef}
            style={stageStyle}
            onPointerDown={handleStagePointerDown}
          >
            {renderTree.children.map((child: TemplateLayer) => (
              <TemplateLayerView
                key={child.id}
                layer={child}
                selectedId={selectedId}
                onSelect={onSelect}
                onLayerPointerDown={startMove}
                onLayerContextMenu={
                  isPreview || !onLayerContextMenu
                    ? undefined
                    : (e, id) => onLayerContextMenu(e.clientX, e.clientY, id)
                }
                parentMode={rootChildParentMode}
              />
            ))}

            {/* Resize handles overlay for the selected layer (hidden in preview) */}
            {!isPreview && selectedLayer && selectedLayer.id !== "tpl_root" && !selectedLayer.locked && (
              <SelectionHandles
                bounds={
                  selectedParentIsStack && stackHandleBounds
                    ? stackHandleBounds
                    : layerToBounds(selectedLayer)
                }
                scale={scale}
                onHandlePointerDown={(e, handle) =>
                  startResize(e, selectedLayer.id, handle)
                }
              />
            )}

            {/* Snap guides */}
            {guides.map((g, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  background: "rgb(244, 63, 94)",
                  pointerEvents: "none",
                  ...(g.axis === "v"
                    ? { left: g.position, top: 0, width: 1 / scale, height: baseH }
                    : { left: 0, top: g.position, height: 1 / scale, width: baseW }),
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------- Selection handles -------------------------

function SelectionHandles({
  bounds,
  scale,
  onHandlePointerDown,
}: {
  bounds: Bounds;
  scale: number;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLDivElement>, h: Handle) => void;
}) {
  const handleSize = 10 / scale; // world units; renders as ~10 css px
  const offset = handleSize / 2;
  const handles: { id: Handle; x: number; y: number; cursor: string }[] = [
    { id: "nw", x: bounds.x - offset,                y: bounds.y - offset,                cursor: "nwse-resize" },
    { id: "n",  x: bounds.x + bounds.w / 2 - offset, y: bounds.y - offset,                cursor: "ns-resize"   },
    { id: "ne", x: bounds.x + bounds.w - offset,     y: bounds.y - offset,                cursor: "nesw-resize" },
    { id: "e",  x: bounds.x + bounds.w - offset,     y: bounds.y + bounds.h / 2 - offset, cursor: "ew-resize"   },
    { id: "se", x: bounds.x + bounds.w - offset,     y: bounds.y + bounds.h - offset,     cursor: "nwse-resize" },
    { id: "s",  x: bounds.x + bounds.w / 2 - offset, y: bounds.y + bounds.h - offset,     cursor: "ns-resize"   },
    { id: "sw", x: bounds.x - offset,                y: bounds.y + bounds.h - offset,     cursor: "nesw-resize" },
    { id: "w",  x: bounds.x - offset,                y: bounds.y + bounds.h / 2 - offset, cursor: "ew-resize"   },
  ];
  return (
    <>
      {handles.map((h) => (
        <div
          key={h.id}
          onPointerDown={(e) => onHandlePointerDown(e, h.id)}
          style={{
            position: "absolute",
            left: h.x,
            top: h.y,
            width: handleSize,
            height: handleSize,
            background: "#ffffff",
            border: `${1 / scale}px solid rgb(59, 130, 246)`,
            borderRadius: 2 / scale,
            cursor: h.cursor,
            zIndex: 10000,
          }}
        />
      ))}
    </>
  );
}

// ------------------------- Geometry helpers -------------------------

function layerToBounds(l: TemplateLayer): Bounds {
  return { x: l.position.x, y: l.position.y, w: l.size.w, h: l.size.h };
}

function applyGhostBounds(
  root: TemplateDefinition,
  id: string,
  bounds: Bounds
): TemplateDefinition {
  const clone = (nodes: TemplateLayer[]): TemplateLayer[] =>
    nodes.map((n) => {
      if (n.id === id) {
        return {
          ...n,
          position: { x: bounds.x, y: bounds.y },
          size: { w: bounds.w, h: bounds.h },
        };
      }
      if (n.type === "frame") return { ...n, children: clone(n.children) };
      return n;
    });
  return { ...root, children: clone(root.children) };
}

function applyResize(
  start: Bounds,
  handle: Handle,
  dx: number,
  dy: number,
  lockAspect: boolean,
  aspectRatio: number
): Bounds {
  let { x, y, w, h } = start;
  switch (handle) {
    case "e":  w = start.w + dx; break;
    case "w":  x = start.x + dx; w = start.w - dx; break;
    case "s":  h = start.h + dy; break;
    case "n":  y = start.y + dy; h = start.h - dy; break;
    case "se": w = start.w + dx; h = start.h + dy; break;
    case "ne": w = start.w + dx; y = start.y + dy; h = start.h - dy; break;
    case "sw": x = start.x + dx; w = start.w - dx; h = start.h + dy; break;
    case "nw": x = start.x + dx; w = start.w - dx; y = start.y + dy; h = start.h - dy; break;
  }
  if (lockAspect) {
    // Use width as driver; recompute height.
    const newH = w / aspectRatio;
    const dh = newH - h;
    if (handle === "n" || handle === "nw" || handle === "ne") y -= dh;
    h = newH;
  }
  // Flip prevention: clamp to min size, keeping the anchor side stable.
  if (w < MIN_SIZE) {
    if (handle === "w" || handle === "nw" || handle === "sw") {
      x = start.x + start.w - MIN_SIZE;
    }
    w = MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    if (handle === "n" || handle === "nw" || handle === "ne") {
      y = start.y + start.h - MIN_SIZE;
    }
    h = MIN_SIZE;
  }
  return { x, y, w, h };
}

function edgesForHandle(handle: Handle): {
  x: ("left" | "centerX" | "right")[];
  y: ("top" | "centerY" | "bottom")[];
} {
  const x: ("left" | "centerX" | "right")[] = [];
  const y: ("top" | "centerY" | "bottom")[] = [];
  if (handle === "w" || handle === "nw" || handle === "sw") x.push("left");
  if (handle === "e" || handle === "ne" || handle === "se") x.push("right");
  if (handle === "n" || handle === "nw" || handle === "ne") y.push("top");
  if (handle === "s" || handle === "sw" || handle === "se") y.push("bottom");
  return { x, y };
}

// ------------------------- Snap -------------------------

interface SnapTarget {
  // Reference lines this target contributes; the canvas adds center lines too.
  xs: number[];
  ys: number[];
}

function collectSnapTargets(
  definition: TemplateDefinition,
  excludeId: string
): SnapTarget {
  const xs: number[] = [0, definition.size.w, definition.size.w / 2];
  const ys: number[] = [0, definition.size.h, definition.size.h / 2];
  for (const child of definition.children) {
    if (child.id === excludeId) continue;
    const b = layerToBounds(child);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function applySnap(
  bounds: Bounds,
  activeEdges: {
    x: ("left" | "centerX" | "right")[];
    y: ("top" | "centerY" | "bottom")[];
  },
  targets: SnapTarget,
  threshold: number
): { snapped: Bounds; guides: Guide[] } {
  const guides: Guide[] = [];
  let { x, y, w, h } = bounds;

  // X axis: find best snap among active edges.
  let bestDx: { delta: number; line: number } | null = null;
  for (const edge of activeEdges.x) {
    const edgeX =
      edge === "left" ? x : edge === "right" ? x + w : x + w / 2;
    for (const t of targets.xs) {
      const delta = t - edgeX;
      if (Math.abs(delta) < threshold) {
        if (!bestDx || Math.abs(delta) < Math.abs(bestDx.delta)) {
          bestDx = { delta, line: t };
        }
      }
    }
  }
  if (bestDx) {
    // Apply delta. For "right" or "centerX" we move only x (and size doesn't
    // change for move). For resize, the change must be applied to whichever
    // edge is active. Simplest correct behavior: shift the entire bounds by
    // the delta when the active edge is the only x-edge; for resize with
    // both edges (shouldn't happen) we'd skip — but here we keep the simple
    // path because at most one of left/right is active per resize handle,
    // and "centerX" only appears for move (with both move-edges symmetric).
    if (activeEdges.x.length === 1) {
      const edge = activeEdges.x[0];
      if (edge === "left") {
        x += bestDx.delta;
        w -= bestDx.delta;
      } else if (edge === "right") {
        w += bestDx.delta;
      } else {
        x += bestDx.delta;
      }
    } else {
      // Move case: shift everything.
      x += bestDx.delta;
    }
    guides.push({ axis: "v", position: bestDx.line });
  }

  // Y axis: same logic.
  let bestDy: { delta: number; line: number } | null = null;
  for (const edge of activeEdges.y) {
    const edgeY =
      edge === "top" ? y : edge === "bottom" ? y + h : y + h / 2;
    for (const t of targets.ys) {
      const delta = t - edgeY;
      if (Math.abs(delta) < threshold) {
        if (!bestDy || Math.abs(delta) < Math.abs(bestDy.delta)) {
          bestDy = { delta, line: t };
        }
      }
    }
  }
  if (bestDy) {
    if (activeEdges.y.length === 1) {
      const edge = activeEdges.y[0];
      if (edge === "top") {
        y += bestDy.delta;
        h -= bestDy.delta;
      } else if (edge === "bottom") {
        h += bestDy.delta;
      } else {
        y += bestDy.delta;
      }
    } else {
      y += bestDy.delta;
    }
    guides.push({ axis: "h", position: bestDy.line });
  }

  // Re-enforce min size after snap.
  w = Math.max(MIN_SIZE, w);
  h = Math.max(MIN_SIZE, h);

  return { snapped: { x, y, w, h }, guides };
}
