import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";
import {
  getCurrentPeriod,
  getCreditStatus,
  isUserExempt,
} from "@/lib/client-credits";

// GET - Estado de créditos visto por el usuario actual.
// Cualquier usuario autenticado puede pedirlo. Devuelve null/exento cuando no aplica.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const clientId = Number(id);
    if (!Number.isFinite(clientId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const [clientRows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM clients WHERE id = ? LIMIT 1",
      [clientId]
    );
    if (clientRows.length === 0) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
    }

    const isAdmin = session.user.role === "admin";
    const userId = Number(session.user.id);
    const exempt = isAdmin ? true : await isUserExempt(clientId, userId);

    const period = await getCurrentPeriod();

    // Aunque el usuario esté exento, devolvemos status para mostrar el consumo del cliente
    // (útil para que el usuario sepa cómo va la marca). Esto NO bloquea generaciones.
    const [imageStatus, videoStatus] = await Promise.all([
      getCreditStatus(clientId, "image", period),
      getCreditStatus(clientId, "video", period),
    ]);

    return NextResponse.json({
      client_id: clientId,
      is_admin: isAdmin,
      exempt,
      period,
      image: imageStatus,
      video: videoStatus,
    });
  } catch (error) {
    console.error("Error obteniendo créditos del usuario:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
