import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface BrandKitRow extends RowDataPacket {
  id: number;
  client_id: number;
  name: string;
  colors_json: unknown;
  typography_json: unknown;
  logos_json: unknown;
  spacing_json: unknown;
  rules_text: string | null;
  is_default: number;
  created_at: Date;
  updated_at: Date;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const [rows] = await pool.execute<BrandKitRow[]>(
      `SELECT id, client_id, name, colors_json, typography_json, logos_json,
              spacing_json, rules_text, is_default, created_at, updated_at
         FROM production_brand_kits WHERE id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Brand kit no encontrado" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error("Error obteniendo brand_kit:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;

    const schema = z.object({
      name: z.string().min(1).max(150).optional(),
      colors_json: z.unknown().optional(),
      typography_json: z.unknown().optional(),
      logos_json: z.unknown().optional(),
      spacing_json: z.unknown().optional(),
      rules_text: z.string().max(20000).nullable().optional(),
      is_default: z.boolean().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;
    const d = parsed.data;

    if (d.is_default === true) {
      const [existing] = await pool.execute<BrandKitRow[]>(
        `SELECT client_id FROM production_brand_kits WHERE id = ?`,
        [id]
      );
      if (existing.length > 0) {
        await pool.execute<ResultSetHeader>(
          `UPDATE production_brand_kits SET is_default = 0
            WHERE client_id = ? AND is_default = 1 AND id != ?`,
          [existing[0].client_id, id]
        );
      }
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (d.name !== undefined) { updates.push("name = ?"); values.push(d.name); }
    for (const key of ["colors_json", "typography_json", "logos_json", "spacing_json"] as const) {
      if (d[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(d[key] === null ? null : JSON.stringify(d[key]));
      }
    }
    if (d.rules_text !== undefined) { updates.push("rules_text = ?"); values.push(d.rules_text); }
    if (d.is_default !== undefined) { updates.push("is_default = ?"); values.push(d.is_default ? 1 : 0); }

    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }
    values.push(id);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_brand_kits SET ${updates.join(", ")} WHERE id = ?`,
      values
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Brand kit no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando brand_kit:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const [result] = await pool.execute<ResultSetHeader>(
      `DELETE FROM production_brand_kits WHERE id = ?`,
      [id]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Brand kit no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando brand_kit:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
