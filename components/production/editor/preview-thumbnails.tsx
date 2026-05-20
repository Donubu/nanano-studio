"use client";

import { useState, CSSProperties } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TemplateDefinition,
  TemplateLayer,
  StackLayout,
} from "@/lib/production/types";
import { BrandKitContent, resolveTreeTokens } from "@/lib/production/brand-kit";
import { reflowForPreview } from "@/lib/production/reflow";
import { TemplateLayerView, stackToFlexStyle } from "./template-layer";

export interface ThumbnailPreset {
  id: string;
  label: string;
  size: { w: number; h: number };
}

const THUMB_HEIGHT = 160;
const RATIO_EPSILON = 0.001;

interface Props {
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  presets: ThumbnailPreset[];
  activePreviewId: string | null;
  onSelectPreview: (id: string | null) => void;
}

// Thumbnail bar at the top of the canvas column. Renders a read-only mini
// preview of the template in each non-master aspect ratio. Click a thumb to
// open it in the main canvas; click the active thumb again to drop back to
// the master view.
export function PreviewThumbnails({
  definition,
  brandKit,
  presets,
  activePreviewId,
  onSelectPreview,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const masterRatio = definition.size.w / definition.size.h;
  const visiblePresets = presets.filter((p) => {
    const r = p.size.w / p.size.h;
    return Math.abs(r - masterRatio) > RATIO_EPSILON;
  });

  if (visiblePresets.length === 0) return null;

  return (
    <div className="border-b border-border/50 bg-muted/20 shrink-0">
      <div className="flex items-center justify-end px-2 py-0.5">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center gap-1 px-1.5 py-0.5"
          title={collapsed ? "Mostrar previews" : "Ocultar previews"}
        >
          {collapsed ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          )}
          Previews
        </button>
      </div>
      {!collapsed && (
        <div className="flex items-end justify-center gap-4 pb-2 px-3">
          {visiblePresets.map((p) => (
            <PreviewCard
              key={p.id}
              preset={p}
              definition={definition}
              brandKit={brandKit}
              active={activePreviewId === p.id}
              onClick={() =>
                onSelectPreview(activePreviewId === p.id ? null : p.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PreviewCard({
  preset,
  definition,
  brandKit,
  active,
  onClick,
}: {
  preset: ThumbnailPreset;
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  active: boolean;
  onClick: () => void;
}) {
  const reflowed = reflowForPreview(definition, preset.size);
  const resolved = resolveTreeTokens(reflowed, brandKit);
  const scale = THUMB_HEIGHT / preset.size.h;
  const cssW = preset.size.w * scale;
  const bg =
    resolved.background && resolved.background.type === "color"
      ? resolved.background.value
      : "#ffffff";

  const rootIsStack = resolved.layout.mode === "stack";
  const innerStyle: CSSProperties = {
    width: preset.size.w,
    height: preset.size.h,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    position: "relative",
    ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
  };
  const childParentMode: "free" | "stack" = rootIsStack ? "stack" : "free";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 group focus:outline-none"
      title={`${preset.label} · ${preset.size.w}×${preset.size.h}`}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded shadow-sm border-2 transition-all",
          active
            ? "border-primary shadow-md"
            : "border-transparent group-hover:border-foreground/30"
        )}
        style={{ width: cssW, height: THUMB_HEIGHT, background: bg }}
      >
        <div style={innerStyle}>
          {resolved.children.map((child: TemplateLayer) => (
            <TemplateLayerView
              key={child.id}
              layer={child}
              selectedId={null}
              onSelect={noop}
              onLayerPointerDown={noop}
              parentMode={childParentMode}
            />
          ))}
        </div>
      </div>
      <span
        className={cn(
          "text-[10px]",
          active ? "text-foreground font-medium" : "text-muted-foreground"
        )}
      >
        {preset.label}
      </span>
    </button>
  );
}

function noop() {}
