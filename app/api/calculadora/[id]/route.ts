import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// GET - Budget detail with items, hours, and externals
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const isAdmin = session.user.role === "admin";
    const userId = (session.user as { id: number }).id;

    // Get budget - non-admins can view budgets from their assigned clients
    const [budgets] = await pool.execute<RowDataPacket[]>(
      `SELECT
        b.*,
        c.name as client_name,
        u.name as creator_name,
        u.email as creator_email
      FROM budgets b
      LEFT JOIN clients c ON b.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      WHERE b.id = ? AND b.deleted_at IS NULL
      ${isAdmin ? "" : "AND b.client_id IN (SELECT client_id FROM client_users WHERE user_id = ?)"}`,
      isAdmin ? [id] : [id, userId]
    );

    if (budgets.length === 0) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    const budget = budgets[0];
    const isOwner = budget.created_by === userId;

    // Get items
    const [items] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM budget_items WHERE budget_id = ? ORDER BY sort_order",
      [id]
    );

    // Get hours for all items
    const itemIds = items.map((item: RowDataPacket) => item.id);
    let hoursMap: Record<number, RowDataPacket[]> = {};
    let itemExternalsMap: Record<number, RowDataPacket[]> = {};

    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => "?").join(",");

      const [hours] = await pool.execute<RowDataPacket[]>(
        `SELECT bih.*, u.name as user_name, u.email as user_email, u.cargo as user_cargo
         FROM budget_item_hours bih
         LEFT JOIN users u ON bih.user_id = u.id
         WHERE bih.budget_item_id IN (${placeholders})`,
        itemIds
      );
      for (const h of hours) {
        if (!hoursMap[h.budget_item_id]) hoursMap[h.budget_item_id] = [];
        hoursMap[h.budget_item_id].push(h);
      }

      const [itemExts] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM budget_item_externals WHERE budget_item_id IN (${placeholders})`,
        itemIds
      );
      for (const e of itemExts) {
        if (!itemExternalsMap[e.budget_item_id]) itemExternalsMap[e.budget_item_id] = [];
        itemExternalsMap[e.budget_item_id].push(e);
      }
    }

    // Get global externals
    const [globalExternals] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM budget_externals WHERE budget_id = ?",
      [id]
    );

    // Assemble response
    const result = {
      ...budget,
      is_owner: isAdmin || isOwner,
      items: items.map((item: RowDataPacket) => ({
        ...item,
        item_data: typeof item.item_data === "string" ? JSON.parse(item.item_data) : item.item_data,
        cost_breakdown: item.cost_breakdown ? (typeof item.cost_breakdown === "string" ? JSON.parse(item.cost_breakdown) : item.cost_breakdown) : null,
        hours: hoursMap[item.id] || [],
        externals: itemExternalsMap[item.id] || [],
      })),
      externals: globalExternals,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error obteniendo presupuesto:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Soft delete budget
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const isAdmin = session.user.role === "admin";
    const userId = (session.user as { id: number }).id;

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE budgets SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL ${isAdmin ? "" : "AND created_by = ?"}`,
      isAdmin ? [id] : [id, userId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando presupuesto:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
