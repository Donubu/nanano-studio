"use client";

// Modal-style picker para elegir el punto de partida de un nuevo template.
// Tres orígenes posibles, todos en una sola UI con tabs:
//
//   1. "Blank"            — canvas vacío.
//   2. "Plantillas"       — uno de los layouts pre-armados del catálogo.
//   3. "Clonar existente" — copia exacta de otro template del mismo proyecto
//                          (master + variantes), útil para variar contenido
//                          sin re-componer el layout desde cero.
//
// Cada selección actualiza `pickedSource` (discriminated union). Al pulsar
// Crear, el caller recibe el source y arma el POST correspondiente:
// blank/layout → definition pre-armada; clone → fetch + replicar.

import { CSSProperties, useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Plus, Rocket, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LayoutTemplate,
  LAYOUT_TEMPLATES,
  AspectKey,
} from "@/lib/production/layout-templates";
import { TemplateDefinition, TemplateLayer } from "@/lib/production/types";

export type PickerSource =
  | { kind: "blank" }
  | { kind: "layout"; id: string }
  | { kind: "clone"; templateId: number };

// Shape mínimo de un template existente del proyecto, según lo que devuelve
// /api/production/templates. Solo usamos los campos visibles en la card.
interface ExistingTemplate {
  id: number;
  name: string;
  base_width: number;
  base_height: number;
  variant_count: number;
  adaptation_count: number;
  updated_at: string;
}

interface Props {
  open: boolean;
  productionProjectId: number;
  onClose: () => void;
  onCreate: (params: { name: string; source: PickerSource }) => Promise<void>;
}

type TabKey = "templates" | "clone";

export function LayoutTemplatePicker({
  open,
  productionProjectId,
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [tab, setTab] = useState<TabKey>("templates");
  const [pickedSource, setPickedSource] = useState<PickerSource>({ kind: "blank" });
  const [creating, setCreating] = useState(false);

  // Templates existentes del proyecto para el tab "Clonar". Se cargan al
  // entrar al tab por primera vez para no pagar el fetch si el productor
  // solo usa el catálogo.
  const [existing, setExisting] = useState<ExistingTemplate[] | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const fetchExisting = useCallback(async () => {
    setLoadingExisting(true);
    try {
      const res = await fetch(
        `/api/production/templates?production_project_id=${productionProjectId}`,
      );
      if (res.ok) {
        setExisting(await res.json());
      } else {
        setExisting([]);
      }
    } catch {
      setExisting([]);
    } finally {
      setLoadingExisting(false);
    }
  }, [productionProjectId]);

  useEffect(() => {
    if (open && tab === "clone" && existing == null && !loadingExisting) {
      fetchExisting();
    }
  }, [open, tab, existing, loadingExisting, fetchExisting]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate({ name: name.trim(), source: pickedSource });
      setName("");
      setPickedSource({ kind: "blank" });
      setTab("templates");
    } finally {
      setCreating(false);
    }
  };

  // Descripción del source actual para que el productor sepa qué va a crear
  // antes de pulsar el botón final.
  const sourceLabel = (() => {
    if (pickedSource.kind === "blank") return "Canvas vacío";
    if (pickedSource.kind === "layout") {
      const t = LAYOUT_TEMPLATES.find((x) => x.id === pickedSource.id);
      return t ? `Plantilla: ${t.name}` : "Plantilla";
    }
    const t = existing?.find((x) => x.id === pickedSource.templateId);
    return t ? `Clonando: ${t.name}` : "Clon de template existente";
  })();

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
              Empieza desde una plantilla, clona uno existente o canvas vacío.
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

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-border/50">
          <TabButton
            active={tab === "templates"}
            onClick={() => setTab("templates")}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            Plantillas
          </TabButton>
          <TabButton
            active={tab === "clone"}
            onClick={() => setTab("clone")}
            icon={<Copy className="h-3.5 w-3.5" />}
          >
            Clonar existente
          </TabButton>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "templates" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Card "Blank" — siempre primera, default. */}
              <TemplateCard
                picked={pickedSource.kind === "blank"}
                onPick={() => setPickedSource({ kind: "blank" })}
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
                  picked={
                    pickedSource.kind === "layout" && pickedSource.id === lt.id
                  }
                  onPick={() => setPickedSource({ kind: "layout", id: lt.id })}
                  title={lt.name}
                  description={lt.description}
                >
                  <TemplateMultiPreview template={lt} />
                </TemplateCard>
              ))}
            </div>
          )}

          {tab === "clone" && (
            <>
              {loadingExisting ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !existing || existing.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Aún no hay templates en este proyecto para clonar.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {existing.map((t) => (
                    <TemplateCard
                      key={t.id}
                      picked={
                        pickedSource.kind === "clone" &&
                        pickedSource.templateId === t.id
                      }
                      onPick={() =>
                        setPickedSource({ kind: "clone", templateId: t.id })
                      }
                      title={t.name}
                      description={`${t.base_width}×${t.base_height}${
                        t.variant_count > 0
                          ? ` · +${t.variant_count} orientación${
                              t.variant_count === 1 ? "" : "es"
                            }`
                          : ""
                      }${
                        t.adaptation_count > 0
                          ? ` · ${t.adaptation_count} adaptaciones`
                          : ""
                      }`}
                    >
                      <div
                        className="flex items-center justify-center w-full h-full bg-muted/30 rounded"
                        style={{
                          aspectRatio: `${t.base_width} / ${t.base_height}`,
                        }}
                      >
                        <Rocket className="h-8 w-8 text-muted-foreground/40" />
                      </div>
                    </TemplateCard>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border/50 bg-muted/20">
          <span className="text-xs text-muted-foreground truncate">
            {sourceLabel}
          </span>
          <div className="flex items-center gap-2">
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
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
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
