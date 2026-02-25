import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { sendMessage } from "@/lib/google-ai";

const MODEL_ID = "gemini-3-flash-preview";

function fmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-CL");
}

function buildPrompt(budget: RowDataPacket, items: RowDataPacket[], globalExternals: RowDataPacket[]): string {
  const lines: string[] = [];

  lines.push(`Presupuesto: ${budget.project_name}`);
  if (budget.client_name) lines.push(`Cliente: ${budget.client_name}`);
  if (budget.detail) lines.push(`Detalle del proyecto: ${budget.detail}`);
  lines.push("");

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const d = typeof item.item_data === "string" ? JSON.parse(item.item_data) : item.item_data;
    const cb = item.cost_breakdown ? (typeof item.cost_breakdown === "string" ? JSON.parse(item.cost_breakdown) : item.cost_breakdown) : {};

    if (item.type === "video") {
      const ratio = d.ratio === "Otro" ? (d.ratioCustom || "personalizado") : d.ratio;
      lines.push(`Ítem ${i + 1}: Video`);
      lines.push(`  - ${d.planos} planos, máster ${d.durMaster}s en ${ratio}`);
      if (d.lipSync) lines.push(`  - Lip-sync: ${fmt(cb.lipSync || 0)}`);
      if (d.training) lines.push(`  - Entrenamiento IA: ${fmt(cb.training || 0)}`);
      if (d.complejos > 0) lines.push(`  - ${d.complejos} planos complejos: ${fmt(cb.complejos || 0)}`);
      const ad169 = Number(d.ad169) || 0, ad916 = Number(d.ad916) || 0, ad11 = Number(d.ad11) || 0;
      if (ad169 + ad916 + ad11 > 0) {
        const parts = [];
        if (ad169) parts.push(`${ad169}x 16:9`);
        if (ad916) parts.push(`${ad916}x 9:16`);
        if (ad11) parts.push(`${ad11}x 1:1`);
        lines.push(`  - Adaptaciones (${parts.join(", ")}): ${fmt(cb.adaptaciones || 0)}`);
      }
      // Reductions — support both new array format and legacy flat fields
      const reductionsArr = Array.isArray(d.reductions) ? d.reductions : [];
      if (reductionsArr.length > 0) {
        for (const r of reductionsArr) {
          const parts = [];
          if (Number(r.red169)) parts.push(`${r.red169}x 16:9`);
          if (Number(r.red916)) parts.push(`${r.red916}x 9:16`);
          if (Number(r.red11)) parts.push(`${r.red11}x 1:1`);
          if (Number(r.red45)) parts.push(`${r.red45}x 4:5`);
          if (Number(r.redOtro) && r.redOtroLabel) parts.push(`${r.redOtro}x ${r.redOtroLabel}`);
          if (parts.length) lines.push(`  - Reducción ${r.durRed}s (${parts.join(", ")})`);
        }
        if (cb.reducciones) lines.push(`  - Total reducciones: ${fmt(cb.reducciones)}`);
      } else {
        const red169 = Number(d.red169) || 0, red916 = Number(d.red916) || 0, red11 = Number(d.red11) || 0;
        if (red169 + red916 + red11 > 0) {
          const parts = [];
          if (red169) parts.push(`${red169}x 16:9`);
          if (red916) parts.push(`${red916}x 9:16`);
          if (red11) parts.push(`${red11}x 1:1`);
          lines.push(`  - Reducciones ${d.durRed}s (${parts.join(", ")}): ${fmt(cb.reducciones || 0)}`);
        }
      }
    } else {
      lines.push(`Ítem ${i + 1}: Fotografía`);
      lines.push(`  - ${d.imagenes} imágenes finales`);
      if (d.training) lines.push(`  - Entrenamiento IA: ${fmt(cb.training || 0)}`);
      if (d.retQty > 0) {
        const retLabels: Record<string, string> = { b: "básico", m: "medio", c: "complejo" };
        lines.push(`  - Retoque ${retLabels[d.retLevel] || "básico"} (${d.retQty} fotos): ${fmt(cb.retoque || 0)}`);
      }
      if (d.upscale) lines.push(`  - Escalado HiRes: ${fmt(cb.upscale || 0)}`);
      if (d.capas) lines.push(`  - Entrega en capas PSD: ${fmt(cb.capas || 0)}`);
    }

    if (item.dias_habiles) lines.push(`  - Plazo de entrega: ${item.dias_habiles} días hábiles`);

    // Item externals
    const itemExts = item.externals || [];
    for (const ext of itemExts) {
      lines.push(`  - Externo: ${ext.name} ${fmt(ext.amount)}`);
    }

    lines.push(`  - Subtotal ítem: ${fmt(Number(item.subtotal))}`);
    lines.push("");
  }

  if (globalExternals.length > 0) {
    lines.push("Costos externos globales:");
    for (const ext of globalExternals) {
      lines.push(`  - ${ext.name}: ${fmt(ext.amount)}`);
    }
    lines.push("");
  }

  const techFee = Number(budget.tech_fee_percent);
  if (techFee > 0) lines.push(`Tech Fee: ${(techFee * 100).toFixed(0)}%`);

  if (Number(budget.discount_amount) > 0) {
    const discType = budget.discount_type === "percent" ? `${budget.discount_amount}%` : fmt(Number(budget.discount_amount));
    lines.push(`Descuento: ${discType}${budget.discount_reason ? ` (${budget.discount_reason})` : ""}`);
  }

  lines.push(`Total final: ${fmt(Number(budget.total))}`);

  return lines.join("\n");
}

const SYSTEM_INSTRUCTION = `Eres un analista de presupuestos de producción audiovisual y fotográfica con IA.
Tu tarea es generar un resumen ejecutivo claro y profesional del presupuesto que se te entrega.

El resumen debe:
- Ser conciso (máximo 4-5 párrafos cortos)
- Describir el alcance general del proyecto
- Destacar los elementos principales incluidos (video, foto, servicios adicionales)
- Mencionar características técnicas relevantes (lip-sync, entrenamiento IA, adaptaciones, etc.)
- Indicar el plazo de entrega estimado si está disponible
- Cerrar con el monto total

Escribe en español, en tono profesional pero accesible. No uses viñetas ni listas, solo prosa fluida.
No inventes información que no esté en los datos proporcionados.`;

// POST - Generate AI summary for a budget
export async function POST(
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

    // Get budget with client name - non-admins can access budgets from their assigned clients
    const [budgets] = await pool.execute<RowDataPacket[]>(
      `SELECT b.*, c.name as client_name
       FROM budgets b
       LEFT JOIN clients c ON b.client_id = c.id
       WHERE b.id = ? AND b.deleted_at IS NULL
       ${isAdmin ? "" : "AND b.client_id IN (SELECT client_id FROM client_users WHERE user_id = ?)"}`,
      isAdmin ? [id] : [id, userId]
    );

    if (budgets.length === 0) {
      return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });
    }

    const budget = budgets[0];

    // Get items with externals
    const [items] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM budget_items WHERE budget_id = ? ORDER BY sort_order",
      [id]
    );

    const itemIds = items.map((item: RowDataPacket) => item.id);
    if (itemIds.length > 0) {
      const placeholders = itemIds.map(() => "?").join(",");
      const [itemExts] = await pool.execute<RowDataPacket[]>(
        `SELECT * FROM budget_item_externals WHERE budget_item_id IN (${placeholders})`,
        itemIds
      );
      const extMap: Record<number, RowDataPacket[]> = {};
      for (const e of itemExts) {
        if (!extMap[e.budget_item_id]) extMap[e.budget_item_id] = [];
        extMap[e.budget_item_id].push(e);
      }
      for (const item of items) {
        item.externals = extMap[item.id] || [];
      }
    }

    // Get global externals
    const [globalExternals] = await pool.execute<RowDataPacket[]>(
      "SELECT * FROM budget_externals WHERE budget_id = ?",
      [id]
    );

    // Build prompt and call Gemini
    const prompt = buildPrompt(budget, items, globalExternals);

    const result = await sendMessage(
      MODEL_ID,
      [{ role: "user", content: prompt }],
      SYSTEM_INSTRUCTION,
      { temperature: 0.7, maxOutputTokens: 2048 }
    );

    const summary = result.text.trim();

    // Save to database
    await pool.execute<ResultSetHeader>(
      "UPDATE budgets SET ai_summary = ? WHERE id = ?",
      [summary, id]
    );

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Error generando resumen IA:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error generando resumen" },
      { status: 500 }
    );
  }
}
