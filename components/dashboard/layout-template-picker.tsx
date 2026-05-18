"use client";

// Modal-style picker para elegir un layout template inicial al crear un
// nuevo production_template. Las opciones son:
//   - "Blank" (canvas vacío, comportamiento histórico).
//   - Cada LayoutTemplate del catálogo en lib/production/layout-templates.ts.
//
// Cada card muestra previews scaled de las 3 orientaciones (horizontal,
// square, vertical) para que el productor entienda cómo cambia el layout
// entre formatos antes de instanciar.

import { CSSProperties, useState } from "react";
import { Loader2, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LayoutTemplate,
  LAYOUT_TEMPLATES,
  AspectKey,
} from "@/lib/production/layout-templates";
import { TemplateDefinition, TemplateLayer } from "@/lib/production/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (params: { name: string; layoutTemplateId: string | null }) => Promise<void>;
}

export function LayoutTemplatePicker({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null); // null = blank
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate({ name: name.trim(), layoutTemplateId: pickedId });
      setName("");
      setPickedId(null);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold">Nuevo template</h2>
            <p className="text-xs text-muted-foreground">
              Empieza desde un layout pre-armado o desde un canvas vacío.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-3 border-b border-border/50">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre del template (ej: Súper Ofertas Marzo)"
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Card "Blank" — siempre primera, default */}
            <TemplateCard
              picked={pickedId === null}
              onPick={() => setPickedId(null)}
              title="Blank"
              description="Canvas 16:9 vacío. Construye desde cero."
            >
              <div className="flex items-center justify-center w-full h-full bg-muted/30 border border-dashed border-border/40 rounded">
                <Plus className="h-8 w-8 text-muted-foreground/40" />
              </div>
            </TemplateCard>

            {LAYOUT_TEMPLATES.map((lt) => (
              <TemplateCard
                key={lt.id}
                picked={pickedId === lt.id}
                onPick={() => setPickedId(lt.id)}
                title={lt.name}
                description={lt.description}
              >
                <TemplateMultiPreview template={lt} />
              </TemplateCard>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/50 bg-muted/20">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!name.trim() || creating}
            className="gap-1"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Crear
          </Button>
        </div>
      </div>
    </div>
  );
}

// Card con preview + título + descripción. Estado `picked` resalta el borde.
function TemplateCard({
  picked,
  onPick,
  title,
  description,
  children,
}: {
  picked: boolean;
  onPick: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "text-left flex flex-col gap-2 p-3 rounded-lg border-2 transition-colors",
        picked
          ? "border-primary bg-primary/5"
          : "border-border/50 hover:border-foreground/30 hover:bg-muted/30",
      )}
    >
      <div className="w-full aspect-[16/9] flex items-center justify-center overflow-hidden">
        {children}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {description}
        </p>
      </div>
    </button>
  );
}

// Muestra las 3 orientaciones del template (horizontal, square, vertical) en
// fila. Da feedback inmediato de cómo el layout se reorganiza entre formatos.
function TemplateMultiPreview({ template }: { template: LayoutTemplate }) {
  const aspects: AspectKey[] = ["horizontal", "square", "vertical"];
  return (
    <div className="flex items-center justify-center gap-1 w-full h-full bg-muted/20 rounded p-1">
      {aspects.map((a) => (
        <div key={a} className="flex items-center justify-center" style={{ height: "100%" }}>
          <ScaledDefinitionPreview definition={template.aspects[a]} targetH={70} />
        </div>
      ))}
    </div>
  );
}

// Render simplificado de una TemplateDefinition a un alto target. Cada layer
// se pinta como un rectángulo coloreado según su tipo:
//   - frame: bg.value
//   - shape: fill
//   - text: gray semitransparent box
//   - image: dotted box
// No usamos el renderer completo (text/font/etc.) porque a esta escala los
// detalles no se ven y el costo no vale la pena. La composición sí.
function ScaledDefinitionPreview({
  definition,
  targetH,
}: {
  definition: TemplateDefinition;
  targetH: number;
}) {
  const scale = targetH / definition.size.h;
  const w = definition.size.w * scale;
  const bg =
    definition.background && definition.background.type === "color"
      ? definition.background.value
      : "#f3f4f6";
  return (
    <div
      className="relative rounded overflow-hidden shadow-sm border border-border/20"
      style={{ width: w, height: targetH, background: bg }}
    >
      {definition.children.map((c) => (
        <LayerRect key={c.id} layer={c} scale={scale} />
      ))}
    </div>
  );
}

function LayerRect({ layer, scale }: { layer: TemplateLayer; scale: number }) {
  const style: CSSProperties = {
    position: "absolute",
    left: layer.position.x * scale,
    top: layer.position.y * scale,
    width: layer.size.w * scale,
    height: layer.size.h * scale,
  };
  if (layer.type === "shape") {
    return (
      <div
        style={{
          ...style,
          background: layer.fill,
          borderRadius: (layer.cornerRadius ?? 0) * scale,
        }}
      />
    );
  }
  if (layer.type === "text") {
    return (
      <div
        style={{
          ...style,
          background: "rgba(255,255,255,0.18)",
          borderRadius: 2,
        }}
      />
    );
  }
  if (layer.type === "image") {
    return (
      <div
        style={{
          ...style,
          background: "rgba(0,0,0,0.15)",
          border: "1px dashed rgba(255,255,255,0.35)",
          borderRadius: 2,
        }}
      />
    );
  }
  // frame
  return null;
}
