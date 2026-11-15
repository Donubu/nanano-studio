"use client";

// Panel "Imágenes": catálogo de todas las imágenes del canvas (las vinculadas
// de otros canvas, que no se editan aquí, y las propias) en miniatura, con
// vista grande, link y descarga. Las descargas las hace el servidor
// (`…/canvas/images/file` y `/zip`) con nombres numerados en el orden del
// panel: "Descargar todas" es UN ZIP.

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardCopy, Copy, Download, ExternalLink, Images, LocateFixed, X } from "lucide-react";
import { imageFileName, listCanvasImages, type CanvasImage } from "../lib/canvas-images";
import { thumbUrl } from "../lib/thumb";

type N = Parameters<typeof listCanvasImages>[0][number];

// Descarga por el servidor en otra pestaña: si algo falla, el canvas no se pierde.
function triggerDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ImagesPanel({
  conversationId,
  isOpen,
  nodes,
  edges,
  onClose,
  onFocusNode,
}: {
  conversationId: number;
  isOpen: boolean;
  nodes: N[];
  edges: Parameters<typeof listCanvasImages>[1];
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
}) {
  const images = useMemo(() => (isOpen ? listCanvasImages(nodes, edges) : []), [isOpen, nodes, edges]);
  const groups = useMemo(() => [...new Set(images.map((i) => i.group))], [images]);
  const [group, setGroup] = useState<string>("");
  const [copied, setCopied] = useState<string | null>(null);
  const [zipStarted, setZipStarted] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const shown = group ? images.filter((i) => i.group === group) : images;

  useEffect(() => {
    if (viewing === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewing(null);
      else if (e.key === "ArrowRight") setViewing((v) => (v === null ? v : Math.min(v + 1, shown.length - 1)));
      else if (e.key === "ArrowLeft") setViewing((v) => (v === null ? v : Math.max(v - 1, 0)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing, shown.length]);

  if (!isOpen) return null;

  const fileNameOf = (img: CanvasImage) => imageFileName(images.indexOf(img), images.length, img);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      /* sin permiso de portapapeles: no hace nada */
    }
  };

  const base = `/api/conversations/${conversationId}/canvas/images`;
  const downloadOne = (img: CanvasImage) => triggerDownload(`${base}/file?key=${encodeURIComponent(img.key)}`);
  const downloadAll = () => {
    if (images.length === 0) return;
    triggerDownload(`${base}/zip`);
    setZipStarted(true);
  };
  const allLinks = shown.map((i) => `${i.label}\t${i.url}`).join("\n");
  const current = viewing !== null ? shown[viewing] : null;

  return (
    <div className="fixed top-0 right-0 z-40 flex h-full w-[520px] max-w-full flex-col border-l border-border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Images className="h-4 w-4 text-sky-500" />
          <h2 className="text-sm font-semibold">Imágenes del canvas</h2>
          <span className="text-xs text-muted-foreground">{images.length}</span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={downloadAll}
          disabled={images.length === 0 || conversationId <= 0}
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          title="Un solo ZIP con todas las imágenes (propias y vinculadas), numeradas en orden"
        >
          <Download className="h-3.5 w-3.5" />
          Descargar todas en ZIP ({images.length})
        </button>
        <button
          type="button"
          onClick={() => copy(allLinks, "all")}
          disabled={shown.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          title="Copia una línea por imagen: nombre y link"
        >
          {copied === "all" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
          Copiar los links
        </button>
        {groups.length > 1 && (
          <select
            value={group}
            onChange={(e) => {
              setGroup(e.target.value);
              setViewing(null);
            }}
            className="ml-auto max-w-[180px] rounded-md border border-border bg-background px-2 py-1 text-xs"
            title="Ver solo un canvas de origen"
          >
            <option value="">Todos los canvas</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
        {zipStarted && (
          <p className="w-full text-xs text-muted-foreground">
            El ZIP se arma mientras se descarga: el navegador no sabe el tamaño total hasta que termina.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {images.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Este canvas no tiene imágenes. Las de otros canvas se traen con Vincular.
          </p>
        )}
        {sections(shown).map(({ group: g, items }) => (
          <section key={g} className="mb-3">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g}
              {g !== "Este canvas" && <span className="ml-1 font-normal normal-case tracking-normal">(vinculadas, solo lectura)</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {items.map(({ img, index }) => (
                <Tile
                  key={img.key}
                  img={img}
                  copied={copied === img.key}
                  onView={() => setViewing(index)}
                  onCopy={() => copy(img.url, img.key)}
                  onDownload={() => downloadOne(img)}
                  onFocus={() => onFocusNode(img.nodeId)}
                  downloadTitle={`Descargar como "${fileNameOf(img)}"`}
                  canDownload={conversationId > 0}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={() => setViewing(null)}>
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span className="min-w-0 flex-1 truncate">{current.label}</span>
            <span className="text-xs text-white/60">
              {viewing! + 1} / {shown.length}
            </span>
            <button type="button" className="rounded p-1.5 hover:bg-white/10" title="Descargar" onClick={() => downloadOne(current)}>
              <Download className="h-4 w-4" />
            </button>
            <button type="button" className="rounded p-1.5 hover:bg-white/10" title="Abrir en una pestaña nueva" onClick={() => window.open(current.url, "_blank", "noopener")}>
              <ExternalLink className="h-4 w-4" />
            </button>
            <button type="button" className="rounded p-1.5 hover:bg-white/10" title="Cerrar (Esc)" onClick={() => setViewing(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.url} alt={current.label} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
            {viewing! > 0 && (
              <button
                type="button"
                className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                title="Anterior (←)"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewing(viewing! - 1);
                }}
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {viewing! < shown.length - 1 && (
              <button
                type="button"
                className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
                title="Siguiente (→)"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewing(viewing! + 1);
                }}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Imágenes por grupo, en orden, con su posición en la lista (para la vista grande). */
function sections(list: CanvasImage[]): { group: string; items: { img: CanvasImage; index: number }[] }[] {
  const out: { group: string; items: { img: CanvasImage; index: number }[] }[] = [];
  list.forEach((img, index) => {
    const last = out[out.length - 1];
    if (last && last.group === img.group) last.items.push({ img, index });
    else out.push({ group: img.group, items: [{ img, index }] });
  });
  return out;
}

function Tile({
  img,
  copied,
  onView,
  onCopy,
  onDownload,
  onFocus,
  downloadTitle,
  canDownload,
}: {
  img: CanvasImage;
  copied: boolean;
  onView: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onFocus: () => void;
  downloadTitle: string;
  canDownload: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="group relative overflow-hidden rounded-md border border-border bg-muted">
        <button type="button" onClick={onView} className="block aspect-square w-full" title="Ver grande">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbUrl(img.url, 256)} alt={img.label} loading="lazy" className="h-full w-full object-cover" />
        </button>
        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-0.5 bg-gradient-to-t from-black/70 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
          <TileButton title="Ver en el canvas" onClick={onFocus}>
            <LocateFixed className="h-3.5 w-3.5" />
          </TileButton>
          <TileButton title="Copiar el link" onClick={onCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </TileButton>
          <TileButton title={downloadTitle} onClick={onDownload} disabled={!canDownload}>
            <Download className="h-3.5 w-3.5" />
          </TileButton>
        </div>
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={img.label}>
        {img.label.startsWith(`${img.group} · `) ? img.label.slice(img.group.length + 3) : img.label}
      </p>
    </div>
  );
}

function TileButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-white hover:bg-white/20 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
