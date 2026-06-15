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

    // Admins y exentos no ven el badge (el cliente lo oculta), así que evitamos
    // las ~6 queries pesadas de getCreditStatus. El badge se polea cada 90s por
    // cada sesión abierta; correr el JOIN de messages aquí satura el pool en vano.
    if (isAdmin || exempt) {
      return NextResponse.json({
        client_id: clientId,
        is_admin: isAdmin,
        exempt,
        period: null,
        image: null,
        video: null,
      });
    }

    const period = await getCurrentPeriod();

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
