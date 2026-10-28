// Resolución server-side del brand kit efectivo.
//
// Modelo: la MARCA (cliente) tiene sus tokens en un kit client-wide
// (production_project_id NULL). Cada proyecto los hereda; si el proyecto los
// personaliza, se hace un fork project-scoped (snapshot) que reemplaza al de
// la marca dentro de ese proyecto. Un template puede además fijar un kit
// explícito (brand_kit_id) — ese siempre gana.
//
// Orden de resolución, de más específico a más general:
//   1. template.brand_kit_id explícito (si existe y no está borrado)
//   2. kit project-scoped marcado default → si no hay, el project-scoped más antiguo
//   3. kit client-wide marcado default → si no hay, el client-wide más antiguo
//   4. null (sin tokens: el editor renderiza defaults)
//
// Todas las rutas que necesitan tokens (creación de templates, agente IA)
// pasan por acá para que el productor vea en el editor exactamente lo que
// el agente usó. Un fork es un snapshot completo, así que NO se mezcla con
// el kit de la marca: mezclar resucitaría tokens que el fork eliminó.

import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import {
  BrandKit,
  BrandKitContent,
  brandKitFromApi,
  makeRef,
} from "@/lib/production/brand-kit";
import { imageSize } from "@/lib/production/image-size";

interface BrandKitRow extends RowDataPacket {
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
  deleted_at: Date | null;
}

const KIT_COLUMNS = `id, client_id, production_project_id, name, colors_json,
       typography_json, logos_json, spacing_json, rules_text, is_default, deleted_at`;

export interface ResolvedBrandKit {
  id: number;
  scope: "template" | "project" | "client";
  content: BrandKitContent;
  kit: BrandKit;
}

export async function loadBrandKitById(id: number): Promise<BrandKit | null> {
  const [rows] = await pool.execute<BrandKitRow[]>(
    `SELECT ${KIT_COLUMNS} FROM production_brand_kits WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return rows.length > 0 ? brandKitFromApi(rows[0]) : null;
}

// Kit heredado por un proyecto: fork del proyecto si existe, si no el de la
// marca. Devuelve null cuando el cliente no tiene ningún kit.
export async function resolveProjectBrandKit(
  clientId: number,
  productionProjectId: number,
): Promise<ResolvedBrandKit | null> {
  const [rows] = await pool.execute<BrandKitRow[]>(
    `SELECT ${KIT_COLUMNS}
       FROM production_brand_kits
      WHERE client_id = ?
        AND (production_project_id IS NULL OR production_project_id = ?)
        AND deleted_at IS NULL
      ORDER BY production_project_id IS NULL ASC, is_default DESC, id ASC`,
    [clientId, productionProjectId],
  );
  if (rows.length === 0) return null;
  // El ORDER BY ya deja primero: project-scoped default, project-scoped más
  // antiguo, client-wide default, client-wide más antiguo.
  const row = rows[0];
  const kit = brandKitFromApi(row);
  return {
    id: row.id,
    scope: row.production_project_id == null ? "client" : "project",
    content: kit.content,
    kit,
  };
}

// Kit efectivo de un template: el explícito si lo tiene, si no el heredado
// por su proyecto.
export async function resolveTemplateBrandKit(params: {
  brandKitId: number | null;
  clientId: number;
  productionProjectId: number;
}): Promise<ResolvedBrandKit | null> {
  if (params.brandKitId != null) {
    const kit = await loadBrandKitById(params.brandKitId);
    if (kit) return { id: kit.id, scope: "template", content: kit.content, kit };
  }
  return resolveProjectBrandKit(params.clientId, params.productionProjectId);
}

// ---------------------------------------------------------------------------
// Logo de la marca para la IA de producción
// ---------------------------------------------------------------------------
//
// El primero del brand kit (como token {logo.x}, así el editor lo resuelve
// igual que la IA); si el kit no tiene, el logo de la ficha del cliente
// (clients.logo, URL directa). `aspect` = ancho / alto real de la imagen,
// para que la capa del logo tenga su proporción.

export interface BrandLogo {
  src: string;
  url: string;
  aspect: number;
}

interface ClientLogoRow extends RowDataPacket {
  logo: string | null;
}

// Proporción de la imagen (ancho / alto), o null si no se pudo medir.
async function imageAspect(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "force-cache" });
    if (!res.ok) return null;
    const size = imageSize(new Uint8Array(await res.arrayBuffer()));
    return size && size.w > 0 && size.h > 0 ? size.w / size.h : null;
  } catch {
    return null;
  }
}

// `useToken`: el editor solo resuelve tokens del kit asignado a la plantilla
// (brand_kit_id). Si la plantilla no tiene kit asignado, va la URL directa
// del logo para que se vea igual.
export async function resolveBrandLogo(
  kit: BrandKitContent | null,
  clientId: number,
  opts: { useToken?: boolean } = {},
): Promise<BrandLogo | null> {
  let src: string | null = null;
  let url: string | null = null;
  const fromKit = kit?.logos.find((l) => l.src);
  if (fromKit) {
    src = opts.useToken === false ? fromKit.src : makeRef("logo", fromKit.name);
    url = fromKit.src;
  } else {
    const [rows] = await pool.execute<ClientLogoRow[]>("SELECT logo FROM clients WHERE id = ?", [clientId]);
    const logo = rows[0]?.logo?.trim();
    if (logo && /^https:\/\//i.test(logo)) src = url = logo;
  }
  if (!src || !url) return null;
  // Si no se puede medir (el CDN puede no responder a este servidor), se
  // asume cuadrado: la capa usa fit "contain" igual.
  return { src, url, aspect: (await imageAspect(url)) ?? 1 };
}
