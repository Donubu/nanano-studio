import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import {
  getCurrentPeriod,
  getCreditStatus,
  getAdjustmentsSum,
} from "@/lib/client-credits";

interface ClientRow extends RowDataPacket {
  id: number;
  monthly_image_limit: number | null;
  monthly_video_limit: number | null;
}

// GET - Resumen de la política, ajustes del mes y consumo actual
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
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const [rows] = await pool.execute<ClientRow[]>(
      "SELECT id, monthly_image_limit, monthly_video_limit FROM clients WHERE id = ?",
      [clientId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const period = await getCurrentPeriod();
    const [imageStatus, videoStatus, imageTopups, videoTopups] = await Promise.all([
      getCreditStatus(clientId, "image", period),
      getCreditStatus(clientId, "video", period),
      getAdjustmentsSum(clientId, "image", period),
      getAdjustmentsSum(clientId, "video", period),
    ]);

    return NextResponse.json({
      client_id: clientId,
      policy: {
        monthly_image_limit: rows[0].monthly_image_limit,
        monthly_video_limit: rows[0].monthly_video_limit,
      },
      period,
      usage: {
        image: imageStatus,
        video: videoStatus,
      },
      adjustments_total: {
        image: imageTopups,
        video: videoTopups,
      },
    });
  } catch (error) {
    console.error("Error obteniendo créditos del cliente:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar política base (monthly_image_limit / monthly_video_limit)
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
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const schema = z.object({
      monthly_image_limit: z.number().int().min(0).nullable().optional(),
      monthly_video_limit: z.number().int().min(0).nullable().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;

    const updates: string[] = [];
    const values: (number | null)[] = [];
    if (parsed.data.monthly_image_limit !== undefined) {
      updates.push("monthly_image_limit = ?");
      values.push(parsed.data.monthly_image_limit);
    }
    if (parsed.data.monthly_video_limit !== undefined) {
      updates.push("monthly_video_limit = ?");
      values.push(parsed.data.monthly_video_limit);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    values.push(clientId);
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE clients SET ${updates.join(", ")} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando créditos del cliente:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
