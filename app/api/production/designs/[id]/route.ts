import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";

// PATCH - Update a design (admin only). Body: { name?, description? }.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "name no puede estar vacío" }, { status: 400 });
      }
      updates.push("name = ?");
      values.push(name);
    }
    if ("description" in body) {
      updates.push("description = ?");
      values.push(typeof body.description === "string" ? body.description : null);
    }
    if (updates.length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }
    values.push(id);
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_designs SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      values
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Design no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando design:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Soft-delete a design (admin only). Templates referencing it lose
// the link (design_id queda en NULL gracias al ON DELETE SET NULL del FK).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }
    // Soft delete: marcamos deleted_at. El FK ON DELETE SET NULL solo dispara
    // con DELETE físico, así que limpiamos design_id manualmente.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        "UPDATE production_templates SET design_id = NULL WHERE design_id = ?",
        [id]
      );
      const [result] = await conn.execute<ResultSetHeader>(
        "UPDATE production_designs SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
        [id]
      );
      await conn.commit();
      if (result.affectedRows === 0) {
        return NextResponse.json({ error: "Design no encontrado" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error eliminando design:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
