import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Shared connection for general use (queues, pub)
let sharedConnection: Redis | null = null;

export function getRedisConnection(): Redis {
  if (!sharedConnection) {
    sharedConnection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    });
  }
  return sharedConnection;
}

// Create a new independent connection (for subscribers, workers)
export function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}
