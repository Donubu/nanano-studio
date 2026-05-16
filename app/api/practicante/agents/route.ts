import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.PRACTICANTE_URL;
  const apiKey = process.env.PRACTICANTE_API_KEY;
  // Per-request: el catálogo de agentes que ve cada usuario depende de sus
  // permisos en Practicante. El env var queda como override para debug.
  const userEmail = process.env.PRACTICANTE_USER_EMAIL || session.user.email;

  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { error: "Practicante no configurado (falta PRACTICANTE_URL o PRACTICANTE_API_KEY)" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${baseUrl}/api/external/agents`, {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "X-User-Email": userEmail,
      },
      cache: "no-store",
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(body, { status: res.status });
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error("Error proxying to practicante /agents:", error);
    return NextResponse.json(
      { error: "No se pudo contactar a Practicante" },
      { status: 502 }
    );
  }
}
