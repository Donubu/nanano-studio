"use client";

// Panel "Videos": todos los videos del canvas (vinculados en orden de montaje
// y los propios) con su link, para copiarlo, abrirlo o descargarlo. Las
// descargas las hace el servidor (`…/canvas/videos/file` y `/zip`) con los
// mismos nombres numerados: "Descargar todos" es UN ZIP (el navegador corta
// las series largas de descargas sueltas).

import { useMemo, useState } from "react";
import { Check, ClipboardCopy, Copy, Download, ExternalLink, Film, LocateFixed, X } from "lucide-react";
import { listCanvasVideos, videoFileName, type CanvasVideo } from "../lib/canvas-videos";

type N = Parameters<typeof listCanvasVideos>[0][number];

// Descarga por el servidor (nombre numerado, sin cargar el video en la
// memoria del navegador): un enlace con la ruta, como un clic normal.
function triggerDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function VideosPanel({
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
  edges: Parameters<typeof listCanvasVideos>[1];
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
}) {
  const videos = useMemo(() => (isOpen ? listCanvasVideos(nodes, edges) : []), [isOpen, nodes, edges]);
  const ready = videos.filter((v) => v.url);
  const [copied, setCopied] = useState<string | null>(null);
  const [zipStarted, setZipStarted] = useState(false);

  if (!isOpen) return null;

  const fileNameOf = (v: CanvasVideo) => videoFileName(videos.indexOf(v), videos.length, v.label);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((k) => (k === key ? null : k)), 1500);
    } catch {
      /* sin permiso de portapapeles: no hace nada */
    }
  };

  const base = `/api/conversations/${conversationId}/canvas/videos`;
  const downloadOne = (v: CanvasVideo) => {
    if (v.url) triggerDownload(`${base}/file?node=${encodeURIComponent(v.nodeId)}`);
  };
  const downloadAll = () => {
    if (ready.length === 0) return;
    triggerDownload(`${base}/zip`);
    setZipStarted(true);
  };

  const allLinks = ready.map((v) => `${v.label}\t${v.url}`).join("\n");

  return (
    <div className="fixed top-0 right-0 z-40 flex h-full w-[420px] flex-col border-l border-border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold">Videos del canvas</h2>
          <span className="text-xs text-muted-foreground">
            {ready.length}/{videos.length} listos
          </span>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="Cerrar">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
        <button
          type="button"
          onClick={downloadAll}
          disabled={ready.length === 0 || conversationId <= 0}
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          title="Un solo ZIP con todos los videos listos, numerados en orden"
        >
          <Download className="h-3.5 w-3.5" />
          Descargar todos en ZIP ({ready.length})
        </button>
        <button
          type="button"
          onClick={() => copy(allLinks, "all")}
          disabled={ready.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          title="Copia una línea por video: nombre y link"
        >
          {copied === "all" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
          Copiar todos los links
        </button>
        {zipStarted && (
          <p className="w-full text-xs text-muted-foreground">
            El ZIP se arma mientras se descarga: el navegador no sabe el tamaño total hasta que termina. Puede tardar unos minutos.
          </p>
        )}
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-3">
        {videos.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">Este canvas no tiene videos. Vincúlalos con Vincular → Videos.</p>
        )}
        {videos.map((v, i) => {
          const header = i === 0 || videos[i - 1].group !== v.group ? v.group : null;
          return (
            <div key={v.nodeId}>
              {header && <div className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">{header}</div>}
              <div className="rounded-md border border-border px-2 py-1.5">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={v.label}>
                    {v.label}
                  </span>
                  <IconButton title="Ver en el canvas" onClick={() => onFocusNode(v.nodeId)}>
                    <LocateFixed className="h-3.5 w-3.5" />
                  </IconButton>
                  {v.url && (
                    <>
                      <IconButton title="Copiar el link" onClick={() => copy(v.url!, v.nodeId)}>
                        {copied === v.nodeId ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </IconButton>
                      <IconButton title="Abrir en una pestaña nueva" onClick={() => window.open(v.url!, "_blank", "noopener")}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton title={`Descargar como "${fileNameOf(v)}"`} onClick={() => downloadOne(v)} disabled={conversationId <= 0}>
                        <Download className="h-3.5 w-3.5" />
                      </IconButton>
                    </>
                  )}
                </div>
                {v.url ? (
                  <a
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-[11px] text-muted-foreground hover:text-primary hover:underline"
                    title={v.url}
                  >
                    {v.url}
                  </a>
                ) : (
                  <p className="text-[11px] text-amber-600 dark:text-amber-300">Todavía sin video</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IconButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
    >
      {children}
    </button>
  );
}
