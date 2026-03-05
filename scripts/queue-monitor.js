#!/usr/bin/env node
const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE = "generation-stream";
const redis = new Redis(REDIS_URL);

async function getStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    redis.llen(`bull:${QUEUE}:wait`),
    redis.llen(`bull:${QUEUE}:active`),
    redis.zcard(`bull:${QUEUE}:completed`),
    redis.zcard(`bull:${QUEUE}:failed`),
    redis.zcard(`bull:${QUEUE}:delayed`),
  ]);
  return { waiting, active, completed, failed, delayed };
}

async function getActiveJobs() {
  const ids = await redis.lrange(`bull:${QUEUE}:active`, 0, -1);
  const jobs = [];
  for (const id of ids) {
    const data = await redis.hgetall(`bull:${QUEUE}:${id}`);
    if (data.data) {
      const parsed = JSON.parse(data.data);
      jobs.push({
        id,
        model: parsed.modelId,
        conversation: parsed.conversationId,
        type: parsed.generationType,
        quality: parsed.qualityTier,
      });
    }
  }
  return jobs;
}

async function run() {
  const watch = process.argv.includes("--watch");

  const display = async () => {
    const stats = await getStats();
    const active = await getActiveJobs();

    console.clear();
    console.log(`=== Queue Monitor: ${QUEUE} ===`);
    console.log(`  Waiting:   ${stats.waiting}`);
    console.log(`  Active:    ${stats.active}`);
    console.log(`  Completed: ${stats.completed}`);
    console.log(`  Failed:    ${stats.failed}`);
    console.log(`  Delayed:   ${stats.delayed}`);

    if (active.length > 0) {
      console.log(`\n--- Active Jobs ---`);
      for (const job of active) {
        console.log(`  [${job.id}] ${job.model} | conv:${job.conversation} | ${job.type}/${job.quality}`);
      }
    }
    console.log(`\n  ${new Date().toLocaleTimeString()}`);
  };

  if (watch) {
    setInterval(display, 1000);
  } else {
    await display();
    redis.disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  redis.disconnect();
});
