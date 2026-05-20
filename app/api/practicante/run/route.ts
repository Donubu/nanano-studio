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
  const primaryEmail = session.user.email;
  const fallbackEmail = process.env.PRACTICANTE_USER_EMAIL;

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
  // Replicate the QA profile defaults: forceAgent when an agent is targeted,
  // responseFormat=json, normalize=false (mensaje llega al agente sin
  // pre-procesamiento del orquestador).
  const payload: Record<string, unknown> = {
    message,
    dryRun: body.dryRun === true,
    normalize: false,
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

  const callPracticante = (email: string) =>
    fetch(`${baseUrl}/api/external/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-User-Email": email,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

  try {
    // Por defecto se identifica al usuario interactuando. Si Practicante no
    // conoce ese email (404 user_not_found) y hay PRACTICANTE_USER_EMAIL
    // configurado, reintenta con ese identity compartido como fallback.
    let res = await callPracticante(primaryEmail);
    let responseBody = await res.json().catch(() => ({} as Record<string, unknown>));

    if (
      res.status === 404 &&
      responseBody?.code === "user_not_found" &&
      fallbackEmail &&
      fallbackEmail !== primaryEmail
    ) {
      console.warn(
        `[practicante] ${primaryEmail} no existe en Practicante; reintentando con fallback ${fallbackEmail}`
      );
      res = await callPracticante(fallbackEmail);
      responseBody = await res.json().catch(() => ({} as Record<string, unknown>));
    }

    return NextResponse.json(responseBody, { status: res.status });
  } catch (error) {
    console.error("Error proxying to practicante /run:", error);
    return NextResponse.json(
      { error: "No se pudo contactar a Practicante" },
      { status: 502 }
    );
  }
}
