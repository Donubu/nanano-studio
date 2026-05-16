"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  ImageLayer,
  ShapeLayer,
  FrameLayer,
  StackLayout,
  StackAlign,
  StackJustify,
  DEFAULT_STACK_LAYOUT,
  Constraints,
  ConstraintH,
  ConstraintV,
  DEFAULT_CONSTRAINTS,
} from "@/lib/production/types";
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
  onUpdateLayer: (id: string, mutator: (layer: TemplateLayer) => TemplateLayer) => void;
  onUpdateRoot: (mutator: (root: TemplateDefinition) => TemplateDefinition) => void;
  brandKit?: BrandKitContent;
  clientId?: number | null;
  projectId?: number;
  allBrandKits?: BrandKit[];
  onBrandKitsChange?: () => void;
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
              className="w-8 h-7 rounded border border-border/50 bg-muted cursor-pointer"
            />
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-xs font-mono"
            />
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
  onUpdateLayer,
  onUpdateRoot,
  brandKit = EMPTY_KIT_CONTENT,
  clientId = null,
}: Props) {
  const noSelection = !selectedLayer;
  const isRoot = selectedLayer?.id === "tpl_root";

  return (
    <aside className="w-64 shrink-0 border-l border-border/50 bg-card/40 overflow-y-auto">
      <div className="p-3 border-b border-border/50">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {noSelection ? "Propiedades" : isRoot ? "Canvas" : labelForType(selectedLayer!.type)}
        </h3>
      </div>
      <div className="p-3 space-y-4">
        {noSelection && (
          <p className="text-xs text-muted-foreground">
            Selecciona una capa para editar sus propiedades.
          </p>
        )}

        {isRoot && (
          <RootProps definition={definition} onUpdateRoot={onUpdateRoot} brandKit={brandKit} />
        )}

        {selectedLayer && !isRoot && (
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
        <ColorRow
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
      {layer.type === "frame" && (
        <FrameProps layer={layer} onUpdate={onUpdate} brandKit={brandKit} />
      )}
    </>
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
        <TokenNumberRow
          label="Tamaño"
          value={layer.style.fontSize}
          tokens={brandKit.scales}
          refKind="scale"
          min={1}
          onChangeLiteral={(v) => updateStyle({ fontSize: v })}
          onPickToken={(r) => updateStyle({ fontSize: r })}
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
        <div className="flex items-center gap-1">
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => updateStyle({ align: a })}
              className={`flex-1 text-xs py-1 rounded border ${
                (layer.style.align ?? "left") === a
                  ? "border-primary bg-primary/10"
                  : "border-border/50 hover:bg-muted"
              }`}
            >
              {a === "left" ? "←" : a === "center" ? "↔" : "→"}
            </button>
          ))}
        </div>
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
      {clientId !== null && (
        <>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-muted transition-colors"
          >
            <ImageIcon className="h-3 w-3" />
            Galería del cliente
          </button>
          {pickerOpen && (
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
        </>
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
      <ColorRow
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
        <ColorRow
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
