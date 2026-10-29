// Kit de marca de practicante (operación BRAND_ASSETS, sin modelo): logos,
// íconos y patrones oficiales que el equipo sube en la ficha del cliente en
// practicante. Se vuelcan al brand kit de la marca en nanano (client-wide,
// el default) como tokens {logo.x}, así el editor, "Crear desde texto" y
// "Pídele a la IA" usan el logo oficial. Los colores medidos de los logos se
// suman a la paleta si no estaban. Server-only.
//
// Upsert por URL: no se borra nada del kit (el diseñador puede haber subido
// logos a mano en nanano).

import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { callPracticante } from "@/lib/practicante-client";
import { brandKitFromApi, brandKitToApi, BrandKitContent, ColorToken, LogoToken } from "./brand-kit";

interface PracticanteAsset {
  id: string;
  url: string;
  tipo: string;
  variante?: string;
  nombre?: string;
  descripcion?: string;
  colores?: { hex: string; pct: number }[];
  origen?: string;
  formato?: string;
  ancho?: number | null;
  alto?: number | null;
}

// Un logo raster más chico que esto se ve blando en un master de 1920 px o
// en un feed a 2× (Topaz lo reescala, pero mejor pedir el original).
const LOGO_MIN_RASTER_PX = 1000;

// El primer logo del kit es el que usa resolveBrandLogo: SVG primero, y
// entre rasters el más grande.
function logoQuality(a: PracticanteAsset): number {
  if ((a.formato ?? "").toLowerCase() === "svg" || /\.svg(\?|$)/i.test(a.url)) return 1_000_000;
  return Math.max(a.ancho ?? 0, a.alto ?? 0);
}

interface KitRow extends RowDataPacket {
  id: number;
  client_id: number;
  production_project_id: number | null;
  name: string;
  colors_json: unknown;
  typography_json: unknown;
  logos_json: unknown;
  spacing_json: unknown;
  rules_text: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "logo";

export interface BrandAssetsSync {
  kitId: number;
  created: boolean;
  logosAdded: number;
  // Avisos para el equipo (logos en baja, etc.); no detienen la sincronización.
  warnings: string[];
  colorsAdded: number;
  fuentes: string[];
}

export async function syncBrandAssets(params: {
  clientId: number;
  clientSlug: string;
  userEmail: string;
  userId: number;
}): Promise<BrandAssetsSync> {
  const res = await callPracticante({
    message: `Assets de marca del cliente "${params.clientSlug}"`,
    promptSuffix: JSON.stringify({
      operation: "BRAND_ASSETS",
      client_slug: params.clientSlug,
      tipos: ["logo", "icono", "patron"],
      limite_piezas: 0,
    }),
    userEmail: params.userEmail,
  });
  let data: { assets?: PracticanteAsset[]; fuentes?: string[]; error?: string };
  try {
    data = JSON.parse(res.response ?? "{}");
  } catch {
    throw new Error("Practicante no devolvió un JSON de assets válido");
  }
  if (data.error) throw new Error(`Practicante respondió: ${data.error}`);
  const assets = (data.assets ?? []).filter(
    (a) => a.origen !== "pieza_archivada" && typeof a.url === "string" && /^https:\/\//i.test(a.url),
  );
  const logos = assets.filter((a) => a.tipo === "logo").sort((x, y) => logoQuality(y) - logoQuality(x));
  const warnings: string[] = [];
  if (logos.length > 0 && logoQuality(logos[0]) < LOGO_MIN_RASTER_PX) {
    warnings.push(
      `El logo de mayor resolución que tiene practicante mide ${logos[0].ancho ?? "?"}×${logos[0].alto ?? "?"} px: pide el SVG o un PNG de al menos ${LOGO_MIN_RASTER_PX} px para que no salga blando en masters grandes y feeds a 2×.`,
    );
  }

  // Kit de la marca: el default client-wide; si no hay, se crea.
  const [rows] = await pool.execute<KitRow[]>(
    `SELECT * FROM production_brand_kits
      WHERE client_id = ? AND production_project_id IS NULL AND deleted_at IS NULL
      ORDER BY is_default DESC, id ASC LIMIT 1`,
    [params.clientId],
  );
  const existing = rows[0] ?? null;
  const content: BrandKitContent = existing
    ? brandKitFromApi(existing).content
    : { colors: [], fonts: [], scales: [], spacing: [], logos: [] };

  let logosAdded = 0;
  const names = new Set(content.logos.map((l) => l.name));
  for (const a of logos) {
    if (content.logos.some((l) => l.src === a.url)) continue;
    let name = slug(a.variante || a.nombre || "logo");
    for (let i = 2; names.has(name); i++) name = `${slug(a.variante || a.nombre || "logo")}-${i}`;
    names.add(name);
    const label = [a.nombre || "Logo", a.descripcion].filter(Boolean).join(" — ").slice(0, 120);
    content.logos.push({ name, label, src: a.url } satisfies LogoToken);
    logosAdded++;
  }

  let colorsAdded = 0;
  const hexes = new Set(content.colors.map((c) => c.value.toUpperCase()));
  for (const a of logos) {
    for (const c of a.colores ?? []) {
      const hex = c.hex?.toUpperCase();
      if (!hex || !/^#[0-9A-F]{6}$/.test(hex) || hexes.has(hex)) continue;
      hexes.add(hex);
      const n = content.colors.length + 1;
      content.colors.push({ name: n === 1 ? "primary" : `logo-${n}`, label: `Color del logo (${hex})`, value: hex } satisfies ColorToken);
      colorsAdded++;
    }
  }

  const payload = brandKitToApi(content);
  let kitId: number;
  if (existing) {
    kitId = existing.id;
    if (logosAdded > 0 || colorsAdded > 0) {
      await pool.execute<ResultSetHeader>(
        "UPDATE production_brand_kits SET colors_json = ?, logos_json = ? WHERE id = ?",
        [JSON.stringify(payload.colors_json), JSON.stringify(payload.logos_json), kitId],
      );
    }
  } else {
    const [ins] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_brand_kits
         (client_id, production_project_id, name, colors_json, typography_json,
          logos_json, spacing_json, rules_text, is_default, created_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, 1, ?)`,
      [
        params.clientId,
        "Kit de marca",
        JSON.stringify(payload.colors_json),
        JSON.stringify(payload.typography_json),
        JSON.stringify(payload.logos_json),
        JSON.stringify(payload.spacing_json),
        params.userId,
      ],
    );
    kitId = ins.insertId;
  }
  return { kitId, created: !existing, logosAdded, colorsAdded, warnings, fuentes: data.fuentes ?? [] };
}
