import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { PoolConnection } from "mysql2/promise";

interface BudgetRow extends RowDataPacket {
  id: number;
  client_id: number | null;
  client_name: string | null;
  project_name: string;
  created_by: number;
  creator_name: string | null;
  creator_email: string;
  status: "draft" | "accepted" | "rejected";
  status_note: string | null;
  status_date: string | null;
  discount_amount: number;
  discount_reason: string | null;
  tech_fee_percent: number;
  subtotal: number;
  total: number;
  item_count: number;
  created_at: string;
  updated_at: string;
}

// GET - Listar presupuestos
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const isAdmin = session.user.role === "admin";
    const userId = (session.user as { id: number }).id;

    // Verify calculator access for non-admin users
    if (!isAdmin) {
      const [accessRows] = await pool.execute<RowDataPacket[]>(
        "SELECT ai_calculator_access FROM users WHERE id = ?",
        [userId]
      );
      if (!accessRows.length || accessRows[0].ai_calculator_access !== 1) {
        return NextResponse.json({ error: "Sin acceso a calculadora" }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = `
      SELECT
        b.id, b.client_id, b.project_name, b.created_by,
        b.status, b.status_note, b.status_date,
        b.discount_amount, b.discount_reason,
        b.tech_fee_percent, b.subtotal, b.total,
        b.created_at, b.updated_at,
        c.name as client_name,
        u.name as creator_name,
        u.email as creator_email,
        (SELECT COUNT(*) FROM budget_items WHERE budget_id = b.id) as item_count
      FROM budgets b
      LEFT JOIN clients c ON b.client_id = c.id
      LEFT JOIN users u ON b.created_by = u.id
      WHERE b.deleted_at IS NULL
      ${isAdmin ? "" : "AND b.client_id IN (SELECT client_id FROM client_users WHERE user_id = ?)"}
    `;

    const params: (number | string)[] = isAdmin ? [] : [userId];

    if (status) {
      query += " AND b.status = ?";
      params.push(status);
    }

    query += " ORDER BY b.created_at DESC";

    const [rows] = await pool.execute<BudgetRow[]>(query, params);

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error obteniendo presupuestos:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Crear presupuesto
export async function POST(request: NextRequest) {
  let connection: PoolConnection | null = null;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = (session.user as { id: number }).id;
    const isAdmin = session.user.role === "admin";

    if (!isAdmin) {
      const [accessRows] = await pool.execute<RowDataPacket[]>(
        "SELECT ai_calculator_access FROM users WHERE id = ?",
        [userId]
      );
      if (!accessRows.length || accessRows[0].ai_calculator_access !== 1) {
        return NextResponse.json({ error: "Sin acceso a calculadora" }, { status: 403 });
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

    // Create budget
    const [budgetResult] = await connection.execute<ResultSetHeader>(
      `INSERT INTO budgets (client_id, project_name, detail, created_by, tech_fee_percent, discount_amount, discount_type, discount_reason, subtotal, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client_id || null, project_name, detail || null, userId, tech_fee_percent ?? 0.05, discount_amount ?? 0, discount_type || "amount", discount_reason || null, subtotal ?? 0, total ?? 0]
    );
    const budgetId = budgetResult.insertId;

    // Create items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Calculate cost breakdown with current config values
      let costBreakdown: Record<string, number> = {};
      const d = item.item_data || {};
      if (item.type === "video" && videoConfig) {
        const base = (Number(d.planos) || 0) * videoConfig.basePlano;
        const cLip = d.lipSync ? base * videoConfig.lipSync : 0;
        const cTr = d.training ? base * videoConfig.training : 0;
        const cComp = (base * videoConfig.complejo) * (Number(d.complejos) || 0);
        const adT = (Number(d.ad169) || 0) + (Number(d.ad916) || 0) + (Number(d.ad11) || 0);
        const reT = (Number(d.red169) || 0) + (Number(d.red916) || 0) + (Number(d.red11) || 0);
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
        [budgetId, item.type, i, item.mode || "dias_habiles", item.dias_habiles ?? null, JSON.stringify(item.item_data), item.subtotal ?? 0, JSON.stringify(costBreakdown)]
      );
      const itemId = itemResult.insertId;

      // Create item hours
      if (item.hours && item.hours.length > 0) {
        for (const h of item.hours) {
          await connection.execute(
            "INSERT INTO budget_item_hours (budget_item_id, user_id, hours) VALUES (?, ?, ?)",
            [itemId, h.user_id, h.hours]
          );
        }
      }

      // Create item externals
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

    // Create global externals
    if (externals && externals.length > 0) {
      for (const ext of externals) {
        if (ext.name && ext.amount > 0) {
          await connection.execute(
            "INSERT INTO budget_externals (budget_id, name, amount) VALUES (?, ?, ?)",
            [budgetId, ext.name, ext.amount]
          );
        }
      }
    }

    await connection.commit();

    return NextResponse.json({ id: budgetId }, { status: 201 });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Error creando presupuesto:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
