"use client";

// Modal-style picker para elegir el punto de partida de un nuevo template.
// Tres orígenes posibles, todos en una sola UI con tabs:
//
//   1. "Blank"            — canvas vacío.
//   2. "Plantillas"       — uno de los layouts pre-armados del catálogo.
//   3. "Clonar existente" — copia exacta de otro template del mismo proyecto
//                          (master + variantes), útil para variar contenido
//                          sin re-componer el layout desde cero.
//   4. "Subir referencia" — el Banner Designer replica el estilo de 1-3
//                          imágenes (GENERATE_FROM_REFERENCE).
//   5. "Crear desde texto" — el Banner Designer compone desde cero a partir
//                          de una descripción (GENERATE_FROM_PROMPT).
//
// Cada selección actualiza `pickedSource` (discriminated union). Al pulsar
// Crear, el caller recibe el source y arma el POST correspondiente:
// blank/layout → definition pre-armada; clone → fetch + replicar.

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LayoutTemplate,
  LAYOUT_TEMPLATES,
  AspectKey,
} from "@/lib/production/layout-templates";
import { TemplateDefinition, TemplateLayer } from "@/lib/production/types";
import { prepareImageForAgent, renameForPrepared } from "@/lib/production/prepare-image";

export type PickerSource =
  | { kind: "blank" }
  | { kind: "layout"; id: string }
  | { kind: "clone"; templateId: number }
  // Generación IA desde imágenes de referencia ya generada y validada.
  // La definition + variants vienen del endpoint /api/production/ai/
  // generate-from-reference y el caller solo arma el POST templates.
  | {
      kind: "ai-reference";
      definition: TemplateDefinition;
      variants: AiVariant[];
    }
  // Generación IA desde texto (sin imágenes). Misma forma que ai-reference;
  // viene de /api/production/ai/generate-from-prompt.
  | {
      kind: "ai-prompt";
      definition: TemplateDefinition;
      variants: AiVariant[];
    };

interface AiVariant {
  dims: { w: number; h: number };
  definition: TemplateDefinition;
}

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

type TabKey = "templates" | "clone" | "reference" | "prompt";

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
    if (pickedSource.kind === "clone") {
      const t = existing?.find((x) => x.id === pickedSource.templateId);
      return t ? `Clonando: ${t.name}` : "Clon de template existente";
    }
    if (pickedSource.kind === "ai-prompt") return "Propuesta IA desde texto";
    return "Propuesta IA desde referencia";
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
              Empieza desde una plantilla, clona uno existente, canvas vacío o
              genera con IA (referencia o texto).
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
          <TabButton
            active={tab === "reference"}
            onClick={() => setTab("reference")}
            icon={<ImageIcon className="h-3.5 w-3.5" />}
          >
            Subir referencia
          </TabButton>
          <TabButton
            active={tab === "prompt"}
            onClick={() => setTab("prompt")}
            icon={<MessageSquareText className="h-3.5 w-3.5" />}
          >
            Crear desde texto
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

          {tab === "reference" && (
            <ReferenceUploadTab
              productionProjectId={productionProjectId}
              pickedSource={pickedSource}
              onPicked={(source) => setPickedSource(source)}
            />
          )}

          {tab === "prompt" && (
            <PromptTab
              productionProjectId={productionProjectId}
              pickedSource={pickedSource}
              onPicked={(source) => setPickedSource(source)}
            />
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

// Tab "Subir referencia": permite arrastrar/cargar 1-3 imágenes, mandarlas
// al Banner Designer para que extraiga estilo y proponga un template, y
// mostrar el rationale del agente. Cuando la generación es exitosa, el
// pickedSource del picker pasa a ser { kind: "ai-reference", definition,
// variants } y el botón "Crear" del footer del picker arma el POST final
// con esa proposal.
function ReferenceUploadTab({
  productionProjectId,
  pickedSource,
  onPicked,
}: {
  productionProjectId: number;
  pickedSource: PickerSource;
  onPicked: (source: PickerSource) => void;
}) {
  const [files, setFiles] = useState<UploadedReference[]>([]);
  const [intent, setIntent] = useState("");
  const [instructions, setInstructions] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFilePick = async (selected: FileList | null) => {
    if (!selected || selected.length === 0) return;
    setError(null);
    const remaining = 3 - files.length;
    if (remaining <= 0) {
      setError("Máximo 3 referencias por generación");
      return;
    }
    const toUpload = Array.from(selected).slice(0, remaining);
    setUploading(true);
    try {
      const uploaded: UploadedReference[] = [];
      for (const file of toUpload) {
        if (!file.type.startsWith("image/")) {
          setError(`Archivo no soportado: ${file.name} (solo imágenes)`);
          continue;
        }
        // Preparación client-side: ≤1568 px de lado largo + WebP (fallback
        // JPEG). Los modelos de visión cobran por píxeles, así que mandar
        // el pantallazo Retina completo no mejora nada y pesa 10-20× más.
        let prepared;
        try {
          prepared = await prepareImageForAgent(file);
        } catch (e) {
          setError(`No se pudo procesar ${file.name}: ${(e as Error).message}`);
          continue;
        }
        const res = await fetch("/api/production/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageData: prepared.dataUri }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error || `Error subiendo ${file.name}`);
          continue;
        }
        const body = await res.json();
        uploaded.push({
          filename: renameForPrepared(file.name, prepared.extension),
          publicUrl: body.url as string,
          mimeType: prepared.mimeType,
          previewUrl: prepared.dataUri,
          bytes: prepared.blob.size,
          originalBytes: prepared.originalBytes,
          width: prepared.width,
          height: prepared.height,
        });
      }
      setFiles((cur) => [...cur, ...uploaded]);
    } catch (e) {
      setError(`Error subiendo: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      // Limpiamos el input para permitir re-subir la misma file si la
      // borraron y la volvieron a elegir.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (idx: number) => {
    setFiles((cur) => cur.filter((_, i) => i !== idx));
    // Cuando borras la última referencia, invalidamos la selección IA pendiente
    // para que el botón Crear no quede activo apuntando a algo desconectado.
    if (pickedSource.kind === "ai-reference") {
      onPicked({ kind: "blank" });
    }
  };

  const callAgent = async () => {
    if (files.length === 0) {
      setError("Sube al menos una imagen de referencia");
      return;
    }
    setGenerating(true);
    setError(null);
    setRationale(null);
    try {
      const res = await fetch(
        "/api/production/ai/generate-from-reference",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            production_project_id: productionProjectId,
            reference_files: files.map((f) => ({
              filename: f.filename,
              publicUrl: f.publicUrl,
              mimeType: f.mimeType,
            })),
            intent: intent.trim() || undefined,
            instructions: instructions.trim() || undefined,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Error ${res.status}`);
        return;
      }
      const proposal = body.proposal as {
        definition: TemplateDefinition;
        variants: Array<{
          dims: { w: number; h: number };
          definition: TemplateDefinition;
        }>;
      };
      setRationale(typeof body.rationale === "string" ? body.rationale : null);
      setCost(
        typeof body.tokenUsage?.estimatedCost === "number"
          ? body.tokenUsage.estimatedCost
          : null,
      );
      // Marcamos pickedSource como ai-reference con la proposal: ahora el
      // botón "Crear" del footer del picker la usa.
      onPicked({
        kind: "ai-reference",
        definition: proposal.definition,
        variants: proposal.variants,
      });
    } catch (e) {
      setError(`Error de red: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const hasProposal = pickedSource.kind === "ai-reference";

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          Imágenes de referencia (máx. 3)
        </label>
        <div
          className="border-2 border-dashed border-border/50 rounded-lg p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFilePick(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFilePick(e.target.files)}
          />
          {files.length === 0 ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex flex-col items-center justify-center gap-2 py-8 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {uploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
              ) : (
                <Upload className="h-6 w-6 text-muted-foreground/60" />
              )}
              <span>
                Click para seleccionar imágenes o arrastra acá (1-3
                referencias)
              </span>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="relative border border-border/50 rounded overflow-hidden bg-muted/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={f.previewUrl}
                      alt={f.filename}
                      className="w-full h-32 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 h-6 w-6 rounded-full bg-red-500 hover:bg-red-600 text-white shadow flex items-center justify-center"
                      title="Quitar referencia"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    <p className="text-[10px] truncate px-1 py-0.5 bg-background/80">
                      {f.filename}
                      <span className="text-muted-foreground">
                        {" "}· {f.width}×{f.height} · {formatKb(f.bytes)}
                        {f.originalBytes > f.bytes * 1.5 && ` (antes ${formatKb(f.originalBytes)})`}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              {files.length < 3 && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full text-xs text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 py-2 border border-dashed border-border/40 rounded hover:border-foreground/40 transition-colors disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Agregar más referencias ({3 - files.length} disponibles)
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Intención (opcional)
          </label>
          <input
            type="text"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Ej: campaña de invierno"
            disabled={generating}
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Instrucciones extra (opcional)
          </label>
          <input
            type="text"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Ej: usa nuestro azul, no el rojo"
            disabled={generating}
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          El agente extrae paleta, jerarquía y layout de las referencias y los
          aplica con el brand kit del cliente. No copia logos ni texto literal.
        </p>
        <Button
          size="sm"
          onClick={callAgent}
          disabled={files.length === 0 || uploading || generating}
          className="gap-1 shrink-0"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {hasProposal ? "Regenerar" : "Generar con IA"}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {hasProposal && rationale && (
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-violet-400 mb-1 flex items-center justify-between">
            <span>Decisión del agente</span>
            {cost != null && (
              <span className="text-muted-foreground normal-case tracking-normal">
                ~ USD {cost.toFixed(4)}
              </span>
            )}
          </p>
          <p className="text-xs text-foreground">{rationale}</p>
          <p className="text-[10px] text-muted-foreground mt-2">
            Propuesta lista. Pulsa Crear abajo para instanciar el template.
          </p>
        </div>
      )}
    </div>
  );
}

// Tab "Crear desde texto": el productor describe el banner y el Banner
// Designer lo compone desde cero (GENERATE_FROM_PROMPT). Sin imágenes. Misma
// mecánica que ReferenceUploadTab: la proposal validada queda en
// pickedSource ({ kind: "ai-prompt" }) y el botón Crear del footer la
// instancia.
const TONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Que decida el agente" },
  { value: "energetic", label: "Energético / promo" },
  { value: "premium", label: "Premium / elegante" },
  { value: "corporate", label: "Corporativo / sobrio" },
  { value: "playful", label: "Juguetón / cercano" },
  { value: "minimal", label: "Minimalista" },
  { value: "urgent", label: "Urgente / oferta flash" },
];

function PromptTab({
  productionProjectId,
  pickedSource,
  onPicked,
}: {
  productionProjectId: number;
  pickedSource: PickerSource;
  onPicked: (source: PickerSource) => void;
}) {
  const [intent, setIntent] = useState("");
  const [tone, setTone] = useState("");
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);

  const canGenerate = intent.trim().length >= 3 && !generating;

  const callAgent = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setRationale(null);
    try {
      const res = await fetch("/api/production/ai/generate-from-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          production_project_id: productionProjectId,
          intent: intent.trim(),
          tone: tone || undefined,
          instructions: instructions.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Error ${res.status}`);
        return;
      }
      const proposal = body.proposal as {
        definition: TemplateDefinition;
        variants: AiVariant[];
      };
      setRationale(typeof body.rationale === "string" ? body.rationale : null);
      setCost(
        typeof body.tokenUsage?.estimatedCost === "number"
          ? body.tokenUsage.estimatedCost
          : null,
      );
      onPicked({
        kind: "ai-prompt",
        definition: proposal.definition,
        variants: proposal.variants,
      });
    } catch (e) {
      setError(`Error de red: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const hasProposal = pickedSource.kind === "ai-prompt";

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          ¿Qué debe comunicar el banner?
        </label>
        <textarea
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          placeholder="Ej: venta flash de pizzas 2x1 solo por hoy, con precio destacado y botón de pedir ahora"
          disabled={generating}
          rows={3}
          className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm resize-y disabled:opacity-50"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") callAgent();
          }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Tono (opcional)
          </label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            disabled={generating}
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm disabled:opacity-50"
          >
            {TONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Instrucciones extra (opcional)
          </label>
          <input
            type="text"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Ej: deja espacio para una foto del producto a la derecha"
            disabled={generating}
            className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          El agente compone master 16:9 más variantes 1:1 y 9:16 con el brand kit
          del cliente. Las imágenes quedan como slots vacíos para que las subas
          después en el editor.
        </p>
        <Button
          size="sm"
          onClick={callAgent}
          disabled={!canGenerate}
          className="gap-1 shrink-0"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {hasProposal ? "Regenerar" : "Generar con IA"}
        </Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {hasProposal && rationale && (
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-violet-400 mb-1 flex items-center justify-between">
            <span>Decisión del agente</span>
            {cost != null && (
              <span className="text-muted-foreground normal-case tracking-normal">
                ~ USD {cost.toFixed(4)}
              </span>
            )}
          </p>
          <p className="text-xs text-foreground">{rationale}</p>
          <p className="text-[10px] text-muted-foreground mt-2">
            Propuesta lista. Pulsa Crear abajo para instanciar el template.
          </p>
        </div>
      )}
    </div>
  );
}

interface UploadedReference {
  filename: string;
  publicUrl: string;
  mimeType: string;
  // dataUri local para mostrar preview inline sin hacer otro fetch.
  previewUrl: string;
  // Métricas de la preparación, para mostrarle al productor cuánto se
  // redujo (y detectar si alguien sube algo raro).
  bytes: number;
  originalBytes: number;
  width: number;
  height: number;
}

function formatKb(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
