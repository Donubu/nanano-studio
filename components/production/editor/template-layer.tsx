"use client";

import { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TemplateLayer,
  FrameLayer,
  TextLayer,
  ImageLayer,
  ShapeLayer,
  IconLayer,
  StackLayout,
  StackAlign,
  StackJustify,
  isFontSizeRange,
} from "@/lib/production/types";
import { ensureGoogleFontLoaded } from "@/lib/production/google-fonts";
import { SmartText } from "./smart-text";

// Resolver lucide por nombre. El zod schema garantiza que solo lleguen nombres
// del catálogo, pero como defensa por si la BD tiene basura vieja, caemos a
// "HelpCircle" cuando el nombre no existe en el bundle de lucide.
function getLucideIcon(name: string): React.ComponentType<{
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}> {
  const Comp = (LucideIcons as Record<string, unknown>)[name];
  if (Comp && typeof Comp === "function") {
    return Comp as React.ComponentType<{
      size?: number;
      color?: string;
      strokeWidth?: number;
      className?: string;
    }>;
  }
  return LucideIcons.HelpCircle as unknown as React.ComponentType<{
    size?: number;
    color?: string;
    strokeWidth?: number;
    className?: string;
  }>;
}

interface Props {
  layer: TemplateLayer;
  selectedId: string | null;
  // Multi-select. Cuando el layer está incluido y NO es el primary,
  // se pinta un outline ámbar (en vez del azul del primary) para que
  // el productor vea cuáles están en el set.
  selectedIds?: string[];
  onSelect: (id: string, opts?: { additive?: boolean }) => void;
  onLayerPointerDown: (e: ReactPointerEvent<HTMLDivElement>, layerId: string) => void;
  onLayerContextMenu?: (e: React.MouseEvent<HTMLDivElement>, layerId: string) => void;
  parentMode?: "free" | "stack";
}

// Genera el string CSS de box-shadow/text-shadow desde el shape DropShadow
// del schema. Sin spread (lo omitimos del MVP — confunde más que aporta).
function shadowCss(s: TemplateLayer["shadow"]): string | undefined {
  if (!s) return undefined;
  return `${s.x}px ${s.y}px ${s.blur}px ${s.color}`;
}

// Decide si la sombra del layer debe aplicarse como boxShadow (la caja
// proyecta sombra) o textShadow (los glyphs del texto la proyectan).
//
//   - Text SIN backgroundColor → textShadow: la caja es transparente, no
//     tiene sentido tirar sombra de un rect invisible; lo que el productor
//     quiere es que el texto cast shadow.
//   - Text CON backgroundColor → boxShadow: ahora hay una pill/badge
//     visible y la sombra va debajo de ella, no de los glyphs.
//   - Cualquier otro tipo (shape/image/frame) → boxShadow.
function shadowKind(layer: TemplateLayer): "box" | "text" {
  if (layer.type === "text" && !layer.style.backgroundColor) return "text";
  return "box";
}

function baseLayerStyle(layer: TemplateLayer, parentMode: "free" | "stack"): CSSProperties {
  // El shadow se aplica como boxShadow por default — el caso de text-shadow
  // se sobreescribe en renderText cuando aplica.
  const shadow = shadowCss(layer.shadow);
  const useBoxShadow = shadow && shadowKind(layer) === "box";
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
      boxShadow: useBoxShadow ? shadow : undefined,
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
    boxShadow: useBoxShadow ? shadow : undefined,
  };
}

export function TemplateLayerView({
  layer,
  selectedId,
  selectedIds,
  onSelect,
  onLayerPointerDown,
  onLayerContextMenu,
  parentMode = "free",
}: Props) {
  const isSelected = selectedId === layer.id;
  const isInMulti =
    !!selectedIds &&
    selectedIds.length > 1 &&
    selectedIds.includes(layer.id) &&
    !isSelected;
  const commonProps = {
    "data-layer-id": layer.id,
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      // Tres casos:
      //   1. Modifier presionado → toggle en multi-set, no drag.
      //   2. Click sin modifier sobre layer ya en multi-set → CONSERVAR el
      //      multi-set y empezar drag del grupo entero (multi-move).
      //   3. Click sin modifier sobre layer fuera del set → reemplazar
      //      selección por solo esa capa y empezar drag normal.
      if (additive) {
        onSelect(layer.id, { additive: true });
        return;
      }
      const inMulti =
        !!selectedIds &&
        selectedIds.length > 1 &&
        selectedIds.includes(layer.id);
      if (!inMulti) {
        onSelect(layer.id);
      }
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
      isSelected
        ? "outline outline-blue-500"
        : isInMulti
          ? "outline outline-amber-400/80"
          : "outline-transparent hover:outline hover:outline-blue-300/60",
    ),
  };

  if (layer.type === "frame")
    return renderFrame(layer, parentMode, {
      commonProps,
      selectedId,
      selectedIds,
      onSelect,
      onLayerPointerDown,
      onLayerContextMenu,
    });
  if (layer.type === "text") return renderText(layer, parentMode, commonProps);
  if (layer.type === "image") return renderImage(layer, parentMode, commonProps);
  if (layer.type === "shape") return renderShape(layer, parentMode, commonProps);
  if (layer.type === "icon") return renderIcon(layer, parentMode, commonProps);
  return null;
}

type CommonProps = {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
  className: string;
};

export function stackToFlexStyle(layout: StackLayout): CSSProperties {
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
    selectedIds?: string[];
    onSelect: (id: string, opts?: { additive?: boolean }) => void;
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
          selectedIds={ctx.selectedIds}
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
  // Vertical align: implementado vía display: flex en el contenedor de texto.
  // Default top (alineación original). El textAlign sigue siendo CSS horizontal
  // normal — el contenedor solo posiciona el bloque dentro de la caja.
  const vAlign = style.verticalAlign ?? "top";
  const justifyContent =
    vAlign === "middle" ? "center" : vAlign === "bottom" ? "flex-end" : "flex-start";
  const baseCss: CSSProperties = {
    ...baseLayerStyle(layer, parentMode),
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    color: style.color,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.align ?? "left",
    fontStyle: style.italic ? "italic" : undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    display: "flex",
    flexDirection: "column",
    justifyContent,
    // Fondo opcional del text layer — colapsa el patrón shape+text a una
    // sola capa para botones/badges/ribbons. backgroundCornerRadius=size.h/2
    // hace una pill; =size.w/2 con caja cuadrada hace un círculo.
    background: style.backgroundColor,
    borderRadius: style.backgroundCornerRadius,
    // textShadow para texto sin fondo (los glyphs casean sombra). El
    // baseLayerStyle ya manejó el boxShadow caso text-con-bg.
    textShadow:
      layer.shadow && !style.backgroundColor
        ? `${layer.shadow.x}px ${layer.shadow.y}px ${layer.shadow.blur}px ${layer.shadow.color}`
        : undefined,
    // Efectos de texto. textDecoration y textTransform son CSS estándar;
    // outline usa -webkit-text-stroke que React expone como WebkitTextStroke.
    // Soporte: Chrome/Safari/Firefox modernos — en el editor (Chrome) y en
    // el export html-to-image funciona.
    textDecoration:
      style.textDecoration && style.textDecoration !== "none"
        ? style.textDecoration
        : undefined,
    textTransform:
      style.textTransform && style.textTransform !== "none"
        ? style.textTransform
        : undefined,
    WebkitTextStroke:
      style.outline && style.outline.width > 0
        ? `${style.outline.width}px ${style.outline.color}`
        : undefined,
  };
  // Smart text: el render busca el font-size más grande que entre en la caja.
  if (isFontSizeRange(style.fontSize)) {
    return (
      <SmartText
        content={layer.content}
        range={style.fontSize}
        style={baseCss}
        {...common}
      />
    );
  }
  const css: CSSProperties = {
    ...baseCss,
    fontSize: style.fontSize,
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

// Renderea un ícono lucide dentro de la caja del layer. El size del SVG se
// fija a min(w, h) y el contenedor lo centra — esto hace que cambiar el
// aspect ratio del box no deforme el ícono (los íconos son cuadrados por
// definición). El color va vía la prop, no CSS, porque lucide pinta stroke
// y fill condicionalmente según el ícono.
function renderIcon(layer: IconLayer, parentMode: "free" | "stack", common: CommonProps) {
  const Icon = getLucideIcon(layer.iconName);
  const iconSize = Math.min(layer.size.w, layer.size.h);
  const style: CSSProperties = {
    ...baseLayerStyle(layer, parentMode),
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  return (
    <div style={style} {...common}>
      <Icon
        size={iconSize}
        color={layer.color}
        strokeWidth={layer.strokeWidth ?? 2}
      />
    </div>
  );
}
