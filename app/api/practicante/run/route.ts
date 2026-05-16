import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

interface RunRequestBody {
  message?: string;
  agentId?: string;
  agentName?: string;
  dryRun?: boolean;
  existingConversationId?: string;
  files?: Array<{ filename: string; publicUrl: string; mimeType: string }>;
  promptSuffix?: string;
  returnOnlyFinalText?: boolean;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.PRACTICANTE_URL;
  const apiKey = process.env.PRACTICANTE_API_KEY;
  // Practicante identifica al user por email. Mandamos el del usuario que
  // está interactuando; el env var actúa como override (debug / cuentas de
  // servicio). Practicante responderá 404 user_not_found si el email no
  // existe del lado de Practicante con permisos configurados.
  const userEmail = process.env.PRACTICANTE_USER_EMAIL || session.user.email;

  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: "Practicante no configurado (falta PRACTICANTE_URL o PRACTICANTE_API_KEY)" },
      { status: 500 }
    );
  }

  let body: RunRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body invalido" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Falta el prompt" }, { status: 400 });
  }

  // New external contract (post-ExternalApiProfile cutover): the per-user
  // profile flags are gone; behavior is set in the body of every request.
  // Replicate the QA profile defaults: forceAgent when an agent is targeted
  // and responseFormat=json. normalize defaults to false server-side.
  const payload: Record<string, unknown> = {
    message,
    dryRun: body.dryRun === true,
  };

  const context: Record<string, unknown> = {
    responseFormat: "json",
  };
  if (body.agentName) {
    context.agentName = body.agentName;
    context.forceAgent = true;
  }
  if (body.promptSuffix) context.promptSuffix = body.promptSuffix;
  payload.context = context;

  if (body.existingConversationId) {
    payload.existingConversationId = body.existingConversationId;
  }
  if (body.files && body.files.length > 0) {
    payload.files = body.files;
  }
  if (typeof body.returnOnlyFinalText === "boolean") {
    payload.returnOnlyFinalText = body.returnOnlyFinalText;
  }

  try {
    const res = await fetch(`${baseUrl}/api/external/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-User-Email": userEmail,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const responseBody = await res.json().catch(() => ({}));
    return NextResponse.json(responseBody, { status: res.status });
  } catch (error) {
    console.error("Error proxying to practicante /run:", error);
    return NextResponse.json(
      { error: "No se pudo contactar a Practicante" },
      { status: 502 }
    );
  }
}
