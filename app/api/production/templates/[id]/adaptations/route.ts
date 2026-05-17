import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface AdaptationRow extends RowDataPacket {
  id: number;
  template_id: number;
  format_preset_id: number | null;
  custom_name: string | null;
  width: number;
  height: number;
  overrides_json: string | null;
  is_active: number;
  thumbnail_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Joined from the preset (nullable when adaptation is custom)
  preset_channel: string | null;
  preset_group_name: string | null;
  preset_name: string | null;
  preset_orientation: "horizontal" | "vertical" | "square" | null;
}

interface PresetRow extends RowDataPacket {
  id: number;
  width: number;
  height: number;
}

interface TemplateRow extends RowDataPacket {
  id: number;
}

// GET - List adaptations for a template (admin only).
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: templateIdRaw } = await params;
    const templateId = Number(templateIdRaw);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    const [rows] = await pool.execute<AdaptationRow[]>(
      `SELECT a.id, a.template_id, a.format_preset_id, a.custom_name, a.width,
              a.height, a.overrides_json, a.is_active, a.thumbnail_url,
              a.sort_order, a.created_at, a.updated_at,
              fp.channel AS preset_channel, fp.group_name AS preset_group_name,
              fp.name AS preset_name, fp.orientation AS preset_orientation
         FROM production_template_adaptations a
         LEFT JOIN production_format_presets fp ON fp.id = a.format_preset_id
        WHERE a.template_id = ?
        ORDER BY a.sort_order ASC, a.id ASC`,
      [templateId]
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error listando adaptaciones:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Create one or more adaptations (admin only). Body shapes:
//   { format_preset_id: number }                          — single from preset
//   { custom_name: string, width: number, height: number }— single custom
//   { format_preset_ids: number[] }                       — bulk from presets
// Bulk runs in a single transaction so the sort_order numbering stays
// contiguous and we don't end up half-applied on a failure.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: templateIdRaw } = await params;
    const templateId = Number(templateIdRaw);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    // Verify the template exists.
    const [tpl] = await pool.execute<TemplateRow[]>(
      "SELECT id FROM production_templates WHERE id = ? AND deleted_at IS NULL",
      [templateId]
    );
    if (tpl.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    const body = await request.json();
    const bulkIds: number[] | null = Array.isArray(body.format_preset_ids)
      ? body.format_preset_ids
          .map((x: unknown) => Number(x))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      : null;

    // ----- Bulk path -----
    if (bulkIds && bulkIds.length > 0) {
      const placeholders = bulkIds.map(() => "?").join(",");
      const [presets] = await pool.execute<PresetRow[]>(
        `SELECT id, width, height FROM production_format_presets WHERE id IN (${placeholders})`,
        bulkIds
      );
      if (presets.length === 0) {
        return NextResponse.json(
          { error: "Ningún format preset válido" },
          { status: 400 }
        );
      }
      const presetMap = new Map(presets.map((p) => [p.id, p]));

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [[{ next_order }]] = await conn.execute<
          (RowDataPacket & { next_order: number })[]
        >(
          "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM production_template_adaptations WHERE template_id = ?",
          [templateId]
        );
        let order = Number(next_order);
        const insertedIds: number[] = [];
        for (const id of bulkIds) {
          const preset = presetMap.get(id);
          if (!preset) continue;
          const [result] = await conn.execute<ResultSetHeader>(
            `INSERT INTO production_template_adaptations
               (template_id, format_preset_id, custom_name, width, height, sort_order)
             VALUES (?, ?, NULL, ?, ?, ?)`,
            [templateId, id, preset.width, preset.height, order]
          );
          insertedIds.push(result.insertId);
          order += 10;
        }
        await conn.commit();
        return NextResponse.json({ ids: insertedIds, count: insertedIds.length }, { status: 201 });
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    }

    // ----- Single path -----
    const formatPresetId =
      body.format_preset_id != null ? Number(body.format_preset_id) : null;
    const customName: string | null =
      typeof body.custom_name === "string" && body.custom_name.trim() !== ""
        ? body.custom_name.trim()
        : null;
    let width: number | null = body.width != null ? Number(body.width) : null;
    let height: number | null = body.height != null ? Number(body.height) : null;

    if (formatPresetId !== null) {
      const [presets] = await pool.execute<PresetRow[]>(
        "SELECT id, width, height FROM production_format_presets WHERE id = ?",
        [formatPresetId]
      );
      if (presets.length === 0) {
        return NextResponse.json(
          { error: "Format preset no encontrado" },
          { status: 400 }
        );
      }
      // Preset wins — ignore client-sent w/h to avoid drift.
      width = presets[0].width;
      height = presets[0].height;
    } else {
      // Custom adaptation: requires name + dimensions.
      if (!customName) {
        return NextResponse.json(
          { error: "Falta custom_name para adaptación personalizada" },
          { status: 400 }
        );
      }
      if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) {
        return NextResponse.json(
          { error: "Dimensiones inválidas" },
          { status: 400 }
        );
      }
    }

    // Pick next sort_order (append at end).
    const [[{ next_order }]] = await pool.execute<
      (RowDataPacket & { next_order: number })[]
    >(
      "SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM production_template_adaptations WHERE template_id = ?",
      [templateId]
    );

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_template_adaptations
         (template_id, format_preset_id, custom_name, width, height, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        templateId,
        formatPresetId,
        customName,
        width,
        height,
        next_order,
      ]
    );

    return NextResponse.json({ id: result.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error creando adaptación:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
