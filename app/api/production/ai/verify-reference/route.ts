// Endpoint: verificación visual de una propuesta "Fiel a la referencia".
// El cliente renderiza la propuesta, la captura y la manda junto con la
// referencia; Gemini compara y devuelve correcciones chicas por capa que el
// motor aplica con topes (lib/production/reference-verify.ts). Hasta 2
// pasadas, las maneja el cliente (re-renderiza entre una y otra).
//
// URL: POST /api/production/ai/verify-reference
//   Body: {
//     production_project_id: number,
//     reference: { publicUrl, mimeType },   // la subida a /api/production/upload
//     render: { mimeType, data },           // base64 de la captura
//     definition: TemplateDefinition,       // la propuesta tal como está
//     variant_dims?: [{ w, h }],            // para re-derivar las orientaciones
//     pass?: 1 | 2
//   }
// Devuelve { definition, preview, variants, fidelity, applied, summary,
// tokenUsage, invocation_id }. NO escribe el template.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { EMPTY_KIT_CONTENT, resolveColor, resolveTreeTokens } from "@/lib/production/brand-kit";
import { resolveProjectBrandKit } from "@/lib/production/project-brand-kit";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { downloadReference } from "@/lib/production/reference-images";
import { validateTemplateDefinition } from "@/lib/production/template-schema";
import { adaptTree } from "@/lib/production/adapt";
import { ensureTextContrast } from "@/lib/production/layout-plan";
import { LAYOUT_PLANNER_MODEL } from "@/lib/production/layout-planner";
import { requestReferenceVerification } from "@/lib/production/reference-verifier";
import { applyReferenceCorrections, describeLayersForVerify, MAX_VERIFY_PASSES } from "@/lib/production/reference-verify";
import type { TemplateDefinition } from "@/lib/production/types";

export const maxDuration = 120;

const bodySchema = z.object({
  production_project_id: z.number().int().positive(),
  reference: z.object({ publicUrl: z.string().url().max(2000), mimeType: z.string().min(1).max(100) }),
  render: z.object({ mimeType: z.enum(["image/webp", "image/jpeg", "image/png"]), data: z.string().min(100).max(12_000_000) }),
  definition: z.unknown(),
  variant_dims: z.array(z.object({ w: z.number().int().positive().max(10000), h: z.number().int().positive().max(10000) })).max(5).optional(),
  pass: z.number().int().min(1).max(MAX_VERIFY_PASSES).optional(),
});

interface ProjectRow extends RowDataPacket {
  client_id: number;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const { production_project_id, reference, render, variant_dims } = parsed.data;
    const pass = parsed.data.pass ?? 1;

    const validated = validateTemplateDefinition(parsed.data.definition);
    if (!validated.ok) return NextResponse.json({ error: `Definición inválida: ${validated.error}` }, { status: 400 });
    const def = validated.definition;

    const [projRows] = await pool.execute<ProjectRow[]>("SELECT client_id FROM production_projects WHERE id = ?", [
      production_project_id,
    ]);
    if (projRows.length === 0) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    const clientId = projRows[0].client_id;

    const quota = await checkProductionAiQuota({ projectId: production_project_id, userId });
    if (!quota.ok) return NextResponse.json(quotaBlockedBody(quota), { status: 429 });

    const kit = (await resolveProjectBrandKit(clientId, production_project_id))?.content ?? EMPTY_KIT_CONTENT;
    const resolveC = (c: string) => resolveColor(c, kit, c);

    const startedAt = Date.now();
    let referenceImage: { mimeType: string; data: string };
    try {
      referenceImage = await downloadReference(reference.publicUrl);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    let result: Awaited<ReturnType<typeof requestReferenceVerification>>;
    try {
      result = await requestReferenceVerification({
        reference: referenceImage,
        render: { mimeType: render.mimeType, data: render.data },
        layers: describeLayersForVerify(def),
        pass,
      });
    } catch (e) {
      const err = e as Error & { usage?: { inputTokens: number; outputTokens: number; estimatedCost: number } };
      await pool.execute<ResultSetHeader>(
        `INSERT INTO production_ai_invocations
           (production_project_id, template_id, target_template_id, operation, agent_name, model,
            input_tokens, output_tokens, estimated_cost, duration_ms, success, error_msg, conversation_id, rationale, created_by)
         VALUES (?, NULL, NULL, 'VERIFY_REFERENCE', 'reference-verifier', ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?)`,
        [
          production_project_id,
          LAYOUT_PLANNER_MODEL,
          err.usage?.inputTokens ?? null,
          err.usage?.outputTokens ?? null,
          err.usage?.estimatedCost ?? null,
          Date.now() - startedAt,
          err.message.slice(0, 4000),
          userId,
        ],
      );
      return NextResponse.json({ error: err.message }, { status: 502 });
    }

    const { verification, usage } = result;
    const corrected = applyReferenceCorrections(def, verification.corrections);
    const definition: TemplateDefinition = ensureTextContrast(corrected.definition, resolveC);
    const variants = (variant_dims ?? []).map((dims) => ({
      dims,
      definition: ensureTextContrast(adaptTree(definition, dims), resolveC),
    }));

    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation, agent_name, model,
          input_tokens, output_tokens, estimated_cost, duration_ms, success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, NULL, NULL, 'VERIFY_REFERENCE', 'reference-verifier', ?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)`,
      [
        production_project_id,
        LAYOUT_PLANNER_MODEL,
        usage.inputTokens,
        usage.outputTokens,
        usage.estimatedCost,
        Date.now() - startedAt,
        `pasada ${pass}: fidelidad ${verification.fidelity}, ${corrected.applied} correcciones. ${verification.summary}`.slice(0, 8000),
        userId,
      ],
    );

    return NextResponse.json({
      definition,
      preview: resolveTreeTokens(definition, kit),
      variants,
      fidelity: verification.fidelity,
      applied: corrected.applied,
      corrections: verification.corrections.length,
      summary: verification.summary,
      tokenUsage: usage,
      invocation_id: inv.insertId,
    });
  } catch (error) {
    console.error("Error en verify-reference:", error);
    return NextResponse.json({ error: `Error interno: ${(error as Error).message}` }, { status: 500 });
  }
}
