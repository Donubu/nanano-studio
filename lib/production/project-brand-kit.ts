// Resolución server-side del brand kit efectivo de un proyecto de producción.
//
// Cascada: kit client-wide default (production_project_id NULL) + kit
// project-scoped default, merged token por token con el project pisando al
// client. Es el mismo criterio que mergeKits en el cliente (brand-kit.ts),
// replicado acá para las rutas /api/production/ai/* que necesitan el kit
// para armar el CONTEXTO del agente Banner Designer.

import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import {
  BrandKit,
  BrandKitContent,
  EMPTY_KIT_CONTENT,
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

export async function loadMergedBrandKit(
  clientId: number,
  productionProjectId: number,
): Promise<BrandKitContent> {
  const [kitRows] = await pool.execute<BrandKitRow[]>(
    `SELECT id, client_id, production_project_id, name, colors_json,
            typography_json, logos_json, spacing_json, rules_text,
            is_default, deleted_at
       FROM production_brand_kits
      WHERE client_id = ?
        AND (production_project_id IS NULL OR production_project_id = ?)
        AND deleted_at IS NULL`,
    [clientId, productionProjectId],
  );
  const parsedKits: BrandKit[] = kitRows.map((r) => brandKitFromApi(r));
  const clientWide = parsedKits.filter((k) => k.production_project_id === null);
  const projectScoped = parsedKits.filter((k) => k.production_project_id != null);
  const baseClient = clientWide.find((k) => k.is_default) ?? clientWide[0];
  const baseProject = projectScoped.find((k) => k.is_default) ?? projectScoped[0];

  if (!baseClient && !baseProject) return EMPTY_KIT_CONTENT;

  // Concatenar client + project y dedupe por name conservando el último
  // (= project gana sobre client).
  return {
    colors: dedupeByName([
      ...(baseClient?.content.colors ?? []),
      ...(baseProject?.content.colors ?? []),
    ]),
    fonts: dedupeByName([
      ...(baseClient?.content.fonts ?? []),
      ...(baseProject?.content.fonts ?? []),
    ]),
    scales: dedupeByName([
      ...(baseClient?.content.scales ?? []),
      ...(baseProject?.content.scales ?? []),
    ]),
    spacing: dedupeByName([
      ...(baseClient?.content.spacing ?? []),
      ...(baseProject?.content.spacing ?? []),
    ]),
    logos: dedupeByName([
      ...(baseClient?.content.logos ?? []),
      ...(baseProject?.content.logos ?? []),
    ]),
  };
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of items) map.set(it.name, it);
  return Array.from(map.values());
}
