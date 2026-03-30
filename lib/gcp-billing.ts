/**
 * GCP Billing Integration
 * Syncs billing data from BigQuery to local MySQL database
 */

import { BigQuery } from "@google-cloud/bigquery";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// Initialize BigQuery client
const bigquery = new BigQuery({
  projectId: process.env.GCP_BILLING_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// Environment configuration
const BILLING_ACCOUNT_ID = process.env.GCP_BILLING_ACCOUNT_ID?.replace(/-/g, "_");
const BILLING_DATASET = process.env.GCP_BILLING_DATASET || "billing_export";
const BILLING_PROJECT = process.env.GCP_BILLING_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const BILLING_LOCATION = process.env.GCP_BILLING_LOCATION || "US";

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

interface GcpDailyCost extends RowDataPacket {
  id: number;
  cost_date: string;
  service_id: string;
  service_description: string;
  sku_id: string | null;
  sku_description: string | null;
  project_id: string | null;
  location: string | null;
  cost: number;
  credits: number;
  net_cost: number;
  usage_amount: number | null;
  usage_unit: string | null;
  currency: string;
  synced_at: string;
}

interface SyncResult {
  success: boolean;
  recordsSynced: number;
  totalCost: number;
  error?: string;
}

interface CostSummary {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  byService: Array<{
    service_id: string;
    service_description: string;
    total_cost: number;
  }>;
}

/**
 * Format a Date as YYYY-MM-DD in local timezone (America/Santiago)
 * Avoids the UTC offset issue of toISOString() which shifts dates by -3h
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get the full BigQuery table name for billing data
 */
function getBillingTableName(): string {
  if (!BILLING_ACCOUNT_ID) {
    throw new Error("GCP_BILLING_ACCOUNT_ID is not configured");
  }
  return `\`${BILLING_PROJECT}.${BILLING_DATASET}.gcp_billing_export_v1_${BILLING_ACCOUNT_ID}\``;
}

/**
 * Sync costs from BigQuery to local database
 * @param daysBack - Number of days to sync (default: 2 for today and yesterday)
 */
export async function syncGcpCosts(daysBack: number = 2): Promise<SyncResult> {
  const startedAt = new Date();

  try {
    const tableName = getBillingTableName();

    // Query BigQuery for billing data
    const query = `
      SELECT
        DATE(usage_start_time, "America/Santiago") as cost_date,
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
      WHERE DATE(usage_start_time, "America/Santiago") >= DATE_SUB(CURRENT_DATE("America/Santiago"), INTERVAL @daysBack DAY)
      GROUP BY 1, 2, 3, 4, 5, 6, 7
      HAVING net_cost != 0
      ORDER BY cost_date DESC, net_cost DESC
    `;

    const options = {
      query,
      params: { daysBack },
      location: BILLING_LOCATION,
    };

    const [rows] = await bigquery.query(options);
    const billingRows = rows as BillingRow[];

    if (billingRows.length === 0) {
      // Log successful sync with no data
      await logSync(startedAt, 0, 0, "success");
      return { success: true, recordsSynced: 0, totalCost: 0 };
    }

    // Upsert each row into MySQL
    let totalCost = 0;
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
    }

    // Log successful sync
    await logSync(startedAt, billingRows.length, totalCost, "success");

    return {
      success: true,
      recordsSynced: billingRows.length,
      totalCost,
    };
  } catch (error) {
    // Extract detailed error information
    let errorMessage = "Unknown error";
    let errorDetails = "";

    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || "";
      // Check for BigQuery specific error properties
      const bqError = error as Error & { code?: string; errors?: Array<{ message: string }> };
      if (bqError.code) {
        errorMessage = `[${bqError.code}] ${errorMessage}`;
      }
      if (bqError.errors && Array.isArray(bqError.errors)) {
        errorDetails = bqError.errors.map(e => e.message).join("; ");
        errorMessage = `${errorMessage} - ${errorDetails}`;
      }
    } else if (typeof error === "object" && error !== null) {
      errorMessage = JSON.stringify(error);
    } else {
      errorMessage = String(error);
    }

    console.error("Error syncing GCP costs:", errorMessage, errorDetails);

    // Log failed sync
    await logSync(startedAt, 0, 0, "error", errorMessage);

    return {
      success: false,
      recordsSynced: 0,
      totalCost: 0,
      error: errorMessage,
    };
  }
}

/**
 * Log sync operation to database
 */
async function logSync(
  startedAt: Date,
  recordsSynced: number,
  totalCost: number,
  status: "success" | "error" | "partial",
  errorMessage?: string
): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO gcp_sync_log
       (sync_date, records_synced, total_cost, status, error_message, started_at, completed_at)
       VALUES (CURDATE(), ?, ?, ?, ?, ?, NOW())`,
      [recordsSynced, totalCost, status, errorMessage || null, startedAt]
    );
  } catch (err) {
    console.error("Error logging sync:", err);
  }
}

/**
 * Get costs for a specific date
 */
export async function getGcpDailyCosts(date: Date): Promise<GcpDailyCost[]> {
  const dateStr = formatLocalDate(date);

  const [rows] = await pool.execute<GcpDailyCost[]>(
    `SELECT * FROM gcp_daily_costs
     WHERE cost_date = ?
     ORDER BY net_cost DESC`,
    [dateStr]
  );

  return rows;
}

/**
 * Get costs for a date range
 */
export async function getGcpCostsByRange(
  startDate: Date,
  endDate: Date,
  serviceFilter?: string
): Promise<GcpDailyCost[]> {
  const startStr = formatLocalDate(startDate);
  const endStr = formatLocalDate(endDate);

  let query = `
    SELECT * FROM gcp_daily_costs
    WHERE cost_date BETWEEN ? AND ?
  `;
  const params: (string | undefined)[] = [startStr, endStr];

  if (serviceFilter) {
    query += ` AND service_id = ?`;
    params.push(serviceFilter);
  }

  query += ` ORDER BY cost_date DESC, net_cost DESC`;

  const [rows] = await pool.execute<GcpDailyCost[]>(query, params);
  return rows;
}

/**
 * Get aggregated costs by service for a date range
 */
export async function getGcpCostsByService(
  startDate: Date,
  endDate: Date
): Promise<Array<{ service_id: string; service_description: string; total_cost: number }>> {
  const startStr = formatLocalDate(startDate);
  const endStr = formatLocalDate(endDate);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       service_id,
       service_description,
       SUM(net_cost) as total_cost
     FROM gcp_daily_costs
     WHERE cost_date BETWEEN ? AND ?
     GROUP BY service_id, service_description
     ORDER BY total_cost DESC`,
    [startStr, endStr]
  );

  return rows.map((row) => ({
    service_id: row.service_id,
    service_description: row.service_description,
    total_cost: Number(row.total_cost),
  }));
}

/**
 * Get daily totals for a date range
 */
export async function getGcpDailyTotals(
  startDate: Date,
  endDate: Date
): Promise<Array<{ date: string; total_cost: number }>> {
  const startStr = formatLocalDate(startDate);
  const endStr = formatLocalDate(endDate);

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       cost_date as date,
       SUM(net_cost) as total_cost
     FROM gcp_daily_costs
     WHERE cost_date BETWEEN ? AND ?
     GROUP BY cost_date
     ORDER BY cost_date ASC`,
    [startStr, endStr]
  );

  return rows.map((row) => ({
    date: row.date,
    total_cost: Number(row.total_cost),
  }));
}

/**
 * Get cost summary (today, yesterday, this month, last month)
 */
export async function getGcpCostsSummary(): Promise<CostSummary> {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  // Get totals
  const [todayResult] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(net_cost), 0) as total FROM gcp_daily_costs WHERE cost_date = ?`,
    [formatLocalDate(today)]
  );

  const [yesterdayResult] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(net_cost), 0) as total FROM gcp_daily_costs WHERE cost_date = ?`,
    [formatLocalDate(yesterday)]
  );

  const [thisMonthResult] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(net_cost), 0) as total FROM gcp_daily_costs WHERE cost_date >= ?`,
    [formatLocalDate(thisMonthStart)]
  );

  const [lastMonthResult] = await pool.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(net_cost), 0) as total FROM gcp_daily_costs WHERE cost_date BETWEEN ? AND ?`,
    [formatLocalDate(lastMonthStart), formatLocalDate(lastMonthEnd)]
  );

  // Get by service for this month
  const byService = await getGcpCostsByService(thisMonthStart, today);

  return {
    today: Number(todayResult[0]?.total) || 0,
    yesterday: Number(yesterdayResult[0]?.total) || 0,
    thisMonth: Number(thisMonthResult[0]?.total) || 0,
    lastMonth: Number(lastMonthResult[0]?.total) || 0,
    byService,
  };
}

/**
 * Get last sync info
 */
export async function getLastSyncInfo(): Promise<{
  lastSync: string | null;
  status: string | null;
  recordsSynced: number;
} | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT completed_at, status, records_synced
     FROM gcp_sync_log
     ORDER BY completed_at DESC
     LIMIT 1`
  );

  if (rows.length === 0) return null;

  return {
    lastSync: rows[0].completed_at,
    status: rows[0].status,
    recordsSynced: rows[0].records_synced,
  };
}

/**
 * Check if BigQuery billing export is configured
 */
export function isBillingConfigured(): boolean {
  return !!(
    process.env.GCP_BILLING_ACCOUNT_ID &&
    process.env.GCP_BILLING_DATASET &&
    (process.env.GCP_BILLING_PROJECT || process.env.GOOGLE_CLOUD_PROJECT)
  );
}
