import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Common Redis options for stable connections (prevent ETIMEDOUT on long jobs)
const REDIS_COMMON_OPTIONS = {
  maxRetriesPerRequest: null as null, // Required by BullMQ
  enableReadyCheck: false,
  keepAlive: 30000,         // Send TCP keepAlive every 30s
  connectTimeout: 30000,    // 30s connection timeout
  retryStrategy(times: number) {
    return Math.min(times * 500, 15000); // Retry with backoff, max 15s
  },
};

// Shared connection for general use (queues, pub)
let sharedConnection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!sharedConnection) {
    sharedConnection = new Redis(REDIS_URL, REDIS_COMMON_OPTIONS);
  }
  return sharedConnection;
}

// Create a new independent connection (for subscribers, workers)
export function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, REDIS_COMMON_OPTIONS);
}

export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}
