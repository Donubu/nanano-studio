"use client";

import { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import {
  TemplateLayer,
  FrameLayer,
  TextLayer,
  ImageLayer,
  ShapeLayer,
  StackLayout,
  StackAlign,
  StackJustify,
} from "@/lib/production/types";
import { ensureGoogleFontLoaded } from "@/lib/production/google-fonts";

interface Props {
  layer: TemplateLayer;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLayerPointerDown: (e: ReactPointerEvent<HTMLDivElement>, layerId: string) => void;
  onLayerContextMenu?: (e: React.MouseEvent<HTMLDivElement>, layerId: string) => void;
  parentMode?: "free" | "stack";
}

function baseLayerStyle(layer: TemplateLayer, parentMode: "free" | "stack"): CSSProperties {
  if (parentMode === "stack") {
    // Position is determined by the parent's flex layout. We keep width/height
    // as the layer's stored size; align "stretch" on the cross-axis is handled
    // by the parent via alignItems, which CSS resolves against this size.
    return {
      position: "relative",
      width: layer.size.w,
      height: layer.size.h,
      flexShrink: 0,
      opacity: layer.opacity ?? 1,
      transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
      display: layer.visible === false ? "none" : undefined,
      boxSizing: "border-box",
    };
  }
  return {
    position: "absolute",
    left: layer.position.x,
    top: layer.position.y,
    width: layer.size.w,
    height: layer.size.h,
    opacity: layer.opacity ?? 1,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    display: layer.visible === false ? "none" : undefined,
    boxSizing: "border-box",
  };
}

export function TemplateLayerView({
  layer,
  selectedId,
  onSelect,
  onLayerPointerDown,
  onLayerContextMenu,
  parentMode = "free",
}: Props) {
  const isSelected = selectedId === layer.id;
  const commonProps = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onSelect(layer.id);
      onLayerPointerDown(e, layer.id);
    },
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onLayerContextMenu) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect(layer.id);
      onLayerContextMenu(e, layer.id);
    },
    className: cn(
      "outline-2 outline-offset-0",
      layer.locked
        ? "cursor-default"
        : parentMode === "stack"
        ? "cursor-pointer"
        : "cursor-move",
      isSelected ? "outline outline-blue-500" : "outline-transparent hover:outline hover:outline-blue-300/60"
    ),
  };

  if (layer.type === "frame")
    return renderFrame(layer, parentMode, {
      commonProps,
      selectedId,
      onSelect,
      onLayerPointerDown,
      onLayerContextMenu,
    });
  if (layer.type === "text") return renderText(layer, parentMode, commonProps);
  if (layer.type === "image") return renderImage(layer, parentMode, commonProps);
  if (layer.type === "shape") return renderShape(layer, parentMode, commonProps);
  return null;
}

type CommonProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  className: string;
};

function stackToFlexStyle(layout: StackLayout): CSSProperties {
  const [pt, pr, pb, pl] = layout.padding;
  return {
    display: "flex",
    flexDirection: layout.direction === "horizontal" ? "row" : "column",
    paddingTop: pt,
    paddingRight: pr,
    paddingBottom: pb,
    paddingLeft: pl,
    gap: layout.gap,
    alignItems: alignToCss(layout.align),
    justifyContent: justifyToCss(layout.justify),
  };
}

function alignToCss(a: StackAlign): CSSProperties["alignItems"] {
  switch (a) {
    case "start":   return "flex-start";
    case "center":  return "center";
    case "end":     return "flex-end";
    case "stretch": return "stretch";
  }
}

function justifyToCss(j: StackJustify): CSSProperties["justifyContent"] {
  switch (j) {
    case "start":         return "flex-start";
    case "center":        return "center";
    case "end":           return "flex-end";
    case "space-between": return "space-between";
    case "space-around":  return "space-around";
    case "space-evenly":  return "space-evenly";
  }
}

function renderFrame(
  layer: FrameLayer,
  parentMode: "free" | "stack",
  ctx: {
    commonProps: CommonProps;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onLayerPointerDown: (e: ReactPointerEvent<HTMLDivElement>, layerId: string) => void;
    onLayerContextMenu?: (e: React.MouseEvent<HTMLDivElement>, layerId: string) => void;
  }
) {
  const bg = layer.background;
  const isStack = layer.layout.mode === "stack";
  const style: CSSProperties = {
    ...baseLayerStyle(layer, parentMode),
    background:
      bg && bg.type === "color"
        ? bg.value
        : bg && bg.type === "transparent"
        ? "transparent"
        : undefined,
    borderRadius: layer.cornerRadius,
    ...(isStack ? stackToFlexStyle(layer.layout as StackLayout) : {}),
    overflow: "hidden",
  };
  const childParentMode: "free" | "stack" = isStack ? "stack" : "free";
  return (
    <div style={style} {...ctx.commonProps}>
      {layer.children.map((child) => (
        <TemplateLayerView
          key={child.id}
          layer={child}
          selectedId={ctx.selectedId}
          onSelect={ctx.onSelect}
          onLayerPointerDown={ctx.onLayerPointerDown}
          onLayerContextMenu={ctx.onLayerContextMenu}
          parentMode={childParentMode}
        />
      ))}
    </div>
  );
}

function renderText(layer: TextLayer, parentMode: "free" | "stack", common: CommonProps) {
  const { style } = layer;
  if (style.fontFamily) ensureGoogleFontLoaded(style.fontFamily);
  const css: CSSProperties = {
    ...baseLayerStyle(layer, parentMode),
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    color: style.color,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.align ?? "left",
    fontStyle: style.italic ? "italic" : undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    overflow: "hidden",
  };
  return (
    <div style={css} {...common}>
      {layer.content}
    </div>
  );
}

function renderImage(layer: ImageLayer, parentMode: "free" | "stack", common: CommonProps) {
  const style: CSSProperties = {
    ...baseLayerStyle(layer, parentMode),
    overflow: "hidden",
    borderRadius: layer.cornerRadius,
    background: layer.src ? undefined : "rgba(0,0,0,0.05)",
  };
  return (
    <div style={style} {...common}>
      {layer.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={layer.src}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: layer.fit ?? "cover",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(0,0,0,0.4)",
            fontSize: 14,
            border: "1px dashed rgba(0,0,0,0.2)",
          }}
        >
          Sin imagen
        </div>
      )}
    </div>
  );
}

function renderShape(layer: ShapeLayer, parentMode: "free" | "stack", common: CommonProps) {
  const isEllipse = layer.shape === "ellipse";
  const style: CSSProperties = {
    ...baseLayerStyle(layer, parentMode),
    background: layer.fill,
    borderRadius: isEllipse ? "50%" : layer.cornerRadius,
    border: layer.stroke
      ? `${layer.stroke.width}px solid ${layer.stroke.color}`
      : undefined,
  };
  return <div style={style} {...common} />;
}
