import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
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

  const callPracticante = (email: string) =>
    fetch(`${baseUrl}/api/external/agents`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "X-User-Email": email,
      },
      cache: "no-store",
    });

  try {
    // Por defecto se identifica al usuario interactuando. Si Practicante no
    // conoce ese email (404 user_not_found) y hay PRACTICANTE_USER_EMAIL
    // configurado, reintenta con ese identity compartido como fallback.
    let res = await callPracticante(primaryEmail);
    let body = await res.json().catch(() => ({} as Record<string, unknown>));

    if (
      res.status === 404 &&
      body?.code === "user_not_found" &&
      fallbackEmail &&
      fallbackEmail !== primaryEmail
    ) {
      console.warn(
        `[practicante] ${primaryEmail} no existe en Practicante; reintentando con fallback ${fallbackEmail}`
      );
      res = await callPracticante(fallbackEmail);
      body = await res.json().catch(() => ({} as Record<string, unknown>));
    }

    return NextResponse.json(body, { status: res.status });
  } catch (error) {
    console.error("Error proxying to practicante /agents:", error);
    return NextResponse.json(
      { error: "No se pudo contactar a Practicante" },
      { status: 502 }
    );
  }
}
