import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { PoolConnection } from "mysql2/promise";

// POST - Duplicate a budget as a new draft
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let connection: PoolConnection | null = null;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const isAdmin = session.user.role === "admin";
    const userId = (session.user as { id: number }).id;

    // Get original budget - non-admins can duplicate budgets from their assigned clients
    const [budgets] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM budgets WHERE id = ? AND deleted_at IS NULL ${isAdmin ? "" : "AND client_id IN (SELECT client_id FROM client_users WHERE user_id = ?)"}`,
      isAdmin ? [id] : [id, userId]
    );

    if (budgets.length === 0) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    const original = budgets[0];

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Create new budget as draft
    const [budgetResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO budgets (client_id, project_name, detail, created_by, tech_fee_percent, discount_amount, discount_type, discount_reason, subtotal, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [original.client_id, original.project_name + " (copia)", original.detail, userId, original.tech_fee_percent, original.discount_amount, original.discount_type || "amount", original.discount_reason, original.subtotal, original.total]
    );
    const newBudgetId = budgetResult.insertId;

    // Get and duplicate items
    const [items] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM budget_items WHERE budget_id = ?",
      [id]
    );

    for (const item of items) {
      const [itemResult] = await connection.execute<ResultSetHeader>(
        "INSERT INTO budget_items (budget_id, type, sort_order, mode, dias_habiles, item_data, subtotal, cost_breakdown) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [newBudgetId, item.type, item.sort_order, item.mode, item.dias_habiles, typeof item.item_data === "string" ? item.item_data : JSON.stringify(item.item_data), item.subtotal, item.cost_breakdown ? (typeof item.cost_breakdown === "string" ? item.cost_breakdown : JSON.stringify(item.cost_breakdown)) : null]
      );
      const newItemId = itemResult.insertId;

      // Duplicate hours
      const [hours] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM budget_item_hours WHERE budget_item_id = ?",
        [item.id]
      );
      for (const h of hours) {
        await connection.execute(
          "INSERT INTO budget_item_hours (budget_item_id, user_id, hours) VALUES (?, ?, ?)",
          [newItemId, h.user_id, h.hours]
        );
      }

      // Duplicate item externals
      const [itemExts] = await connection.execute<RowDataPacket[]>(
        "SELECT * FROM budget_item_externals WHERE budget_item_id = ?",
        [item.id]
      );
      for (const e of itemExts) {
        await connection.execute(
          "INSERT INTO budget_item_externals (budget_item_id, name, amount) VALUES (?, ?, ?)",
          [newItemId, e.name, e.amount]
        );
      }
    }

    // Duplicate global externals
    const [globalExts] = await connection.execute<RowDataPacket[]>(
      "SELECT * FROM budget_externals WHERE budget_id = ?",
      [id]
    );
    for (const e of globalExts) {
      await connection.execute(
        "INSERT INTO budget_externals (budget_id, name, amount) VALUES (?, ?, ?)",
        [newBudgetId, e.name, e.amount]
      );
    }

    await connection.commit();

    return NextResponse.json({ id: newBudgetId }, { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error duplicando presupuesto:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
