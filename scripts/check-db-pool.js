#!/usr/bin/env node
// Usage: node scripts/check-db-pool.js
// Checks MySQL connection status and stuck queries

const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

// Load env from .env.gcp
const envFile = path.resolve(__dirname, "../.env.gcp");
const env = {};
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8").split("\n").forEach((line) => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, "");
  });
}

(async () => {
  const conn = await mysql.createConnection({
    host: env.DB_HOST || process.env.DB_HOST,
    port: Number(env.DB_PORT || process.env.DB_PORT) || 3306,
    user: env.DB_USER || process.env.DB_USER,
    password: env.DB_PASSWORD || process.env.DB_PASSWORD,
    database: env.DB_NAME || process.env.DB_NAME,
    connectTimeout: 10000,
  });

  const [rows] = await conn.query("SHOW PROCESSLIST");
  const grouped = {};
  rows.forEach((r) => {
    if (!grouped[r.Command]) grouped[r.Command] = 0;
    grouped[r.Command]++;
  });

  console.log(`Total connections: ${rows.length}`);
  console.log("By command:", grouped);

  const stuck = rows.filter((r) => r.Command === "Execute" && r.Time > 5);
  if (stuck.length === 0) {
    console.log("\nNo stuck queries");
  } else {
    console.log(`\nSTUCK queries: ${stuck.length}`);
    stuck.forEach((r) =>
      console.log(`  ID:${r.Id} Time:${r.Time}s Info:${(r.Info || "").substring(0, 100)}`)
    );
  }

  await conn.end();
})().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
