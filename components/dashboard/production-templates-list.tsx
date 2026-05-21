"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Layers, Trash2, Rocket } from "lucide-react";
import { formatDateLocal } from "@/lib/utils";
import {
  LayoutTemplatePicker,
  type PickerSource,
} from "@/components/dashboard/layout-template-picker";
import {
  findLayoutTemplate,
  freshDefinitionIds,
  CANONICAL_SIZES,
} from "@/lib/production/layout-templates";
import { TemplateDefinition } from "@/lib/production/types";
import { BrandKitContent, EMPTY_KIT_CONTENT, brandKitFromApi } from "@/lib/production/brand-kit";
import { AdaptationRenderer } from "@/components/production/render/adaptation-renderer";

// Master arranca siempre en 16:9 (1920×1080) cuando es Blank. Si el productor
// elige un layout template, la dimensión sale del template (horizontal por
// default; las otras orientaciones se crean como variantes linked).
const DEFAULT_MASTER_WIDTH = 1920;
const DEFAULT_MASTER_HEIGHT = 1080;

interface Template {
  id: number;
  production_project_id: number;
  design_id: number | null;
  design_name: string | null;
  name: string;
  description: string | null;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  // brand_kit_id resuelve a un BrandKitContent del map cargado para el
  // proyecto. null = preview con kit vacío (colores caen al default).
  brand_kit_id: number | null;
  // Definición parseada del master. null si el JSON estaba corrupto en DB —
  // en ese caso el card cae al ícono.
  definition: TemplateDefinition | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_at: string;
  updated_at: string;
  adaptation_count: number;
  // Otros templates del mismo design (variantes) que se ven en el editor.
  variant_count: number;
}

interface Props {
  productionProjectId: number;
  // clientId del proyecto. Necesario para cargar los brand kits accesibles
  // (cliente-wide + project-scoped) y resolver el preview de cada card.
  clientId: number;
}

// Etiqueta legible para la orientación de un template, así el usuario sabe
// rápido qué variante es cuál dentro de un design.
function orientationLabel(w: number, h: number): string {
  const ratio = w / h;
  if (Math.abs(ratio - 1) < 0.05) return "Cuadrado";
  if (ratio > 1.5) return "Horizontal";
  if (ratio < 0.7) return "Vertical";
  return "Mixto";
}

export default function ProductionTemplatesList({ productionProjectId, clientId }: Props) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Map brand_kit_id → BrandKitContent. Cargado en paralelo con templates;
  // mientras carga, los previews caen a EMPTY_KIT_CONTENT.
  const [brandKitMap, setBrandKitMap] = useState<Map<number, BrandKitContent>>(new Map());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tplRes, kitRes] = await Promise.all([
        fetch(`/api/production/templates?production_project_id=${productionProjectId}`),
        fetch(`/api/production/brand-kits?client_id=${clientId}&production_project_id=${productionProjectId}`),
      ]);
      if (tplRes.ok) setTemplates(await tplRes.json());
      if (kitRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawKits: any[] = await kitRes.json();
        const map = new Map<number, BrandKitContent>();
        for (const raw of rawKits) {
          try {
            // brandKitFromApi parsea los *_json a tokens normalizados; el row
            // crudo es laxo (mismo patrón usado en la página producir).
            const kit = brandKitFromApi(raw);
            map.set(kit.id, kit.content);
          } catch (e) {
            // Un kit corrupto no debe tumbar el listado entero.
            console.warn("Brand kit malformed, skipping:", e);
          }
        }
        setBrandKitMap(map);
      }
    } catch (err) {
      console.error("Error obteniendo templates:", err);
    } finally {
      setLoading(false);
    }
  }, [productionProjectId, clientId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Crea el template via POST. Tres rutas según el source elegido por el
  // productor en el picker:
  //   - blank  → POST sin definition: la API arma uno vacío 16:9.
  //   - layout → instancia un layout del catálogo: master horizontal +
  //              variants square/vertical, todos con ids frescos.
  //   - clone  → fetch del template fuente + sus orientaciones, replica
  //              cada definition con ids frescos para que sea independiente.
  const handleCreate = async ({
    name,
    source,
  }: {
    name: string;
    source: PickerSource;
  }) => {
    try {
      let body: Record<string, unknown>;
      if (source.kind === "layout") {
        const lt = findLayoutTemplate(source.id);
        if (!lt) {
          console.error("Layout template no encontrado:", source.id);
          return;
        }
        const masterAspect = CANONICAL_SIZES.horizontal;
        body = {
          production_project_id: productionProjectId,
          name,
          base_width: masterAspect.w,
          base_height: masterAspect.h,
          definition: freshDefinitionIds(lt.aspects.horizontal),
          variants: (["square", "vertical"] as const).map((a) => ({
            width: CANONICAL_SIZES[a].w,
            height: CANONICAL_SIZES[a].h,
            definition: freshDefinitionIds(lt.aspects[a]),
          })),
        };
      } else if (source.kind === "clone") {
        // Fetcheamos las orientaciones del template fuente (master + variants)
        // con sus definitions parseadas. El endpoint /orientations devuelve
        // todos los miembros del design ordenados por id ASC, así que el
        // primero es el master/principal.
        const oriRes = await fetch(
          `/api/production/templates/${source.templateId}/orientations`,
        );
        if (!oriRes.ok) {
          const errBody = await oriRes.json().catch(() => ({}));
          console.error("Clone: no se pudo leer orientaciones:", errBody);
          alert("No se pudo leer el template a clonar");
          return;
        }
        interface OrientationRow {
          id: number;
          base_width: number;
          base_height: number;
          brand_kit_id: number | null;
          definition: TemplateDefinition | null;
        }
        const orientations: OrientationRow[] = await oriRes.json();
        if (orientations.length === 0) {
          alert("El template a clonar no tiene orientaciones válidas");
          return;
        }
        // Sort por id ASC para garantizar que el principal (MIN id) sea el
        // master del clon.
        orientations.sort((a, b) => a.id - b.id);
        const master = orientations[0];
        const variants = orientations.slice(1);
        if (!master.definition) {
          alert("El template a clonar no tiene definición");
          return;
        }
        // brand_kit_id se replica desde el master del source: si el productor
        // venía usando un fork project-scoped customizado, el clon arranca
        // con el mismo kit (no se re-forkea — sigue siendo el mismo fork
        // compartido con el original dentro del proyecto). Si después el
        // productor quiere divergir, lo hace con "Personalizar" desde el
        // editor del clon, que sí dispara un fork independiente.
        body = {
          production_project_id: productionProjectId,
          name,
          base_width: master.base_width,
          base_height: master.base_height,
          brand_kit_id: master.brand_kit_id ?? null,
          definition: freshDefinitionIds(master.definition),
          variants: variants
            .filter((v) => v.definition != null)
            .map((v) => ({
              width: v.base_width,
              height: v.base_height,
              definition: freshDefinitionIds(v.definition as TemplateDefinition),
            })),
        };
      } else if (source.kind === "ai-reference") {
        // La proposal del agente ya viene validada por el endpoint
        // /generate-from-reference. Solo armamos el POST templates con la
        // definition + variants frescas (ids regenerados por si el agente
        // usó ids semánticos repetidos entre master y variants).
        const masterDef = freshDefinitionIds(source.definition);
        body = {
          production_project_id: productionProjectId,
          name,
          base_width: source.definition.size.w,
          base_height: source.definition.size.h,
          definition: masterDef,
          variants: source.variants.map((v) => ({
            width: v.dims.w,
            height: v.dims.h,
            definition: freshDefinitionIds(v.definition),
          })),
        };
      } else {
        // blank
        body = {
          production_project_id: productionProjectId,
          name,
          base_width: DEFAULT_MASTER_WIDTH,
          base_height: DEFAULT_MASTER_HEIGHT,
        };
      }
      const res = await fetch(`/api/production/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowPicker(false);
        fetchAll();
      } else {
        const errBody = await res.json().catch(() => ({}));
        console.error("POST template fallo:", res.status, errBody);
      }
    } catch (err) {
      console.error("Error creando template:", err);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este template?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/production/templates/${id}`, { method: "DELETE" });
      if (res.ok) fetchAll();
    } catch (err) {
      console.error("Error eliminando template:", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium">Templates</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cada template es un master con sus orientaciones (cuadrado,
            vertical, horizontal). Empieza desde un layout pre-armado o blank.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowPicker(true)} className="gap-1">
          <Plus className="h-4 w-4" /> Nuevo template
        </Button>
      </div>

      <LayoutTemplatePicker
        open={showPicker}
        productionProjectId={productionProjectId}
        onClose={() => setShowPicker(false)}
        onCreate={handleCreate}
      />

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          Aún no hay templates en este proyecto
        </p>
      ) : (
        // Listado plano: 1 card por master. El concepto "design" sigue
        // existiendo en el backend (agrupando las orientaciones) pero el
        // productor no lo ve — cada card es un master completo.
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              router={router}
              deleting={deletingId === t.id}
              onDelete={() => handleDelete(t.id)}
              brandKit={(t.brand_kit_id != null && brandKitMap.get(t.brand_kit_id)) || EMPTY_KIT_CONTENT}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template: t,
  router,
  deleting,
  onDelete,
  brandKit,
}: {
  template: Template;
  router: ReturnType<typeof useRouter>;
  deleting: boolean;
  onDelete: () => void;
  brandKit: BrandKitContent;
}) {
  return (
    <div className="relative bg-muted/50 rounded-lg p-3 transition-colors group flex flex-col gap-2">
      <div
        className="w-full bg-background rounded-md border border-border/30 flex items-center justify-center overflow-hidden"
        style={{
          aspectRatio: `${t.base_width} / ${t.base_height}`,
          maxHeight: 200,
        }}
      >
        {/* Orden de fallback:
            1. thumbnail_url persistido (camino rápido — JPG cacheado por CDN,
               generado por el editor al guardar la principal del design).
            2. Render inline del definition para templates legacy que aún no
               tienen thumbnail. El primer save del editor los migra.
            3. Ícono Layers como último recurso. */}
        {t.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.thumbnail_url} alt={t.name} className="w-full h-full object-contain" />
        ) : t.definition ? (
          <MasterPreview definition={t.definition} brandKit={brandKit} />
        ) : (
          <Layers className="h-8 w-8 text-muted-foreground/50" />
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{t.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {orientationLabel(t.base_width, t.base_height)} · {t.base_width}×{t.base_height}
            {t.variant_count > 0 && (
              <>
                {" · "}
                <span className="text-emerald-300">
                  +{t.variant_count}{" "}
                  {t.variant_count === 1 ? "orientación" : "orientaciones"}
                </span>
              </>
            )}
            {" · "}
            {t.adaptation_count} {t.adaptation_count === 1 ? "adaptación" : "adaptaciones"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Actualizado {formatDateLocal(t.updated_at)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={deleting}
          title="Eliminar template"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          )}
        </Button>
      </div>
      <Button
        size="sm"
        className="gap-1.5 w-full"
        onClick={() => router.push(`/produccion/template/${t.id}/producir`)}
        title="Abrir el master para componer y producir adaptaciones"
      >
        <Rocket className="h-3.5 w-3.5" />
        Producir
      </Button>
    </div>
  );
}

// Renderiza el master inline dentro del card. Estrategia:
//   - Reutilizamos AdaptationRenderer con fit_mode="contain", lo cual mete
//     el master en una caja arbitraria preservando aspect ratio.
//   - Como el contenedor padre tiene aspect-ratio = master, la caja real
//     coincide con la del master; usamos un ResizeObserver para conocer las
//     dimensiones renderizadas y pasárselas al renderer (no podemos
//     pre-computar pixel size porque depende del ancho de columna del grid).
//   - Pointer-events disabled: los layers no deben interceptar clicks del
//     botón "Producir" o del delete.
function MasterPreview({ definition, brandKit }: { definition: TemplateDefinition; brandKit: BrandKitContent }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Evita re-render infinito por sub-pixel jitter.
      setBox((cur) => {
        if (cur && Math.abs(cur.w - width) < 0.5 && Math.abs(cur.h - height) < 0.5) return cur;
        return { w: width, h: height };
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Memoizamos el "adaptation" para evitar nuevas instancias en cada render
  // que disparen trabajo innecesario en el renderer.
  const adaptation = useMemo(
    () =>
      box
        ? {
            width: Math.max(1, Math.round(box.w)),
            height: Math.max(1, Math.round(box.h)),
            fit_mode: "contain" as const,
            overrides_json: null,
          }
        : null,
    [box]
  );

  return (
    <div
      ref={containerRef}
      className="w-full h-full pointer-events-none"
      style={{ position: "relative" }}
    >
      {adaptation && (
        <AdaptationRenderer
          adaptation={adaptation}
          master={definition}
          brandKit={brandKit}
        />
      )}
    </div>
  );
}
