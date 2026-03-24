import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getRedisConnection } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {
    db: "error",
    redis: "error",
  };

  try {
    await pool.execute("SELECT 1");
    checks.db = "ok";
  } catch {}

  try {
    const redis = getRedisConnection();
    await redis.ping();
    checks.redis = "ok";
  } catch {}

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks },
    { status: allOk ? 200 : 503 }
  );
}
