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
} from "@/lib/production/brand-kit";

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
