/**
 * GCP Billing Sync Script
 *
 * This script syncs billing data from BigQuery to the local database.
 * Run this script via cron daily to keep billing data up to date.
 *
 * Usage:
 *   npx ts-node scripts/sync-gcp-costs.ts [days]
 *
 * Arguments:
 *   days - Number of days to sync (default: 2 for today and yesterday)
 *
 * Cron example (run daily at 6:00 AM):
 *   0 6 * * * cd /path/to/project && npx ts-node scripts/sync-gcp-costs.ts
 */

// Load environment variables from .env.local
// Run with: npx ts-node -r dotenv/config scripts/sync-gcp-costs.ts dotenv_config_path=.env.local
// Or set environment variables before running

import { BigQuery } from "@google-cloud/bigquery";
import mysql from "mysql2/promise";

// Configuration
const BILLING_ACCOUNT_ID = process.env.GCP_BILLING_ACCOUNT_ID?.replace(/-/g, "_");
const BILLING_DATASET = process.env.GCP_BILLING_DATASET || "billing_export";
const BILLING_PROJECT = process.env.GCP_BILLING_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

interface BillingRow {
  cost_date: { value: string };
  service_id: string;
  service_description: string;
  sku_id: string | null;
  sku_description: string | null;
  project_id: string | null;
  location: string | null;
  cost: number;
  credits: number | null;
  net_cost: number;
  usage_amount: number | null;
  usage_unit: string | null;
  currency: string;
}

async function main() {
  const startTime = Date.now();
  const daysBack = parseInt(process.argv[2]) || 2;

  console.log("=".repeat(60));
  console.log(`GCP Billing Sync - ${new Date().toISOString()}`);
  console.log(`Syncing last ${daysBack} days of billing data`);
  console.log("=".repeat(60));

  // Validate configuration
  if (!BILLING_ACCOUNT_ID) {
    console.error("ERROR: GCP_BILLING_ACCOUNT_ID is not configured");
    process.exit(1);
  }

  console.log(`Project: ${BILLING_PROJECT}`);
  console.log(`Dataset: ${BILLING_DATASET}`);
  console.log(`Billing Account: ${BILLING_ACCOUNT_ID}`);

  // Initialize clients
  const bigquery = new BigQuery({
    projectId: BILLING_PROJECT,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  const pool = await mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
  });

  try {
    // Query BigQuery
    console.log("\nQuerying BigQuery...");
    const tableName = `\`${BILLING_PROJECT}.${BILLING_DATASET}.gcp_billing_export_v1_${BILLING_ACCOUNT_ID}\``;

    const query = `
      SELECT
        DATE(usage_start_time) as cost_date,
        service.id as service_id,
        service.description as service_description,
        sku.id as sku_id,
        sku.description as sku_description,
        project.id as project_id,
        location.location as location,
        SUM(cost) as cost,
        SUM((SELECT SUM(c.amount) FROM UNNEST(credits) c)) as credits,
        SUM(cost) + IFNULL(SUM((SELECT SUM(c.amount) FROM UNNEST(credits) c)), 0) as net_cost,
        SUM(usage.amount) as usage_amount,
        ANY_VALUE(usage.unit) as usage_unit,
        ANY_VALUE(currency) as currency
      FROM ${tableName}
      WHERE DATE(usage_start_time) >= DATE_SUB(CURRENT_DATE(), INTERVAL @daysBack DAY)
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      HAVING net_cost != 0
      ORDER BY cost_date DESC, net_cost DESC
    `;

    const [rows] = await bigquery.query({
      query,
      params: { daysBack },
      location: "US",
    });

    const billingRows = rows as BillingRow[];
    console.log(`Found ${billingRows.length} billing records`);

    if (billingRows.length === 0) {
      console.log("No billing data found for the specified period");
      await logSync(pool, daysBack, 0, 0, "success");
      return;
    }

    // Upsert to MySQL
    console.log("\nSyncing to MySQL...");
    let totalCost = 0;
    let synced = 0;

    for (const row of billingRows) {
      const costDate = row.cost_date.value;
      const netCost = row.net_cost || 0;
      totalCost += netCost;

      await pool.execute(
        `INSERT INTO gcp_daily_costs
         (cost_date, service_id, service_description, sku_id, sku_description,
          project_id, location, cost, credits, net_cost, usage_amount, usage_unit, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           service_description = VALUES(service_description),
           sku_description = VALUES(sku_description),
           project_id = VALUES(project_id),
           location = VALUES(location),
           cost = VALUES(cost),
           credits = VALUES(credits),
           net_cost = VALUES(net_cost),
           usage_amount = VALUES(usage_amount),
           usage_unit = VALUES(usage_unit),
           currency = VALUES(currency),
           synced_at = CURRENT_TIMESTAMP`,
        [
          costDate,
          row.service_id,
          row.service_description,
          row.sku_id,
          row.sku_description,
          row.project_id,
          row.location,
          row.cost || 0,
          row.credits || 0,
          netCost,
          row.usage_amount,
          row.usage_unit,
          row.currency || "USD",
        ]
      );
      synced++;

      // Progress indicator
      if (synced % 100 === 0) {
        console.log(`  Synced ${synced}/${billingRows.length} records...`);
      }
    }

    // Log success
    await logSync(pool, daysBack, synced, totalCost, "success");

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n" + "=".repeat(60));
    console.log("Sync completed successfully!");
    console.log(`  Records synced: ${synced}`);
    console.log(`  Total cost: $${totalCost.toFixed(4)}`);
    console.log(`  Time elapsed: ${elapsed}s`);
    console.log("=".repeat(60));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("\nERROR:", errorMessage);
    await logSync(pool, daysBack, 0, 0, "error", errorMessage);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function logSync(
  pool: mysql.Pool,
  daysBack: number,
  recordsSynced: number,
  totalCost: number,
  status: "success" | "error",
  errorMessage?: string
) {
  try {
    await pool.execute(
      `INSERT INTO gcp_sync_log
       (sync_date, records_synced, total_cost, status, error_message, started_at, completed_at)
       VALUES (CURDATE(), ?, ?, ?, ?, NOW(), NOW())`,
      [recordsSynced, totalCost, status, errorMessage || null]
    );
  } catch (err) {
    console.error("Error logging sync:", err);
  }
}

main().catch(console.error);
