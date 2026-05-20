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
import { substituteVariables, DataRow } from "@/lib/production/variables";
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
  // Cuando hay un dataset cargado y una fila seleccionada, las variables
  // {{var}} del master Y del manual_layout se sustituyen con esta fila antes
  // de renderizar.
  dataRow?: DataRow | null;
}

// Renders a single adaptation at its native pixel size. Used by the export
// pipeline: mount it into a hidden container, capture with html-to-image,
// unmount.
//
// La lógica de fit_mode espeja la del preview en la página de producir.
// Manual_layout (override) tiene prioridad; sino se elige entre responsive
// (constraints) o scale uniforme según el fit_mode.
export const AdaptationRenderer = forwardRef<HTMLDivElement, Props>(function AdaptationRenderer(
  { adaptation, master, brandKit, dataRow },
  ref,
) {
  const adaptW = adaptation.width;
  const adaptH = adaptation.height;

  // El manual_layout es un árbol completo; si hay dataRow le aplicamos la
  // misma sustitución de variables que hacemos al master. Sin esto los
  // overrides manuales ignoraban el dataset.
  const rawManualLayout = parseOverrides(adaptation.overrides_json).manual_layout;
  const manualLayout = rawManualLayout && dataRow
    ? substituteVariables(rawManualLayout, dataRow)
    : rawManualLayout;
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

  // Aplicamos substitución de variables al master antes de cualquier otra
  // transformación (reflow / scale) para que las variables {{var}} salgan
  // resueltas tanto en responsive como en cover/contain/width/height.
  const effectiveMaster = dataRow ? substituteVariables(master, dataRow) : master;

  if (adaptation.fit_mode === "responsive") {
    const reflowed = reflowForPreview(effectiveMaster, { w: adaptW, h: adaptH });
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
  const masterW = effectiveMaster.size.w;
  const masterH = effectiveMaster.size.h;
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

  const resolved = resolveTreeTokens(effectiveMaster, brandKit);
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
