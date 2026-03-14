import { auth } from "@/auth";
import { getAvailableSlots } from "@/lib/veo-semaphore";
import { isRedisConfigured } from "@/lib/redis";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isRedisConfigured()) {
    // If Redis is not configured, assume all slots available
    const max = process.env.GEMINI_API_KEY_OVERFLOW ? 18 : 9;
    return Response.json({ available: max, active: 0, max });
  }

  try {
    const slots = await getAvailableSlots();
    return Response.json(slots);
  } catch (error) {
    console.error("[VEO Slots] Error:", error);
    const max = process.env.GEMINI_API_KEY_OVERFLOW ? 18 : 9;
    return Response.json({ available: max, active: 0, max });
  }
}
