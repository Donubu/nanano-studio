"use client";

import { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import {
  TemplateLayer,
  FrameLayer,
  TextLayer,
  ImageLayer,
  ShapeLayer,
} from "@/lib/production/types";

interface Props {
  layer: TemplateLayer;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onLayerPointerDown: (e: ReactPointerEvent<HTMLDivElement>, layerId: string) => void;
}

function baseLayerStyle(layer: TemplateLayer): CSSProperties {
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
}: Props) {
  const isSelected = selectedId === layer.id;
  const commonProps = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      // Stop so parent frame doesn't also receive the down (we still want
      // bubbling to the canvas-level capture).
      e.stopPropagation();
      onSelect(layer.id);
      onLayerPointerDown(e, layer.id);
    },
    className: cn(
      "cursor-move outline-2 outline-offset-0",
      isSelected ? "outline outline-blue-500" : "outline-transparent hover:outline hover:outline-blue-300/60"
    ),
  };

  if (layer.type === "frame") return renderFrame(layer, { commonProps, selectedId, onSelect, onLayerPointerDown });
  if (layer.type === "text") return renderText(layer, commonProps);
  if (layer.type === "image") return renderImage(layer, commonProps);
  if (layer.type === "shape") return renderShape(layer, commonProps);
  return null;
}

type CommonProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  className: string;
};

function renderFrame(
  layer: FrameLayer,
  ctx: {
    commonProps: CommonProps;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onLayerPointerDown: (e: ReactPointerEvent<HTMLDivElement>, layerId: string) => void;
  }
) {
  const bg = layer.background;
  const style: CSSProperties = {
    ...baseLayerStyle(layer),
    background:
      bg && bg.type === "color"
        ? bg.value
        : bg && bg.type === "transparent"
        ? "transparent"
        : undefined,
    borderRadius: layer.cornerRadius,
  };
  return (
    <div style={style} {...ctx.commonProps}>
      {layer.children.map((child) => (
        <TemplateLayerView
          key={child.id}
          layer={child}
          selectedId={ctx.selectedId}
          onSelect={ctx.onSelect}
          onLayerPointerDown={ctx.onLayerPointerDown}
        />
      ))}
    </div>
  );
}

function renderText(layer: TextLayer, common: CommonProps) {
  const { style } = layer;
  const css: CSSProperties = {
    ...baseLayerStyle(layer),
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

function renderImage(layer: ImageLayer, common: CommonProps) {
  const style: CSSProperties = {
    ...baseLayerStyle(layer),
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

function renderShape(layer: ShapeLayer, common: CommonProps) {
  const isEllipse = layer.shape === "ellipse";
  const style: CSSProperties = {
    ...baseLayerStyle(layer),
    background: layer.fill,
    borderRadius: isEllipse ? "50%" : layer.cornerRadius,
    border: layer.stroke
      ? `${layer.stroke.width}px solid ${layer.stroke.color}`
      : undefined,
  };
  return <div style={style} {...common} />;
}
