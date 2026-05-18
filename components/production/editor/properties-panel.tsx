"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignHorizontalSpaceAround,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalSpaceAround,
  ImageIcon,
  Loader2,
  PanelRightClose,
  Pipette,
  Upload,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  ImageLayer,
  ShapeLayer,
  FrameLayer,
  IconLayer,
  StackLayout,
  StackAlign,
  StackJustify,
  DEFAULT_STACK_LAYOUT,
  Constraints,
  ConstraintH,
  ConstraintV,
  DEFAULT_CONSTRAINTS,
  FontSizeRange,
  isFontSizeRange,
} from "@/lib/production/types";
import {
  ICON_CATALOG,
  ICON_CATEGORIES,
  type IconCategory,
} from "@/lib/production/icon-catalog";
import {
  BrandKit,
  BrandKitContent,
  EMPTY_KIT_CONTENT,
  parseRef,
  makeRef,
  ColorToken,
} from "@/lib/production/brand-kit";
import { cn } from "@/lib/utils";
import { ClientImagePicker } from "@/components/production/editor/client-image-picker";

interface Props {
  definition: TemplateDefinition;
  selectedLayer: TemplateLayer | null;
  // Multi-select. Cuando length > 1, mostramos un panel especial de
  // alineación + distribución en vez del editor per-layer.
  selectedIds?: string[];
  onAlign?: (
    direction:
      | "left"
      | "center-h"
      | "right"
      | "top"
      | "center-v"
      | "bottom",
  ) => void;
  onDistribute?: (axis: "horizontal" | "vertical") => void;
  onUpdateLayer: (id: string, mutator: (layer: TemplateLayer) => TemplateLayer) => void;
  onUpdateRoot: (mutator: (root: TemplateDefinition) => TemplateDefinition) => void;
  brandKit?: BrandKitContent;
  clientId?: number | null;
  projectId?: number;
  allBrandKits?: BrandKit[];
  onBrandKitsChange?: () => void;
  // Cuando viene, el panel muestra un botón para colapsarse.
  onCollapse?: () => void;
  // Cuando true, no rendereamos ni el header interno ni el border/width del
  // <aside>. Se usa cuando el panel vive dentro de un acordeón que ya provee
  // su propia chrome.
  embedded?: boolean;
}

function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-12 text-muted-foreground">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-xs"
      />
    </label>
  );
}

// Number field that can be either a literal number or a token reference. Used
// for fontSize (scale tokens), padding/gap (spacing tokens).
function TokenNumberRow<T extends { name: string; label: string; value?: number; fontSize?: number }>({
  label,
  value,
  onChangeLiteral,
  onPickToken,
  tokens,
  refKind,
  min = 0,
  max,
}: {
  label: string;
  value: number | string | undefined;
  onChangeLiteral: (n: number) => void;
  onPickToken: (ref: string) => void;
  tokens: T[];
  refKind: "scale" | "spacing";
  min?: number;
  max?: number;
}) {
  const ref = parseRef(value);
  const isRef = ref && ref.kind === refKind;
  const refToken = isRef ? tokens.find((t) => t.name === ref.name) : null;
  // For literal display when value is a number; if ref, show resolved value placeholder.
  const literalValue =
    typeof value === "number"
      ? value
      : refToken
      ? refToken.value ?? refToken.fontSize ?? 0
      : Number(value) || 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">{label}</span>
        {isRef ? (
          <div className="flex-1 flex items-center gap-1 bg-blue-500/10 border border-blue-500/30 rounded px-2 py-1">
            <span className="text-xs flex-1 truncate text-blue-300">
              {refToken?.label ?? ref.name}{" "}
              <span className="text-[10px] text-blue-300/60">({literalValue}px)</span>
            </span>
            <button
              type="button"
              onClick={() => onChangeLiteral(literalValue)}
              className="text-[10px] text-blue-300 hover:text-foreground"
              title="Convertir a valor literal"
            >
              ×
            </button>
          </div>
        ) : (
          <input
            type="number"
            value={literalValue}
            min={min}
            max={max}
            onChange={(e) => onChangeLiteral(Math.max(min, Number(e.target.value)))}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-xs"
          />
        )}
      </div>
      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-14">
          {tokens.map((t) => {
            const active = isRef && ref.name === t.name;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => onPickToken(makeRef(refKind, t.name))}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title={`${t.name} = ${t.value ?? t.fontSize}px`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Font-size field con tres modos:
//   - número o token ref ("{scale.lg}"): tamaño fijo (TokenNumberRow normal).
//   - { min, max }: smart text — el render busca el font-size más grande que
//     entre en la caja. Toggle para alternar entre fijo y rango.
function FontSizeRow({
  value,
  scales,
  onChange,
}: {
  value: number | string | FontSizeRange | undefined;
  scales: { name: string; label: string; fontSize?: number }[];
  onChange: (next: number | string | FontSizeRange) => void;
}) {
  const isRange = isFontSizeRange(value);

  const toFixed = () => {
    // Pasamos de rango a fijo usando el max como tamaño objetivo.
    if (isRange) onChange(value.max);
  };
  const toRange = () => {
    if (isRange) return;
    // Pasamos de fijo a rango. Default sensato: min = max / 2, max = current.
    const current =
      typeof value === "number" ? value : Number(value) || 48;
    const max = Math.max(8, Math.round(current));
    const min = Math.max(6, Math.round(max / 2));
    onChange({ min, max });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">Tamaño</span>
        <div className="flex-1 flex items-center gap-1">
          <button
            type="button"
            onClick={toFixed}
            className={cn(
              "flex-1 text-[10px] py-1 rounded border",
              !isRange
                ? "border-primary bg-primary/10"
                : "border-border/50 text-muted-foreground hover:bg-muted"
            )}
            title="Tamaño fijo en px"
          >
            Fijo
          </button>
          <button
            type="button"
            onClick={toRange}
            className={cn(
              "flex-1 text-[10px] py-1 rounded border",
              isRange
                ? "border-primary bg-primary/10"
                : "border-border/50 text-muted-foreground hover:bg-muted"
            )}
            title="Auto-ajusta entre min y max según el espacio disponible"
          >
            Auto-fit
          </button>
        </div>
      </div>
      {isRange ? (
        // Antes el bloque tenía pl-14 + dos labels con flex-1 sin min-w-0.
        // En la columna fija de 256px el max se desbordaba y aparecía scroll
        // horizontal. Quitamos el pl-14 (no aporta acá, ya hay alineación por
        // el row de arriba) y forzamos min-w-0 + w-full en los inputs para
        // que se encojan dentro de su columna.
        <div className="flex items-center gap-2">
          <label className="flex-1 min-w-0 flex items-center gap-1 text-[10px] text-muted-foreground">
            min
            <input
              type="number"
              min={1}
              value={value.min}
              onChange={(e) =>
                onChange({
                  ...value,
                  min: Math.max(1, Number(e.target.value) || 1),
                })
              }
              className="flex-1 min-w-0 w-full bg-muted border border-border/50 rounded px-1.5 py-1 text-xs"
            />
          </label>
          <label className="flex-1 min-w-0 flex items-center gap-1 text-[10px] text-muted-foreground">
            max
            <input
              type="number"
              min={value.min}
              value={value.max}
              onChange={(e) =>
                onChange({
                  ...value,
                  max: Math.max(value.min, Number(e.target.value) || value.min),
                })
              }
              className="flex-1 min-w-0 w-full bg-muted border border-border/50 rounded px-1.5 py-1 text-xs"
            />
          </label>
        </div>
      ) : (
        <TokenNumberRow
          label=""
          value={value as number | string | undefined}
          tokens={scales}
          refKind="scale"
          min={1}
          onChangeLiteral={(v) => onChange(v)}
          onPickToken={(r) => onChange(r)}
        />
      )}
    </div>
  );
}

// String field that can be either a literal or a token reference. Used for
// fontFamily (font tokens) and image src (logo tokens).
function TokenTextRow<T extends { name: string; label: string }>({
  label,
  value,
  onChange,
  tokens,
  refKind,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  tokens: T[];
  refKind: "font" | "logo";
  placeholder?: string;
}) {
  const ref = parseRef(value);
  const isRef = ref && ref.kind === refKind;
  const refToken = isRef ? tokens.find((t) => t.name === ref.name) : null;

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">{label}</span>
        {isRef ? (
          <div className="flex-1 flex items-center gap-1 bg-blue-500/10 border border-blue-500/30 rounded px-2 py-1">
            <span className="text-xs flex-1 truncate text-blue-300">
              {refToken?.label ?? ref.name}
            </span>
            <button
              type="button"
              onClick={() => onChange("")}
              className="text-[10px] text-blue-300 hover:text-foreground"
              title="Convertir a valor literal"
            >
              ×
            </button>
          </div>
        ) : (
          <input
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-xs"
          />
        )}
      </label>
      {tokens.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-14">
          {tokens.map((t) => {
            const active = isRef && ref.name === t.name;
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => onChange(makeRef(refKind, t.name))}
                className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title={t.name}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Detección + construcción de gradientes. Solo soportamos en UI los dos
// formatos canónicos que generamos nosotros:
//   linear-gradient(<angle>deg, <c1>, <c2>)
//   radial-gradient(circle, <c1>, <c2>)
// Si el productor (o el agente) mete un gradiente con más stops o sintaxis
// custom, el render CSS sigue funcionando pero la UI no puede roundtripear
// — se cae al modo "string libre" y muestra el campo de texto.

interface ParsedGradient {
  kind: "linear" | "radial";
  angle: number; // solo aplica a linear
  colorA: string;
  colorB: string;
}

function parseGradient(value: string): ParsedGradient | null {
  const trimmed = value.trim();
  // linear-gradient(123deg, #aaa, #bbb)
  const linear = trimmed.match(
    /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i,
  );
  if (linear) {
    return {
      kind: "linear",
      angle: Number(linear[1]),
      colorA: linear[2].trim(),
      colorB: linear[3].trim(),
    };
  }
  // radial-gradient(circle, #aaa, #bbb)
  const radial = trimmed.match(
    /^radial-gradient\(\s*circle\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)$/i,
  );
  if (radial) {
    return {
      kind: "radial",
      angle: 0,
      colorA: radial[1].trim(),
      colorB: radial[2].trim(),
    };
  }
  return null;
}

function buildGradient(g: ParsedGradient): string {
  if (g.kind === "linear") {
    return `linear-gradient(${g.angle}deg, ${g.colorA}, ${g.colorB})`;
  }
  return `radial-gradient(circle, ${g.colorA}, ${g.colorB})`;
}

// FillRow extiende el concepto de ColorRow agregando soporte para gradiente.
// Modo toggle Sólido / Linear / Radial. En modos gradient muestra 2 color
// inputs + (para linear) un slider de ángulo. Genera el string CSS y lo
// guarda en el mismo campo.
function FillRow({
  label,
  value,
  onChange,
  tokens,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  tokens?: ColorToken[];
}) {
  const parsed = parseGradient(value);
  const mode: "solid" | "linear" | "radial" = parsed?.kind ?? "solid";

  // Cambiar de modo: si vamos a gradient desde solid, usamos el color actual
  // como colorA y un blanco como colorB. Si volvemos a solid, usamos colorA
  // del gradient como el color sólido (preservamos el primer color).
  const switchTo = (next: "solid" | "linear" | "radial") => {
    if (next === "solid") {
      const fallback = parsed?.colorA ?? value;
      onChange(fallback);
      return;
    }
    const base: ParsedGradient = {
      kind: next,
      angle: parsed?.kind === "linear" ? parsed.angle : 90,
      colorA: parsed?.colorA ?? value,
      colorB: parsed?.colorB ?? "#ffffff",
    };
    onChange(buildGradient(base));
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px]">
        <span className="w-12 text-muted-foreground">{label}</span>
        {(["solid", "linear", "radial"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchTo(m)}
            className={cn(
              "flex-1 py-1 rounded border transition-colors",
              mode === m
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {m === "solid" ? "Sólido" : m === "linear" ? "Linear" : "Radial"}
          </button>
        ))}
      </div>
      {mode === "solid" && (
        <ColorRow
          label=""
          value={value}
          tokens={tokens}
          onChange={onChange}
        />
      )}
      {parsed && (mode === "linear" || mode === "radial") && (
        <>
          <ColorRow
            label="Color 1"
            value={parsed.colorA}
            tokens={tokens}
            onChange={(v) =>
              onChange(buildGradient({ ...parsed, colorA: v }))
            }
          />
          <ColorRow
            label="Color 2"
            value={parsed.colorB}
            tokens={tokens}
            onChange={(v) =>
              onChange(buildGradient({ ...parsed, colorB: v }))
            }
          />
          {mode === "linear" && (
            <div className="flex items-center gap-2 text-xs">
              <span className="w-12 text-muted-foreground">Ángulo</span>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={parsed.angle}
                onChange={(e) =>
                  onChange(buildGradient({ ...parsed, angle: Number(e.target.value) }))
                }
                className="flex-1"
              />
              <span className="text-[10px] text-muted-foreground w-10 text-right">
                {parsed.angle}°
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  tokens,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  tokens?: ColorToken[];
}) {
  const ref = parseRef(value);
  const refToken = ref && ref.kind === "color" ? tokens?.find((t) => t.name === ref.name) : null;
  const isRef = ref !== null;
  const inputColor = isRef && refToken ? refToken.value : (isRef ? "#888888" : value);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">{label}</span>
        {isRef ? (
          <div className="flex-1 flex items-center gap-1 bg-muted border border-border/50 rounded px-2 py-1">
            <div
              className="w-4 h-4 rounded border border-border/50"
              style={{ background: inputColor }}
            />
            <span className="text-xs flex-1 truncate">
              {refToken?.label ?? ref.name}
            </span>
            <button
              type="button"
              onClick={() => onChange(inputColor)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
              title="Convertir a valor personalizado"
            >
              ×
            </button>
          </div>
        ) : (
          <>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              // w-7 h-7 = cuadrado 28×28. Los selectores
              // ::-webkit-color-swatch-wrapper y ::-webkit-color-swatch quitan
              // el padding interno de Chrome/Edge que aplastaba el color
              // visible adentro del input.
              className="w-7 h-7 shrink-0 rounded border border-border/50 bg-muted cursor-pointer p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-sm"
            />
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-xs font-mono"
            />
            <EyeDropperButton onPick={onChange} />
          </>
        )}
      </div>
      {tokens && tokens.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-14">
          {tokens.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => onChange(makeRef("color", t.name))}
              className={`w-5 h-5 rounded border ${
                isRef && refToken?.name === t.name
                  ? "border-primary ring-1 ring-primary"
                  : "border-border/50 hover:border-foreground/40"
              }`}
              style={{ background: t.value }}
              title={`${t.label} · ${t.value}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TextRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-12 text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-xs"
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export function PropertiesPanel({
  definition,
  selectedLayer,
  selectedIds,
  onAlign,
  onDistribute,
  onUpdateLayer,
  onUpdateRoot,
  brandKit = EMPTY_KIT_CONTENT,
  clientId = null,
  onCollapse,
  embedded = false,
}: Props) {
  const noSelection = !selectedLayer;
  const isRoot = selectedLayer?.id === "tpl_root";
  // Multi-select activo cuando hay 2+ ids. Cuando lo es, reemplazamos el
  // contenido per-layer por el panel de align/distribute.
  const isMultiSelect = !!selectedIds && selectedIds.length > 1;

  return (
    <aside
      className={cn(
        "flex flex-col min-h-0",
        embedded
          ? "h-full overflow-y-auto overflow-x-hidden"
          : "w-64 shrink-0 border-l border-border/50 bg-card/40 overflow-y-auto overflow-x-hidden",
      )}
    >
      {!embedded && (
        <div className="p-3 border-b border-border/50 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {noSelection ? "Propiedades" : isRoot ? "Canvas" : labelForType(selectedLayer!.type)}
          </h3>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded"
              title="Colapsar"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="p-3 space-y-4">
        {/* Multi-select: el productor seleccionó 2+ capas. Mostramos el
            panel de align/distribute en vez del editor per-layer — no tiene
            sentido editar style cuando hay múltiples capas heterogéneas. */}
        {isMultiSelect && (
          <MultiSelectAlignPanel
            count={selectedIds!.length}
            onAlign={onAlign}
            onDistribute={onDistribute}
          />
        )}

        {!isMultiSelect && noSelection && (
          <p className="text-xs text-muted-foreground">
            Selecciona una capa para editar sus propiedades.
          </p>
        )}

        {!isMultiSelect && isRoot && (
          <RootProps definition={definition} onUpdateRoot={onUpdateRoot} brandKit={brandKit} />
        )}

        {!isMultiSelect && selectedLayer && !isRoot && (
          <LayerProps
            layer={selectedLayer}
            onUpdate={onUpdateLayer}
            brandKit={brandKit}
            clientId={clientId}
          />
        )}
      </div>
    </aside>
  );
}

// Panel que aparece cuando hay multi-selección. Botones de align al
// bounding box común (6 direcciones) + distribute horizontal/vertical
// (requiere 3+ capas).
function MultiSelectAlignPanel({
  count,
  onAlign,
  onDistribute,
}: {
  count: number;
  onAlign?: (
    direction:
      | "left"
      | "center-h"
      | "right"
      | "top"
      | "center-v"
      | "bottom",
  ) => void;
  onDistribute?: (axis: "horizontal" | "vertical") => void;
}) {
  const canDistribute = count >= 3;
  const btnClass =
    "flex items-center justify-center h-9 rounded border border-border/50 hover:bg-muted text-foreground transition-colors";
  const btnDisabled =
    "flex items-center justify-center h-9 rounded border border-border/30 text-muted-foreground/40 cursor-not-allowed";
  return (
    <Section title={`${count} capas seleccionadas`}>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Alinear
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" onClick={() => onAlign?.("left")} className={btnClass} title="Alinear a la izquierda">
            <AlignHorizontalJustifyStart className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onAlign?.("center-h")} className={btnClass} title="Centrar horizontalmente">
            <AlignHorizontalJustifyCenter className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onAlign?.("right")} className={btnClass} title="Alinear a la derecha">
            <AlignHorizontalJustifyEnd className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onAlign?.("top")} className={btnClass} title="Alinear arriba">
            <AlignVerticalJustifyStart className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onAlign?.("center-v")} className={btnClass} title="Centrar verticalmente">
            <AlignVerticalJustifyCenter className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onAlign?.("bottom")} className={btnClass} title="Alinear abajo">
            <AlignVerticalJustifyEnd className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
          Distribuir {!canDistribute && <span className="normal-case text-muted-foreground/60">(necesita 3+)</span>}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => canDistribute && onDistribute?.("horizontal")}
            className={canDistribute ? btnClass : btnDisabled}
            disabled={!canDistribute}
            title="Distribuir horizontalmente (gaps iguales en X)"
          >
            <AlignHorizontalSpaceAround className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => canDistribute && onDistribute?.("vertical")}
            className={canDistribute ? btnClass : btnDisabled}
            disabled={!canDistribute}
            title="Distribuir verticalmente (gaps iguales en Y)"
          >
            <AlignVerticalSpaceAround className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Section>
  );
}

function labelForType(type: TemplateLayer["type"]) {
  switch (type) {
    case "frame":
      return "Frame";
    case "text":
      return "Texto";
    case "image":
      return "Imagen";
    case "shape":
      return "Forma";
    case "icon":
      return "Ícono";
  }
}

function RootProps({
  definition,
  onUpdateRoot,
  brandKit,
}: {
  definition: TemplateDefinition;
  onUpdateRoot: (m: (root: TemplateDefinition) => TemplateDefinition) => void;
  brandKit: BrandKitContent;
}) {
  const bgColor =
    definition.background && definition.background.type === "color"
      ? definition.background.value
      : "#ffffff";

  return (
    <>
      <Section title="Fondo">
        <FillRow
          label="Color"
          value={bgColor}
          tokens={brandKit.colors}
          onChange={(v) =>
            onUpdateRoot((root) => ({
              ...root,
              background: { type: "color", value: v },
            }))
          }
        />
        <p className="text-[10px] text-muted-foreground pt-1">
          {definition.size.w} × {definition.size.h} px
        </p>
      </Section>

      <LayoutControls frame={definition} onUpdateFrame={onUpdateRoot} brandKit={brandKit} />
    </>
  );
}

function LayerProps({
  layer,
  onUpdate,
  brandKit,
  clientId,
}: {
  layer: TemplateLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
  clientId: number | null;
}) {
  return (
    <>
      <Section title="Nombre">
        <TextRow
          label="Capa"
          value={layer.name ?? ""}
          onChange={(v) => onUpdate(layer.id, (l) => ({ ...l, name: v }))}
        />
      </Section>

      <Section title="Posición y tamaño">
        <NumberRow
          label="X"
          value={Math.round(layer.position.x)}
          onChange={(v) =>
            onUpdate(layer.id, (l) => ({ ...l, position: { ...l.position, x: v } }))
          }
        />
        <NumberRow
          label="Y"
          value={Math.round(layer.position.y)}
          onChange={(v) =>
            onUpdate(layer.id, (l) => ({ ...l, position: { ...l.position, y: v } }))
          }
        />
        <NumberRow
          label="Ancho"
          value={Math.round(layer.size.w)}
          min={1}
          onChange={(v) =>
            onUpdate(layer.id, (l) => ({ ...l, size: { ...l.size, w: Math.max(1, v) } }))
          }
        />
        <NumberRow
          label="Alto"
          value={Math.round(layer.size.h)}
          min={1}
          onChange={(v) =>
            onUpdate(layer.id, (l) => ({ ...l, size: { ...l.size, h: Math.max(1, v) } }))
          }
        />
      </Section>

      <ConstraintsControls
        layer={layer}
        onUpdate={(next) =>
          onUpdate(layer.id, (l) => ({ ...l, constraints: next }))
        }
      />

      {layer.type === "text" && (
        <TextProps layer={layer} onUpdate={onUpdate} brandKit={brandKit} />
      )}
      {layer.type === "image" && (
        <ImageProps
          layer={layer}
          onUpdate={onUpdate}
          brandKit={brandKit}
          clientId={clientId}
        />
      )}
      {layer.type === "shape" && (
        <ShapeProps layer={layer} onUpdate={onUpdate} brandKit={brandKit} />
      )}
      {layer.type === "icon" && (
        <IconProps layer={layer} onUpdate={onUpdate} brandKit={brandKit} />
      )}
      {layer.type === "frame" && (
        <FrameProps layer={layer} onUpdate={onUpdate} brandKit={brandKit} />
      )}

      {/* Drop shadow — disponible para cualquier layer type. El renderer
          decide internamente si aplica boxShadow o textShadow según el
          contexto (text-sin-bg → textShadow; resto → boxShadow). */}
      <ShadowSection layer={layer} onUpdate={onUpdate} brandKit={brandKit} />
    </>
  );
}

// Sección de drop shadow común a todos los layer types. Toggle + offsets +
// blur + color. Sin spread (lo dejamos fuera del MVP — confunde y es
// redundante con blur para 90% de los casos).
function ShadowSection({
  layer,
  onUpdate,
  brandKit,
}: {
  layer: TemplateLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
}) {
  const s = layer.shadow;
  return (
    <Section title="Sombra">
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">Sombra</span>
        <label className="flex items-center gap-1 cursor-pointer flex-1">
          <input
            type="checkbox"
            checked={s != null}
            onChange={(e) =>
              onUpdate(layer.id, (l) => ({
                ...l,
                shadow: e.target.checked
                  ? (l.shadow ?? { x: 0, y: 8, blur: 16, color: "rgba(0,0,0,0.25)" })
                  : undefined,
              }))
            }
          />
          <span className="text-muted-foreground">
            {s ? "Activada" : "Sin sombra"}
          </span>
        </label>
      </div>
      {s && (
        <>
          <NumberRow
            label="X"
            value={s.x}
            onChange={(v) =>
              onUpdate(layer.id, (l) =>
                l.shadow ? { ...l, shadow: { ...l.shadow, x: v } } : l,
              )
            }
          />
          <NumberRow
            label="Y"
            value={s.y}
            onChange={(v) =>
              onUpdate(layer.id, (l) =>
                l.shadow ? { ...l, shadow: { ...l.shadow, y: v } } : l,
              )
            }
          />
          <NumberRow
            label="Blur"
            value={s.blur}
            min={0}
            max={200}
            onChange={(v) =>
              onUpdate(layer.id, (l) =>
                l.shadow ? { ...l, shadow: { ...l.shadow, blur: Math.max(0, v) } } : l,
              )
            }
          />
          <ColorRow
            label="Color"
            value={s.color}
            tokens={brandKit.colors}
            onChange={(v) =>
              onUpdate(layer.id, (l) =>
                l.shadow ? { ...l, shadow: { ...l.shadow, color: v } } : l,
              )
            }
          />
        </>
      )}
    </Section>
  );
}

function TextProps({
  layer,
  onUpdate,
  brandKit,
}: {
  layer: TextLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
}) {
  const updateStyle = (s: Partial<TextLayer["style"]>) =>
    onUpdate(layer.id, (l) =>
      l.type === "text" ? { ...l, style: { ...l.style, ...s } } : l
    );
  return (
    <>
      <Section title="Contenido">
        <textarea
          value={layer.content}
          onChange={(e) =>
            onUpdate(layer.id, (l) =>
              l.type === "text" ? { ...l, content: e.target.value } : l
            )
          }
          rows={3}
          className="w-full bg-muted border border-border/50 rounded px-2 py-1 text-xs"
        />
      </Section>
      <Section title="Tipografía">
        <TokenTextRow
          label="Fuente"
          value={layer.style.fontFamily ?? ""}
          tokens={brandKit.fonts}
          refKind="font"
          placeholder="Inter, system-ui, sans-serif"
          onChange={(v) => updateStyle({ fontFamily: v || undefined })}
        />
        <FontSizeRow
          value={layer.style.fontSize}
          scales={brandKit.scales}
          onChange={(v) => updateStyle({ fontSize: v })}
        />
        <NumberRow
          label="Peso"
          value={Number(layer.style.fontWeight ?? 400)}
          min={100}
          max={900}
          step={100}
          onChange={(v) => updateStyle({ fontWeight: v })}
        />
        <ColorRow
          label="Color"
          value={layer.style.color}
          tokens={brandKit.colors}
          onChange={(v) => updateStyle({ color: v })}
        />
        {/* Alineación horizontal — text-align. Iconos lucide propios de texto
            (AlignLeft/Center/Right) en vez de flechas ASCII genéricas. */}
        <div className="flex items-center gap-1">
          {(
            [
              { v: "left", Icon: AlignLeft, title: "Alinear texto a la izquierda" },
              { v: "center", Icon: AlignCenter, title: "Centrar texto horizontalmente" },
              { v: "right", Icon: AlignRight, title: "Alinear texto a la derecha" },
            ] as const
          ).map(({ v, Icon, title }) => (
            <button
              key={v}
              type="button"
              onClick={() => updateStyle({ align: v })}
              title={title}
              className={cn(
                "flex-1 flex items-center justify-center py-1 rounded border transition-colors",
                (layer.style.align ?? "left") === v
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        {/* Alineación vertical — flex justify-content sobre el contenedor del
            texto. Útil para banners chatos donde la caja es más alta que el
            contenido, o smart text con espacio sobrante. */}
        <div className="flex items-center gap-1">
          {(
            [
              { v: "top", Icon: AlignVerticalJustifyStart, title: "Alinear arriba" },
              { v: "middle", Icon: AlignVerticalJustifyCenter, title: "Centrar verticalmente" },
              { v: "bottom", Icon: AlignVerticalJustifyEnd, title: "Alinear abajo" },
            ] as const
          ).map(({ v, Icon, title }) => (
            <button
              key={v}
              type="button"
              onClick={() => updateStyle({ verticalAlign: v })}
              title={title}
              className={cn(
                "flex-1 flex items-center justify-center py-1 rounded border transition-colors",
                (layer.style.verticalAlign ?? "top") === v
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </Section>
      {/* Fondo del text layer — colapsa el patrón viejo de shape+text a una
          sola capa. Toggle "tiene fondo" + color + radius. Quitar el toggle
          es lo mismo que limpiar backgroundColor → la capa vuelve a ser
          un text "puro". */}
      <Section title="Fondo">
        <div className="flex items-center gap-2 text-xs">
          <span className="w-12 text-muted-foreground">Fondo</span>
          <label className="flex items-center gap-1 cursor-pointer flex-1">
            <input
              type="checkbox"
              checked={layer.style.backgroundColor != null}
              onChange={(e) =>
                updateStyle({
                  backgroundColor: e.target.checked
                    ? (layer.style.backgroundColor ?? "#0F172A")
                    : undefined,
                  backgroundCornerRadius: e.target.checked
                    ? (layer.style.backgroundCornerRadius ?? 0)
                    : undefined,
                })
              }
            />
            <span className="text-muted-foreground">
              {layer.style.backgroundColor ? "Activado" : "Sin fondo"}
            </span>
          </label>
        </div>
        {layer.style.backgroundColor != null && (
          <>
            <FillRow
              label="Color"
              value={layer.style.backgroundColor}
              tokens={brandKit.colors}
              onChange={(v) => updateStyle({ backgroundColor: v })}
            />
            <NumberRow
              label="Radio"
              value={layer.style.backgroundCornerRadius ?? 0}
              min={0}
              onChange={(v) =>
                updateStyle({ backgroundCornerRadius: Math.max(0, v) })
              }
            />
            {/* Shortcuts: pill (radius = h/2) y círculo (radius = w/2 si la
                caja es cuadrada, igual aplicable a no-cuadrada como aprox).
                Setean el radius al valor exacto del shortcut. */}
            <div className="flex items-center gap-1 pl-14">
              <button
                type="button"
                onClick={() =>
                  updateStyle({
                    backgroundCornerRadius: Math.floor(layer.size.h / 2),
                  })
                }
                className="flex-1 text-[10px] py-1 rounded border border-border/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Pill: radio = altura / 2"
              >
                Pill
              </button>
              <button
                type="button"
                onClick={() =>
                  updateStyle({
                    backgroundCornerRadius: Math.floor(
                      Math.min(layer.size.w, layer.size.h) / 2,
                    ),
                  })
                }
                className="flex-1 text-[10px] py-1 rounded border border-border/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Círculo: requiere caja cuadrada para que se vea redondo"
              >
                Círculo
              </button>
              <button
                type="button"
                onClick={() => updateStyle({ backgroundCornerRadius: 0 })}
                className="flex-1 text-[10px] py-1 rounded border border-border/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Esquinas rectas"
              >
                Recto
              </button>
            </div>
          </>
        )}
      </Section>
    </>
  );
}

function ImageProps({
  layer,
  onUpdate,
  brandKit,
  clientId,
}: {
  layer: ImageLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
  clientId: number | null;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("El archivo debe ser una imagen");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/production/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: dataUrl, clientId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setUploadError(body?.error || "Error al subir");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      onUpdate(layer.id, (l) =>
        l.type === "image" ? { ...l, src: url } : l
      );
    } catch (err) {
      console.error("Error subiendo imagen:", err);
      setUploadError("Error inesperado");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <Section title="Imagen">
      <TokenTextRow
        label="Logo"
        value={layer.src ?? ""}
        tokens={brandKit.logos}
        refKind="logo"
        placeholder="URL de la imagen"
        onChange={(v) =>
          onUpdate(layer.id, (l) =>
            l.type === "image" ? { ...l, src: v.trim() || null } : l
          )
        }
      />
      <div
        className={cn(
          "rounded border border-dashed transition-colors p-1 -m-1",
          dragOver
            ? "border-primary/60 bg-primary/5"
            : "border-transparent"
        )}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="grid grid-cols-2 gap-1">
          {clientId !== null && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded border border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted transition-colors"
            >
              <ImageIcon className="h-3 w-3" />
              Galería
            </button>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded border transition-colors",
              "border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted",
              clientId === null && "col-span-2",
              uploading && "opacity-60 cursor-wait"
            )}
            title="Subir desde tu equipo (se guarda en GCS)"
          >
            {uploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Upload className="h-3 w-3" />
            )}
            {uploading ? "Subiendo…" : "Subir o arrastrar"}
          </button>
        </div>
        {uploadError && (
          <p className="text-[10px] text-red-400 mt-1">{uploadError}</p>
        )}
      </div>
      {pickerOpen && clientId !== null && (
        <ClientImagePicker
          clientId={clientId}
          onClose={() => setPickerOpen(false)}
          onPick={(img) =>
            onUpdate(layer.id, (l) =>
              l.type === "image" ? { ...l, src: img.url } : l
            )
          }
        />
      )}
      <div className="flex items-center gap-1">
        {(["cover", "contain", "fill"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() =>
              onUpdate(layer.id, (l) => (l.type === "image" ? { ...l, fit: f } : l))
            }
            className={`flex-1 text-[10px] py-1 rounded border ${
              (layer.fit ?? "cover") === f
                ? "border-primary bg-primary/10"
                : "border-border/50 hover:bg-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
      <NumberRow
        label="Radio"
        value={layer.cornerRadius ?? 0}
        min={0}
        onChange={(v) =>
          onUpdate(layer.id, (l) =>
            l.type === "image" ? { ...l, cornerRadius: v } : l
          )
        }
      />
    </Section>
  );
}

function ShapeProps({
  layer,
  onUpdate,
  brandKit,
}: {
  layer: ShapeLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
}) {
  return (
    <Section title="Forma">
      <div className="flex items-center gap-1">
        {(["rect", "ellipse"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() =>
              onUpdate(layer.id, (l) => (l.type === "shape" ? { ...l, shape: s } : l))
            }
            className={`flex-1 text-xs py-1 rounded border ${
              layer.shape === s
                ? "border-primary bg-primary/10"
                : "border-border/50 hover:bg-muted"
            }`}
          >
            {s === "rect" ? "Rectángulo" : "Elipse"}
          </button>
        ))}
      </div>
      <FillRow
        label="Relleno"
        value={layer.fill}
        tokens={brandKit.colors}
        onChange={(v) =>
          onUpdate(layer.id, (l) => (l.type === "shape" ? { ...l, fill: v } : l))
        }
      />
      {layer.shape !== "ellipse" && (
        <NumberRow
          label="Radio"
          value={layer.cornerRadius ?? 0}
          min={0}
          onChange={(v) =>
            onUpdate(layer.id, (l) =>
              l.type === "shape" ? { ...l, cornerRadius: v } : l
            )
          }
        />
      )}
      {/* Stroke / borde. El schema ya lo soporta (ShapeLayer.stroke) y el
          renderer SVG lo dibuja; faltaba la UI. Toggle de "tiene borde" +
          color + width cuando está activo. width=0 equivale a sin borde,
          pero usamos null en la BD para distinguirlo del 0 explícito. */}
      <div className="flex items-center gap-2 text-xs">
        <span className="w-12 text-muted-foreground">Borde</span>
        <label className="flex items-center gap-1 cursor-pointer flex-1">
          <input
            type="checkbox"
            checked={layer.stroke != null}
            onChange={(e) =>
              onUpdate(layer.id, (l) =>
                l.type === "shape"
                  ? {
                      ...l,
                      stroke: e.target.checked
                        ? { color: l.stroke?.color ?? "#0F172A", width: l.stroke?.width ?? 2 }
                        : null,
                    }
                  : l
              )
            }
          />
          <span className="text-muted-foreground">
            {layer.stroke ? "Activado" : "Sin borde"}
          </span>
        </label>
      </div>
      {layer.stroke && (
        <>
          <ColorRow
            label="Color"
            value={layer.stroke.color}
            tokens={brandKit.colors}
            onChange={(v) =>
              onUpdate(layer.id, (l) =>
                l.type === "shape" && l.stroke
                  ? { ...l, stroke: { ...l.stroke, color: v } }
                  : l
              )
            }
          />
          <NumberRow
            label="Grosor"
            value={layer.stroke.width}
            min={0}
            max={50}
            onChange={(v) =>
              onUpdate(layer.id, (l) =>
                l.type === "shape" && l.stroke
                  ? { ...l, stroke: { ...l.stroke, width: Math.max(0, v) } }
                  : l
              )
            }
          />
        </>
      )}
    </Section>
  );
}

// IconProps: panel para IconLayer. Tres secciones:
//   1. Selector visual del catálogo curado (grid + tabs de categorías).
//   2. Color del trazo/fill (sin gradiente — los íconos lucide pintan en
//      SVG y los gradientes requieren <defs>; el ROI es bajo).
//   3. Grosor del trazo (1-3 con paso 0.5).
function IconProps({
  layer,
  onUpdate,
  brandKit,
}: {
  layer: IconLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
}) {
  const [activeCategory, setActiveCategory] = useState<IconCategory>(() => {
    const found = ICON_CATALOG.find((i) => i.name === layer.iconName);
    return found?.category ?? "general";
  });
  const filtered = ICON_CATALOG.filter((i) => i.category === activeCategory);
  return (
    <Section title="Ícono">
      {/* Tabs de categoría — colapsado en 2 filas para no comer altura. */}
      <div className="flex flex-wrap gap-1 text-[10px]">
        {ICON_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setActiveCategory(c.value)}
            className={cn(
              "px-1.5 py-0.5 rounded border transition-colors",
              activeCategory === c.value
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {/* Grid de íconos. 6 columnas para que entren al menos 12 sin scroll
          en el panel típico de propiedades. Click → setea iconName. */}
      <div className="grid grid-cols-6 gap-1 pt-1">
        {filtered.map((entry) => {
          const Icon = (LucideIcons as Record<string, unknown>)[entry.name] as
            | React.ComponentType<{ size?: number; className?: string }>
            | undefined;
          if (!Icon) return null;
          const isCurrent = entry.name === layer.iconName;
          return (
            <button
              key={entry.name}
              type="button"
              onClick={() =>
                onUpdate(layer.id, (l) =>
                  l.type === "icon" ? { ...l, iconName: entry.name } : l,
                )
              }
              className={cn(
                "aspect-square flex items-center justify-center rounded border transition-colors",
                isCurrent
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={entry.label}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </div>
      <ColorRow
        label="Color"
        value={layer.color}
        tokens={brandKit.colors}
        onChange={(v) =>
          onUpdate(layer.id, (l) => (l.type === "icon" ? { ...l, color: v } : l))
        }
      />
      <NumberRow
        label="Grosor"
        value={layer.strokeWidth ?? 2}
        min={0.5}
        max={4}
        step={0.5}
        onChange={(v) =>
          onUpdate(layer.id, (l) =>
            l.type === "icon" ? { ...l, strokeWidth: Math.max(0.5, Math.min(4, v)) } : l,
          )
        }
      />
    </Section>
  );
}

function FrameProps({
  layer,
  onUpdate,
  brandKit,
}: {
  layer: FrameLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
}) {
  const bgColor =
    layer.background && layer.background.type === "color"
      ? layer.background.value
      : "#ffffff";
  return (
    <>
      <Section title="Frame">
        <FillRow
          label="Fondo"
          value={bgColor}
          tokens={brandKit.colors}
          onChange={(v) =>
            onUpdate(layer.id, (l) =>
              l.type === "frame"
                ? { ...l, background: { type: "color", value: v } }
                : l
            )
          }
        />
        <NumberRow
          label="Radio"
          value={layer.cornerRadius ?? 0}
          min={0}
          onChange={(v) =>
            onUpdate(layer.id, (l) =>
              l.type === "frame" ? { ...l, cornerRadius: v } : l
            )
          }
        />
      </Section>

      <LayoutControls
        frame={layer}
        onUpdateFrame={(m) =>
          onUpdate(layer.id, (l) => (l.type === "frame" ? m(l) : l))
        }
        brandKit={brandKit}
      />
    </>
  );
}

// ----- Constraints controls -----

function ConstraintsControls({
  layer,
  onUpdate,
}: {
  layer: TemplateLayer;
  onUpdate: (next: Constraints) => void;
}) {
  const current = layer.constraints ?? DEFAULT_CONSTRAINTS;
  const setH = (h: ConstraintH) => onUpdate({ ...current, h });
  const setV = (v: ConstraintV) => onUpdate({ ...current, v });

  const H_OPTIONS: Array<[ConstraintH, string, string]> = [
    ["left", "Izq", "Pegado a la izquierda"],
    ["center", "Centro", "Centrado horizontal"],
    ["right", "Der", "Pegado a la derecha"],
    ["stretch", "↔", "Estirar a izquierda y derecha"],
    ["scale", "%", "Escala proporcional al ancho"],
  ];
  const V_OPTIONS: Array<[ConstraintV, string, string]> = [
    ["top", "Sup", "Pegado arriba"],
    ["center", "Centro", "Centrado vertical"],
    ["bottom", "Inf", "Pegado abajo"],
    ["stretch", "↕", "Estirar arriba y abajo"],
    ["scale", "%", "Escala proporcional al alto"],
  ];

  return (
    <Section title="Constraints">
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Horizontal</label>
        <div className="grid grid-cols-5 gap-1">
          {H_OPTIONS.map(([val, label, title]) => (
            <button
              key={val}
              type="button"
              onClick={() => setH(val)}
              title={title}
              className={`text-[10px] py-1 rounded border ${
                current.h === val
                  ? "border-primary bg-primary/10"
                  : "border-border/50 hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Vertical</label>
        <div className="grid grid-cols-5 gap-1">
          {V_OPTIONS.map(([val, label, title]) => (
            <button
              key={val}
              type="button"
              onClick={() => setV(val)}
              title={title}
              className={`text-[10px] py-1 rounded border ${
                current.v === val
                  ? "border-primary bg-primary/10"
                  : "border-border/50 hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground pt-1">
        Cómo se ancla esta capa cuando el canvas cambia de tamaño (vista previa
        o adaptaciones).
      </p>
    </Section>
  );
}

// ----- Layout controls (free vs stack) -----

function LayoutControls({
  frame,
  onUpdateFrame,
  brandKit,
}: {
  frame: FrameLayer;
  onUpdateFrame: (m: (f: FrameLayer) => FrameLayer) => void;
  brandKit: BrandKitContent;
}) {
  const isStack = frame.layout.mode === "stack";
  return (
    <Section title="Layout">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onUpdateFrame((f) => ({ ...f, layout: { mode: "free" } }))}
          className={`flex-1 text-xs py-1 rounded border ${
            !isStack
              ? "border-primary bg-primary/10"
              : "border-border/50 hover:bg-muted"
          }`}
        >
          Libre
        </button>
        <button
          type="button"
          onClick={() =>
            onUpdateFrame((f) => ({
              ...f,
              layout: f.layout.mode === "stack" ? f.layout : DEFAULT_STACK_LAYOUT,
            }))
          }
          className={`flex-1 text-xs py-1 rounded border ${
            isStack
              ? "border-primary bg-primary/10"
              : "border-border/50 hover:bg-muted"
          }`}
        >
          Stack
        </button>
      </div>

      {isStack && (
        <StackControls
          layout={frame.layout as StackLayout}
          onChange={(s) => onUpdateFrame((f) => ({ ...f, layout: s }))}
          brandKit={brandKit}
        />
      )}
    </Section>
  );
}

function StackControls({
  layout,
  onChange,
  brandKit,
}: {
  layout: StackLayout;
  onChange: (next: StackLayout) => void;
  brandKit: BrandKitContent;
}) {
  const update = (patch: Partial<StackLayout>) => onChange({ ...layout, ...patch });
  return (
    <div className="space-y-2 pt-1">
      {/* Direction */}
      <div className="flex items-center gap-1">
        {(["vertical", "horizontal"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => update({ direction: d })}
            className={`flex-1 text-[11px] py-1 rounded border ${
              layout.direction === d
                ? "border-primary bg-primary/10"
                : "border-border/50 hover:bg-muted"
            }`}
          >
            {d === "vertical" ? "↓ Vertical" : "→ Horizontal"}
          </button>
        ))}
      </div>

      {/* Padding (4 sides) */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">
          Padding (t · r · b · l)
        </label>
        <div className="grid grid-cols-4 gap-1">
          {(["T", "R", "B", "L"] as const).map((side, i) => {
            const cell = layout.padding[i];
            const cellRef = parseRef(cell);
            const isRef = cellRef && cellRef.kind === "spacing";
            const refToken = isRef
              ? brandKit.spacing.find((t) => t.name === cellRef.name)
              : null;
            return (
              <input
                key={side}
                type="number"
                min={0}
                value={isRef ? "" : (cell as number)}
                placeholder={isRef ? refToken?.label ?? "T" : undefined}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0);
                  const next = [...layout.padding] as [
                    number | string,
                    number | string,
                    number | string,
                    number | string,
                  ];
                  next[i] = v;
                  update({ padding: next });
                }}
                className={cn(
                  "bg-muted border rounded px-1.5 py-1 text-xs text-center",
                  isRef
                    ? "border-blue-500/40 bg-blue-500/10 placeholder:text-blue-300"
                    : "border-border/50"
                )}
                title={isRef ? `${cellRef.name} (token)` : side}
              />
            );
          })}
        </div>
        {brandKit.spacing.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 mt-1">
            <span className="text-[10px] text-muted-foreground mr-1">Token a todos:</span>
            {brandKit.spacing.map((t) => {
              const ref = makeRef("spacing", t.name);
              const allActive = layout.padding.every((p) => p === ref);
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => update({ padding: [ref, ref, ref, ref] })}
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border",
                    allActive
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title={`${t.name} = ${t.value}px`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Gap */}
      <TokenNumberRow
        label="Gap"
        value={layout.gap}
        tokens={brandKit.spacing}
        refKind="spacing"
        min={0}
        onChangeLiteral={(v) => update({ gap: Math.max(0, v) })}
        onPickToken={(r) => update({ gap: r })}
      />

      {/* Align (cross-axis) */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Alinear</label>
        <div className="grid grid-cols-4 gap-1">
          {(["start", "center", "end", "stretch"] as StackAlign[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => update({ align: a })}
              className={`text-[10px] py-1 rounded border ${
                layout.align === a
                  ? "border-primary bg-primary/10"
                  : "border-border/50 hover:bg-muted"
              }`}
              title={a}
            >
              {a === "start"
                ? "Inicio"
                : a === "center"
                ? "Centro"
                : a === "end"
                ? "Fin"
                : "Stretch"}
            </button>
          ))}
        </div>
      </div>

      {/* Justify (main-axis) */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Distribuir</label>
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ["start", "Inicio"],
              ["center", "Centro"],
              ["end", "Fin"],
              ["space-between", "Entre"],
              ["space-around", "Alrededor"],
              ["space-evenly", "Uniforme"],
            ] as Array<[StackJustify, string]>
          ).map(([j, label]) => (
            <button
              key={j}
              type="button"
              onClick={() => update({ justify: j })}
              className={`text-[10px] py-1 rounded border ${
                layout.justify === j
                  ? "border-primary bg-primary/10"
                  : "border-border/50 hover:bg-muted"
              }`}
              title={j}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Botón eyedropper: usa la EyeDropper API del browser (Chrome 95+, Edge 95+).
// Si no está disponible, no se renderea — degradación gracil. Permite chupar
// un color de cualquier pixel de la pantalla (no solo del canvas del editor).
function EyeDropperButton({ onPick }: { onPick: (color: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        "EyeDropper" in window &&
        typeof (window as unknown as { EyeDropper: unknown }).EyeDropper ===
          "function",
    );
  }, []);
  if (!supported) return null;

  const handleClick = async () => {
    setPicking(true);
    try {
      // EyeDropper no está tipada en lib.dom hasta TS 5.5; casteamos manual.
      interface EyeDropperLike {
        open(): Promise<{ sRGBHex: string }>;
      }
      const Ctor = (window as unknown as { EyeDropper: new () => EyeDropperLike })
        .EyeDropper;
      const ed = new Ctor();
      const result = await ed.open();
      onPick(result.sRGBHex);
    } catch {
      // El usuario canceló con Escape — silenciamos, no es error.
    } finally {
      setPicking(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={picking}
      className="w-7 h-7 shrink-0 rounded border border-border/50 bg-muted hover:bg-accent transition-colors flex items-center justify-center disabled:opacity-50"
      title="Eyedropper — chupá un color de la pantalla"
    >
      {picking ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Pipette className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
