"use client";

import { useCallback, useEffect, useMemo, useRef, useState, CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckSquare,
  ChevronDown,
  Database,
  Download,
  FileSpreadsheet,
  Link2,
  Loader2,
  Package,
  LayoutGrid,
  LayoutList,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Sparkles,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { hasExtremeAspectMismatch } from "@/lib/production/fit-mode";
import { parseOverrides } from "@/lib/production/overrides";
import {
  captureNodeToJpeg,
  downloadBlob,
  sanitizeFilename,
} from "@/lib/production/export";
import { AdaptationRenderer } from "@/components/production/render/adaptation-renderer";
import {
  extractVariables,
  substituteVariables,
  DataRow,
} from "@/lib/production/variables";
import { parseCsvFile, ParsedDataset } from "@/lib/production/csv";
import {
  TemplateDefinition,
  TemplateLayer,
  StackLayout,
  newRootFrame,
} from "@/lib/production/types";
import { TemplateEditor } from "@/components/production/editor/template-editor";
import { ProjectBrandKitModal } from "@/components/production/editor/project-brand-kit-modal";
import {
  buildInitialFromAdaptFit,
  deriveManualLayoutFromMaster,
} from "@/lib/production/overrides";
import {
  BrandKit,
  BrandKitContent,
  EMPTY_KIT_CONTENT,
  brandKitFromApi,
  resolveTreeTokens,
} from "@/lib/production/brand-kit";
import { reflowForPreview } from "@/lib/production/reflow";
import {
  TemplateLayerView,
  stackToFlexStyle,
} from "@/components/production/editor/template-layer";

const CHANNEL_LABEL: Record<string, string> = {
  gdn: "Google Display",
  meta: "Meta / Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  email: "Email",
  print: "Imprenta",
  custom: "Personalizado",
};

const CHANNEL_ORDER: string[] = [
  "gdn",
  "meta",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "email",
  "print",
];

// Palette de badges para identificar visualmente cada orientación del master
// (#1 = master, #2 = primera variante, etc.). Los colores son determinísticos
// por índice — la misma orientación tiene el mismo color durante toda la
// sesión, y cada AdaptationCard adopta el badge de su source para que el
// productor sepa de qué variante hereda. Si hay más de 8 orientaciones el
// palette cicla (raro en la práctica, los masters suelen tener 3-5).
const ORIENTATION_BADGE_PALETTE: { bg: string; ring: string }[] = [
  { bg: "bg-blue-500",   ring: "ring-blue-500/30" },
  { bg: "bg-emerald-500", ring: "ring-emerald-500/30" },
  { bg: "bg-orange-500", ring: "ring-orange-500/30" },
  { bg: "bg-purple-500", ring: "ring-purple-500/30" },
  { bg: "bg-pink-500",   ring: "ring-pink-500/30" },
  { bg: "bg-cyan-500",   ring: "ring-cyan-500/30" },
  { bg: "bg-yellow-500", ring: "ring-yellow-500/30" },
  { bg: "bg-rose-500",   ring: "ring-rose-500/30" },
];

function orientationBadgeColors(num: number): { bg: string; ring: string } {
  // num es 1-indexed; -1 para meter en el palette 0-indexed.
  return ORIENTATION_BADGE_PALETTE[(num - 1) % ORIENTATION_BADGE_PALETTE.length];
}

// El sort del strip: master primero, después por aspect (h → cuadrado → v)
// y por área dentro de cada grupo. Vive como helper a nivel de módulo para
// que tanto el VariantsStrip como el page (para numerar adaptaciones) usen
// el mismo orden y los números calcen visualmente.
function sortOrientationsForBadging(
  orientations: Orientation[],
  principalId: number | null,
): Orientation[] {
  return [...orientations].sort((a, b) => {
    if (a.id === principalId) return -1;
    if (b.id === principalId) return 1;
    const orient = (w: number, h: number) => {
      const r = w / h;
      if (Math.abs(r - 1) < 0.05) return 1;
      return r > 1 ? 0 : 2;
    };
    const ao = orient(a.base_width, a.base_height);
    const bo = orient(b.base_width, b.base_height);
    if (ao !== bo) return ao - bo;
    return a.base_width * a.base_height - b.base_width * b.base_height;
  });
}

interface Template {
  id: number;
  production_project_id: number;
  design_id: number | null;
  linked_to_template_id: number | null;
  brand_kit_id: number | null;
  name: string;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  status: "draft" | "published" | "archived";
  version: number;
  definition: TemplateDefinition | null;
}

// Orientación del master. Cada master tiene 1..N orientaciones — pueden ser
// vinculadas al base (heredan layout via reflow) o distintas (layout
// propio). Vienen del endpoint /api/production/templates/[id]/orientations.
interface Orientation {
  id: number;
  production_project_id: number;
  design_id: number | null;
  linked_to_template_id: number | null;
  name: string;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  version: number;
  definition: TemplateDefinition | null;
}

interface FormatPreset {
  id: number;
  channel: string;
  group_name: string | null;
  name: string;
  width: number;
  height: number;
  orientation: "horizontal" | "vertical" | "square";
  is_system: number;
  client_id: number | null;
  sort_order: number;
}

type FitMode = "contain" | "cover" | "width" | "height" | "responsive";

const FIT_MODE_LABEL: Record<FitMode, string> = {
  contain: "Contain",
  cover: "Cover",
  width: "Ancho 100%",
  height: "Alto 100%",
  responsive: "Responsive",
};

const FIT_MODE_DESCRIPTION: Record<FitMode, string> = {
  contain: "Master entero a escala uniforme; puede dejar bordes vacíos",
  cover: "Llena toda la adaptación; recorta lo que sobra",
  width: "Ajusta al ancho de la adaptación; recorta o extiende vertical",
  height: "Ajusta al alto de la adaptación; recorta o extiende horizontal",
  responsive: "Usa los constraints por capa del master (layout fluido)",
};

interface Adaptation {
  id: number;
  design_id: number;
  // null = auto-pick por aspect; number = orientación pinned como fuente.
  source_template_id: number | null;
  format_preset_id: number | null;
  custom_name: string | null;
  width: number;
  height: number;
  fit_mode: FitMode;
  is_active: number;
  thumbnail_url: string | null;
  overrides_json: string | null;
  preset_channel: string | null;
  preset_group_name: string | null;
  preset_name: string | null;
  preset_orientation: "horizontal" | "vertical" | "square" | null;
}

export default function ProducirPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<Template | null>(null);
  // Orientaciones del master: cada item incluye id + dimensiones +
  // definition. Una sola orientación cuando el master no tiene variantes.
  // El "master" es el conjunto, no un singular.
  const [orientations, setOrientations] = useState<Orientation[]>([]);
  // Orientación activa = la que está abierta en el editor. Default: la del
  // URL. Cambiar de orientación NO refresca la página ni navega — solo
  // setea este state.
  const [activeOrientationId, setActiveOrientationId] = useState<number | null>(null);
  // clientId y brandKits viven en state (no solo locals de fetchAll) porque
  // el editor embebido los necesita como props.
  const [clientId, setClientId] = useState<number | null>(null);
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [brandKitContent, setBrandKitContent] = useState<BrandKitContent>(EMPTY_KIT_CONTENT);
  const [adaptations, setAdaptations] = useState<Adaptation[]>([]);
  const [presets, setPresets] = useState<FormatPreset[]>([]);
  // Adaptations carga lazy: contamos cuántas hay para mostrar el botón
  // "Ver adaptaciones (N)" sin tener que renderear todas las cards (cada
  // card hace reflow + token resolve + render del layer tree). Se cargan
  // al click.
  const [adaptationsLoaded, setAdaptationsLoaded] = useState(false);
  const [adaptationCount, setAdaptationCount] = useState(0);
  const [adaptationsLoading, setAdaptationsLoading] = useState(false);

  // Job de generación de thumbnail del master. Se setea desde handleSaveMaster
  // cuando el productor edita la orientación principal y se persiste OK; un
  // useEffect monta el render off-screen, captura con html-to-image, sube a
  // GCS y hace PUT del thumbnail_url al master template. Best-effort: si
  // falla, el editor sigue funcionando — el listado simplemente cae al
  // render inline mientras tanto.
  const [thumbnailJob, setThumbnailJob] = useState<{
    def: TemplateDefinition;
    nativeW: number;
    nativeH: number;
    targetTemplateId: number;
  } | null>(null);
  const thumbnailCaptureRef = useRef<HTMLDivElement | null>(null);
  // Auto-gen del thumbnail solo en el primer save de un master sin imagen.
  // Una vez disparado en la sesión, los siguientes saves no regeneran; el
  // productor decide cuándo refrescarlo via el botón "Rehacer preview".
  // Evita que cada save dispare un upload nuevo (con autosave debounced de
  // 1s eso significaba un blob a S3 cada vez que dejabas de tipear).
  const autoThumbnailFiredRef = useRef(false);
  // Filtros del módulo adaptaciones. Set vacío significa "todos" — más
  // simple para el toggle (un click agrega/quita un id del set). Search
  // matchea contra custom_name + preset_name. onlyCustomized filtra a
  // adaptaciones con manual_layout. Los filtros NO persisten — son por
  // sesión, se reinician al volver a entrar a la página.
  const [filterSourceIds, setFilterSourceIds] = useState<Set<number>>(new Set());
  const [filterChannels, setFilterChannels] = useState<Set<string>>(new Set());
  const [filterSearch, setFilterSearch] = useState("");
  const [filterOnlyCustomized, setFilterOnlyCustomized] = useState(false);
  // Modo de vista del grid de adaptaciones:
  //   "clean"    → grid plano, solo preview + dims, sin filtros / canales /
  //                badges / botones (default — el productor se concentra
  //                en las piezas).
  //   "detailed" → vista completa con filtros, agrupado por canal, source
  //                badges, fit mode, descarga individual, etc.
  // No persiste; cada entrada a la página arranca en clean.
  const [adaptationsView, setAdaptationsView] = useState<"clean" | "detailed">("clean");
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // --- Editor embebido (workspace unificado) ---
  // editingId controla qué se muestra en el editor:
  //   null  → master del template (variante activa)
  //   N     → adaptación N (override editing)
  const [editingId, setEditingId] = useState<number | null>(null);
  // Snapshot del overrides_json de la adaptación al momento de entrar a
  // editarla. Si el productor cancela, restauramos este valor (o reset_overrides
  // si no había). Sin esto, los cambios auto-guardados del editor ya están
  // persistidos y "cancelar" no podría revertirlos.
  const editSnapshotRef = useRef<string | null>(null);
  // Ref del wrapper de la section del editor — sirve para hacer scrollIntoView
  // cuando el productor clickea Editar en una adaptación lejos del viewport.
  const editorSectionRef = useRef<HTMLElement | null>(null);

  // Modal para agregar variante del master.
  const [showAddVariant, setShowAddVariant] = useState(false);

  // Modal de edición del brand kit ACTIVO. Cuando es != null, se monta el
  // modal sobre el kit con ese id. El productor lo dispara con "Editar" o
  // "Personalizar para este proyecto" (fork + abrir editor).
  const [editingKitId, setEditingKitId] = useState<number | null>(null);

  // Modal de Banner Designer (IA): id de la orientación que se está adaptando.
  // null = modal cerrado. La modal se monta como overlay y maneja su propio
  // ciclo de pedida → preview → accept/regenerate/cancel.
  const [aiAdaptTargetId, setAiAdaptTargetId] = useState<number | null>(null);
  // Contador que se incrementa cuando aplicamos una propuesta de IA. Va en
  // el `key` del editor para forzar remount aun cuando la orientación activa
  // no cambia — sin esto, React no detecta que la definition cambió y el
  // editor sigue mostrando el contenido viejo.
  const [editorRemountKey, setEditorRemountKey] = useState(0);
  // Toast efímero que confirma una acción exitosa de IA. Se muestra unos
  // segundos y luego se limpia solo.
  const [aiSuccessToast, setAiSuccessToast] = useState<string | null>(null);

  // designId del template actual. Las adaptaciones cuelgan del design, no
  // del template — la URL del producir page sigue siendo por template_id
  // (es el contexto de edición del productor) pero internamente todo se
  // resuelve por design_id.
  const designId = template?.design_id ?? null;

  const fetchAdaptations = useCallback(async () => {
    if (designId == null) return;
    setAdaptationsLoading(true);
    try {
      const res = await fetch(`/api/production/designs/${designId}/adaptations`);
      if (res.ok) {
        const data: Adaptation[] = await res.json();
        setAdaptations(data);
        setAdaptationCount(data.length);
        setAdaptationsLoaded(true);
      }
    } finally {
      setAdaptationsLoading(false);
    }
  }, [designId]);

  // Carga liviana: solo cuenta cuántas adaptaciones hay. Se llama al inicio
  // así el botón "Ver adaptaciones (N)" muestra el número sin pagar el
  // costo de renderizar las cards.
  const fetchAdaptationCount = useCallback(async (dId: number) => {
    const res = await fetch(`/api/production/designs/${dId}/adaptations`);
    if (res.ok) {
      const data: Adaptation[] = await res.json();
      setAdaptationCount(data.length);
    }
  }, []);

  // Re-fetcheable cuando se guardan cambios en un brand kit o se crea un fork.
  // Solo actualiza la lista — el `brandKitContent` activo se deriva aparte
  // desde `template.brand_kit_id` (ver useEffect más abajo).
  const fetchBrandKits = useCallback(async (cid: number, projectId: number) => {
    const res = await fetch(
      `/api/production/brand-kits?client_id=${cid}&production_project_id=${projectId}`
    );
    if (!res.ok) return;
    const rows: unknown[] = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed: BrandKit[] = rows.map((r: any) => brandKitFromApi(r));
    setBrandKits(parsed);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const tplRes = await fetch(`/api/production/templates/${templateId}`);
      if (!tplRes.ok) {
        if (tplRes.status === 404 || tplRes.status === 401) router.push("/");
        return;
      }
      const tpl: Template = await tplRes.json();
      setTemplate(tpl);

      const [projRes, presetsBaseRes, orientationsRes] = await Promise.all([
        fetch(`/api/production/projects/${tpl.production_project_id}`),
        fetch(`/api/production/format-presets`),
        // Orientaciones del master (incluye la actual). Endpoint dedicado:
        // resuelve design_id, devuelve todos los templates del mismo design
        // CON sus definitions parseadas para previews y rendering.
        fetch(`/api/production/templates/${templateId}/orientations`),
      ]);
      if (orientationsRes.ok) {
        const list: Orientation[] = await orientationsRes.json();
        setOrientations(list);
        // Active = el del URL si está en la lista; si no, el primero.
        const fromUrl = list.find((o) => o.id === Number(templateId));
        setActiveOrientationId((fromUrl ?? list[0])?.id ?? null);
      }
      let resolvedClientId: number | null = null;
      if (projRes.ok) {
        const proj = await projRes.json();
        resolvedClientId = proj.client_id;
      }
      setClientId(resolvedClientId);
      // Re-fetch presets including client-specific ones if we have a client.
      const presetsRes = resolvedClientId
        ? await fetch(`/api/production/format-presets?client_id=${resolvedClientId}`)
        : presetsBaseRes;
      if (presetsRes.ok) setPresets(await presetsRes.json());

      // Brand kit cascade (mismo pattern que el editor).
      if (resolvedClientId) {
        await fetchBrandKits(resolvedClientId, tpl.production_project_id);
      }

      // Las adaptaciones no se renderizan en el load inicial — solo
      // contamos cuántas hay para el botón "Ver adaptaciones (N)". Cada
      // card hace un reflow + token resolve + render del layer tree, así
      // que cargar 12+ tarda. El productor pide verlas cuando las necesita.
      // design_id viene del template — después de migration 113 siempre
      // existe; defensive check por si vienes de una DB previa.
      if (tpl.design_id != null) {
        await fetchAdaptationCount(tpl.design_id);
      }

      // Hidratar dataset persistido (si existe).
      const dsRes = await fetch(`/api/production/templates/${templateId}/datasets`);
      if (dsRes.ok) {
        const ds = await dsRes.json();
        if (ds && Array.isArray(ds.rows) && ds.rows.length > 0) {
          setDataset({
            columns: ds.columns ?? [],
            rows: ds.rows,
            totalRows: ds.row_count ?? ds.rows.length,
            filename: ds.source_filename ?? ds.name ?? "dataset",
          });
          setSelectedRowIdx(0);
        }
      }
    } catch (err) {
      console.error("Error cargando datos:", err);
    } finally {
      setLoading(false);
    }
  }, [templateId, router, fetchAdaptationCount, fetchBrandKits]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session?.user) {
      router.push("/login");
      return;
    }
    if (session.user.role !== "admin") {
      router.push("/");
      return;
    }
    fetchAll();
  }, [fetchAll, session, sessionStatus, router]);

  // El brand kit ACTIVO viene de template.brand_kit_id. Si no apunta a ningún
  // kit válido, queda vacío (EMPTY_KIT_CONTENT). El cascade default+default
  // que existía antes se eliminó: ahora el productor elige explícitamente
  // qué kit usar.
  const activeBrandKit = useMemo(() => {
    if (!template?.brand_kit_id) return null;
    return brandKits.find((k) => k.id === template.brand_kit_id) ?? null;
  }, [template?.brand_kit_id, brandKits]);

  useEffect(() => {
    setBrandKitContent(activeBrandKit?.content ?? EMPTY_KIT_CONTENT);
  }, [activeBrandKit]);

  // Cambia el brand kit base del template. PUT al template + estado local
  // optimista (cambio inmediato; si falla, el siguiente refetch lo corrige).
  const handleSelectBrandKit = useCallback(
    async (kitId: number | null) => {
      if (!template) return;
      const prev = template.brand_kit_id;
      setTemplate((cur) => (cur ? { ...cur, brand_kit_id: kitId } : cur));
      const res = await fetch(`/api/production/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_kit_id: kitId }),
      });
      if (!res.ok) {
        setTemplate((cur) => (cur ? { ...cur, brand_kit_id: prev } : cur));
        const body = await res.json().catch(() => ({}));
        alert(body?.error || `No se pudo cambiar el brand kit (HTTP ${res.status})`);
      }
    },
    [template]
  );

  // Soft-delete del brand kit ACTIVO (debe ser project-scoped). Pide confirm.
  // Después de borrar: refetch kits, y si el template apuntaba a este kit,
  // re-asignamos al default cliente-wide (o NULL si no hay) para que el
  // editor no quede en estado "kit roto".
  const handleDeleteActiveBrandKit = useCallback(async () => {
    if (!template || !activeBrandKit) return;
    if (activeBrandKit.production_project_id == null) {
      // Kits cliente-wide no se borran desde producción. Esa acción vive en
      // el dashboard del cliente. Acá solo se borran forks project-scoped.
      return;
    }
    const ok = confirm(
      `¿Eliminar el brand kit "${activeBrandKit.name}"? Queda como eliminado y el administrador podrá reactivarlo desde el dashboard del cliente.`,
    );
    if (!ok) return;
    const res = await fetch(
      `/api/production/brand-kits/${activeBrandKit.id}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body?.error || `No se pudo eliminar (HTTP ${res.status})`);
      return;
    }
    // Refetch + reasignar a un fallback razonable.
    if (clientId) {
      await fetchBrandKits(clientId, template.production_project_id);
    }
    // Buscamos el default cliente-wide para reasignar; si no hay, queda null.
    const fallbackRes = await fetch(
      `/api/production/brand-kits?client_id=${clientId}&production_project_id=${template.production_project_id}`,
    );
    if (fallbackRes.ok) {
      const rows: unknown[] = await fallbackRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: BrandKit[] = rows.map((r: any) => brandKitFromApi(r));
      const fallback =
        parsed.find((k) => k.production_project_id == null && k.is_default) ??
        parsed.find((k) => k.production_project_id == null) ??
        null;
      await handleSelectBrandKit(fallback?.id ?? null);
    }
  }, [template, activeBrandKit, clientId, fetchBrandKits, handleSelectBrandKit]);

  // Forkea el brand kit activo (snapshot independiente al proyecto) y lo
  // marca como activo. Devuelve el nuevo kit id para que el caller pueda
  // abrir el editor sobre él. Si no hay kit activo o no es cliente-wide,
  // no hace nada.
  const handleForkBrandKit = useCallback(async (): Promise<number | null> => {
    if (!template || !activeBrandKit) return null;
    if (activeBrandKit.production_project_id != null) {
      // Ya es project-scoped: no forkeamos, retornamos su id para abrir editor.
      return activeBrandKit.id;
    }
    const res = await fetch("/api/production/brand-kits/fork", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_kit_id: activeBrandKit.id,
        production_project_id: template.production_project_id,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body?.error || `No se pudo personalizar (HTTP ${res.status})`);
      return null;
    }
    const newKitRow = await res.json();
    if (clientId) {
      await fetchBrandKits(clientId, template.production_project_id);
    }
    await handleSelectBrandKit(newKitRow.id);
    return newKitRow.id as number;
  }, [template, activeBrandKit, clientId, fetchBrandKits, handleSelectBrandKit]);

  // Orientación activa: la que está abierta en el editor en este momento.
  // Cambia con setActiveOrientationId (no requiere recarga ni navegación).
  const activeOrientation = useMemo(
    () => orientations.find((o) => o.id === activeOrientationId) ?? null,
    [orientations, activeOrientationId],
  );

  // La principal del design = la de MIN id. Es el "master" y nunca se diferencia
  // (siempre tiene linked_to_template_id = NULL por construcción).
  const principalOrientation = useMemo(() => {
    if (orientations.length === 0) return null;
    return orientations.reduce(
      (min, o) => (o.id < min.id ? o : min),
      orientations[0],
    );
  }, [orientations]);

  // Map orientationId → número (1-indexed) según el orden visual del strip.
  // El #1 es siempre la principal/master. Cada AdaptationCard usa el número
  // de su source para mostrar el mismo badge — así el productor identifica
  // visualmente qué adaptaciones derivan de qué orientación.
  const orientationNumberById = useMemo(() => {
    if (orientations.length === 0) return new Map<number, number>();
    const sorted = sortOrientationsForBadging(
      orientations,
      principalOrientation?.id ?? null,
    );
    const map = new Map<number, number>();
    sorted.forEach((o, idx) => map.set(o.id, idx + 1));
    return map;
  }, [orientations, principalOrientation]);

  // Lista ordenada de orientaciones (mismo orden que el strip y los badges).
  // La usa el filtro de adaptaciones por origen.
  const sortedOrientations = useMemo(
    () =>
      sortOrientationsForBadging(
        orientations,
        principalOrientation?.id ?? null,
      ),
    [orientations, principalOrientation],
  );

  // Aplica los filtros sobre la lista cruda de adaptaciones. El groupBy
  // de canal se ejecuta DESPUÉS sobre la lista filtrada, así los headers
  // de canal solo aparecen para los grupos con items visibles. resolveSource
  // se llama acá para mapear cada adaptación a su orientación source y poder
  // filtrar por orientation id.
  const filteredAdaptations = useMemo(() => {
    const searchLower = filterSearch.trim().toLowerCase();
    return adaptations.filter((a) => {
      // Source filter: si hay ids seleccionados, la source resuelta debe
      // estar en el set. Si no hay seleccionados, pasa cualquiera.
      if (filterSourceIds.size > 0) {
        const src = resolveSource(a, orientations);
        if (!src || !filterSourceIds.has(src.id)) return false;
      }
      // Channel filter: equivalente. El "custom" cubre adaptaciones sin
      // preset (formato libre) — coincide con el groupBy.
      if (filterChannels.size > 0) {
        const ch = a.preset_channel ?? (a.format_preset_id == null ? "custom" : null);
        if (!ch || !filterChannels.has(ch)) return false;
      }
      // Customized: filtra a las que tienen manual_layout (overrides_json).
      if (filterOnlyCustomized) {
        const overrides = parseOverrides(a.overrides_json);
        if (!overrides.manual_layout) return false;
      }
      // Search: contra custom_name + preset_name. Si ambos null, no matchea
      // a no ser que el search esté vacío.
      if (searchLower) {
        const name = (a.custom_name || a.preset_name || "").toLowerCase();
        const dims = `${a.width}x${a.height}`;
        if (!name.includes(searchLower) && !dims.includes(searchLower)) {
          return false;
        }
      }
      return true;
    });
  }, [
    adaptations,
    orientations,
    filterSourceIds,
    filterChannels,
    filterOnlyCustomized,
    filterSearch,
  ]);

  // Canales que existen en las adaptaciones del template (para los chips del
  // filtro). Solo mostramos chips de canales presentes; no tiene sentido
  // ofrecer "Meta" como filtro si el productor no tiene piezas de Meta.
  const availableChannels = useMemo(() => {
    const set = new Set<string>();
    for (const a of adaptations) {
      const ch = a.preset_channel ?? (a.format_preset_id == null ? "custom" : null);
      if (ch) set.add(ch);
    }
    return Array.from(set).sort((a, b) => {
      const ai = CHANNEL_ORDER.indexOf(a);
      const bi = CHANNEL_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [adaptations]);

  const anyFilterActive =
    filterSourceIds.size > 0 ||
    filterChannels.size > 0 ||
    filterOnlyCustomized ||
    filterSearch.trim().length > 0;

  const clearAdaptationFilters = () => {
    setFilterSourceIds(new Set());
    setFilterChannels(new Set());
    setFilterOnlyCustomized(false);
    setFilterSearch("");
  };

  // Definition que se está editando: viene de la orientación ACTIVA. El
  // useMemo evita reconstruir el objeto en cada render si la orientación no
  // cambió.
  const definition: TemplateDefinition = useMemo(() => {
    if (activeOrientation?.definition && activeOrientation.definition.type === "frame") {
      return activeOrientation.definition;
    }
    if (activeOrientation) {
      return newRootFrame(activeOrientation.base_width, activeOrientation.base_height);
    }
    return newRootFrame(1920, 1080);
  }, [activeOrientation]);

  // Cuando se edita una adaptación, derivamos su layout inicial desde la
  // source orientation (pinned o auto-pick). El manual_layout en overrides_json
  // gana si existe.
  const editingAdaptation = editingId != null
    ? adaptations.find((a) => a.id === editingId) ?? null
    : null;
  const adaptInitialDefinition: TemplateDefinition | null = useMemo(() => {
    if (!editingAdaptation) return null;
    const overrides = parseOverrides(editingAdaptation.overrides_json);
    if (overrides.manual_layout) {
      // El canvas del editor se dimensiona desde definition.size (no del prop
      // baseWidth/baseHeight). Si el manual_layout persistido tiene size
      // distinto al adapt actual, reflowamos al size correcto antes de
      // montar el editor — sino el canvas abre con dimensiones del master
      // (1080×1080) cuando el adapt es 300×250 y el productor ve solo una
      // tajada.
      const ml = overrides.manual_layout;
      if (
        ml.size?.w === editingAdaptation.width &&
        ml.size?.h === editingAdaptation.height
      ) {
        return ml;
      }
      return reflowForPreview(ml, {
        w: editingAdaptation.width,
        h: editingAdaptation.height,
      });
    }
    const source = resolveSource(editingAdaptation, orientations);
    // CRÍTICO: el fallback NUNCA debe ser `definition` (la activa del editor
    // del master) — eso causaba el bug "edito 300x250 desde el master
    // horizontal y heredo del horizontal en vez del cuadrado más cercano".
    const sourceDef =
      resolveEffectiveDefinition(source, orientations) ??
      principalOrientation?.definition ??
      null;
    if (!sourceDef) return null;
    // El initial del editor debe coincidir visualmente con el preview de la
    // card. La card usa scale-uniform cuando fit_mode != "responsive" y
    // reflow cuando es "responsive". Si usábamos reflow para todos los
    // casos, los smart-constraints inferidos (center/left/right) no
    // reescalaban sizes y producían layers gigantes en downscale grandes
    // (cuadrado 1080 → 300×250).
    return buildInitialFromAdaptFit(
      sourceDef,
      editingAdaptation.width,
      editingAdaptation.height,
      editingAdaptation.fit_mode,
    );
  }, [editingAdaptation, orientations, principalOrientation]);

  // Save de la orientación activa: PUT al endpoint del template
  // correspondiente. Si la orientación es la base, el server propaga el
  // cambio a las orientaciones linked (definition reflowed). Después
  // refrescamos las orientaciones para que el strip muestre lo nuevo.
  // Cuando lo guardado es la principal (master del design), encolamos
  // también la regeneración del thumbnail_url para que el listado de
  // /produccion/proyecto/[id] muestre el preview cacheado.
  const handleSaveMaster = useCallback(
    async (def: TemplateDefinition) => {
      if (!activeOrientationId) return;
      const res = await fetch(
        `/api/production/templates/${activeOrientationId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ definition: def }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          `Save master failed: ${res.status}${body?.error ? ` — ${body.error}` : ""}`
        );
      }
      // Refrescamos todas las orientaciones — la base puede haber empujado
      // cambios a las linked. Si solo se editó una orientación linked /
      // distinta, solo esa cambia.
      // IMPORTANTE: no leemos `orientations` del closure ni lo agregamos a
      // las deps de este useCallback. Si lo hiciéramos, el handler cambia
      // identidad tras cada setOrientations, lo que invalida flushSave del
      // editor y dispara el autosave infinitamente (dirtyRef no se limpia
      // post-save). Resolvemos la principal solo con nextList; si el refresh
      // falla, saltamos thumbnail (graceful skip; el siguiente save lo cubre).
      const refresh = await fetch(
        `/api/production/templates/${templateId}/orientations`
      );
      if (refresh.ok) {
        const nextList: Orientation[] = await refresh.json();
        setOrientations(nextList);
        if (nextList.length > 0) {
          const principal = nextList.reduce(
            (min, o) => (o.id < min.id ? o : min),
            nextList[0],
          );
          // Auto-gen thumbnail solo si:
          //   1. Se editó la principal (no una variant).
          //   2. La principal todavía no tiene thumbnail (primera vez).
          //   3. No lo disparamos antes en esta sesión (anti-doble-fire por
          //      autosave entre saves).
          if (
            activeOrientationId === principal.id &&
            !principal.thumbnail_url &&
            !autoThumbnailFiredRef.current
          ) {
            autoThumbnailFiredRef.current = true;
            setThumbnailJob({
              def,
              nativeW: principal.base_width,
              nativeH: principal.base_height,
              targetTemplateId: principal.id,
            });
          }
        }
      }
    },
    [activeOrientationId, templateId]
  );

  // Manual: el productor pide explícitamente regenerar el thumbnail. Útil
  // tras cambios visuales importantes (colores, layout, copy hero) que el
  // listado debería reflejar. Captura el master ACTUAL (no `definition` del
  // editor — esa es la orientación activa, podría ser una variant).
  const handleRegenerateThumbnail = useCallback(() => {
    if (!principalOrientation || !principalOrientation.definition) return;
    setThumbnailJob({
      def: principalOrientation.definition,
      nativeW: principalOrientation.base_width,
      nativeH: principalOrientation.base_height,
      targetTemplateId: principalOrientation.id,
    });
  }, [principalOrientation]);

  // Captura el master recién guardado, lo sube a GCS y PUT thumbnail_url al
  // template principal. Trigger: thumbnailJob !== null. Best-effort —
  // failures se loggean pero no rompen el editor. El render off-screen vive
  // al final del JSX gated por thumbnailJob.
  useEffect(() => {
    if (!thumbnailJob) return;
    let cancelled = false;
    const run = async () => {
      try {
        // requestAnimationFrame + setTimeout asegura que React montó el
        // OrientationMiniPreview off-screen Y el browser hizo paint antes
        // de capturar.
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => setTimeout(resolve, 80)),
        );
        if (cancelled) return;
        const node = thumbnailCaptureRef.current;
        if (!node) return;
        const blob = await captureNodeToJpeg(node);
        const dataUri: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("FileReader falló"));
          reader.readAsDataURL(blob);
        });
        if (cancelled) return;
        const up = await fetch("/api/production/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageData: dataUri, clientId: clientId ?? undefined }),
        });
        if (!up.ok) {
          console.warn("Thumbnail upload falló:", up.status);
          return;
        }
        const upBody = await up.json();
        if (typeof upBody.url !== "string") return;
        if (cancelled) return;
        const put = await fetch(
          `/api/production/templates/${thumbnailJob.targetTemplateId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ thumbnail_url: upBody.url }),
          },
        );
        if (!put.ok) {
          console.warn("PUT thumbnail_url falló:", put.status);
          return;
        }
        // Optimistic local update: la principal ahora tiene thumbnail. Sin
        // esto, el siguiente save vuelve a ver thumbnail_url=null y, si el
        // autoThumbnailFiredRef se resetara (no lo hace, pero defensive),
        // re-dispararía. Además mantiene consistencia con la DB sin un
        // refetch extra.
        const newUrl = upBody.url;
        const targetId = thumbnailJob.targetTemplateId;
        setOrientations((cur) =>
          cur.map((o) =>
            o.id === targetId ? { ...o, thumbnail_url: newUrl } : o,
          ),
        );
      } catch (e) {
        console.warn("Thumbnail generation falló:", (e as Error).message);
      } finally {
        if (!cancelled) setThumbnailJob(null);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [thumbnailJob, clientId]);

  // Save de una adaptación: PATCH overrides_json con manual_layout.
  const handleSaveAdapt = useCallback(
    async (def: TemplateDefinition) => {
      if (editingId == null || designId == null) return;
      const res = await fetch(
        `/api/production/designs/${designId}/adaptations/${editingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides_json: { manual_layout: def } }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`Save adapt failed: ${res.status}${body?.error ? ` — ${body.error}` : ""}`);
      }
      setAdaptations((cur) =>
        cur.map((a) =>
          a.id === editingId
            ? { ...a, overrides_json: JSON.stringify({ manual_layout: def }) }
            : a
        )
      );
    },
    [designId, editingId]
  );

  // Entra al modo edición de una adaptación: snapshot del overrides_json
  // actual (para poder cancelar después) + scroll del editor al viewport
  // para que el productor entienda que la pieza está abierta arriba.
  // También alineamos activeOrientationId al source resuelto. Eso garantiza
  // que `definition` (el state local derivado de activeOrientation) calce
  // con la herencia esperada — si el TemplateEditor llegase a leer fallback
  // de `definition`, ya quedó apuntando al source correcto. Sin esto, editar
  // 300x250 desde el master horizontal heredaba del horizontal en vez del
  // cuadrado más cercano.
  const handleEditAdaptation = useCallback((adaptationId: number) => {
    const adapt = adaptations.find((a) => a.id === adaptationId);
    editSnapshotRef.current = adapt?.overrides_json ?? null;
    setEditingId(adaptationId);
    // requestAnimationFrame asegura que el editor terminó de renderear con
    // la nueva initial definition antes de hacer scroll.
    requestAnimationFrame(() => {
      editorSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [adaptations]);

  // Cancela la edición de la adaptación: descarta los cambios que se hayan
  // auto-guardado restaurando el overrides_json al snapshot inicial. Si no
  // había overrides previos, ejecuta reset_overrides=true (vuelve a derivar
  // del master). Después cierra el modo edición.
  const handleCancelEditAdaptation = useCallback(async () => {
    if (editingId == null || designId == null) {
      setEditingId(null);
      return;
    }
    const snapshot = editSnapshotRef.current;
    let body: Record<string, unknown>;
    if (snapshot) {
      // Restaurar al overrides_json original. Como ya es un string JSON
      // serializado, podemos mandarlo así — el endpoint acepta string.
      body = { overrides_json: snapshot };
    } else {
      body = { reset_overrides: true };
    }
    const res = await fetch(
      `/api/production/designs/${designId}/adaptations/${editingId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      alert(errBody?.error || `No se pudo cancelar los cambios (HTTP ${res.status})`);
      return;
    }
    setAdaptations((cur) =>
      cur.map((a) =>
        a.id === editingId ? { ...a, overrides_json: snapshot } : a,
      ),
    );
    setEditingId(null);
    editSnapshotRef.current = null;
  }, [designId, editingId]);

  // Quita el ajuste manual de una adaptación SIN tocar el modo edición
  // (esto se invoca desde la card al hacer hover, fuera del flujo de editar).
  // La adaptación vuelve a derivar automáticamente del master cercano.
  const handleResetAdaptationOverride = useCallback(
    async (adaptationId: number) => {
      if (designId == null) return;
      if (
        !confirm(
          "¿Quitar el ajuste manual? La pieza volverá a derivar automáticamente del master.",
        )
      ) {
        return;
      }
      const res = await fetch(
        `/api/production/designs/${designId}/adaptations/${adaptationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reset_overrides: true }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error || `No se pudo quitar el ajuste (HTTP ${res.status})`);
        return;
      }
      setAdaptations((cur) =>
        cur.map((a) =>
          a.id === adaptationId ? { ...a, overrides_json: null } : a,
        ),
      );
    },
    [designId],
  );

  // Bulk add de adaptaciones. Ya no hay autoDistribute — todas las adaptaciones
  // cuelgan del design entero, y el renderer auto-selecciona la orientación
  // más cercana por aspect en cada pieza. El productor puede después fijar
  // una source distinta vía el picker de la card.
  const handleAddBulk = async (presetIds: number[]) => {
    if (presetIds.length === 0 || designId == null) return;
    const res = await fetch(`/api/production/designs/${designId}/adaptations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format_preset_ids: presetIds }),
    });
    if (res.ok) {
      setShowPicker(false);
      fetchAdaptations();
    }
  };

  const handleAddCustom = async (name: string, w: number, h: number) => {
    if (designId == null) return;
    const res = await fetch(`/api/production/designs/${designId}/adaptations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_name: name, width: w, height: h }),
    });
    if (res.ok) {
      setShowPicker(false);
      fetchAdaptations();
    }
  };

  // Cambia la source orientation de una adaptación. null = auto-pick.
  // Optimistic update + read-back para confirmar.
  const handleSourceChange = useCallback(
    async (adaptationId: number, sourceTemplateId: number | null) => {
      if (designId == null) return;
      setAdaptations((cur) =>
        cur.map((a) =>
          a.id === adaptationId ? { ...a, source_template_id: sourceTemplateId } : a,
        ),
      );
      const res = await fetch(
        `/api/production/designs/${designId}/adaptations/${adaptationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_template_id: sourceTemplateId }),
        },
      );
      if (!res.ok) {
        // Rollback con re-fetch para volver al estado canónico de la BD.
        fetchAdaptations();
      }
    },
    [designId, fetchAdaptations],
  );

  // --- Export pipeline ---
  // currentlyRendering: la adaptación que está montada en el container oculto
  // a su tamaño nativo (con la fila de datos opcional para variable
  // substitution). captureResolverRef sostiene el resolve del Promise que
  // espera el blob capturado. Trabajamos con un slot único: exportSingle
  // serializa cualquier llamada (single-download o ítem de un batch).
  const [currentlyRendering, setCurrentlyRendering] = useState<{
    adaptation: Adaptation;
    row: DataRow | null;
  } | null>(null);
  const captureResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const renderRef = useRef<HTMLDivElement | null>(null);
  const [singleDownloadingId, setSingleDownloadingId] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // --- Dataset / variables ---
  // El dataset persiste en production_datasets (uno por template). El upload
  // parsea el CSV en cliente vía papaparse y luego lo POSTea para guardarlo.
  // Al cargar la página se hace GET para hidratar el estado.
  const [dataset, setDataset] = useState<ParsedDataset | null>(null);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const datasetFileInputRef = useRef<HTMLInputElement | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [datasetSaving, setDatasetSaving] = useState(false);

  useEffect(() => {
    if (!currentlyRendering) return;
    let cancelled = false;
    (async () => {
      // Esperamos dos rAF para asegurar que React commit y el browser pinte.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (cancelled) return;
      const node = renderRef.current;
      if (!node) {
        captureResolverRef.current?.(null);
        captureResolverRef.current = null;
        setCurrentlyRendering(null);
        return;
      }
      try {
        const blob = await captureNodeToJpeg(node);
        if (cancelled) return;
        captureResolverRef.current?.(blob);
      } catch (err) {
        console.error("Capture failed:", err);
        captureResolverRef.current?.(null);
      } finally {
        if (!cancelled) {
          captureResolverRef.current = null;
          setCurrentlyRendering(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentlyRendering]);

  const exportAdaptation = useCallback(
    (a: Adaptation, row: DataRow | null = null): Promise<Blob | null> => {
      return new Promise((resolve) => {
        captureResolverRef.current = resolve;
        setCurrentlyRendering({ adaptation: a, row });
      });
    },
    []
  );

  const filenameFor = useCallback(
    (a: Adaptation): string => {
      const label = a.custom_name || a.preset_name || `${a.width}x${a.height}`;
      const tpl = template?.name ?? "template";
      return sanitizeFilename(`${tpl}_${label}_${a.width}x${a.height}.jpg`);
    },
    [template]
  );

  const handleDownloadSingle = async (a: Adaptation) => {
    setSingleDownloadingId(a.id);
    try {
      // Single download usa el row de preview si hay uno seleccionado, así
      // descargas la versión que ves en pantalla.
      const blob = await exportAdaptation(a, previewRow);
      if (blob) {
        const suffix = previewRow ? `_fila${(selectedRowIdx ?? 0) + 1}` : "";
        const name = filenameFor(a).replace(/\.jpg$/, `${suffix}.jpg`);
        downloadBlob(blob, name);
      }
    } finally {
      setSingleDownloadingId(null);
    }
  };

  const handleDownloadAll = async () => {
    if (adaptations.length === 0) return;
    // Dos modos según haya o no dataset cargado:
    //  - Sin dataset: 1 archivo por adaptación.
    //  - Con dataset: N filas × M adaptaciones, agrupadas en subcarpetas
    //    por fila para mantener orden.
    const rows: (DataRow | null)[] = dataset ? dataset.rows : [null];
    const total = rows.length * adaptations.length;
    setBatchProgress({ current: 0, total });
    let counter = 0;
    try {
      const zip = new JSZip();
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const rowPrefix = row
          ? `${String(r + 1).padStart(3, "0")}_${sanitizeFilename(rowSubfolderName(row, r))}/`
          : "";
        for (let i = 0; i < adaptations.length; i++) {
          const a = adaptations[i];
          counter++;
          setBatchProgress({ current: counter, total });
          const blob = await exportAdaptation(a, row);
          if (blob) {
            zip.file(`${rowPrefix}${filenameFor(a)}`, blob);
          }
        }
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const tplName = template?.name ?? "template";
      const zipName = dataset
        ? `${tplName}_${dataset.rows.length}filas.zip`
        : `${tplName}_adaptaciones.zip`;
      downloadBlob(zipBlob, sanitizeFilename(zipName));
    } finally {
      setBatchProgress(null);
    }
  };

  // --- Dataset handlers ---
  const detectedVariables = useMemo(
    () => extractVariables(definition),
    [definition]
  );

  const handleUploadCsv = async (file: File) => {
    setDatasetError(null);
    setDatasetSaving(true);
    try {
      const parsed = await parseCsvFile(file);
      if (parsed.rows.length === 0) {
        setDatasetError("El archivo CSV está vacío");
        return;
      }
      // Persistimos antes de actualizar UI: si la BD falla, no queremos
      // dejar al usuario con un dataset que se va a perder al refrescar.
      const res = await fetch(
        `/api/production/templates/${templateId}/datasets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: parsed.filename,
            source_filename: parsed.filename,
            columns: parsed.columns,
            rows: parsed.rows,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setDatasetError(body?.error || `No se pudo guardar el dataset (HTTP ${res.status})`);
        return;
      }
      setDataset(parsed);
      setSelectedRowIdx(0);
    } catch (err) {
      console.error("Error parseando/guardando CSV:", err);
      setDatasetError("No se pudo parsear o guardar el archivo CSV");
    } finally {
      setDatasetSaving(false);
      if (datasetFileInputRef.current) datasetFileInputRef.current.value = "";
    }
  };

  const handleClearDataset = async () => {
    setDatasetSaving(true);
    try {
      const res = await fetch(
        `/api/production/templates/${templateId}/datasets`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setDataset(null);
        setSelectedRowIdx(null);
      } else {
        const body = await res.json().catch(() => null);
        setDatasetError(body?.error || "No se pudo eliminar el dataset");
      }
    } finally {
      setDatasetSaving(false);
    }
  };

  // La fila activa del dataset (si la hay) se propaga a cada AdaptationCard
  // como dataRow. La sustitución de variables se hace adentro del renderer
  // tanto para el master como para el manual_layout — así un override manual
  // también respeta el dataset sin que el caller tenga que pre-procesar.
  const previewRow: DataRow | null =
    dataset && selectedRowIdx !== null ? dataset.rows[selectedRowIdx] ?? null : null;

  const [fitModeError, setFitModeError] = useState<string | null>(null);

  const designMembers = useMemo(() => {
    if (orientations.length === 0) return [];
    return orientations
      .map((o) => ({
        id: o.id,
        name: o.name,
        base_width: o.base_width,
        base_height: o.base_height,
        thumbnail_url: o.thumbnail_url,
        linked_to_template_id: o.linked_to_template_id,
        isCurrent: o.id === activeOrientationId,
      }))
      .sort((a, b) => {
        const orient = (w: number, h: number) => {
          const r = w / h;
          if (Math.abs(r - 1) < 0.05) return 1;
          return r > 1 ? 0 : 2;
        };
        const ao = orient(a.base_width, a.base_height);
        const bo = orient(b.base_width, b.base_height);
        if (ao !== bo) return ao - bo;
        return a.base_width * a.base_height - b.base_width * b.base_height;
      });
  }, [orientations, activeOrientationId]);

  const handleAddVariant = useCallback(
    async (width: number, height: number, customName?: string) => {
      // Creamos la variante a partir de la orientación ACTUAL (no del URL
      // template). Así el reflow inicial se hace contra lo que el productor
      // estaba mirando, no contra una "base" arbitraria.
      const sourceId = activeOrientationId ?? Number(templateId);
      const res = await fetch(
        `/api/production/templates/${sourceId}/variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ width, height, name: customName }),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as { id: number };
        setShowAddVariant(false);
        // Refrescamos las orientaciones y dejamos la nueva como activa —
        // sin navegar. El productor sigue en el mismo URL.
        const refresh = await fetch(
          `/api/production/templates/${templateId}/orientations`
        );
        if (refresh.ok) {
          const list: Orientation[] = await refresh.json();
          setOrientations(list);
          setActiveOrientationId(data.id);
        }
      }
    },
    [activeOrientationId, templateId]
  );

  // Borrar una orientación (variante). La PRINCIPAL (MIN id) no se puede
  // borrar — es el master mismo. Después de borrar, refrescamos orientations
  // y si era la activa, switcheamos a la principal.
  const handleDeleteOrientation = useCallback(
    async (orientationId: number) => {
      const sorted = [...orientations].sort((a, b) => a.id - b.id);
      const principal = sorted[0];
      if (principal && orientationId === principal.id) return;
      if (
        !confirm(
          "¿Eliminar esta orientación? Las adaptaciones del master no se borran, pero las que la estaban usando pasarán a la orientación más cercana."
        )
      ) {
        return;
      }
      const res = await fetch(
        `/api/production/templates/${orientationId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const refresh = await fetch(
          `/api/production/templates/${templateId}/orientations`
        );
        if (refresh.ok) {
          const list: Orientation[] = await refresh.json();
          setOrientations(list);
          // Si la activa era la borrada, cae sobre la principal nueva.
          if (activeOrientationId === orientationId) {
            const newSorted = [...list].sort((a, b) => a.id - b.id);
            setActiveOrientationId(newSorted[0]?.id ?? null);
          }
        }
      }
    },
    [orientations, activeOrientationId, templateId]
  );

  // Diferencia una orientación específica del grupo linked. Acepta el id
  // como param para poder invocarse desde el strip sobre cualquier orientación
  // (no solo la activa).
  const handleDifferentiate = useCallback(
    async (orientationId: number) => {
      const target = orientations.find((o) => o.id === orientationId);
      if (!target || target.linked_to_template_id == null) return;
      const ok = confirm(
        `¿Diferenciar "${target.name}" del resto? Dejará de heredar cambios del master base.`,
      );
      if (!ok) return;
      const res = await fetch(`/api/production/templates/${orientationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linked_to_template_id: null }),
      });
      if (res.ok) {
        setOrientations((cur) =>
          cur.map((o) =>
            o.id === orientationId ? { ...o, linked_to_template_id: null } : o,
          ),
        );
      }
    },
    [orientations],
  );

  // Re-vincula una orientación a otra fuente (por defecto el master) y
  // reemplaza su definition por la fuente reflowed. Sirve para "re-engancharla"
  // al grupo de sync después de haberla diferenciado.
  const handleRelinkTo = useCallback(
    async (targetId: number, sourceId: number) => {
      if (sourceId === targetId) return;
      const target = orientations.find((o) => o.id === targetId);
      if (!target) return;
      const sourceOri = orientations.find((o) => o.id === sourceId);
      const sourceLabel = sourceOri
        ? principalOrientation && sourceOri.id === principalOrientation.id
          ? "el master"
          : `"${sourceOri.name}"`
        : "esa orientación";
      const ok = confirm(
        `¿Reemplazar el contenido de "${target.name}" por el de ${sourceLabel}? El layout actual se pierde.`,
      );
      if (!ok) return;
      const res = await fetch(
        `/api/production/templates/${targetId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linked_to_template_id: sourceId }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body?.error || `No se pudo ajustar el formato (HTTP ${res.status})`);
        return;
      }
      const refresh = await fetch(
        `/api/production/templates/${templateId}/orientations`,
      );
      if (refresh.ok) {
        const list: Orientation[] = await refresh.json();
        setOrientations(list);
      }
    },
    [orientations, principalOrientation, templateId],
  );

  // Acepta una propuesta del Banner Designer.
  //   - applyToAllLinked = false  → PUT con linked_to_template_id=null.
  //     La propuesta queda solo en esta orientación. Diferenciada del master.
  //   - applyToAllLinked = true   → PUT sin tocar linked_to_template_id.
  //     El backend propaga (reflowed) al master + todas las linked variants
  //     del grupo. Útil cuando la propuesta IA es lo suficientemente buena
  //     como para volverse el nuevo "canónico" del concepto.
  //
  // Después de aplicar: refetch + switch + remount + toast.
  const handleAiAcceptProposal = useCallback(
    async (
      targetId: number,
      definition: TemplateDefinition,
      applyToAllLinked: boolean,
    ) => {
      const body: Record<string, unknown> = { definition };
      if (!applyToAllLinked) {
        body.linked_to_template_id = null;
      }
      const res = await fetch(`/api/production/templates/${targetId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || `No se pudo aplicar la propuesta (HTTP ${res.status})`);
        return false;
      }
      const refresh = await fetch(
        `/api/production/templates/${templateId}/orientations`,
      );
      if (refresh.ok) {
        const list: Orientation[] = await refresh.json();
        setOrientations(list);
      }
      setActiveOrientationId(targetId);
      setEditorRemountKey((k) => k + 1);
      setAiSuccessToast(
        applyToAllLinked
          ? "Propuesta aplicada al master y a todas las variantes linkeadas"
          : "Propuesta aplicada · orientación diferenciada del master",
      );
      window.setTimeout(() => setAiSuccessToast(null), 3500);
      return true;
    },
    [templateId],
  );

  const handleFitModeChange = async (adaptationId: number, fitMode: FitMode) => {
    if (designId == null) return;
    setFitModeError(null);
    setAdaptations((cur) =>
      cur.map((a) => (a.id === adaptationId ? { ...a, fit_mode: fitMode } : a))
    );
    try {
      const res = await fetch(
        `/api/production/designs/${designId}/adaptations/${adaptationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fit_mode: fitMode }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("PATCH fit_mode failed:", res.status, body);
        setFitModeError(
          body?.error || `No se pudo guardar el fit (HTTP ${res.status})`
        );
        fetchAdaptations();
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.adaptation?.fit_mode) {
        const canonical = data.adaptation.fit_mode as FitMode;
        setAdaptations((cur) =>
          cur.map((a) =>
            a.id === adaptationId ? { ...a, fit_mode: canonical } : a
          )
        );
      }
    } catch (err) {
      console.error("PATCH fit_mode network error:", err);
      setFitModeError("Error de red al guardar el fit");
      fetchAdaptations();
    }
  };

  const handleDelete = async (adaptationId: number) => {
    if (designId == null) return;
    if (!confirm("¿Eliminar esta adaptación?")) return;
    setDeletingId(adaptationId);
    try {
      const res = await fetch(
        `/api/production/designs/${designId}/adaptations/${adaptationId}`,
        { method: "DELETE" }
      );
      if (res.ok) fetchAdaptations();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading || sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Template no encontrado</p>
      </div>
    );
  }

  // VariantsStrip compartido entre el editor del master y el del adapt. Los
  // previews superiores muestran SIEMPRE la misma barra (master numerado +
  // variantes), independiente de qué se esté editando. Antes el editor del
  // adapt no recibía topAccessory y caía al PreviewThumbnails default
  // (1:1/9:16/16:9), lo que confundía al productor.
  //
  // onSwitch en modo edit-adapt: salir del modo edit y cambiar de orientación
  // en un solo click. El snapshot se descarta porque el productor está
  // navegando explícitamente fuera de la adaptación.
  const variantsStripNode = (
    <VariantsStrip
      orientations={orientations}
      activeOrientationId={editingId != null ? null : activeOrientationId}
      brandKit={brandKitContent}
      orientationNumberById={orientationNumberById}
      onSwitch={(id) => {
        if (editingId != null) {
          editSnapshotRef.current = null;
          setEditingId(null);
        }
        setActiveOrientationId(id);
      }}
      onAdd={() => setShowAddVariant(true)}
      onDelete={handleDeleteOrientation}
      onDifferentiate={handleDifferentiate}
      onRelinkToMaster={(id) => {
        if (principalOrientation) {
          handleRelinkTo(id, principalOrientation.id);
        }
      }}
      onAiAdapt={(id) => setAiAdaptTargetId(id)}
    />
  );

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/40 shrink-0">
        <div className="px-6 py-3 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              router.push(`/produccion/proyecto/${template.production_project_id}`)
            }
            title="Volver al proyecto"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <Rocket className="h-4 w-4 shrink-0" />
            <span className="font-medium text-foreground">{template.name}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {template.base_width}×{template.base_height}
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span>Producir</span>
          </div>

          <div className="flex-1" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRegenerateThumbnail}
            disabled={!principalOrientation?.definition || thumbnailJob !== null}
            className="gap-1.5 text-muted-foreground"
            title="Regenera la imagen miniatura que muestra el listado del proyecto. Útil tras cambios visuales importantes."
          >
            {thumbnailJob ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {thumbnailJob ? "Generando..." : "Rehacer preview"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/produccion/template/${template.id}`)}
            className="gap-1.5 text-muted-foreground"
            title="Editor del master en pantalla completa (sin grid de adaptaciones)"
          >
            <Pencil className="h-3.5 w-3.5" />
            Pantalla completa
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6 w-full space-y-6">
        {/* Editor embebido — workspace unificado.
            Por defecto edita el master. Click en una adaptación más abajo
            cambia el editor a esa adaptación; el botón "Volver al master"
            arriba del editor regresa al master. */}
        <section
          ref={editorSectionRef}
          className="bg-card rounded-xl border border-border/50 overflow-hidden scroll-mt-4"
        >
          {/* Selector de brand kit base. Lista todos los kits disponibles
              (client-wide + project-scoped del proyecto) y permite cambiar
              el activo. Si el activo es client-wide, el botón ofrece
              "Personalizar para este proyecto" (fork). Si ya es un fork
              project-scoped, el botón ofrece "Editar". */}
          {editingId == null && (
            <BrandKitSelectorBar
              kits={brandKits}
              activeKit={activeBrandKit}
              onSelect={handleSelectBrandKit}
              onPersonalize={async () => {
                const newKitId = await handleForkBrandKit();
                if (newKitId != null) setEditingKitId(newKitId);
              }}
              onEdit={() => {
                if (activeBrandKit) setEditingKitId(activeBrandKit.id);
              }}
              onDelete={handleDeleteActiveBrandKit}
            />
          )}

          <div className="h-[90vh] min-h-[640px] relative">
            {editingId == null && activeOrientation ? (
              <TemplateEditor
                // key incluye la orientación: al cambiar de orientación se
                // desmonta y remonta el editor con la definition correcta.
                // No hay navegación, no recarga — solo el remount React.
                key={`orientation-${activeOrientation.id}-${editorRemountKey}`}
                initial={definition}
                baseWidth={activeOrientation.base_width}
                baseHeight={activeOrientation.base_height}
                onSave={handleSaveMaster}
                brandKit={brandKitContent}
                clientId={clientId}
                projectId={template.production_project_id}
                allBrandKits={brandKits}
                onBrandKitsChange={() => {
                  if (clientId)
                    fetchBrandKits(clientId, template.production_project_id);
                }}
                dataRow={previewRow}
                topAccessory={variantsStripNode}
                rightAccessory={
                  <DatasetPanel
                    detectedVariables={detectedVariables}
                    dataset={dataset}
                    selectedRowIdx={selectedRowIdx}
                    saving={datasetSaving}
                    error={datasetError}
                    fileInputRef={datasetFileInputRef}
                    onUploadClick={() => datasetFileInputRef.current?.click()}
                    onFileChange={(f) => handleUploadCsv(f)}
                    onSelectRow={(i) => setSelectedRowIdx(i)}
                    onClear={handleClearDataset}
                  />
                }
              />
            ) : editingAdaptation && adaptInitialDefinition ? (
              <TemplateEditor
                /* key incluye source.id para forzar remount cuando cambia
                   la orientación de herencia. Sin esto, si orientations se
                   refrescaba mid-edit (ej. autosave del master propagó el
                   reflow a las linked variants), el state interno del editor
                   del adapt quedaba con el initial viejo — useTemplateEditor
                   solo lee initial en el primer mount. */
                key={`adapt-${editingId}-src-${resolveSource(editingAdaptation, orientations)?.id ?? "none"}`}
                initial={adaptInitialDefinition}
                baseWidth={editingAdaptation.width}
                baseHeight={editingAdaptation.height}
                onSave={handleSaveAdapt}
                brandKit={brandKitContent}
                clientId={clientId}
                projectId={template.production_project_id}
                allBrandKits={brandKits}
                onBrandKitsChange={() => {
                  if (clientId)
                    fetchBrandKits(clientId, template.production_project_id);
                }}
                topAccessory={variantsStripNode}
                /* Huincha de edición independiente. Vive dentro del editor,
                   debajo de los PreviewThumbnails de la adaptación. Antes
                   estaba arriba de toda la sección — al moverla acá queda
                   pegada al canvas que está modificando, sin desconectar
                   el aviso del trabajo. Dos acciones:
                     - Cancelar: revierte los auto-saves al snapshot original.
                     - Listo: deja los cambios y vuelve al master. */
                topBanner={
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500 text-black border-b border-amber-600">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium leading-tight">
                        Editando pieza independiente ·{" "}
                        {editingAdaptation.custom_name ||
                          editingAdaptation.preset_name ||
                          `${editingAdaptation.width}×${editingAdaptation.height}`}{" "}
                        ({editingAdaptation.width}×{editingAdaptation.height})
                      </p>
                      <p className="text-[11px] text-black/70 leading-tight mt-0.5">
                        Los cambios solo se reflejan en esta pieza, no en el
                        master ni en otras adaptaciones.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCancelEditAdaptation}
                      className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-white/15 hover:bg-white/25 border border-white/30 transition-colors font-medium"
                      title="Descarta los cambios y vuelve al master"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        editSnapshotRef.current = null;
                      }}
                      className="shrink-0 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded bg-white text-amber-700 hover:bg-amber-50 transition-colors font-medium"
                      title="Guarda los cambios y vuelve al master"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Listo
                    </button>
                  </div>
                }
              />
            ) : null}

            {/* Las acciones de diferenciar / ajustar formato dejaron de ser
                botones flotantes sobre el canvas (el ámbar se perdía contra
                fondos saturados). Ahora viven dentro del mini-preview de cada
                orientación en el VariantsStrip — botón Unlink (linked) o
                Link (diferenciada) on hover. */}
          </div>
        </section>


        {fitModeError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2 flex items-center justify-between">
            <span>{fitModeError}</span>
            <button
              type="button"
              onClick={() => setFitModeError(null)}
              className="text-red-300/80 hover:text-red-300"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Adaptations list */}
        <section className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium">Adaptaciones</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Una pieza de salida por formato. Click en + para agregar.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {adaptationsLoaded && adaptations.length > 0 && (
                <div className="flex items-center rounded-md border border-border/50 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setAdaptationsView("clean")}
                    className={cn(
                      "px-2 py-1 text-xs transition-colors flex items-center gap-1",
                      adaptationsView === "clean"
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                    title="Vista limpia: solo preview + dimensiones, sin filtros ni canales"
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Limpio
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdaptationsView("detailed")}
                    className={cn(
                      "px-2 py-1 text-xs transition-colors flex items-center gap-1 border-l border-border/50",
                      adaptationsView === "detailed"
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted",
                    )}
                    title="Vista detallada: filtros, canales, source badges, controles por pieza"
                  >
                    <LayoutList className="h-3.5 w-3.5" />
                    Detallado
                  </button>
                </div>
              )}
              {adaptationsLoaded && adaptations.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadAll}
                  disabled={!!batchProgress || !!singleDownloadingId}
                  className="gap-1"
                  title={
                    dataset
                      ? `Renderiza ${dataset.rows.length} filas × ${adaptations.length} adaptaciones y descarga ZIP con subcarpetas por fila`
                      : "Renderiza todas las adaptaciones y descarga un ZIP"
                  }
                >
                  {batchProgress ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {batchProgress.current}/{batchProgress.total}
                    </>
                  ) : (
                    <>
                      <Package className="h-4 w-4" />
                      {dataset
                        ? `Descargar ZIP (${dataset.rows.length} × ${adaptations.length})`
                        : "Descargar todas (ZIP)"}
                    </>
                  )}
                </Button>
              )}
              <Button size="sm" onClick={() => setShowPicker(true)} className="gap-1">
                <Plus className="h-4 w-4" /> Agregar adaptación
              </Button>
            </div>
          </div>

          {adaptationCount === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aún no hay adaptaciones. Empieza agregando uno o varios formatos.
            </p>
          ) : !adaptationsLoaded ? (
            // Lazy load: el botón muestra el conteo. Click renderea las
            // cards (cada una hace reflow + token resolve + layer render).
            <div className="flex flex-col items-center py-8 gap-3">
              <p className="text-sm text-muted-foreground">
                Este template tiene{" "}
                <span className="text-foreground font-medium">{adaptationCount}</span>{" "}
                {adaptationCount === 1 ? "adaptación" : "adaptaciones"}.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchAdaptations}
                disabled={adaptationsLoading}
                className="gap-1"
              >
                {adaptationsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                Ver adaptaciones
              </Button>
            </div>
          ) : (
            adaptationsView === "clean" ? (
              <>
                {/* Vista limpia: layout masonry-flex. Cada preview adopta su
                    aspect ratio natural, todas las piezas comparten la misma
                    altura (TARGET_H) y se empaquetan en filas como una pared
                    de imágenes. Sin filtros, sin canales, sin badges, sin
                    cajas — solo preview + medida abajo. Click → edita.
                    Orden propio (cuadrados → verticales → horizontales) que
                    agrupa visualmente formas parecidas. Dentro del bucket
                    horizontal, sort secundario por aspect ratio (w/h) asc:
                    los más cuadraditos primero, los banners ultra chatos
                    (10:1, 8:1) al final — esos quedan capeados por el
                    TARGET_W del preview y tienen menos alto efectivo, así
                    que mandarlos al final evita huecos verticales en las
                    filas anteriores. */}
                <div className="flex flex-wrap items-start gap-3">
                  {groupAdaptationsByChannel(adaptations)
                    .flatMap((g) => g.items)
                    .sort((a, b) => {
                      const order = { square: 0, vertical: 1, horizontal: 2 };
                      const oa = adaptationOrientation(a);
                      const ob = adaptationOrientation(b);
                      if (order[oa] !== order[ob]) return order[oa] - order[ob];
                      // Secundario: aspect ratio ascendente. En horizontales
                      // los más chatos quedan al final; en verticales/cuadrados
                      // no cambia la altura visual pero da un gradiente
                      // estético de ancho dentro del bucket.
                      return (a.width / a.height) - (b.width / b.height);
                    })
                    .map((a) => {
                      const sourceOrientation = resolveSource(a, orientations);
                      const sourceDef = sourceOrientation?.definition ?? definition;
                      return (
                        <MinimalAdaptationCard
                          key={a.id}
                          adaptation={a}
                          definition={sourceDef}
                          brandKit={brandKitContent}
                          dataRow={previewRow}
                          isEditing={editingId === a.id}
                          onEdit={() => handleEditAdaptation(a.id)}
                        />
                      );
                    })}
                </div>
              </>
            ) : (
            <>
              {/* Filtros: visible solo cuando hay 2+ adaptaciones porque con
                  1 sola no sirve filtrar. Compacto, 2 filas: source chips +
                  channels + (búsqueda + solo manual + limpiar). */}
              {adaptations.length >= 2 && (
                <div className="mb-4 p-3 rounded-lg bg-muted/30 border border-border/40 space-y-2">
                  {/* Fila 1: chips de orientación */}
                  {sortedOrientations.length > 1 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-muted-foreground shrink-0 uppercase tracking-wide">
                        Origen
                      </span>
                      {sortedOrientations.map((o) => {
                        const num = orientationNumberById.get(o.id);
                        if (num == null) return null;
                        const badge = orientationBadgeColors(num);
                        const isActive = filterSourceIds.has(o.id);
                        const label = o.id === principalOrientation?.id ? "master" : o.name;
                        return (
                          <button
                            key={o.id}
                            type="button"
                            onClick={() => {
                              setFilterSourceIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(o.id)) next.delete(o.id);
                                else next.add(o.id);
                                return next;
                              });
                            }}
                            className={cn(
                              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors",
                              isActive
                                ? "border-foreground/60 bg-foreground/10 text-foreground"
                                : "border-border/50 bg-card/60 text-muted-foreground hover:text-foreground hover:border-foreground/30"
                            )}
                          >
                            <span
                              className={cn(
                                "h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0",
                                badge.bg,
                              )}
                            >
                              {num}
                            </span>
                            <span className="truncate max-w-[120px]">{label}</span>
                            <span className="text-[10px] text-muted-foreground/70 font-mono">
                              {o.base_width}×{o.base_height}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Fila 2: chips de canal (solo si hay >1) */}
                  {availableChannels.length > 1 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-muted-foreground shrink-0 uppercase tracking-wide">
                        Canal
                      </span>
                      {availableChannels.map((ch) => {
                        const isActive = filterChannels.has(ch);
                        return (
                          <button
                            key={ch}
                            type="button"
                            onClick={() => {
                              setFilterChannels((prev) => {
                                const next = new Set(prev);
                                if (next.has(ch)) next.delete(ch);
                                else next.add(ch);
                                return next;
                              });
                            }}
                            className={cn(
                              "text-xs px-2 py-1 rounded-full border transition-colors",
                              isActive
                                ? "border-foreground/60 bg-foreground/10 text-foreground"
                                : "border-border/50 bg-card/60 text-muted-foreground hover:text-foreground hover:border-foreground/30"
                            )}
                          >
                            {CHANNEL_LABEL[ch] ?? ch}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Fila 3: buscar + solo manual + limpiar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      placeholder="Buscar por nombre o dimensiones…"
                      className="flex-1 min-w-[180px] bg-card/60 border border-border/50 rounded px-2 py-1 text-xs focus:outline-none focus:border-foreground/40"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filterOnlyCustomized}
                        onChange={(e) => setFilterOnlyCustomized(e.target.checked)}
                      />
                      <span>Solo con cambios manuales</span>
                    </label>
                    {anyFilterActive && (
                      <button
                        type="button"
                        onClick={clearAdaptationFilters}
                        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1"
                      >
                        <X className="h-3 w-3" />
                        Limpiar filtros
                      </button>
                    )}
                  </div>

                  {/* Contador "X de Y" si hay filtro activo */}
                  {anyFilterActive && (
                    <p className="text-[11px] text-muted-foreground">
                      Mostrando {filteredAdaptations.length} de {adaptations.length} adaptaciones
                    </p>
                  )}
                </div>
              )}

              {filteredAdaptations.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center flex flex-col items-center gap-2">
                  <p>Ninguna adaptación coincide con los filtros.</p>
                  <button
                    type="button"
                    onClick={clearAdaptationFilters}
                    className="text-xs underline hover:no-underline"
                  >
                    Limpiar filtros
                  </button>
                </div>
              ) : (
            <div className="space-y-5">
              {/* Vista detallada: agrupado por canal, con todos los controles
                  por pieza (source, fit, descarga, delete, manual indicator). */}
              {groupAdaptationsByChannel(filteredAdaptations).map((group) => (
                <div key={group.channel}>
                  <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    {CHANNEL_LABEL[group.channel] ?? group.channel}
                    <span className="text-muted-foreground/60 ml-2 normal-case tracking-normal">
                      ({group.items.length}{" "}
                      {group.items.length === 1 ? "pieza" : "piezas"})
                    </span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {group.items.map((a) => {
                      // Source resolution:
                      //   1. Si la adaptación tiene source_template_id pinned,
                      //      esa orientación es la fuente.
                      //   2. Si NULL, auto-pick por aspect ratio más cercano.
                      // El manual_layout (overrides_json) gana por encima de
                      // todo dentro del renderer de la card.
                      const sourceOrientation = resolveSource(
                        a,
                        orientations,
                      );
                      const sourceDef = sourceOrientation?.definition ?? definition;
                      const sourceBadgeNumber = sourceOrientation
                        ? orientationNumberById.get(sourceOrientation.id) ?? null
                        : null;
                      return (
                        <AdaptationCard
                          key={a.id}
                          adaptation={a}
                          orientations={orientations}
                          principalId={principalOrientation?.id ?? null}
                          sourceOrientation={sourceOrientation}
                          sourceBadgeNumber={sourceBadgeNumber}
                          definition={sourceDef}
                          brandKit={brandKitContent}
                          dataRow={previewRow}
                          isEditing={editingId === a.id}
                          onEdit={() => handleEditAdaptation(a.id)}
                          onDelete={() => handleDelete(a.id)}
                          onFitModeChange={(m) => handleFitModeChange(a.id, m)}
                          onSourceChange={(srcId) => handleSourceChange(a.id, srcId)}
                          onResetOverride={() => handleResetAdaptationOverride(a.id)}
                          onDownload={() => handleDownloadSingle(a)}
                          downloading={singleDownloadingId === a.id}
                          batchInProgress={!!batchProgress}
                          deleting={deletingId === a.id}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
              )}
            </>
            )
          )}
        </section>
      </main>

      {showAddVariant && (
        <AddVariantModal
          existingSizes={designMembers.map((m) => ({
            w: m.base_width,
            h: m.base_height,
          }))}
          onClose={() => setShowAddVariant(false)}
          onAdd={handleAddVariant}
        />
      )}

      {/* Modal de edición de brand kit (fork project-scoped). El productor
          lo dispara con "Editar" o "Personalizar". Al guardar refetchea la
          lista y cierra el modal. */}
      {editingKitId != null && clientId && template && (() => {
        const kit = brandKits.find((k) => k.id === editingKitId);
        if (!kit) return null;
        return (
          <ProjectBrandKitModal
            kit={kit}
            onClose={() => setEditingKitId(null)}
            onSaved={() => {
              if (clientId)
                fetchBrandKits(clientId, template.production_project_id);
            }}
          />
        );
      })()}

      {aiAdaptTargetId != null && (() => {
        const targetOri = orientations.find((o) => o.id === aiAdaptTargetId);
        if (!targetOri || !principalOrientation) return null;
        return (
          <AiAdaptModal
            templateId={Number(templateId)}
            target={targetOri}
            master={principalOrientation}
            brandKit={brandKitContent}
            onClose={() => setAiAdaptTargetId(null)}
            onAccept={async (def, applyToAllLinked) => {
              const ok = await handleAiAcceptProposal(
                targetOri.id,
                def,
                applyToAllLinked,
              );
              if (ok) setAiAdaptTargetId(null);
            }}
          />
        );
      })()}

      {/* Toast efímero de éxito tras aplicar una propuesta IA. Aparece abajo
          al centro durante 3.5s; el clear lo hace handleAiAcceptProposal. */}
      {aiSuccessToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-violet-500 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Check className="h-4 w-4" />
          {aiSuccessToast}
        </div>
      )}

      {showPicker && (
        <PresetPickerModal
          presets={presets}
          existingAdaptations={adaptations}
          onClose={() => setShowPicker(false)}
          onConfirmPresets={handleAddBulk}
          onAddCustom={handleAddCustom}
        />
      )}

      {/* Render off-screen del master para generar el thumbnail persistido
          (lo dispara handleSaveMaster vía thumbnailJob). Capamos el lado
          largo a 800px porque el listado lo muestra a <200px alto, y un
          JPG de 2520×1080 es desperdicio de ancho de banda y bytes en S3. */}
      {thumbnailJob && (() => {
        const THUMB_MAX_SIDE = 800;
        const scale = Math.min(
          1,
          THUMB_MAX_SIDE / Math.max(thumbnailJob.nativeW, thumbnailJob.nativeH),
        );
        return (
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: "-99999px",
              top: 0,
              pointerEvents: "none",
              opacity: 0,
            }}
          >
            <div
              ref={thumbnailCaptureRef}
              style={{
                width: thumbnailJob.nativeW * scale,
                height: thumbnailJob.nativeH * scale,
                overflow: "hidden",
              }}
            >
              <OrientationMiniPreview
                definition={thumbnailJob.def}
                brandKit={brandKitContent}
                nativeW={thumbnailJob.nativeW}
                nativeH={thumbnailJob.nativeH}
                scale={scale}
              />
            </div>
          </div>
        );
      })()}

      {/* Container oculto para renderizar adaptaciones a tamaño nativo durante
          export. Vive fuera del flujo visual; las dimensiones reales del
          renderer escapan por overflow. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          pointerEvents: "none",
          opacity: 0,
        }}
      >
        {currentlyRendering && (() => {
          // El export usa la misma resolución que el preview: source_template_id
          // si está pinned, sino auto-pick por aspect.
          const src = resolveSource(currentlyRendering.adaptation, orientations);
          const srcDef = src?.definition ?? definition;
          return (
            <AdaptationRenderer
              ref={renderRef}
              adaptation={currentlyRendering.adaptation}
              master={srcDef}
              brandKit={brandKitContent}
              dataRow={currentlyRendering.row}
            />
          );
        })()}
      </div>
    </div>
  );
}

// ----- Adaptation card with reflowed mini preview -----

function AdaptationCard({
  adaptation,
  orientations,
  principalId,
  sourceOrientation,
  sourceBadgeNumber,
  definition,
  brandKit,
  dataRow,
  isEditing,
  onEdit,
  onDelete,
  onFitModeChange,
  onSourceChange,
  onResetOverride,
  onDownload,
  downloading,
  batchInProgress,
  deleting,
}: {
  adaptation: Adaptation;
  // Todas las orientaciones del design — necesarias para el dropdown de source.
  orientations: Orientation[];
  // Id del master/principal del design (MIN id). Se muestra como "master" en
  // el dropdown.
  principalId: number | null;
  // La orientación que realmente está alimentando esta adaptación (resuelta
  // antes por resolveSource). Se muestra como label del chip.
  sourceOrientation: Orientation | null;
  // Número del badge (1-indexed) que corresponde a la sourceOrientation. Se
  // pinta como círculo coloreado en la esquina sup-izq de la card para que
  // el productor vea de qué variante hereda sin tener que leer el chip.
  sourceBadgeNumber: number | null;
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  dataRow?: DataRow | null;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onFitModeChange: (m: FitMode) => void;
  // null = volver a auto-pick. number = fijar esa orientación como source.
  onSourceChange: (sourceTemplateId: number | null) => void;
  // Quita el ajuste manual (overrides_json.manual_layout) — la adaptación
  // vuelve a derivar automáticamente del master. Visible solo cuando la
  // adaptación tiene manual_layout.
  onResetOverride: () => void;
  onDownload: () => void;
  downloading: boolean;
  batchInProgress: boolean;
  deleting: boolean;
}) {
  const sourceIsPinned = adaptation.source_template_id != null;
  const sourceLabel = sourceOrientation
    ? sourceOrientation.id === principalId
      ? "master"
      : sourceOrientation.name
    : "—";
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const label =
    adaptation.custom_name ||
    adaptation.preset_name ||
    `${adaptation.width}×${adaptation.height}`;
  const channel =
    adaptation.preset_channel ||
    (adaptation.format_preset_id == null ? "custom" : null);

  // El thumbnail respeta dos límites: alto Y ancho. Antes solo usábamos
  // alto fijo, lo que hacía que banners chatos (8:1, 10:1) generaran un
  // cssW gigante (~1300px) y el flex justify-center del card mostrara el
  // centro del contenido en vez del top-left — el bug de "alto 100% se ve
  // corrido a la derecha".
  const TARGET_H = 160;
  const TARGET_W = 280;
  // Warning si el aspect ratio del adaptación es muy distinto al del master:
  // en ese caso ningún fit automático va a producir un buen resultado y se
  // recomienda ajuste manual.
  const extremeMismatch = hasExtremeAspectMismatch(
    definition.size.w,
    definition.size.h,
    adaptation.width,
    adaptation.height,
  );
  const hasManualOverride = !!parseOverrides(adaptation.overrides_json).manual_layout;

  return (
    <div
      className={cn(
        "bg-muted/50 rounded-lg flex flex-col group border-2 transition-colors overflow-hidden relative",
        isEditing
          ? "border-primary ring-2 ring-primary/40"
          : hasManualOverride
            // Cuando la pieza tiene manual_layout: borde emerald sólido +
            // ring tenue. Se distingue a simple vista en la grilla — el
            // productor ve cuáles están "desconectadas" de su source y ya no
            // siguen al master automáticamente.
            ? "border-emerald-500/70 ring-1 ring-emerald-500/20 hover:border-emerald-400"
            : "border-border/60 hover:border-foreground/30"
      )}
    >
      {/* Esquina superior izquierda: marca visual de "desconectada". Igual
          que el ícono Unlink que usa el strip para orientaciones diferenciadas,
          acá el cable cortado señala que esta adaptación no recibe cambios
          del source automáticamente. El botón X (visible on hover de la card)
          quita el ajuste manual y devuelve la pieza a depender del master. */}
      {hasManualOverride && (
        <div
          className="absolute top-0 left-0 z-10 flex items-stretch text-[10px] font-medium rounded-br-md bg-emerald-500 text-white overflow-hidden shadow-sm"
        >
          <span
            className="flex items-center gap-1 px-1.5 py-0.5"
            title="Esta pieza está desconectada de su source — cambios al master no se propagan acá."
          >
            <Unlink className="h-3 w-3" />
            Independiente
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onResetOverride();
            }}
            className="px-1.5 border-l border-white/30 bg-emerald-600 hover:bg-emerald-700 opacity-0 group-hover:opacity-100 transition-opacity flex items-center"
            title="Quitar ajuste manual y volver a depender del master"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
      {/* Title bar: nombre + dims arriba, siempre visible. El badge del
          source (#N) ahora cuelga en la esquina inf-der del preview, no
          en el título — consistente con el VariantsStrip y deja el título
          más limpio. */}
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between gap-2 min-w-0">
        <div className={cn("flex items-center gap-1.5 min-w-0 flex-1", hasManualOverride && "pl-20")}>
          <p className="text-sm font-medium truncate min-w-0">{label}</p>
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
          {adaptation.width}×{adaptation.height}
        </span>
      </div>
      {/* "Aspect distinto" se mantiene como chip sólido bajo el título.
          "Independiente" se muestra como badge en la esquina superior izq
          (arriba) — no se duplica acá para no saturar visualmente. */}
      {extremeMismatch && !hasManualOverride && (
        <div className="px-3 pb-1.5 flex items-center gap-1.5 flex-wrap">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500 text-white"
            title="Este formato tiene un aspect ratio muy distinto al del master — considera ajustarlo a mano"
          >
            <AlertTriangle className="h-3 w-3" />
            Aspect distinto
          </span>
        </div>
      )}

      {/* Banner area con overlay hover. */}
      <div
        className="relative bg-background/40"
        style={{ minHeight: TARGET_H + 16 }}
      >
        <button
          type="button"
          onClick={onEdit}
          className="flex items-center justify-center w-full h-full hover:bg-background/60 transition-colors"
          style={{ minHeight: TARGET_H + 16 }}
          title={isEditing ? "Esta adaptación está siendo editada" : "Click para editar esta adaptación"}
        >
          <AdaptationPreview
            adaptation={adaptation}
            definition={definition}
            brandKit={brandKit}
            targetH={TARGET_H}
            targetW={TARGET_W}
            dataRow={dataRow}
          />
        </button>

        {/* Badge del source en la esquina inf-der del banner area. Mismo
            número/color que el badge del VariantsStrip — el productor ve
            de un vistazo de qué orientación hereda esta adaptación.
            z-20 para quedar sobre el preview pero debajo del overlay hover
            (z-30+ implícito por orden de pintado). pointer-events-none para
            que no robe clicks del botón "click para editar". */}
        {sourceBadgeNumber != null && (() => {
          const badge = orientationBadgeColors(sourceBadgeNumber);
          const sourceName = sourceOrientation
            ? sourceOrientation.id === principalId
              ? "master"
              : sourceOrientation.name
            : "—";
          return (
            <div
              className={cn(
                "absolute bottom-1.5 right-1.5 z-20 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md ring-2 pointer-events-none",
                badge.bg,
                badge.ring,
              )}
              title={`Hereda del ${sourceName} #${sourceBadgeNumber}`}
            >
              {sourceBadgeNumber}
            </div>
          );
        })()}

        {/* Overlay sobre el banner: badges + canal + controles. Por defecto
            oculto, fade-in al hover. Cuando la card está siendo editada los
            controles quedan visibles permanentemente. */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col justify-between p-2 gap-2",
            "bg-background/85 backdrop-blur-sm transition-opacity",
            isEditing
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
          )}
        >
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="flex flex-col gap-1 min-w-0">
              {channel && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {CHANNEL_LABEL[channel] ?? channel}
                </span>
              )}
              {/* Source chip: muestra de qué orientación se está alimentando
                  la pieza. "auto" cuando se elige por aspect, "fijo" cuando
                  hay source_template_id pinned. Click abre el dropdown para
                  cambiar. Disabled si solo hay 1 orientación (no hay nada
                  que elegir). */}
              {orientations.length >= 1 && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (orientations.length > 1) setShowSourceMenu((v) => !v);
                    }}
                    disabled={orientations.length <= 1}
                    className={cn(
                      "flex items-start gap-1.5 text-[10px] rounded px-1.5 py-0.5 border transition-colors",
                      sourceIsPinned
                        ? "text-blue-200 bg-blue-500/15 border-blue-500/40 hover:bg-blue-500/25"
                        : "text-muted-foreground bg-background/40 border-border/40 hover:bg-background/60",
                      orientations.length <= 1 && "cursor-default opacity-70",
                    )}
                    title={
                      sourceIsPinned
                        ? `Source fijo: ${sourceLabel}`
                        : `Auto-pick: ${sourceLabel}`
                    }
                  >
                    {sourceIsPinned ? (
                      <Link2 className="h-3 w-3 shrink-0 mt-0.5" />
                    ) : (
                      <ChevronDown className="h-3 w-3 shrink-0 mt-0.5" />
                    )}
                    <span>
                      {sourceIsPinned ? "Source: " : "Auto: "}
                      {sourceLabel}
                    </span>
                  </button>
                  {showSourceMenu && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowSourceMenu(false);
                        }}
                        className="fixed inset-0 z-40 cursor-default"
                        aria-label="Cerrar"
                      />
                      <div className="absolute top-full left-0 mt-1 z-50 min-w-[180px] rounded-md bg-popover border border-border shadow-lg overflow-hidden">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowSourceMenu(false);
                            onSourceChange(null);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center justify-between gap-2",
                            !sourceIsPinned && "bg-accent/60",
                          )}
                        >
                          <span>Auto (más cercano)</span>
                          {!sourceIsPinned && <Check className="h-3 w-3" />}
                        </button>
                        <div className="border-t border-border/50" />
                        {orientations.map((o) => {
                          const isPicked = adaptation.source_template_id === o.id;
                          const isMaster = o.id === principalId;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowSourceMenu(false);
                                onSourceChange(o.id);
                              }}
                              className={cn(
                                "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center justify-between gap-2",
                                isPicked && "bg-accent/60",
                              )}
                            >
                              <span className="flex items-center gap-1.5">
                                {isMaster ? "master" : o.name}
                                <span className="text-muted-foreground/70">
                                  {o.base_width}×{o.base_height}
                                </span>
                              </span>
                              {isPicked && <Check className="h-3 w-3" />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
              {/* Los tags "Aspect distinto" y "Ajuste manual" se muestran
                  bajo el título de la card, no acá. Acá solo va el source
                  picker y los controles. */}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hover:bg-red-500/20 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              disabled={deleting}
              title="Eliminar adaptación"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 text-red-400" />
              )}
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={adaptation.fit_mode}
              onChange={(e) => onFitModeChange(e.target.value as FitMode)}
              disabled={hasManualOverride}
              className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-[11px] disabled:opacity-50"
              title={
                hasManualOverride
                  ? "El ajuste manual sobreescribe el fit mode"
                  : FIT_MODE_DESCRIPTION[adaptation.fit_mode]
              }
            >
              {(Object.keys(FIT_MODE_LABEL) as FitMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  Fit: {FIT_MODE_LABEL[mode]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onEdit}
              className={cn(
                "text-[11px] px-2 py-1 rounded border transition-colors flex items-center gap-1",
                isEditing
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border/50 hover:bg-muted hover:border-foreground/30"
              )}
              title="Editar manualmente esta pieza en el editor principal"
            >
              <Pencil className="h-3 w-3" />
              {isEditing ? "Editando" : "Ajustar"}
            </button>
            <button
              type="button"
              onClick={onDownload}
              disabled={downloading || batchInProgress}
              className="text-[11px] px-2 py-1 rounded border border-border/50 hover:bg-muted hover:border-foreground/30 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Descargar como JPG"
            >
              {downloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              JPG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Versión "limpia" de AdaptationCard: literalmente preview + medida y nada
// más. Sin caja, sin borde, sin título, sin canal, sin source picker. El
// productor ve el mosaico de piezas como si fuera una galería de imágenes.
// Click sobre el preview → entra a editar esa pieza. Cuando está siendo
// editada se marca con un ring sutil sobre el propio preview.
function MinimalAdaptationCard({
  adaptation,
  definition,
  brandKit,
  dataRow,
  isEditing,
  onEdit,
}: {
  adaptation: Adaptation;
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  dataRow?: DataRow | null;
  isEditing: boolean;
  onEdit: () => void;
}) {
  // Altura compartida → todas las piezas se alinean horizontalmente como
  // una pared. El ancho es libre (targetW alto) para que cada preview tome
  // su aspect ratio natural; banners ultra anchos (10:1+) quedan capeados
  // pero no se descuadran. La medida va debajo del preview en typo mono.
  const TARGET_H = 140;
  const TARGET_W = 480;
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onEdit}
        title={isEditing ? "Esta adaptación está siendo editada" : "Click para editar esta adaptación"}
        className={cn(
          "transition-shadow rounded-sm",
          isEditing && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
        )}
      >
        <AdaptationPreview
          adaptation={adaptation}
          definition={definition}
          brandKit={brandKit}
          targetH={TARGET_H}
          targetW={TARGET_W}
          dataRow={dataRow}
        />
      </button>
      <span className="text-[10px] text-muted-foreground font-mono">
        {adaptation.width}×{adaptation.height}
      </span>
    </div>
  );
}

// Renders an adaptation at thumbnail size honoring its fit_mode. The
// thumbnail fits within a box (targetW × targetH) preserving aspect ratio —
// usar solo targetH dejaba banners chatos con cssW gigante que el flex
// parent recortaba mostrando el centro en vez del top-left.
function AdaptationPreview({
  adaptation,
  definition,
  brandKit,
  targetH,
  targetW,
  dataRow,
}: {
  adaptation: Adaptation;
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  targetH: number;
  targetW: number;
  // Si hay fila activa del dataset, sus valores reemplazan las variables
  // {{var}} tanto del master como del manual_layout antes de renderizar.
  dataRow?: DataRow | null;
}) {
  const adaptW = adaptation.width;
  const adaptH = adaptation.height;
  const thumbScale = Math.min(targetH / adaptH, targetW / adaptW);
  const cssW = adaptW * thumbScale;
  const cssH = adaptH * thumbScale;

  // Aplicamos la sustitución en un solo lugar — el master que llega como
  // prop podría no estar sustituido (el caller pasa el master crudo y nos
  // delega el binding) y el manual_layout siempre se lee del adaptation
  // crudo, así que se sustituye acá también.
  const effectiveMaster = dataRow ? substituteVariables(definition, dataRow) : definition;
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
      transform: `scale(${thumbScale})`,
      transformOrigin: "0 0",
      position: "relative",
      ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
    };
    return (
      <div
        className="overflow-hidden rounded shadow-sm border border-border/30"
        style={{ width: cssW, height: cssH, background: bg }}
      >
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
      transform: `scale(${thumbScale})`,
      transformOrigin: "0 0",
      position: "relative",
      ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
    };
    return (
      <div
        className="overflow-hidden rounded shadow-sm border border-border/30"
        style={{ width: cssW, height: cssH, background: bg }}
      >
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

  // Scale-based fit modes: render the master at its native size with a
  // uniform scale and position it inside the adaptation canvas. The
  // adaptation canvas does the clipping via overflow:hidden.
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
      // height anchored top, may overflow bottom
      break;
    case "height":
      fitScale = ratioH;
      // width anchored left, may overflow right
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

  // Outer takes the thumbnail size; transform scales the inner adapt-canvas
  // by thumbScale so the inner pixel math stays in adaptation coordinates.
  return (
    <div
      className="overflow-hidden rounded shadow-sm border border-border/30 relative"
      style={{
        width: cssW,
        height: cssH,
        background: masterBg,
      }}
    >
      <div
        style={{
          width: adaptW,
          height: adaptH,
          transform: `scale(${thumbScale})`,
          transformOrigin: "0 0",
          position: "relative",
          overflow: "hidden",
        }}
      >
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
    </div>
  );
}

// ----- Preset picker modal -----

function PresetPickerModal({
  presets,
  existingAdaptations,
  onClose,
  onConfirmPresets,
  onAddCustom,
}: {
  presets: FormatPreset[];
  existingAdaptations: Adaptation[];
  onClose: () => void;
  // Bulk add — el design entero recibe las nuevas adaptaciones y el renderer
  // se encarga de elegir orientación. Antes había un autoDistribute toggle
  // para repartir manualmente entre templates, pero con el nuevo modelo
  // (adaptaciones por design + source_template_id) eso ya no aplica.
  onConfirmPresets: (presetIds: number[]) => void;
  onAddCustom: (name: string, w: number, h: number) => void;
}) {
  const usedPresetIds = useMemo(
    () =>
      new Set(
        existingAdaptations
          .map((a) => a.format_preset_id)
          .filter((x): x is number => x != null)
      ),
    [existingAdaptations]
  );

  const channelsInOrder = useMemo(() => {
    const present = new Set(presets.map((p) => p.channel));
    const known = CHANNEL_ORDER.filter((c) => present.has(c));
    const extras = Array.from(present).filter((c) => !CHANNEL_ORDER.includes(c));
    return [...known, ...extras];
  }, [presets]);

  const [activeChannel, setActiveChannel] = useState<string>(
    channelsInOrder[0] ?? "custom"
  );
  // Selection persists across channel switches so the user can pick items
  // from several channels before confirming.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group presets in the active channel by group_name.
  const channelPresets = presets.filter((p) => p.channel === activeChannel);
  const groups = useMemo(() => {
    const map = new Map<string, FormatPreset[]>();
    for (const p of channelPresets) {
      const key = p.group_name ?? "";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
  }, [channelPresets]);

  // Presets in the current channel that are eligible to be selected via
  // "Seleccionar todos" — i.e. not already added and not already selected.
  const selectableInChannel = useMemo(
    () => channelPresets.filter((p) => !usedPresetIds.has(p.id)),
    [channelPresets, usedPresetIds]
  );
  const allChannelSelected =
    selectableInChannel.length > 0 &&
    selectableInChannel.every((p) => selected.has(p.id));

  const handleSelectAllChannel = () => {
    setSelected((cur) => {
      const next = new Set(cur);
      // Toggle: if all are already selected, clear them; otherwise add all.
      if (allChannelSelected) {
        for (const p of selectableInChannel) next.delete(p.id);
      } else {
        for (const p of selectableInChannel) next.add(p.id);
      }
      return next;
    });
  };

  // Custom form state
  const [customName, setCustomName] = useState("");
  const [customW, setCustomW] = useState("1080");
  const [customH, setCustomH] = useState("1080");

  const selectedCount = selected.size;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold">Agregar adaptaciones</h2>
            <p className="text-xs text-muted-foreground">
              Elegí uno o varios formatos del catálogo (podés seleccionar de
              distintos canales) o creá uno personalizado.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Channel sidebar */}
          <aside className="w-44 shrink-0 border-r border-border/50 p-2 overflow-y-auto">
            {channelsInOrder.map((c) => {
              const countInChannel = presets.filter(
                (p) => p.channel === c && selected.has(p.id)
              ).length;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setActiveChannel(c)}
                  className={cn(
                    "w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors flex items-center justify-between gap-2",
                    activeChannel === c
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span className="truncate">{CHANNEL_LABEL[c] ?? c}</span>
                  {countInChannel > 0 && (
                    <span className="text-[10px] bg-primary/20 text-foreground rounded-full px-1.5 py-0.5 shrink-0">
                      {countInChannel}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setActiveChannel("custom")}
              className={cn(
                "w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors mt-1 border-t border-border/30 pt-2",
                activeChannel === "custom"
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {CHANNEL_LABEL.custom}
            </button>
          </aside>

          {/* Presets grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeChannel === "custom" ? (
              <div className="max-w-md space-y-3">
                <p className="text-xs text-muted-foreground">
                  Definí un tamaño que no está en el catálogo. Se agrega al
                  instante (no requiere confirmar selección).
                </p>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Nombre (ej: Header sitio cliente)"
                  className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-1">
                      Ancho (px)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-1">
                      Alto (px)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => {
                      const w = Number(customW);
                      const h = Number(customH);
                      if (
                        !customName.trim() ||
                        !Number.isFinite(w) ||
                        !Number.isFinite(h) ||
                        w <= 0 ||
                        h <= 0
                      )
                        return;
                      onAddCustom(customName.trim(), w, h);
                    }}
                    disabled={!customName.trim()}
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" /> Agregar
                  </Button>
                </div>
              </div>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Sin formatos para este canal.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {selectableInChannel.length} formato
                    {selectableInChannel.length === 1 ? "" : "s"} disponible
                    {selectableInChannel.length === 1 ? "" : "s"}
                    {" en "}
                    {CHANNEL_LABEL[activeChannel] ?? activeChannel}
                  </p>
                  {selectableInChannel.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-7"
                      onClick={handleSelectAllChannel}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      {allChannelSelected
                        ? "Quitar selección"
                        : "Seleccionar todos"}
                    </Button>
                  )}
                </div>
                {groups.map((g) => (
                  <div key={g.name}>
                    {g.name && (
                      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                        {g.name}
                      </h4>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {g.items.map((p) => {
                        const used = usedPresetIds.has(p.id);
                        const isSelected = selected.has(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => !used && toggle(p.id)}
                            disabled={used}
                            className={cn(
                              "border rounded-md p-2 text-left transition-colors relative",
                              used
                                ? "border-border/30 opacity-50 cursor-not-allowed"
                                : isSelected
                                ? "border-primary bg-primary/10"
                                : "border-border/50 hover:bg-muted hover:border-foreground/30"
                            )}
                            title={used ? "Ya agregado" : `${p.width}×${p.height}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <PresetShape
                                w={p.width}
                                h={p.height}
                                orientation={p.orientation}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">
                                  {p.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {p.width}×{p.height}
                                </p>
                              </div>
                              {used ? (
                                <span className="text-[9px] text-muted-foreground">
                                  Agregado
                                </span>
                              ) : isSelected ? (
                                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Confirm bar */}
        {activeChannel !== "custom" && (
          <div className="flex flex-col gap-2 px-5 py-3 border-t border-border/50 bg-muted/20">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {selectedCount === 0
                  ? "Ningún formato seleccionado"
                  : `${selectedCount} formato${selectedCount === 1 ? "" : "s"} listo${selectedCount === 1 ? "" : "s"} para agregar`}
              </p>
              <div className="flex items-center gap-2">
                {selectedCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                  >
                    Limpiar
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={selectedCount === 0}
                  onClick={() => onConfirmPresets(Array.from(selected))}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" />
                  Agregar
                  {selectedCount > 0 ? ` (${selectedCount})` : ""}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PresetShape({
  w,
  h,
  orientation,
}: {
  w: number;
  h: number;
  orientation: "horizontal" | "vertical" | "square";
}) {
  // Stylized small shape that hints at the aspect ratio.
  const max = 24;
  const ratio = w / h;
  const dispW = ratio >= 1 ? max : max * ratio;
  const dispH = ratio >= 1 ? max / ratio : max;
  return (
    <div
      className={cn(
        "border rounded-sm shrink-0",
        orientation === "square"
          ? "border-blue-400/60"
          : orientation === "horizontal"
          ? "border-emerald-400/60"
          : "border-purple-400/60"
      )}
      style={{ width: Math.max(8, dispW), height: Math.max(8, dispH) }}
    />
  );
}

function noop() {}

// BrandKitSelectorBar: barra arriba del editor con dropdown de brand kits
// disponibles + acción de editar/personalizar. Reemplaza al cascade default
// implícito que existía antes — ahora el productor elige el kit base de
// forma explícita y los forks project-scoped se acumulan en la lista.
function BrandKitSelectorBar({
  kits,
  activeKit,
  onSelect,
  onPersonalize,
  onEdit,
  onDelete,
}: {
  kits: BrandKit[];
  activeKit: BrandKit | null;
  onSelect: (kitId: number | null) => void;
  // Forkea el kit cliente-wide activo y abre el editor sobre el fork.
  // Solo se invoca cuando el activo es cliente-wide.
  onPersonalize: () => void;
  // Abre el editor sobre el activo (que ya debe ser project-scoped).
  onEdit: () => void;
  // Soft-delete del kit activo. Solo aplica a project-scoped forks.
  onDelete: () => void;
}) {
  const isClientWide = activeKit?.production_project_id == null;
  const activeIsProjectScoped = !!activeKit && activeKit.production_project_id != null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-muted/20 text-xs">
      {/* Acciones a la izquierda; label + select + badge alineados a la
          derecha. El spacer flex-1 va ANTES del label para empujarlos. */}
      {activeIsProjectScoped && (
        <>
          <button
            type="button"
            onClick={onEdit}
            className="flex items-center gap-1 px-2 py-1 rounded border border-border/50 hover:bg-muted hover:border-foreground/40 transition-colors text-foreground"
            title="Editar tokens del kit del proyecto"
          >
            <Pencil className="h-3 w-3" />
            Editar
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
            title="Eliminar este brand kit del proyecto (soft-delete; el admin puede reactivarlo desde el dashboard)"
          >
            <Trash2 className="h-3 w-3" />
            Eliminar
          </button>
        </>
      )}
      <div className="flex-1" />
      <span className="text-muted-foreground shrink-0">Brand kit base:</span>
      <select
        value={activeKit?.id ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onSelect(v === "" ? null : Number(v));
        }}
        className="bg-muted border border-border/50 rounded px-2 py-1 text-xs min-w-0 max-w-xs"
        title="Elegí qué brand kit alimenta tokens al editor en este template"
      >
        <option value="">— sin brand kit —</option>
        {/* Agrupamos por scope para que el productor distinga visualmente */}
        <optgroup label="Cliente">
          {kits
            .filter((k) => k.production_project_id == null)
            .map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
                {k.is_default ? " · default" : ""}
              </option>
            ))}
        </optgroup>
        <optgroup label="Proyecto (forks)">
          {kits
            .filter((k) => k.production_project_id != null)
            .map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
        </optgroup>
      </select>
      {activeKit && (
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0",
            isClientWide
              ? "bg-blue-500/15 text-blue-300 border border-blue-500/30"
              : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
          )}
          title={
            isClientWide
              ? "Este kit pertenece al cliente y se comparte con todos sus proyectos."
              : "Este kit es un fork específico de este proyecto; editarlo no afecta al original."
          }
        >
          {isClientWide ? "cliente" : "proyecto"}
        </span>
      )}
      {isClientWide && activeKit && (
        <button
          type="button"
          onClick={onPersonalize}
          className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors"
          title="Crea una copia editable de este kit, scoped a este proyecto. El original no se modifica."
        >
          <Pencil className="h-3 w-3" />
          Personalizar para este proyecto
        </button>
      )}
    </div>
  );
}

// VariantsStrip: barra horizontal con TODAS las orientaciones del master,
// incluyendo la que está abierta en el editor (marcada con border primary).
// Click cambia la orientación activa SIN navegar. La PRINCIPAL (MIN id)
// se etiqueta "master" independientemente de su DB name y no se puede
// borrar — todas las demás tienen botón delete on hover. Cada mini-card
// renderiza el CONTENIDO real de la orientación (no un icono placeholder).
function VariantsStrip({
  orientations,
  activeOrientationId,
  brandKit,
  orientationNumberById,
  onSwitch,
  onAdd,
  onDelete,
  onDifferentiate,
  onRelinkToMaster,
  onAiAdapt,
}: {
  orientations: Orientation[];
  activeOrientationId: number | null;
  brandKit: BrandKitContent;
  // Map orientationId → número 1-indexed (master = #1). Lo provee el page
  // para que el badge calce con el de AdaptationCard.
  orientationNumberById: Map<number, number>;
  onSwitch: (id: number) => void;
  onAdd: () => void;
  onDelete: (id: number) => void;
  onDifferentiate: (id: number) => void;
  onRelinkToMaster: (id: number) => void;
  // Abre el modal del Banner Designer para esa orientación. El handler vive en
  // el padre porque maneja state (proposal, loading, errores, persistencia).
  onAiAdapt: (id: number) => void;
}) {
  // Identificamos la principal por MIN id.
  const principalId =
    orientations.length > 0
      ? orientations.reduce((min, o) => (o.id < min ? o.id : min), orientations[0].id)
      : null;
  // Orden visual: master SIEMPRE primero (es la fuente del grupo), después
  // las demás agrupadas por orientación (horizontal → cuadrado → vertical →
  // custom) y dentro de cada grupo por área. Antes el master quedaba mezclado
  // entre las variantes según su aspect, lo que costaba ubicarlo.
  const designMembers = useMemo(() => {
    return [...orientations].sort((a, b) => {
      if (a.id === principalId) return -1;
      if (b.id === principalId) return 1;
      const orient = (w: number, h: number) => {
        const r = w / h;
        if (Math.abs(r - 1) < 0.05) return 1;
        return r > 1 ? 0 : 2;
      };
      const ao = orient(a.base_width, a.base_height);
      const bo = orient(b.base_width, b.base_height);
      if (ao !== bo) return ao - bo;
      return a.base_width * a.base_height - b.base_width * b.base_height;
    });
  }, [orientations, principalId]);
  // Una sola orientación: la strip queda discreta con solo el botón "+ Formato".
  if (designMembers.length <= 1) {
    return (
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-border/30 bg-muted/10">
        <button
          type="button"
          onClick={onAdd}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded border border-dashed border-border/40 hover:border-foreground/40 transition-colors"
          title="Agregar otra orientación al master"
        >
          <Plus className="h-3 w-3" />
          Formato
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2 px-3 py-2 border-b border-border/30 bg-muted/10 overflow-x-auto">
      {designMembers.map((m) => {
        const isPrincipal = m.id === principalId;
        const isCurrent = m.id === activeOrientationId;
        // El nombre del principal se fuerza a "master" — el nombre que tipea
        // el productor al crear el template no se muestra acá; ese vive en
        // el header de la página como concepto.
        const displayName = isPrincipal ? "master" : m.name;
        const thumbMaxW = 100;
        const thumbMaxH = 80;
        const thumbScale = Math.min(
          thumbMaxW / m.base_width,
          thumbMaxH / m.base_height,
        );
        const cssW = m.base_width * thumbScale;
        const cssH = m.base_height * thumbScale;
        const num = orientationNumberById.get(m.id);
        const badge = num != null ? orientationBadgeColors(num) : null;
        return (
          <div key={m.id} className="relative shrink-0 group">
            <button
              type="button"
              onClick={() => onSwitch(m.id)}
              disabled={isCurrent}
              className={cn(
                "flex flex-col items-center gap-1 focus:outline-none",
                isCurrent && "cursor-default"
              )}
              title={
                isCurrent
                  ? `${displayName} #${num ?? "?"} · orientación abierta`
                  : `${displayName} #${num ?? "?"} · ${m.base_width}×${m.base_height} — click para abrir`
              }
            >
              {/* Wrapper relativo del tamaño exacto del preview: el badge
                  va acá como sibling para poder colgar afuera (-bottom/-right
                  con overflow visible). Antes vivía dentro del recuadro
                  bordeado, que tiene overflow-hidden para clipear el mini
                  render, y eso impedía empujarlo más allá de la esquina. */}
              <div className="relative" style={{ width: cssW, height: cssH }}>
                <div
                  className={cn(
                    "relative rounded shadow-sm transition-colors overflow-hidden w-full h-full",
                    isCurrent
                      ? "border-2 border-primary ring-2 ring-primary/30"
                      : "border border-border/50 hover:border-foreground/40"
                  )}
                >
                  {/* Mini-preview real: renderizamos la definition de la
                      orientación a escala. El productor ve el contenido
                      actual (logo / textos / shapes) en miniatura, no un
                      placeholder. */}
                  {m.definition ? (
                    <OrientationMiniPreview
                      definition={m.definition}
                      brandKit={brandKit}
                      nativeW={m.base_width}
                      nativeH={m.base_height}
                      scale={thumbScale}
                    />
                  ) : null}
                </div>
                {/* Badge numérico: identifica visualmente la orientación.
                    El mismo número (y color) aparece en cada AdaptationCard
                    cuyo source es esta orientación. Cuelga fuera del
                    recuadro en la esquina inf-der como un notification
                    badge — no tapa el contenido del mini-preview. */}
                {badge && num != null && (
                  <div
                    className={cn(
                      "absolute -bottom-1.5 -right-1.5 z-10 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md ring-2",
                      badge.bg,
                      badge.ring,
                    )}
                    style={{ pointerEvents: "none" }}
                  >
                    {num}
                  </div>
                )}
              </div>
              <span
                className={cn(
                  "text-xs flex items-center gap-1 font-medium",
                  isCurrent ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {displayName}
                {/* Marca "diferenciada": orientación que NO es la principal
                    y NO está vinculada al master. Sus cambios viven aisladas.
                    Las linked al master no muestran nada — ese es el estado
                    por defecto. */}
                {!isPrincipal && m.linked_to_template_id == null && (
                  <span
                    className="text-amber-400"
                    title="Diferenciada del resto · no recibe cambios del master"
                  >
                    <Unlink className="h-3 w-3" />
                  </span>
                )}
              </span>
              <span className="text-[10px] text-muted-foreground/70">
                {m.base_width}×{m.base_height}
              </span>
            </button>
            {/* Banner Designer (IA): botón explícito + siempre visible bajo
                cada variante no-principal. Llama al agente que reorganiza el
                contenido del master para este aspect — distinto del reflow,
                puede mover capas, no solo escalar. El master no se adapta a
                sí mismo, por eso no aparece ahí. */}
            {!isPrincipal && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAiAdapt(m.id);
                }}
                className="mt-1 w-full flex items-center justify-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 hover:border-violet-500/60 transition-colors"
                title="Pide al Banner Designer (IA) que reorganice el contenido para este formato"
              >
                <Sparkles className="h-3 w-3" />
                Adaptar con IA
              </button>
            )}
            {/* Acciones de sync — solo en orientaciones no-principal:
                  Linked al master:  Unlink (ámbar)  → diferenciar
                  Diferenciada:      Link  (azul)    → re-link al master
                Ambas piden confirm en el handler del padre. Visibles on hover
                como el delete X, pero en la esquina superior izquierda para
                no chocar. La principal no se puede diferenciar — siempre es
                la fuente del grupo. */}
            {!isPrincipal && m.linked_to_template_id != null && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDifferentiate(m.id);
                }}
                className="absolute -top-1 -left-1 h-5 w-5 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="Diferenciar esta orientación del resto"
              >
                <Unlink className="h-3 w-3" />
              </button>
            )}
            {!isPrincipal && m.linked_to_template_id == null && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRelinkToMaster(m.id);
                }}
                className="absolute -top-1 -left-1 h-5 w-5 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="Re-vincular al master (reemplaza el contenido por el del master reflowed)"
              >
                <Link2 className="h-3 w-3" />
              </button>
            )}
            {/* Borrar variante: solo visible al hover y solo cuando NO es la
                principal. La principal es el master y no se elimina desde
                acá (se elimina el template entero desde el listado). */}
            {!isPrincipal && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(m.id);
                }}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="Eliminar esta orientación"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="text-xs text-muted-foreground hover:text-foreground flex flex-col items-center justify-center gap-1 px-3 py-2 rounded border border-dashed border-border/40 hover:border-foreground/40 transition-colors shrink-0 self-stretch min-h-[100px]"
        title="Agregar otra orientación al master"
      >
        <Plus className="h-4 w-4" />
        <span>Formato</span>
      </button>
    </div>
  );
}

// Modal para agregar una variante al master. El productor elige preset
// (cuadrado / vertical / horizontal) o tamaño custom. La variante se crea
// linked al master actual.
function AddVariantModal({
  existingSizes,
  onClose,
  onAdd,
}: {
  existingSizes: { w: number; h: number }[];
  onClose: () => void;
  onAdd: (w: number, h: number, name?: string) => Promise<void>;
}) {
  const PRESETS = [
    { label: "Cuadrado", w: 1080, h: 1080, ratio: "1:1" },
    { label: "Vertical", w: 1080, h: 1920, ratio: "9:16" },
    { label: "Vertical 4:5", w: 1080, h: 1350, ratio: "4:5" },
    { label: "Horizontal", w: 1920, h: 1080, ratio: "16:9" },
  ];
  // Bloqueamos presets cuya aspect ratio ya existe en el design — no tiene
  // sentido tener dos variantes "Horizontal" del mismo master. Para custom
  // permitimos cualquier W/H aunque coincida, porque podrían ser tamaños
  // distintos del mismo ratio (ej. 1920×1080 y 1280×720).
  const existingRatios = existingSizes.map((s) => s.w / s.h);
  const isPresetTaken = (presetW: number, presetH: number) => {
    const r = presetW / presetH;
    return existingRatios.some((er) => Math.abs(er - r) < 0.02);
  };

  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [w, setW] = useState("1080");
  const [h, setH] = useState("1080");
  const [submitting, setSubmitting] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const submit = async (width: number, height: number) => {
    // Para custom validamos que no exista exactamente esa dimensión.
    if (existingSizes.some((s) => s.w === width && s.h === height)) {
      setCustomError("Ya existe una variante con esas dimensiones exactas.");
      return;
    }
    setCustomError(null);
    setSubmitting(true);
    try {
      await onAdd(width, height);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Agregar formato al master</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Hereda del master actual. Después puedes marcarla distinta para
              tener un layout independiente.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("preset")}
            className={cn(
              "flex-1 text-xs py-1.5 rounded border",
              mode === "preset"
                ? "border-primary bg-primary/10"
                : "border-border/50 hover:bg-muted"
            )}
          >
            Preset
          </button>
          <button
            type="button"
            onClick={() => setMode("custom")}
            className={cn(
              "flex-1 text-xs py-1.5 rounded border",
              mode === "custom"
                ? "border-primary bg-primary/10"
                : "border-border/50 hover:bg-muted"
            )}
          >
            Personalizado
          </button>
        </div>

        {mode === "preset" ? (
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => {
              const taken = isPresetTaken(p.w, p.h);
              return (
                <button
                  key={p.label}
                  type="button"
                  disabled={submitting || taken}
                  onClick={() => submit(p.w, p.h)}
                  className={cn(
                    "border rounded-md p-3 text-left transition-colors",
                    taken
                      ? "border-border/30 bg-muted/20 cursor-not-allowed opacity-60"
                      : "border-border/50 hover:bg-muted hover:border-foreground/30",
                    submitting && "opacity-50"
                  )}
                  title={taken ? "Ya existe una variante con este aspect ratio" : ""}
                >
                  <div className="text-sm font-medium flex items-center justify-between gap-2">
                    {p.label}
                    {taken && (
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                        ya existe
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {p.ratio} · {p.w}×{p.h}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">
                  Ancho (px)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={w}
                  onChange={(e) => setW(e.target.value)}
                  className="w-full bg-muted border border-border/50 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground block mb-1">
                  Alto (px)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={h}
                  onChange={(e) => setH(e.target.value)}
                  className="w-full bg-muted border border-border/50 rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            {customError && (
              <p className="text-xs text-red-400">{customError}</p>
            )}
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={submitting}
                onClick={() => {
                  const ww = Number(w);
                  const hh = Number(h);
                  if (!Number.isFinite(ww) || !Number.isFinite(hh) || ww <= 0 || hh <= 0) return;
                  submit(ww, hh);
                }}
                className="gap-1"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Agregar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Modal del Banner Designer: invoca al agente de practicante para que adapte
// el master a la dimensión de la orientación target, muestra preview side-by-side
// y permite aceptar / regenerar / cancelar. La propuesta aceptada se aplica
// vía PUT al template (con linked_to_template_id=null porque deja de heredar
// del master — el contenido es distinto intencionalmente).
function AiAdaptModal({
  templateId,
  target,
  master,
  brandKit,
  onClose,
  onAccept,
}: {
  templateId: number;
  target: Orientation;
  master: Orientation;
  brandKit: BrandKitContent;
  onClose: () => void;
  // applyToAllLinked: true cuando el productor elige "aplicar al master y
  // todas las linkeadas"; false cuando opta por "solo este formato"
  // (diferenciar).
  onAccept: (def: TemplateDefinition, applyToAllLinked: boolean) => Promise<void>;
}) {
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<TemplateDefinition | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [accepting, setAccepting] = useState(false);
  // Referencia visual del master para input multi-modal al agente. Se captura
  // del DOM render oculto (abajo) y se sube a GCS vía /api/production/upload.
  // Cuando referenceUrl está set, se pasa en `files` a la siguiente llamada.
  // Si la captura/upload falla, seguimos sin imagen (degradación gracil).
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [capturePhase, setCapturePhase] = useState<"pending" | "done">("pending");
  const captureWrapRef = useRef<HTMLDivElement | null>(null);

  const targetDef =
    target.definition && target.definition.type === "frame" ? target.definition : null;
  const masterDef =
    master.definition && master.definition.type === "frame" ? master.definition : null;

  // Escala de captura: cap a 1280px en el lado largo para no mandar imágenes
  // enormes (cost + latencia + límites de vision API).
  const CAPTURE_MAX_SIDE = 1280;
  const captureScale = Math.min(
    1,
    CAPTURE_MAX_SIDE / Math.max(master.base_width, master.base_height),
  );

  // Captura el master renderizado, sube a GCS, guarda la URL. Best-effort:
  // si algo falla, seguimos al callAgent sin imagen.
  const captureAndUpload = useCallback(async () => {
    const node = captureWrapRef.current;
    if (!node) {
      setCapturePhase("done");
      return;
    }
    try {
      // Esperamos un tick a que el DOM termine de pintar el preview.
      await new Promise((r) => setTimeout(r, 80));
      const blob = await captureNodeToJpeg(node);
      const dataUri: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("FileReader falló"));
        reader.readAsDataURL(blob);
      });
      const upRes = await fetch("/api/production/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: dataUri }),
      });
      if (upRes.ok) {
        const body = await upRes.json();
        if (typeof body.url === "string") {
          setReferenceUrl(body.url);
        }
      } else {
        console.warn("Upload de referencia visual falló:", upRes.status);
      }
    } catch (e) {
      console.warn("Captura/upload del master falló:", (e as Error).message);
    } finally {
      setCapturePhase("done");
    }
  }, []);

  const callAgent = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProposal(null);
    setRationale(null);
    try {
      const filesParam =
        referenceUrl != null
          ? [
              {
                filename: "master-reference.jpg",
                publicUrl: referenceUrl,
                mimeType: "image/jpeg",
              },
            ]
          : undefined;
      const res = await fetch(
        `/api/production/templates/${target.id}/ai/adapt-orientation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instructions: instructions.trim() || undefined,
            files: filesParam,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Error ${res.status} del Banner Designer`);
        return;
      }
      setProposal(body.proposal as TemplateDefinition);
      setRationale(typeof body.rationale === "string" ? body.rationale : null);
      setCost(
        typeof body.tokenUsage?.estimatedCost === "number"
          ? body.tokenUsage.estimatedCost
          : null,
      );
    } catch (e) {
      setError(`Error de red: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [target.id, instructions, referenceUrl]);

  // Captura + upload del master ocurre en background al abrir el modal —
  // el productor puede ir escribiendo instructions mientras tanto. La
  // llamada al agente NO se dispara automáticamente: requiere click en
  // "Generar" para que el productor tenga oportunidad de afinar el prompt.
  // Si el productor genera antes de que termine el capture, igual se dispara
  // sin imagen de referencia (la imagen llega en la próxima invocación si
  // captura terminó para entonces).
  useEffect(() => {
    captureAndUpload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master.id]);

  // ¿La orientación target está linkeada al master? Determina si la modal
  // ofrece la elección "solo este formato vs. también al master" o si va
  // directo (diferenciada → no hay master con quien compartir).
  const targetIsLinked = target.linked_to_template_id != null;

  const handleAccept = async (applyToAllLinked: boolean) => {
    if (!proposal) return;
    setAccepting(true);
    try {
      await onAccept(proposal, applyToAllLinked);
    } finally {
      setAccepting(false);
    }
  };

  // Escala para el preview side-by-side: cada lado ocupa ~50% del ancho del
  // modal. Calculamos el alto manteniendo aspect.
  const previewMaxW = 360;
  const previewMaxH = 320;
  const previewScale = Math.min(
    previewMaxW / target.base_width,
    previewMaxH / target.base_height,
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading && !accepting) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <div>
              <h2 className="text-sm font-semibold">Adaptar con Banner Designer</h2>
              <p className="text-xs text-muted-foreground">
                {target.name} · {target.base_width}×{target.base_height} ·
                derivado de master {master.base_width}×{master.base_height}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={loading || accepting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Instrucciones (opcional)
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Ej: mantén el badge de descuento bien visible; el headline debe estar arriba en este formato"
              rows={2}
              disabled={loading || accepting}
              className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>

          {/* Capture/upload del master ocurre en background. Hint inline
              discreto debajo del textarea para que el productor sepa que
              la referencia visual se está preparando, sin bloquear la UI. */}
          {!proposal && !loading && (
            <p className="text-[10px] text-muted-foreground/80 flex items-center gap-1.5">
              {capturePhase === "pending" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
                  Preparando referencia visual del master en segundo plano…
                </>
              ) : referenceUrl ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  Referencia visual lista. Pulsa Generar para pedirle al
                  Banner Designer una propuesta.
                </>
              ) : (
                <span>
                  Pulsa Generar para pedirle al Banner Designer una
                  propuesta (sin imagen de referencia).
                </span>
              )}
            </p>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
              <span>
                Pidiéndole al Banner Designer una propuesta
                {referenceUrl ? " (con imagen de referencia)" : ""}…
              </span>
            </div>
          )}

          {error && !loading && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {proposal && !loading && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Actual
                  </p>
                  <div className="bg-muted/30 rounded-lg p-2 flex items-center justify-center">
                    {targetDef ? (
                      <div
                        className="overflow-hidden rounded border border-border/30"
                        style={{
                          width: target.base_width * previewScale,
                          height: target.base_height * previewScale,
                        }}
                      >
                        <OrientationMiniPreview
                          definition={targetDef}
                          brandKit={brandKit}
                          nativeW={target.base_width}
                          nativeH={target.base_height}
                          scale={previewScale}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground py-4">
                        Sin contenido
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-violet-400">
                    Propuesta IA
                  </p>
                  <div className="bg-muted/30 rounded-lg p-2 flex items-center justify-center">
                    <div
                      className="overflow-hidden rounded border border-violet-500/40 ring-1 ring-violet-500/20"
                      style={{
                        width: target.base_width * previewScale,
                        height: target.base_height * previewScale,
                      }}
                    >
                      <OrientationMiniPreview
                        definition={proposal}
                        brandKit={brandKit}
                        nativeW={target.base_width}
                        nativeH={target.base_height}
                        scale={previewScale}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {rationale && (
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-violet-400 mb-1">
                    Decisión del agente
                  </p>
                  <p className="text-xs text-foreground">{rationale}</p>
                </div>
              )}

              <div className="flex items-center justify-end text-[10px] text-muted-foreground">
                {cost != null && (
                  <span title="Costo estimado de esta invocación">
                    ~ USD {cost.toFixed(4)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 px-5 py-3 border-t border-border/50 bg-muted/20">
          {/* Cuando target está linkeado al master, el productor decide si
              aplica la propuesta solo acá (diferenciar) o si la promueve al
              master (propaga a todas las linkeadas). Cuando está diferenciada,
              no hay decisión — va directo a esta. */}
          {proposal && targetIsLinked && (
            <p className="text-xs text-muted-foreground">
              Esta orientación está vinculada al master. Elegí cómo aplicar la
              propuesta:
            </p>
          )}
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={loading || accepting}
            >
              Cancelar
            </Button>
            <Button
              variant={proposal ? "outline" : "default"}
              size="sm"
              onClick={callAgent}
              disabled={loading || accepting}
              className="gap-1"
              title={
                proposal
                  ? "Pide al agente otra propuesta usando las instrucciones actuales"
                  : "Pide al Banner Designer una propuesta con las instrucciones de arriba"
              }
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {proposal ? "Regenerar" : "Generar"}
            </Button>
            {proposal && targetIsLinked && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAccept(true)}
                disabled={!proposal || loading || accepting}
                className="gap-1"
                title="Aplica la propuesta al master y propaga a todas las orientaciones linkeadas (reflowed)"
              >
                {accepting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Aplicar a todas las linkeadas
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => handleAccept(false)}
              disabled={!proposal || loading || accepting}
              className="gap-1"
              title={
                targetIsLinked
                  ? "Diferencia esta orientación del master y deja la propuesta solo acá"
                  : "Guarda la propuesta en esta orientación"
              }
            >
              {accepting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {targetIsLinked ? "Solo este formato" : "Aceptar y aplicar"}
            </Button>
          </div>
        </div>
      </div>

      {/* Render oculto del master a tamaño nativo (escalado a CAPTURE_MAX_SIDE
          en el lado largo). Sirve para capturarlo con html-to-image y subirlo
          como referencia visual al agente. Se renderea solo si tenemos masterDef;
          el resultado se cachea en referenceUrl tras el upload. Off-screen via
          left: -99999. */}
      {masterDef && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: -99999,
            top: 0,
            pointerEvents: "none",
            opacity: 0,
          }}
        >
          <div
            ref={captureWrapRef}
            style={{
              width: master.base_width * captureScale,
              height: master.base_height * captureScale,
              overflow: "hidden",
            }}
          >
            <OrientationMiniPreview
              definition={masterDef}
              brandKit={brandKit}
              nativeW={master.base_width}
              nativeH={master.base_height}
              scale={captureScale}
            />
          </div>
        </div>
      )}

      {/* templateId queda capturado para futuras llamadas (ej. listar
          invocaciones recientes), pero hoy no se usa explícitamente. */}
      <input type="hidden" value={templateId} readOnly />
    </div>
  );
}

// Panel compacto de Variables y Datos para la columna derecha del editor.
// Vive dentro del rightAccessory del TemplateEditor — debajo de Propiedades.
// Versión condensada de la sección que antes vivía abajo del editor: solo
// chips de variables + upload + selector de fila activa + valores de la
// fila actual. La tabla completa de filas se quita por espacio; el CSV
// sigue subido y se usa entero al exportar.
function DatasetPanel({
  detectedVariables,
  dataset,
  selectedRowIdx,
  saving,
  error,
  fileInputRef,
  onUploadClick,
  onFileChange,
  onSelectRow,
  onClear,
  embedded = false,
}: {
  detectedVariables: string[];
  dataset: ParsedDataset | null;
  selectedRowIdx: number | null;
  saving: boolean;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onUploadClick: () => void;
  onFileChange: (f: File) => void;
  onSelectRow: (idx: number) => void;
  onClear: () => void;
  // Cuando true, no rendereamos chrome propio (border/width/header); el panel
  // vive dentro de un acordeón que ya provee título y scroll.
  embedded?: boolean;
}) {
  if (detectedVariables.length === 0 && !dataset) return null;
  const row = dataset && selectedRowIdx !== null ? dataset.rows[selectedRowIdx] : null;
  return (
    <aside
      className={cn(
        "flex flex-col min-h-0",
        embedded
          ? "h-full overflow-y-auto"
          : "w-64 shrink-0 border-l border-t border-border/50 bg-card/40 overflow-y-auto",
      )}
    >
      {!embedded && (
        <div className="p-3 border-b border-border/50 flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Variables y datos
          </h3>
        </div>
      )}
      <div className="p-3 space-y-3">
        {detectedVariables.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin variables. Escribe {"{{variable}}"} en algún texto para
            insertar datos del CSV.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {detectedVariables.map((v) => {
              const inDataset = dataset?.columns.includes(v);
              return (
                <span
                  key={v}
                  className={cn(
                    "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                    inDataset || !dataset
                      ? "border-border/50 bg-muted text-foreground"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  )}
                  title={
                    dataset
                      ? inDataset
                        ? "Esta variable se sustituye con la columna del CSV"
                        : "El CSV no tiene una columna con este nombre"
                      : undefined
                  }
                >
                  {`{{${v}}}`}
                </span>
              );
            })}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileChange(f);
          }}
        />
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={dataset ? "outline" : "default"}
            onClick={onUploadClick}
            disabled={saving}
            className="flex-1 gap-1"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            <span className="text-xs">{dataset ? "Cambiar" : "Subir CSV"}</span>
          </Button>
          {dataset && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClear}
              disabled={saving}
              title="Quitar dataset"
              className="px-2"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {error && <p className="text-[10px] text-red-400">{error}</p>}

        {dataset && (
          <div className="space-y-2">
            <div className="text-[10px] text-muted-foreground">
              <p className="text-foreground font-medium truncate">
                {dataset.filename}
              </p>
              <p>
                {dataset.totalRows} fila{dataset.totalRows === 1 ? "" : "s"} ·{" "}
                {dataset.columns.length} col{dataset.columns.length === 1 ? "" : "s"}
              </p>
            </div>
            <label className="block text-xs text-muted-foreground">
              Fila activa
              <select
                value={selectedRowIdx ?? 0}
                onChange={(e) => onSelectRow(Number(e.target.value))}
                className="w-full mt-1 bg-muted border border-border/50 rounded px-2 py-1 text-xs"
              >
                {dataset.rows.map((_, i) => (
                  <option key={i} value={i}>
                    Fila {i + 1} de {dataset.rows.length}
                  </option>
                ))}
              </select>
            </label>
            {row && (
              <div className="border border-border/40 rounded p-2 space-y-1 max-h-48 overflow-y-auto bg-background/40">
                {dataset.columns.map((c) => (
                  <div key={c} className="text-[10px]">
                    <span className="text-muted-foreground font-mono">{c}:</span>{" "}
                    <span className="text-foreground">{String(row[c] ?? "")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// Mini-preview real de una orientación del master: renderiza su definition
// resuelta con el brandKit, escalada al tamaño del thumb. Usa el mismo
// pipeline que AdaptationPreview pero sin reflow (la orientación ya está
// dimensionada nativamente).
function OrientationMiniPreview({
  definition,
  brandKit,
  nativeW,
  nativeH,
  scale,
}: {
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  nativeW: number;
  nativeH: number;
  scale: number;
}) {
  const resolved = resolveTreeTokens(definition, brandKit);
  const bg =
    resolved.background && resolved.background.type === "color"
      ? resolved.background.value
      : "#ffffff";
  const rootIsStack = resolved.layout.mode === "stack";
  const innerStyle: CSSProperties = {
    width: nativeW,
    height: nativeH,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    position: "relative",
    background: bg,
    ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
  };
  return (
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
  );
}

// Agrupa adaptaciones por canal del preset (custom queda al final). Dentro
// de cada canal las ordenamos por orientación (horizontal, square, vertical)
// y luego por área (de menor a mayor). Esto produce una grilla legible en la
// que el productor encuentra rápido el formato que busca.
const ORIENTATION_ORDER: Record<string, number> = {
  horizontal: 0,
  square: 1,
  vertical: 2,
};
function adaptationOrientation(a: Adaptation): "horizontal" | "square" | "vertical" {
  if (a.preset_orientation) return a.preset_orientation;
  const r = a.width / a.height;
  if (Math.abs(r - 1) < 0.05) return "square";
  return r > 1 ? "horizontal" : "vertical";
}
function groupAdaptationsByChannel(
  adaptations: Adaptation[],
): { channel: string; items: Adaptation[] }[] {
  const map = new Map<string, Adaptation[]>();
  for (const a of adaptations) {
    const channel =
      a.preset_channel || (a.format_preset_id == null ? "custom" : "other");
    const arr = map.get(channel) ?? [];
    arr.push(a);
    map.set(channel, arr);
  }
  const channels = Array.from(map.keys()).sort((a, b) => {
    const ai = CHANNEL_ORDER.indexOf(a);
    const bi = CHANNEL_ORDER.indexOf(b);
    // custom queda al final
    if (a === "custom") return 1;
    if (b === "custom") return -1;
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return channels.map((channel) => {
    const items = (map.get(channel) ?? []).slice().sort((x, y) => {
      const ox = ORIENTATION_ORDER[adaptationOrientation(x)] ?? 99;
      const oy = ORIENTATION_ORDER[adaptationOrientation(y)] ?? 99;
      if (ox !== oy) return ox - oy;
      return x.width * x.height - y.width * y.height;
    });
    return { channel, items };
  });
}

// Cuando exportamos un batch por filas de un dataset, nombramos la subcarpeta
// con un identificador derivado de la fila: probamos columnas comunes
// (nombre, name, id, sku) y caemos a "fila_N" si no hay nada útil.
function rowSubfolderName(row: DataRow, idx: number): string {
  const candidates = ["nombre", "name", "title", "titulo", "id", "sku", "codigo"];
  for (const key of Object.keys(row)) {
    if (candidates.includes(key.toLowerCase())) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v);
      }
    }
  }
  return `fila_${idx + 1}`;
}

// Para una adaptación dada, elige la orientación del master cuyo aspect
// ratio sea más cercano. Esto resuelve "la adaptación usa por defecto la
// orientación que más se le parezca" — el productor ve cada adaptación
// renderizada desde la orientación correcta sin tener que elegirla.
function pickClosestOrientation(
  orientations: Orientation[],
  adaptW: number,
  adaptH: number,
): Orientation | null {
  if (orientations.length === 0) return null;
  const r = adaptW / adaptH;
  let best = orientations[0];
  let bestDiff = Infinity;
  for (const o of orientations) {
    const or = o.base_width / o.base_height;
    const diff = Math.abs(or - r) / Math.min(or, r);
    if (diff < bestDiff) {
      best = o;
      bestDiff = diff;
    }
  }
  return best;
}

// Resolución de source para una adaptación:
//   1. Si source_template_id está pinned y existe en orientations, esa gana.
//   2. Si la pinned referencia un template que ya no existe (borrado), cae a
//      auto-pick.
//   3. NULL: auto-pick por aspect ratio más cercano.
// Devuelve null solo si orientations está vacío.
function resolveSource(
  adaptation: Adaptation,
  orientations: Orientation[],
): Orientation | null {
  if (adaptation.source_template_id != null) {
    const pinned = orientations.find((o) => o.id === adaptation.source_template_id);
    if (pinned) return pinned;
  }
  return pickClosestOrientation(orientations, adaptation.width, adaptation.height);
}

// Devuelve la TemplateDefinition efectiva de una orientación. Si la
// orientación tiene definition propia (cached), gana. Si no, camina la
// cadena linked_to_template_id hasta encontrar una definition válida y la
// reflowea al tamaño nativo de esta orientación, replicando lo que el
// server hace al persistir orientaciones linked. Sirve para que el editor
// de adaptaciones nunca caiga al fallback "definition de la activeOrientation
// del editor", que era la causa del bug "edito 300x250 desde el master
// horizontal y heredo del horizontal en vez del cuadrado más cercano".
// Guard de ciclos: cada paso valida que el parent no apunte a la misma
// orientación (auto-link) y limita la profundidad por seguridad.
function resolveEffectiveDefinition(
  o: Orientation | null,
  orientations: Orientation[],
  depth: number = 0,
): TemplateDefinition | null {
  if (!o || depth > 8) return null;
  if (o.definition) return o.definition;
  if (o.linked_to_template_id == null || o.linked_to_template_id === o.id) {
    return null;
  }
  const parent = orientations.find((x) => x.id === o.linked_to_template_id);
  if (!parent) return null;
  const parentDef = resolveEffectiveDefinition(parent, orientations, depth + 1);
  if (!parentDef) return null;
  return reflowForPreview(parentDef, { w: o.base_width, h: o.base_height });
}
