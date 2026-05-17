import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";

// DELETE - Remove an adaptation (admin only).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; adaptationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: templateIdRaw, adaptationId: adaptationIdRaw } = await params;
    const templateId = Number(templateIdRaw);
    const adaptationId = Number(adaptationIdRaw);
    if (!Number.isFinite(templateId) || !Number.isFinite(adaptationId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `DELETE FROM production_template_adaptations
        WHERE id = ? AND template_id = ?`,
      [adaptationId, templateId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Adaptación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando adaptación:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
