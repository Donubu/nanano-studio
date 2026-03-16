import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { PoolConnection } from "mysql2/promise";

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
    const isClientUser = !isAdmin && !isOwner; // If they can see it and aren't admin/owner, they're a client user

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
      is_owner: isAdmin || isOwner || isClientUser,
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

// PUT - Update draft budget
export async function PUT(
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

    // Verify budget exists, is draft, and user has access
    const [budgets] = await pool.execute<RowDataPacket[]>(
      `SELECT id, created_by, status FROM budgets WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );

    if (budgets.length === 0) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    const budget = budgets[0];

    if (budget.status !== "draft") {
      return NextResponse.json({ error: "Solo se pueden editar presupuestos en borrador" }, { status: 400 });
    }

    // Check if user is a client user (has access via client_users)
    const isOwnerPut = budget.created_by === userId;
    if (!isAdmin && !isOwnerPut) {
      const [clientAccess] = await pool.execute<RowDataPacket[]>(
        `SELECT 1 FROM client_users cu JOIN budgets b ON b.client_id = cu.client_id WHERE b.id = ? AND cu.user_id = ?`,
        [id, userId]
      );
      if (clientAccess.length === 0) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    }

    const body = await request.json();
    const {
      client_id,
      project_name,
      detail,
      items,
      externals,
      discount_amount,
      discount_type,
      discount_reason,
      tech_fee_percent,
      subtotal,
      total,
    } = body;

    if (!project_name || !items || items.length === 0) {
      return NextResponse.json({ error: "Proyecto e ítems son requeridos" }, { status: 400 });
    }

    // Non-admins must specify a client they have access to
    if (!isAdmin) {
      if (!client_id) {
        return NextResponse.json({ error: "Debes seleccionar un cliente" }, { status: 400 });
      }
      const [clientAccess] = await pool.execute<RowDataPacket[]>(
        "SELECT 1 FROM client_users WHERE client_id = ? AND user_id = ?",
        [client_id, userId]
      );
      if (clientAccess.length === 0) {
        return NextResponse.json({ error: "No tienes acceso a este cliente" }, { status: 403 });
      }
    }

    // Fetch current config for cost breakdown calculation
    const [configRows] = await pool.execute<RowDataPacket[]>(
      "SELECT config_key, config_value FROM budget_config"
    );
    const configMap: Record<string, unknown> = {};
    for (const row of configRows) {
      configMap[row.config_key] = typeof row.config_value === "string"
        ? JSON.parse(row.config_value)
        : row.config_value;
    }
    const videoConfig = configMap.video as { basePlano: number; lipSync: number; training: number; complejo: number; adaptacion: number; reduccion: number } | undefined;
    const fotoConfig = configMap.foto as { baseImagen: number; training: number; capas: number; upscale: number; retouch: { b: number; m: number; c: number } } | undefined;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Update budget row
    await connection.execute(
      `UPDATE budgets SET
        client_id = ?, project_name = ?, detail = ?,
        tech_fee_percent = ?, discount_amount = ?, discount_type = ?, discount_reason = ?,
        subtotal = ?, total = ?, ai_summary = NULL, updated_at = NOW()
      WHERE id = ?`,
      [client_id || null, project_name, detail || null, tech_fee_percent ?? 0.05, discount_amount ?? 0, discount_type || "amount", discount_reason || null, subtotal ?? 0, total ?? 0, id]
    );

    // Delete old child rows
    const [oldItems] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM budget_items WHERE budget_id = ?",
      [id]
    );
    const oldItemIds = oldItems.map((r: RowDataPacket) => r.id);

    if (oldItemIds.length > 0) {
      const ph = oldItemIds.map(() => "?").join(",");
      await connection.execute(`DELETE FROM budget_item_hours WHERE budget_item_id IN (${ph})`, oldItemIds);
      await connection.execute(`DELETE FROM budget_item_externals WHERE budget_item_id IN (${ph})`, oldItemIds);
    }
    await connection.execute("DELETE FROM budget_items WHERE budget_id = ?", [id]);
    await connection.execute("DELETE FROM budget_externals WHERE budget_id = ?", [id]);

    // Re-insert items (same logic as POST)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      let costBreakdown: Record<string, number> = {};
      const d = item.item_data || {};
      if (item.type === "video" && videoConfig) {
        const base = (Number(d.planos) || 0) * videoConfig.basePlano;
        const cLip = d.lipSync ? base * videoConfig.lipSync : 0;
        const cTr = d.training ? base * videoConfig.training : 0;
        const cComp = (base * videoConfig.complejo) * (Number(d.complejos) || 0);
        const adT = (Number(d.ad169) || 0) + (Number(d.ad916) || 0) + (Number(d.ad11) || 0) + (Number(d.ad45) || 0);
        const reductions = Array.isArray(d.reductions) ? d.reductions : [];
        const reT = reductions.reduce((sum: number, r: Record<string, number>) =>
          sum + (Number(r.red169) || 0) + (Number(r.red916) || 0) + (Number(r.red11) || 0) + (Number(r.red45) || 0) + (Number(r.redOtro) || 0), 0);
        const cAd = (base * videoConfig.adaptacion) * adT;
        const cRe = (base * videoConfig.reduccion) * reT;
        costBreakdown = { base, lipSync: cLip, training: cTr, complejos: cComp, adaptaciones: cAd, reducciones: cRe };
      } else if (item.type === "photo" && fotoConfig) {
        const base = (Number(d.imagenes) || 0) * fotoConfig.baseImagen;
        const cTr = d.training ? base * fotoConfig.training : 0;
        const retLevel = (d.retLevel as string) || "b";
        const retLevelVal = retLevel === "b" ? fotoConfig.retouch.b : retLevel === "m" ? fotoConfig.retouch.m : fotoConfig.retouch.c;
        const cRet = (Number(d.retQty) || 0) * retLevelVal;
        const cUp = d.upscale ? (Number(d.imagenes) || 0) * fotoConfig.upscale : 0;
        const subPre = base + cTr + cRet + cUp;
        const cCap = d.capas ? subPre * fotoConfig.capas : 0;
        costBreakdown = { base, training: cTr, retoque: cRet, upscale: cUp, capas: cCap };
      }

      const [itemResult] = await connection.execute<ResultSetHeader>(
        `INSERT INTO budget_items (budget_id, type, sort_order, mode, dias_habiles, item_data, subtotal, cost_breakdown)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.type, i, item.mode || "dias_habiles", item.dias_habiles ?? null, JSON.stringify(item.item_data), item.subtotal ?? 0, JSON.stringify(costBreakdown)]
      );
      const itemId = itemResult.insertId;

      if (item.hours && item.hours.length > 0) {
        for (const h of item.hours) {
          await connection.execute(
            "INSERT INTO budget_item_hours (budget_item_id, user_id, hours) VALUES (?, ?, ?)",
            [itemId, h.user_id, h.hours]
          );
        }
      }

      if (item.externals && item.externals.length > 0) {
        for (const ext of item.externals) {
          if (ext.name && ext.amount > 0) {
            await connection.execute(
              "INSERT INTO budget_item_externals (budget_item_id, name, amount) VALUES (?, ?, ?)",
              [itemId, ext.name, ext.amount]
            );
          }
        }
      }
    }

    // Re-insert global externals
    if (externals && externals.length > 0) {
      for (const ext of externals) {
        if (ext.name && ext.amount > 0) {
          await connection.execute(
            "INSERT INTO budget_externals (budget_id, name, amount) VALUES (?, ?, ?)",
            [id, ext.name, ext.amount]
          );
        }
      }
    }

    await connection.commit();

    return NextResponse.json({ id: Number(id) });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error actualizando presupuesto:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
