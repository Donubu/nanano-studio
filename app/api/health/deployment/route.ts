import { NextResponse } from "next/server";
import { isRedisConfigured, getRedisConnection } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isRedisConfigured()) {
    return NextResponse.json({ active: false });
  }

  try {
    const redis = getRedisConnection();
    const data = await redis.get("deployment:active");

    if (!data) {
      return NextResponse.json({ active: false });
    }

    const parsed = JSON.parse(data);
    return NextResponse.json({
      active: true,
      startedAt: parsed.startedAt,
      estimatedSeconds: parsed.estimatedSeconds || 120,
    });
  } catch {
    return NextResponse.json({ active: false });
  }
}
