import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

const DEFAULT_CONFIG = {
  tech_fee: 0.05,
  video: {
    basePlano: 300000,
    lipSync: 0.20,
    training: 0.15,
    complejo: 0.10,
    adaptacion: 0.10,
    reduccion: 0.10,
  },
  foto: {
    baseImagen: 100000,
    training: 1.0,
    capas: 0.50,
    upscale: 100000,
    retouch: { b: 50000, m: 100000, c: 200000 },
  },
};

// GET - Get calculator configuration
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT config_key, config_value FROM budget_config"
    );

    const config: Record<string, unknown> = {};
    for (const row of rows) {
      config[row.config_key] = typeof row.config_value === "string"
        ? JSON.parse(row.config_value)
        : row.config_value;
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error("Error obteniendo config:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// PUT - Update calculator configuration (admin only)
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = (session.user as { id: number }).id;
    const body = await request.json();

    const allowedKeys = ["tech_fee", "video", "foto"];

    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        await pool.execute(
          `INSERT INTO budget_config (config_key, config_value, updated_by)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)`,
          [key, JSON.stringify(body[key]), userId]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando config:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Reset to factory defaults (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const userId = (session.user as { id: number }).id;

    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
      await pool.execute(
        `INSERT INTO budget_config (config_key, config_value, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)`,
        [key, JSON.stringify(value), userId]
      );
    }

    return NextResponse.json(DEFAULT_CONFIG);
  } catch (error) {
    console.error("Error restaurando config:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
