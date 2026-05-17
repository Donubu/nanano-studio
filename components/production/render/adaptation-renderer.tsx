"use client";

import { CSSProperties, forwardRef } from "react";
import {
  TemplateDefinition,
  TemplateLayer,
  StackLayout,
} from "@/lib/production/types";
import {
  BrandKitContent,
  resolveTreeTokens,
} from "@/lib/production/brand-kit";
import { reflowForPreview } from "@/lib/production/reflow";
import { parseOverrides } from "@/lib/production/overrides";
import {
  TemplateLayerView,
  stackToFlexStyle,
} from "@/components/production/editor/template-layer";

type FitMode = "contain" | "cover" | "width" | "height" | "responsive";

interface AdaptationLike {
  width: number;
  height: number;
  fit_mode: FitMode;
  overrides_json: string | null;
}

interface Props {
  adaptation: AdaptationLike;
  master: TemplateDefinition;
  brandKit: BrandKitContent;
}

// Renders a single adaptation at its native pixel size. Used by the export
// pipeline: mount it into a hidden container, capture with html-to-image,
// unmount.
//
// La lógica de fit_mode espeja la del preview en la página de producir.
// Manual_layout (override) tiene prioridad; sino se elige entre responsive
// (constraints) o scale uniforme según el fit_mode.
export const AdaptationRenderer = forwardRef<HTMLDivElement, Props>(function AdaptationRenderer(
  { adaptation, master, brandKit },
  ref,
) {
  const adaptW = adaptation.width;
  const adaptH = adaptation.height;

  const manualLayout = parseOverrides(adaptation.overrides_json).manual_layout;
  if (manualLayout) {
    const resolved = resolveTreeTokens(manualLayout, brandKit);
    const bg =
      resolved.background && resolved.background.type === "color"
        ? resolved.background.value
        : "#ffffff";
    const rootIsStack = resolved.layout.mode === "stack";
    const innerStyle: CSSProperties = {
      width: adaptW,
      height: adaptH,
      position: "relative",
      background: bg,
      ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
    };
    return (
      <div ref={ref} style={{ width: adaptW, height: adaptH, background: bg }}>
        <div style={innerStyle}>
          {resolved.children.map((child: TemplateLayer) => (
            <TemplateLayerView
              key={child.id}
              layer={child}
              selectedId={null}
              onSelect={noop}
              onLayerPointerDown={noop}
              parentMode={rootIsStack ? "stack" : "free"}
            />
          ))}
        </div>
      </div>
    );
  }

  if (adaptation.fit_mode === "responsive") {
    const reflowed = reflowForPreview(master, { w: adaptW, h: adaptH });
    const resolved = resolveTreeTokens(reflowed, brandKit);
    const bg =
      resolved.background && resolved.background.type === "color"
        ? resolved.background.value
        : "#ffffff";
    const rootIsStack = resolved.layout.mode === "stack";
    const innerStyle: CSSProperties = {
      width: adaptW,
      height: adaptH,
      position: "relative",
      background: bg,
      ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
    };
    return (
      <div ref={ref} style={{ width: adaptW, height: adaptH, background: bg }}>
        <div style={innerStyle}>
          {resolved.children.map((child: TemplateLayer) => (
            <TemplateLayerView
              key={child.id}
              layer={child}
              selectedId={null}
              onSelect={noop}
              onLayerPointerDown={noop}
              parentMode={rootIsStack ? "stack" : "free"}
            />
          ))}
        </div>
      </div>
    );
  }

  // Scale-based fit modes: render master at native size, transform: scale.
  const masterW = master.size.w;
  const masterH = master.size.h;
  const ratioW = adaptW / masterW;
  const ratioH = adaptH / masterH;
  let fitScale = 1;
  let centerX = false;
  let centerY = false;
  switch (adaptation.fit_mode) {
    case "contain":
      fitScale = Math.min(ratioW, ratioH);
      centerX = true;
      centerY = true;
      break;
    case "cover":
      fitScale = Math.max(ratioW, ratioH);
      centerX = true;
      centerY = true;
      break;
    case "width":
      fitScale = ratioW;
      break;
    case "height":
      fitScale = ratioH;
      break;
  }
  const scaledW = masterW * fitScale;
  const scaledH = masterH * fitScale;
  const offsetX = centerX ? (adaptW - scaledW) / 2 : 0;
  const offsetY = centerY ? (adaptH - scaledH) / 2 : 0;

  const resolved = resolveTreeTokens(master, brandKit);
  const masterBg =
    resolved.background && resolved.background.type === "color"
      ? resolved.background.value
      : "#ffffff";
  const rootIsStack = resolved.layout.mode === "stack";
  const masterInnerStyle: CSSProperties = {
    width: masterW,
    height: masterH,
    position: "relative",
    background: masterBg,
    ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
  };

  return (
    <div ref={ref} style={{ width: adaptW, height: adaptH, background: masterBg, position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: offsetX,
          top: offsetY,
          width: masterW,
          height: masterH,
          transform: `scale(${fitScale})`,
          transformOrigin: "0 0",
        }}
      >
        <div style={masterInnerStyle}>
          {resolved.children.map((child: TemplateLayer) => (
            <TemplateLayerView
              key={child.id}
              layer={child}
              selectedId={null}
              onSelect={noop}
              onLayerPointerDown={noop}
              parentMode={rootIsStack ? "stack" : "free"}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

function noop() {}
