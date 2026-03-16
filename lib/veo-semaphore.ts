import { getRedisConnection } from "./redis";

export type VeoPool = "primary" | "overflow";

export interface SlotInfo {
  slotId: string;
  pool: VeoPool;
}

const POOL_KEYS: Record<VeoPool, string> = {
  primary: "veo:active_primary",
  overflow: "veo:active_overflow",
};

const MAX_PER_POOL = 9;
const STALE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes - slots auto-release after 60s RPM window

// Check if overflow is configured
function hasOverflow(): boolean {
  return !!process.env.GEMINI_API_KEY_OVERFLOW;
}

/**
 * Clean stale entries older than STALE_TIMEOUT_MS (crash safety).
 */
async function cleanStale(): Promise<void> {
  const redis = getRedisConnection();
  const cutoff = Date.now() - STALE_TIMEOUT_MS;
  await redis.zremrangebyscore(POOL_KEYS.primary, "-inf", cutoff);
  if (hasOverflow()) {
    await redis.zremrangebyscore(POOL_KEYS.overflow, "-inf", cutoff);
  }
}

/**
 * Get active count for a specific pool.
 */
async function getPoolActive(pool: VeoPool): Promise<number> {
  const redis = getRedisConnection();
  return await redis.zcard(POOL_KEYS[pool]);
}

/**
 * Get the number of available VEO generation slots (across all pools).
 */
export async function getAvailableSlots(): Promise<{ available: number; active: number; max: number }> {
  await cleanStale();
  const primaryActive = await getPoolActive("primary");
  const overflowActive = hasOverflow() ? await getPoolActive("overflow") : 0;
  const totalActive = primaryActive + overflowActive;
  const totalMax = hasOverflow() ? MAX_PER_POOL * 2 : MAX_PER_POOL;
  return {
    available: Math.max(0, totalMax - totalActive),
    active: totalActive,
    max: totalMax,
  };
}

/**
 * Acquire a VEO generation slot. Tries primary pool first, then overflow.
 * Returns slot info with pool identifier, or null if no slots available.
 */
export async function acquireSlot(): Promise<SlotInfo | null> {
  await cleanStale();
  const redis = getRedisConnection();

  // Try primary first
  const primaryActive = await redis.zcard(POOL_KEYS.primary);
  if (primaryActive < MAX_PER_POOL) {
    const slotId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    await redis.zadd(POOL_KEYS.primary, Date.now(), slotId);
    return { slotId, pool: "primary" };
  }

  // Try overflow if configured
  if (hasOverflow()) {
    const overflowActive = await redis.zcard(POOL_KEYS.overflow);
    if (overflowActive < MAX_PER_POOL) {
      const slotId = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      await redis.zadd(POOL_KEYS.overflow, Date.now(), slotId);
      return { slotId, pool: "overflow" };
    }
  }

  return null;
}

/**
 * Wait for a slot to become available, polling every intervalMs.
 * Returns slot info, or null if timed out.
 */
export async function waitForSlot(
  timeoutMs: number = 5 * 60 * 1000,
  intervalMs: number = 5000,
  onWaiting?: (position: number) => void,
): Promise<SlotInfo | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const slot = await acquireSlot();
    if (slot) return slot;

    if (onWaiting) {
      const { active, max } = await getAvailableSlots();
      onWaiting(active - max + 1);
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}

/**
 * Release a VEO generation slot.
 */
export async function releaseSlot(slotId: string, pool: VeoPool): Promise<void> {
  const redis = getRedisConnection();
  await redis.zrem(POOL_KEYS[pool], slotId);
}
