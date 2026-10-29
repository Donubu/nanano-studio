// Nomenclatura de los archivos exportados, como la piden las agencias de
// medios para traficar: cliente_proyecto_pieza_canal_WxH_vN.ext. Tokens
// separados por "_", palabras dentro de un token por "-", sin acentos ni
// mayúsculas, así un listado de 40 archivos se lee y ordena solo.

export interface ExportNameParts {
  client?: string | null;
  project?: string | null;
  template?: string | null;
  channel?: string | null;
  width: number;
  height: number;
  version?: number | null;
  // Fila del dataset (nombre o índice) cuando se exporta un lote.
  row?: string | null;
  ext: string;
}

export function slugToken(s: string | null | undefined, max = 40): string {
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function exportFileName(p: ExportNameParts): string {
  const tokens = [
    slugToken(p.client),
    slugToken(p.project),
    slugToken(p.template),
    slugToken(p.channel, 16),
    `${Math.round(p.width)}x${Math.round(p.height)}`,
    p.version != null ? `v${p.version}` : "",
    slugToken(p.row, 24),
  ].filter(Boolean);
  return `${tokens.join("_")}.${p.ext.replace(/^\./, "")}`;
}

export function exportBundleName(p: Omit<ExportNameParts, "width" | "height" | "ext" | "channel"> & { suffix?: string; ext?: string }): string {
  const tokens = [slugToken(p.client), slugToken(p.project), slugToken(p.template), p.version != null ? `v${p.version}` : "", slugToken(p.suffix)].filter(
    Boolean,
  );
  return `${tokens.join("_")}.${p.ext ?? "zip"}`;
}
