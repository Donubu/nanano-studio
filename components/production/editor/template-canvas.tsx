"use client";

import { useEffect, useRef, useState, PointerEvent as ReactPointerEvent, CSSProperties } from "react";
import { TemplateDefinition, TemplateLayer, findLayer } from "@/lib/production/types";
import { TemplateLayerView } from "./template-layer";

interface Props {
  definition: TemplateDefinition;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveLayer: (id: string, position: { x: number; y: number }) => void;
}

const CANVAS_PADDING = 32;

export function TemplateCanvas({ definition, selectedId, onSelect, onMoveLayer }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  // Fit-to-screen scale.
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

  const baseW = definition.size.w;
  const baseH = definition.size.h;
  const availableW = Math.max(1, containerSize.w - CANVAS_PADDING * 2);
  const availableH = Math.max(1, containerSize.h - CANVAS_PADDING * 2);
  const scale = Math.min(availableW / baseW, availableH / baseH, 1);

  // Drag state. Stored in a ref so we don't re-render on every mouse move.
  const dragRef = useRef<{
    layerId: string;
    startMouseX: number;
    startMouseY: number;
    startLayerX: number;
    startLayerY: number;
  } | null>(null);

  // Local "ghost" position to render the dragged layer smoothly without
  // committing to parent state on every frame.
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);

  const handleLayerPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    layerId: string
  ) => {
    const layer = findLayer(definition, layerId);
    if (!layer || layer.locked) return;
    dragRef.current = {
      layerId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startLayerX: layer.position.x,
      startLayerY: layer.position.y,
    };
    // capture so we keep receiving moves even outside the layer
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  };

  // Pointer move / up are bound to the canvas host so the capture works
  // regardless of which child the pointer is over.
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startMouseX) / scale;
    const dy = (e.clientY - drag.startMouseY) / scale;
    setGhost({
      id: drag.layerId,
      x: Math.round(drag.startLayerX + dx),
      y: Math.round(drag.startLayerY + dy),
    });
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    const g = ghost;
    dragRef.current = null;
    if (drag && g && g.id === drag.layerId) {
      onMoveLayer(drag.layerId, { x: g.x, y: g.y });
    }
    setGhost(null);
  };

  // Background click deselects.
  const handleHostPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onSelect(null);
    }
  };

  // Apply ghost position to the selected layer for live preview during drag.
  const renderTree = ghost
    ? applyGhost(definition, ghost.id, { x: ghost.x, y: ghost.y })
    : definition;

  const scaledW = baseW * scale;
  const scaledH = baseH * scale;

  const rootBackground =
    renderTree.background && renderTree.background.type === "color"
      ? renderTree.background.value
      : "#ffffff";

  const stageStyle: CSSProperties = {
    width: baseW,
    height: baseH,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    background: rootBackground,
    position: "relative",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.08), 0 10px 30px rgba(0,0,0,0.18)",
  };

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
        <div
          style={{
            width: scaledW,
            height: scaledH,
            position: "relative",
          }}
        >
          <div style={stageStyle}>
            {renderTree.children.map((child: TemplateLayer) => (
              <TemplateLayerView
                key={child.id}
                layer={child}
                selectedId={selectedId}
                onSelect={onSelect}
                onLayerPointerDown={handleLayerPointerDown}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Returns a fresh tree with the given layer's position replaced by `pos`.
// Used for live drag preview without committing to parent state.
function applyGhost(
  root: TemplateDefinition,
  id: string,
  pos: { x: number; y: number }
): TemplateDefinition {
  const cloneChildren = (nodes: TemplateLayer[]): TemplateLayer[] =>
    nodes.map((n) => {
      if (n.id === id) return { ...n, position: pos };
      if (n.type === "frame") return { ...n, children: cloneChildren(n.children) };
      return n;
    });
  return { ...root, children: cloneChildren(root.children) };
}
