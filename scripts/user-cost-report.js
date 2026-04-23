#!/usr/bin/env node
/**
 * User Cost Report
 *
 * Cruza costos reales de GCP (tabla `gcp_daily_costs`) con costos estimados
 * por generación de IA (`messages.estimated_cost`) para entregar un desglose
 * por usuario y por mes, prorrateando los costos de infraestructura GCP
 * (Cloud SQL, Compute Engine, Storage, Support, etc.) en función del %
 * de consumo estimado de cada usuario sobre el total estimado.
 *
 * Uso:
 *   set -a; source .env.local; set +a
 *   node scripts/user-cost-report.js                      # default: Feb, Mar, Abr 2026
 *   node scripts/user-cost-report.js --from=2026-02-01 --to=2026-04-30
 *   node scripts/user-cost-report.js --json               # output JSON
 *   node scripts/user-cost-report.js --verbose            # breakdown por servicio GCP
 *   node scripts/user-cost-report.js --csv                # exporta a tmp/YYYY-MM-DD.csv
 *   node scripts/user-cost-report.js --csv=path/x.csv     # exporta a path custom
 *
 * Env vars: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Config
// ============================================================================

// Servicios GCP considerados "IA generativa" (match case-insensitive contra
// service_description). Todo lo que NO matchee aquí se clasifica como "infra"
// y entra al prorrateo.
const AI_SERVICE_PATTERNS = [
  'vertex ai',
  'gemini api',
  'generative language',
  'cloud ai platform',
  'cloud text-to-speech',
  'cloud speech',
];

// Meses por defecto (el usuario pidió Feb, Mar, Abr)
const DEFAULT_MONTHS = [
  { label: 'Feb 2026', from: '2026-02-01', to: '2026-02-28' },
  { label: 'Mar 2026', from: '2026-03-01', to: '2026-03-31' },
  { label: 'Abr 2026', from: '2026-04-01', to: '2026-04-30' },
];

// ============================================================================
// CLI args
// ============================================================================

function parseArgs(argv) {
  const args = { json: false, verbose: false, csv: null };
  for (const a of argv.slice(2)) {
    if (a === '--json') args.json = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--csv') args.csv = defaultCsvPath();
    else if (a.startsWith('--csv=')) args.csv = a.slice(6);
    else if (a.startsWith('--from=')) args.from = a.slice(7);
    else if (a.startsWith('--to=')) args.to = a.slice(5);
    else if (a.startsWith('--ai-pattern=')) args.aiPattern = a.slice(13);
  }
  return args;
}

function defaultCsvPath() {
  const today = fmtDate(new Date());
  return path.join('tmp', `${today}.csv`);
}

const CSV_SEP = ';';
const CSV_BOM = '﻿'; // UTF-8 BOM para que Excel respete tildes y ñ

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Formato numérico europeo: coma como decimal (Excel en es-CL/es-ES usa ',' para decimales
// cuando el separador de columnas es ';').
function fmtNum(n) {
  return Number(n).toFixed(6).replace('.', ',');
}

function buildCsv(report, months) {
  const lines = [];
  // Header — solo totales por mes
  const header = ['email', 'name', 'messages_total'];
  for (const m of months) header.push(`${m.label} total`);
  header.push('grand_total');
  lines.push(header.map(csvEscape).join(CSV_SEP));

  // Rows por usuario (ordenados desc por total)
  const users = Array.from(report.users.values()).sort((a, b) => b.total - a.total);
  for (const u of users) {
    const row = [u.email || '', u.name || '', u.messages];
    for (const m of months) {
      const mu = u.perMonth[m.label] || { total: 0 };
      row.push(fmtNum(mu.total));
    }
    row.push(fmtNum(u.total));
    lines.push(row.map(csvEscape).join(CSV_SEP));
  }

  // Footer: total por mes
  const footer = ['TOTAL', '', ''];
  for (const m of report.months) {
    const mTracked = m.users.reduce((a, u) => a + u.tracked, 0);
    const mProrated = m.users.reduce((a, u) => a + u.prorated, 0);
    footer.push(fmtNum(mTracked + mProrated));
  }
  footer.push(fmtNum(report.grandTotals.total));
  lines.push(footer.map(csvEscape).join(CSV_SEP));

  return CSV_BOM + lines.join('\n') + '\n';
}

function writeCsv(filePath, content) {
  const dir = path.dirname(filePath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

function buildMonthBuckets(args) {
  // Si el usuario pasa --from/--to custom, genera buckets mensuales en ese rango
  if (args.from && args.to) {
    const buckets = [];
    const start = new Date(args.from + 'T00:00:00');
    const end = new Date(args.to + 'T00:00:00');
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const monthStart = new Date(y, m, 1);
      const monthEnd = new Date(y, m + 1, 0);
      buckets.push({
        label: monthStart.toLocaleDateString('es-CL', { month: 'short', year: 'numeric' }),
        from: fmtDate(monthStart),
        to: fmtDate(monthEnd),
      });
      cursor = new Date(y, m + 1, 1);
    }
    return buckets;
  }
  return DEFAULT_MONTHS;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtUsd(n) {
  return `$${Number(n).toFixed(2)}`;
}

function pad(s, w, right = false) {
  s = String(s ?? '');
  if (s.length >= w) return s.slice(0, w);
  return right ? s.padStart(w) : s.padEnd(w);
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Totales GCP del mes, separados en "AI real" vs "Infra" usando AI_SERVICE_PATTERNS.
 */
async function getGcpMonthTotals(conn, from, to, aiPatterns) {
  const [rows] = await conn.execute(
    `SELECT service_id, service_description, SUM(net_cost) AS total
     FROM gcp_daily_costs
     WHERE cost_date BETWEEN ? AND ?
     GROUP BY service_id, service_description`,
    [from, to]
  );

  let aiTotal = 0;
  let infraTotal = 0;
  const byService = [];

  for (const r of rows) {
    const desc = String(r.service_description || '').toLowerCase();
    const isAi = aiPatterns.some((p) => desc.includes(p));
    const net = Number(r.total) || 0;
    if (isAi) aiTotal += net;
    else infraTotal += net;
    byService.push({
      service: r.service_description,
      bucket: isAi ? 'ai' : 'infra',
      total: net,
    });
  }

  byService.sort((a, b) => b.total - a.total);
  return { aiTotal, infraTotal, total: aiTotal + infraTotal, byService };
}

/**
 * Costo estimado (tracked interno) por usuario para el mes.
 * Suma `messages.estimated_cost` donde role='model'.
 */
async function getUserTrackedCosts(conn, from, to) {
  const [rows] = await conn.execute(
    `SELECT u.id AS user_id, u.name, u.email,
            COALESCE(SUM(m.estimated_cost), 0) AS tracked,
            COUNT(*) AS message_count
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = c.user_id
      WHERE m.role = 'model'
        AND m.estimated_cost IS NOT NULL
        AND m.created_at >= ?
        AND m.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY u.id, u.name, u.email`,
    [from, to]
  );

  return rows.map((r) => ({
    user_id: r.user_id,
    name: r.name,
    email: r.email,
    tracked: Number(r.tracked) || 0,
    messages: Number(r.message_count) || 0,
  }));
}

// ============================================================================
// Report
// ============================================================================

async function buildReport(conn, months, aiPatterns) {
  const report = { months: [], users: new Map(), grandTotals: null };
  const grand = { tracked: 0, aiGcp: 0, infraGcp: 0, prorated: 0, total: 0 };

  for (const bucket of months) {
    const gcp = await getGcpMonthTotals(conn, bucket.from, bucket.to, aiPatterns);
    const users = await getUserTrackedCosts(conn, bucket.from, bucket.to);
    const totalTracked = users.reduce((acc, u) => acc + u.tracked, 0);

    // Prorrateo: si no hay usuarios tracked, la infra queda sin repartir (se muestra como "unassigned").
    for (const u of users) {
      const share = totalTracked > 0 ? u.tracked / totalTracked : 0;
      u.prorated = share * gcp.infraTotal;
      u.total = u.tracked + u.prorated;
      u.share = share;
    }

    report.months.push({
      ...bucket,
      gcp,
      totalTracked,
      calibration: totalTracked > 0 ? gcp.aiTotal / totalTracked : null,
      users,
    });

    grand.tracked += totalTracked;
    grand.aiGcp += gcp.aiTotal;
    grand.infraGcp += gcp.infraTotal;

    // Acumular por usuario
    for (const u of users) {
      const existing = report.users.get(u.user_id) || {
        user_id: u.user_id,
        name: u.name,
        email: u.email,
        perMonth: {},
        tracked: 0,
        prorated: 0,
        total: 0,
        messages: 0,
      };
      existing.perMonth[bucket.label] = {
        tracked: u.tracked,
        prorated: u.prorated,
        total: u.total,
        messages: u.messages,
      };
      existing.tracked += u.tracked;
      existing.prorated += u.prorated;
      existing.total += u.total;
      existing.messages += u.messages;
      report.users.set(u.user_id, existing);
    }
  }

  grand.prorated = grand.infraGcp; // toda la infra se reparte
  grand.total = grand.tracked + grand.infraGcp;
  report.grandTotals = grand;
  return report;
}

// ============================================================================
// Output
// ============================================================================

function printTextReport(report, months, verbose) {
  // 1) Resumen GCP por mes
  console.log('\n=== Resumen GCP por mes ===\n');
  console.log(
    pad('Mes', 12) + pad('AI (GCP)', 14, true) + pad('Infra (GCP)', 14, true) +
    pad('Total GCP', 14, true) + pad('Tracked', 14, true) + pad('Calib AI/Trk', 14, true)
  );
  console.log('-'.repeat(82));
  for (const m of report.months) {
    const calib = m.calibration != null ? `${m.calibration.toFixed(2)}x` : 'n/a';
    console.log(
      pad(m.label, 12) +
      pad(fmtUsd(m.gcp.aiTotal), 14, true) +
      pad(fmtUsd(m.gcp.infraTotal), 14, true) +
      pad(fmtUsd(m.gcp.total), 14, true) +
      pad(fmtUsd(m.totalTracked), 14, true) +
      pad(calib, 14, true)
    );
  }
  const g = report.grandTotals;
  console.log('-'.repeat(82));
  console.log(
    pad('TOTAL', 12) +
    pad(fmtUsd(g.aiGcp), 14, true) +
    pad(fmtUsd(g.infraGcp), 14, true) +
    pad(fmtUsd(g.aiGcp + g.infraGcp), 14, true) +
    pad(fmtUsd(g.tracked), 14, true) +
    pad(g.tracked > 0 ? `${(g.aiGcp / g.tracked).toFixed(2)}x` : 'n/a', 14, true)
  );

  // 2) Breakdown por servicio (verbose)
  if (verbose) {
    console.log('\n=== Breakdown por servicio GCP (por mes) ===');
    for (const m of report.months) {
      console.log(`\n-- ${m.label} (${m.from} a ${m.to}) --`);
      for (const s of m.gcp.byService) {
        const tag = s.bucket === 'ai' ? '[AI  ]' : '[INFR]';
        console.log(`  ${tag} ${pad(s.service, 40)} ${pad(fmtUsd(s.total), 12, true)}`);
      }
    }
  }

  // 3) Tabla por usuario
  console.log('\n=== Gasto estimado por usuario ===');
  console.log('(tracked = SUM(messages.estimated_cost); prorrateado = % sobre tracked × infra GCP)');
  console.log('');

  const users = Array.from(report.users.values()).sort((a, b) => b.total - a.total);

  const emailW = Math.max(20, ...users.map((u) => (u.email || '').length));
  const nameW = Math.max(6, ...users.map((u) => (u.name || '').length));

  // Header
  let header = pad('Email', emailW) + ' ' + pad('Nombre', nameW) + ' ';
  for (const m of months) {
    header += pad(m.label + ' trk', 14, true) + pad(m.label + ' prr', 14, true) + pad(m.label + ' TOT', 14, true);
  }
  header += pad('GRAN TOTAL', 14, true);
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const u of users) {
    let row = pad(u.email || '', emailW) + ' ' + pad(u.name || '', nameW) + ' ';
    for (const m of months) {
      const mu = u.perMonth[m.label] || { tracked: 0, prorated: 0, total: 0 };
      row += pad(fmtUsd(mu.tracked), 14, true) + pad(fmtUsd(mu.prorated), 14, true) + pad(fmtUsd(mu.total), 14, true);
    }
    row += pad(fmtUsd(u.total), 14, true);
    console.log(row);
  }

  // Footer totales por mes
  let footer = pad('TOTAL', emailW) + ' ' + pad('', nameW) + ' ';
  for (const m of report.months) {
    const mTracked = m.users.reduce((a, u) => a + u.tracked, 0);
    const mProrated = m.users.reduce((a, u) => a + u.prorated, 0);
    footer += pad(fmtUsd(mTracked), 14, true) + pad(fmtUsd(mProrated), 14, true) + pad(fmtUsd(mTracked + mProrated), 14, true);
  }
  footer += pad(fmtUsd(g.total), 14, true);
  console.log('-'.repeat(header.length));
  console.log(footer);

  // 4) Notas
  console.log('\n=== Notas ===');
  console.log(`- AI patterns: ${AI_SERVICE_PATTERNS.join(', ')}`);
  console.log(`- Total GCP (AI + infra) = ${fmtUsd(g.aiGcp + g.infraGcp)}`);
  console.log(`- Total tracked (suma de messages.estimated_cost): ${fmtUsd(g.tracked)}`);
  console.log(`- Delta AI real vs tracked: ${fmtUsd(g.aiGcp - g.tracked)} (${g.tracked > 0 ? ((g.aiGcp / g.tracked - 1) * 100).toFixed(1) : 'n/a'}%)`);
  console.log('  ^ Si es >0 los estimados internos se quedan cortos; considerar recalibrar precios en tabla `models`.');
  console.log('- El prorrateo reparte TODA la infra GCP entre usuarios según su % de tracked.');
  console.log('- Si un mes tiene tracked=$0, su infra NO se reparte (se ve en fila TOTAL vs GRAN TOTAL).');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);
  const months = buildMonthBuckets(args);
  const aiPatterns = args.aiPattern
    ? args.aiPattern.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : AI_SERVICE_PATTERNS;

  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: '-03:00',
    dateStrings: true,
  };

  if (!dbConfig.host || !dbConfig.user || !dbConfig.database) {
    console.error('ERROR: Faltan env vars DB_HOST / DB_USER / DB_NAME.');
    console.error('Sugerencia: `set -a; source .env.local; set +a` antes de correr.');
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbConfig);
  try {
    const report = await buildReport(conn, months, aiPatterns);

    if (args.json) {
      // Serializable: convertir Map a Array
      const out = {
        months: report.months,
        users: Array.from(report.users.values()).sort((a, b) => b.total - a.total),
        grandTotals: report.grandTotals,
        aiPatterns,
      };
      console.log(JSON.stringify(out, null, 2));
    } else {
      printTextReport(report, months, args.verbose);
    }

    if (args.csv) {
      const csv = buildCsv(report, months);
      writeCsv(args.csv, csv);
      console.log(`\nCSV escrito en: ${path.resolve(args.csv)}`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
