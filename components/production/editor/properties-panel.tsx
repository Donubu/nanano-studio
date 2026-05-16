"use client";

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

interface Props {
  definition: TemplateDefinition;
  selectedLayer: TemplateLayer | null;
  onUpdateLayer: (id: string, mutator: (layer: TemplateLayer) => TemplateLayer) => void;
  onUpdateRoot: (mutator: (root: TemplateDefinition) => TemplateDefinition) => void;
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

function ColorRow({
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
    </label>
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
          <RootProps definition={definition} onUpdateRoot={onUpdateRoot} />
        )}

        {selectedLayer && !isRoot && (
          <LayerProps layer={selectedLayer} onUpdate={onUpdateLayer} />
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
}: {
  definition: TemplateDefinition;
  onUpdateRoot: (m: (root: TemplateDefinition) => TemplateDefinition) => void;
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

      <LayoutControls frame={definition} onUpdateFrame={onUpdateRoot} />
    </>
  );
}

function LayerProps({
  layer,
  onUpdate,
}: {
  layer: TemplateLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
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
        <TextProps layer={layer} onUpdate={onUpdate} />
      )}
      {layer.type === "image" && (
        <ImageProps layer={layer} onUpdate={onUpdate} />
      )}
      {layer.type === "shape" && (
        <ShapeProps layer={layer} onUpdate={onUpdate} />
      )}
      {layer.type === "frame" && (
        <FrameProps layer={layer} onUpdate={onUpdate} />
      )}
    </>
  );
}

function TextProps({
  layer,
  onUpdate,
}: {
  layer: TextLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
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
        <NumberRow
          label="Tamaño"
          value={layer.style.fontSize}
          min={1}
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
}: {
  layer: ImageLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
}) {
  return (
    <Section title="Imagen">
      <TextRow
        label="URL"
        value={layer.src ?? ""}
        onChange={(v) =>
          onUpdate(layer.id, (l) =>
            l.type === "image" ? { ...l, src: v.trim() || null } : l
          )
        }
      />
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
}: {
  layer: ShapeLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
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
}: {
  layer: FrameLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
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
}: {
  frame: FrameLayer;
  onUpdateFrame: (m: (f: FrameLayer) => FrameLayer) => void;
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
        />
      )}
    </Section>
  );
}

function StackControls({
  layout,
  onChange,
}: {
  layout: StackLayout;
  onChange: (next: StackLayout) => void;
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
          {(["T", "R", "B", "L"] as const).map((side, i) => (
            <input
              key={side}
              type="number"
              min={0}
              value={layout.padding[i]}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                const next: [number, number, number, number] = [...layout.padding];
                next[i] = v;
                update({ padding: next });
              }}
              className="bg-muted border border-border/50 rounded px-1.5 py-1 text-xs text-center"
              title={side}
            />
          ))}
        </div>
      </div>

      {/* Gap */}
      <NumberRow
        label="Gap"
        value={layout.gap}
        min={0}
        onChange={(v) => update({ gap: Math.max(0, v) })}
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
