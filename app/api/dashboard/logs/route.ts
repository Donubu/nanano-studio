import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { listContainers, getContainerLogs, isDockerAvailable } from "@/lib/docker";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    if (!isDockerAvailable()) {
      return NextResponse.json({
        available: false,
        containers: [],
        error: "Docker socket no disponible",
      });
    }

    const containerId = request.nextUrl.searchParams.get("container");
    const tail = Math.min(
      parseInt(request.nextUrl.searchParams.get("tail") || "300", 10),
      5000
    );

    if (containerId) {
      // Validate container ID format (alphanumeric, underscores, hyphens only)
      if (!/^[a-zA-Z0-9_-]+$/.test(containerId)) {
        return NextResponse.json({ error: "ID de contenedor inválido" }, { status: 400 });
      }
      const logs = await getContainerLogs(containerId, tail);
      return NextResponse.json({ logs });
    }

    const containers = await listContainers();
    return NextResponse.json({ available: true, containers });
  } catch (error) {
    console.error("Error fetching docker logs:", error);
    return NextResponse.json(
      { error: "Error al obtener logs" },
      { status: 500 }
    );
  }
}
