// Versiones de un design: snapshot del master, sus orientaciones y sus
// adaptaciones en un momento dado, con estado de aprobación interna.
// Server-only (lee y escribe la BD). Las rutas de
// app/api/production/designs/[id]/versions solo validan y llaman acá.

import pool from "@/lib/db";
import { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";

export type DesignVersionStatus = "en_revision" | "aprobada" | "con_cambios";
export const DESIGN_VERSION_STATUSES: DesignVersionStatus[] = ["en_revision", "aprobada", "con_cambios"];

export interface DesignSnapshot {
  templates: {
    id: number;
    name: string;
    base_width: number;
    base_height: number;
    linked_to_template_id: number | null;
    brand_kit_id: number | null;
    definition: unknown;
  }[];
  adaptations: {
    id: number;
    source_template_id: number | null;
    format_preset_id: number | null;
    custom_name: string | null;
    width: number;
    height: number;
    overrides_json: string | null;
    fit_mode: string;
    is_active: number;
    sort_order: number;
  }[];
}

export interface DesignVersionSummary {
  id: number;
  design_id: number;
  number: number;
  kind: "manual" | "pre_restore";
  label: string | null;
  notes: string | null;
  status: DesignVersionStatus;
  templates_count: number;
  adaptations_count: number;
  thumbnail_url: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
}

interface TemplateRow extends RowDataPacket {
  id: number;
  name: string;
  base_width: number;
  base_height: number;
  linked_to_template_id: number | null;
  brand_kit_id: number | null;
  definition_json: string;
  thumbnail_url: string | null;
  updated_at: Date;
}
interface AdaptationRow extends RowDataPacket {
  id: number;
  source_template_id: number | null;
  format_preset_id: number | null;
  custom_name: string | null;
  width: number;
  height: number;
  overrides_json: string | null;
  fit_mode: string;
  is_active: number;
  sort_order: number;
  updated_at: Date;
}
interface VersionRow extends RowDataPacket, Omit<DesignVersionSummary, "created_at" | "reviewed_at"> {
  created_at: Date;
  reviewed_at: Date | null;
}

const SUMMARY_SELECT = `
  SELECT v.id, v.design_id, v.number, v.kind, v.label, v.notes, v.status,
         v.templates_count, v.adaptations_count, v.thumbnail_url,
         v.created_by, cu.name AS created_by_name, v.created_at,
         v.reviewed_by, ru.name AS reviewed_by_name, v.reviewed_at, v.review_notes
    FROM production_design_versions v
    LEFT JOIN users cu ON cu.id = v.created_by
    LEFT JOIN users ru ON ru.id = v.reviewed_by`;

const toSummary = (r: VersionRow): DesignVersionSummary => ({
  ...r,
  created_at: new Date(r.created_at).toISOString(),
  reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
});

async function loadState(designId: number, conn: PoolConnection | typeof pool = pool) {
  const [templates] = await conn.execute<TemplateRow[]>(
    `SELECT id, name, base_width, base_height, linked_to_template_id, brand_kit_id, definition_json, thumbnail_url, updated_at
       FROM production_templates WHERE design_id = ? AND deleted_at IS NULL ORDER BY id`,
    [designId],
  );
  const [adaptations] = await conn.execute<AdaptationRow[]>(
    `SELECT id, source_template_id, format_preset_id, custom_name, width, height, overrides_json, fit_mode, is_active, sort_order, updated_at
       FROM production_template_adaptations WHERE design_id = ? ORDER BY id`,
    [designId],
  );
  return { templates, adaptations };
}

function snapshotOf(state: Awaited<ReturnType<typeof loadState>>): DesignSnapshot {
  return {
    templates: state.templates.map((t) => {
      let definition: unknown = null;
      try {
        definition = JSON.parse(t.definition_json);
      } catch {
        definition = null;
      }
      return {
        id: t.id,
        name: t.name,
        base_width: t.base_width,
        base_height: t.base_height,
        linked_to_template_id: t.linked_to_template_id,
        brand_kit_id: t.brand_kit_id,
        definition,
      };
    }),
    adaptations: state.adaptations.map((a) => ({
      id: a.id,
      source_template_id: a.source_template_id,
      format_preset_id: a.format_preset_id,
      custom_name: a.custom_name,
      width: a.width,
      height: a.height,
      overrides_json: a.overrides_json,
      fit_mode: a.fit_mode,
      is_active: a.is_active,
      sort_order: a.sort_order,
    })),
  };
}

export async function listDesignVersions(designId: number): Promise<{
  versions: DesignVersionSummary[];
  latest: DesignVersionSummary | null;
  // Hubo guardados en templates o adaptaciones después de la última versión.
  changed_since_latest: boolean;
}> {
  const [rows] = await pool.execute<VersionRow[]>(`${SUMMARY_SELECT} WHERE v.design_id = ? ORDER BY v.number DESC`, [designId]);
  const versions = rows.map(toSummary);
  const latest = versions.find((v) => v.kind === "manual") ?? null;
  let changed = false;
  if (latest) {
    // Se compara el contenido, no las fechas: restaurar la última versión
    // deja el design igual a ella aunque los updated_at cambien.
    const [snap] = await pool.execute<RowDataPacket[]>("SELECT snapshot_json FROM production_design_versions WHERE id = ?", [latest.id]);
    const current = JSON.stringify(snapshotOf(await loadState(designId)));
    changed = snap[0]?.snapshot_json !== current;
  }
  return { versions, latest, changed_since_latest: changed };
}

export async function createDesignVersion(params: {
  designId: number;
  userId: number;
  label?: string | null;
  notes?: string | null;
  kind?: "manual" | "pre_restore";
  conn?: PoolConnection;
}): Promise<DesignVersionSummary> {
  const conn = params.conn ?? pool;
  const state = await loadState(params.designId, conn);
  if (state.templates.length === 0) throw new Error("El design no tiene templates");
  const snapshot = snapshotOf(state);
  // Numeración por tipo: los respaldos automáticos no consumen vN.
  const [maxRows] = await conn.execute<RowDataPacket[]>(
    "SELECT COALESCE(MAX(number), 0) AS n FROM production_design_versions WHERE design_id = ? AND kind = ?",
    [params.designId, params.kind ?? "manual"],
  );
  const number = Number(maxRows[0]?.n ?? 0) + 1;
  const principal = state.templates.find((t) => t.linked_to_template_id == null) ?? state.templates[0];
  const [res] = await conn.execute<ResultSetHeader>(
    `INSERT INTO production_design_versions
       (design_id, number, kind, label, notes, status, snapshot_json, templates_count, adaptations_count, thumbnail_url, created_by)
     VALUES (?, ?, ?, ?, ?, 'en_revision', ?, ?, ?, ?, ?)`,
    [
      params.designId,
      number,
      params.kind ?? "manual",
      params.label?.trim() || null,
      params.notes?.trim() || null,
      JSON.stringify(snapshot),
      snapshot.templates.length,
      snapshot.adaptations.length,
      principal?.thumbnail_url ?? null,
      params.userId,
    ],
  );
  const [rows] = await conn.execute<VersionRow[]>(`${SUMMARY_SELECT} WHERE v.id = ?`, [res.insertId]);
  return toSummary(rows[0]);
}

export async function reviewDesignVersion(params: {
  designId: number;
  versionId: number;
  userId: number;
  status: DesignVersionStatus;
  reviewNotes?: string | null;
}): Promise<DesignVersionSummary | null> {
  await pool.execute<ResultSetHeader>(
    `UPDATE production_design_versions
        SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ?
      WHERE id = ? AND design_id = ?`,
    [params.status, params.userId, params.reviewNotes?.trim() || null, params.versionId, params.designId],
  );
  const [rows] = await pool.execute<VersionRow[]>(`${SUMMARY_SELECT} WHERE v.id = ? AND v.design_id = ?`, [params.versionId, params.designId]);
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function updateDesignVersionNotes(params: {
  designId: number;
  versionId: number;
  label?: string | null;
  notes?: string | null;
}): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (params.label !== undefined) {
    sets.push("label = ?");
    vals.push(params.label?.trim() || null);
  }
  if (params.notes !== undefined) {
    sets.push("notes = ?");
    vals.push(params.notes?.trim() || null);
  }
  if (sets.length === 0) return;
  vals.push(params.versionId, params.designId);
  await pool.execute<ResultSetHeader>(`UPDATE production_design_versions SET ${sets.join(", ")} WHERE id = ? AND design_id = ?`, vals);
}

// Vuelve el design al snapshot: antes guarda un respaldo automático
// (pre_restore). Templates: se actualizan los que siguen existiendo (los
// borrados después no se resucitan). Adaptaciones: se actualizan las que
// existen y se recrean las que faltan; las agregadas después se conservan.
export async function restoreDesignVersion(params: { designId: number; versionId: number; userId: number }): Promise<{
  backup: DesignVersionSummary;
  templates_restored: number;
  adaptations_restored: number;
  adaptations_created: number;
}> {
  const [rows] = await pool.execute<RowDataPacket[]>("SELECT number, snapshot_json FROM production_design_versions WHERE id = ? AND design_id = ?", [
    params.versionId,
    params.designId,
  ]);
  if (!rows[0]) throw new Error("Versión no encontrada");
  const snapshot = JSON.parse(rows[0].snapshot_json) as DesignSnapshot;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const backup = await createDesignVersion({
      designId: params.designId,
      userId: params.userId,
      kind: "pre_restore",
      label: `Antes de restaurar v${rows[0].number}`,
      conn,
    });
    const current = await loadState(params.designId, conn);
    const templateIds = new Set(current.templates.map((t) => t.id));
    let templatesRestored = 0;
    for (const t of snapshot.templates) {
      if (!templateIds.has(t.id) || t.definition == null) continue;
      await conn.execute<ResultSetHeader>(
        `UPDATE production_templates
            SET definition_json = ?, name = ?, brand_kit_id = ?, version = version + 1
          WHERE id = ? AND design_id = ?`,
        [JSON.stringify(t.definition), t.name, t.brand_kit_id, t.id, params.designId],
      );
      templatesRestored++;
    }
    const adaptIds = new Set(current.adaptations.map((a) => a.id));
    let adaptationsRestored = 0;
    let adaptationsCreated = 0;
    for (const a of snapshot.adaptations) {
      const source = a.source_template_id != null && templateIds.has(a.source_template_id) ? a.source_template_id : null;
      if (adaptIds.has(a.id)) {
        await conn.execute<ResultSetHeader>(
          `UPDATE production_template_adaptations
              SET source_template_id = ?, custom_name = ?, overrides_json = ?, fit_mode = ?, is_active = ?, sort_order = ?
            WHERE id = ? AND design_id = ?`,
          [source, a.custom_name, a.overrides_json, a.fit_mode, a.is_active, a.sort_order, a.id, params.designId],
        );
        adaptationsRestored++;
      } else {
        await conn.execute<ResultSetHeader>(
          `INSERT INTO production_template_adaptations
             (design_id, source_template_id, format_preset_id, custom_name, width, height, overrides_json, fit_mode, is_active, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [params.designId, source, a.format_preset_id, a.custom_name, a.width, a.height, a.overrides_json, a.fit_mode, a.is_active, a.sort_order],
        );
        adaptationsCreated++;
      }
    }
    await conn.commit();
    return { backup, templates_restored: templatesRestored, adaptations_restored: adaptationsRestored, adaptations_created: adaptationsCreated };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
