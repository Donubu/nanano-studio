import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

// Servicios GCP considerados "AI generativa"; todo lo demás se considera infra
// y se prorratea entre clientes según su % de consumo tracked.
const AI_SERVICE_REGEX =
  "vertex ai|gemini api|generative language|cloud text-to-speech|cloud speech";

interface TrackedRow extends RowDataPacket {
  week_start: string;
  client_id: number | null;
  client_name: string | null;
  is_internal: number | null;
  hidden: number | null;
  tracked: string; // DECIMAL viene como string
  images: number;
  videos: number;
  texts: number;
  audios: number;
  music_pcs: number;
}

interface UserTrackedRow extends RowDataPacket {
  week_start: string;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  tracked: string;
  images: number;
  videos: number;
  texts: number;
  audios: number;
  music_pcs: number;
}

interface PieceCounts {
  images: number;
  videos: number;
  texts: number;
  audios: number;
  music: number;
}

const EMPTY_COUNTS: PieceCounts = { images: 0, videos: 0, texts: 0, audios: 0, music: 0 };

// Fragmento SQL común para contar piezas por mensaje (role='model'):
//   - imágenes, videos, música, audios (incluye HD/chirp) -> presencia de URL
//   - textos -> mensajes sin ninguna URL multimedia (respuesta de texto puro)
const PIECE_COUNT_SQL = `
  SUM(CASE WHEN m.image_url IS NOT NULL AND m.image_url != '' THEN 1 ELSE 0 END) AS images,
  SUM(CASE WHEN m.video_url IS NOT NULL AND m.video_url != '' THEN 1 ELSE 0 END) AS videos,
  SUM(CASE WHEN
        (m.image_url IS NULL OR m.image_url = '')
    AND (m.video_url IS NULL OR m.video_url = '')
    AND (m.audio_url IS NULL OR m.audio_url = '')
    AND (m.music_url IS NULL OR m.music_url = '')
    AND m.quality_tier <> 'chirp'
  THEN 1 ELSE 0 END) AS texts,
  SUM(CASE WHEN
    (m.audio_url IS NOT NULL AND m.audio_url != '') OR m.quality_tier = 'chirp'
  THEN 1 ELSE 0 END) AS audios,
  SUM(CASE WHEN m.music_url IS NOT NULL AND m.music_url != '' THEN 1 ELSE 0 END) AS music_pcs
`;

interface InfraRow extends RowDataPacket {
  week_start: string;
  infra: string;
}

interface ScalarRow extends RowDataPacket {
  total: string | null;
}

interface WeekInfo {
  index: number; // 1..N dentro del año
  start: string; // YYYY-MM-DD (lunes)
  end: string; // YYYY-MM-DD (domingo)
  label: string;
}

interface ClientBucket {
  clientId: number; // 0 = Sin asignar
  name: string;
  isInternal: boolean;
  perWeek: Record<string, number>; // key = week start YYYY-MM-DD, value = total USD (tracked + prorateado)
  countsPerWeek: Record<string, PieceCounts>;
  trackedTotal: number;
  proratedTotal: number;
  grandTotal: number;
  countsTotal: PieceCounts;
}

interface UserBucket {
  userId: number;
  name: string;
  email: string | null;
  perWeek: Record<string, number>;
  countsPerWeek: Record<string, PieceCounts>;
  trackedTotal: number;
  proratedTotal: number;
  grandTotal: number;
  countsTotal: PieceCounts;
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYear(raw: string | null): number {
  const n = raw ? Number(raw) : NaN;
  if (Number.isInteger(n) && n >= 2020 && n <= 2100) return n;
  return new Date().getFullYear();
}

// Lunes de la semana que contiene la fecha dada
function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // Mon=0..Sun=6
  out.setDate(out.getDate() - dow);
  return out;
}

// Genera todas las semanas (lunes-domingo) de un año, de la 1 a la que contiene capDate.
// Semana 1 = la que contiene el 4 de enero (ISO).
function buildWeeksOfYear(year: number, capDate: Date): WeekInfo[] {
  const jan4 = new Date(year, 0, 4);
  const week1Monday = mondayOf(jan4);

  const weeks: WeekInfo[] = [];
  const cursor = new Date(week1Monday);
  let idx = 1;
  while (cursor <= capDate) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setDate(start.getDate() + 6);
    const monthNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const label = `S${idx} (${start.getDate()} ${monthNames[start.getMonth()]} - ${end.getDate()} ${monthNames[end.getMonth()]})`;
    weeks.push({ index: idx, start: fmtDate(start), end: fmtDate(end), label });
    cursor.setDate(cursor.getDate() + 7);
    idx++;
  }
  return weeks;
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const year = parseYear(searchParams.get("year"));
    const now = new Date();
    const isCurrentYear = year === now.getFullYear();
    const capDate = isCurrentYear ? now : new Date(year, 11, 31);
    const weeks = buildWeeksOfYear(year, capDate);

    if (weeks.length === 0) {
      return NextResponse.json({
        year,
        currency: "USD",
        weeks: [],
        clients: [],
        totals: { tracked: 0, infra: 0, grand: 0 },
        globalSpentUsd: 0,
      });
    }

    const rangeStart = weeks[0].start;
    const rangeEnd = weeks[weeks.length - 1].end;

    // 1) Tracked por (semana, cliente). Join:
    //    messages → conversations → projects → clients (LEFT para no perder huérfanos)
    const [trackedRows] = await pool.execute<TrackedRow[]>(
      `SELECT
         DATE(m.created_at - INTERVAL WEEKDAY(m.created_at) DAY) AS week_start,
         c.id AS client_id,
         c.name AS client_name,
         c.is_internal AS is_internal,
         c.hidden AS hidden,
         COALESCE(SUM(m.estimated_cost), 0) AS tracked,
         ${PIECE_COUNT_SQL}
       FROM messages m
       LEFT JOIN conversations conv ON conv.id = m.conversation_id
       LEFT JOIN projects p ON p.id = conv.project_id
       LEFT JOIN clients c ON c.id = p.client_id
       WHERE m.role = 'model'
         AND m.estimated_cost IS NOT NULL
         AND m.created_at >= ?
         AND m.created_at < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY week_start, client_id, client_name, is_internal, hidden`,
      [rangeStart, rangeEnd]
    );

    // 1b) Tracked por (semana, usuario). messages → conversations → users.
    const [userTrackedRows] = await pool.execute<UserTrackedRow[]>(
      `SELECT
         DATE(m.created_at - INTERVAL WEEKDAY(m.created_at) DAY) AS week_start,
         u.id AS user_id,
         u.name AS user_name,
         u.email AS user_email,
         COALESCE(SUM(m.estimated_cost), 0) AS tracked,
         ${PIECE_COUNT_SQL}
       FROM messages m
       JOIN conversations conv ON conv.id = m.conversation_id
       JOIN users u ON u.id = conv.user_id
       WHERE m.role = 'model'
         AND m.estimated_cost IS NOT NULL
         AND m.created_at >= ?
         AND m.created_at < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY week_start, user_id, user_name, user_email`,
      [rangeStart, rangeEnd]
    );

    // 2) Infra GCP por semana (servicios NO AI). Net cost.
    const [infraRows] = await pool.execute<InfraRow[]>(
      `SELECT
         DATE(cost_date - INTERVAL WEEKDAY(cost_date) DAY) AS week_start,
         COALESCE(SUM(net_cost), 0) AS infra
       FROM gcp_daily_costs
       WHERE cost_date BETWEEN ? AND ?
         AND LOWER(service_description) NOT REGEXP ?
       GROUP BY week_start`,
      [rangeStart, rangeEnd, AI_SERVICE_REGEX]
    );

    // 3) Totales históricos (todo el tiempo) para cálculo del saldo restante.
    //    Matchea con lo mostrado: sum_tracked_all + sum_infra_all = total spent.
    const [totalTrackedHist] = await pool.execute<ScalarRow[]>(
      `SELECT COALESCE(SUM(estimated_cost), 0) AS total
         FROM messages
        WHERE role = 'model' AND estimated_cost IS NOT NULL`
    );
    const [totalInfraHist] = await pool.execute<ScalarRow[]>(
      `SELECT COALESCE(SUM(net_cost), 0) AS total
         FROM gcp_daily_costs
        WHERE LOWER(service_description) NOT REGEXP ?`,
      [AI_SERVICE_REGEX]
    );

    // Build per-week infra map
    const infraByWeek = new Map<string, number>();
    for (const r of infraRows) {
      infraByWeek.set(r.week_start, Number(r.infra) || 0);
    }

    // Build per-(week, client) tracked map + total tracked per week
    const trackedByWeekClient = new Map<string, Map<number, number>>();
    const countsByWeekClient = new Map<string, Map<number, PieceCounts>>();
    const trackedByWeek = new Map<string, number>();
    const clientsMeta = new Map<number, { name: string; isInternal: boolean }>();

    for (const r of trackedRows) {
      const week = r.week_start;
      const clientId = r.client_id ?? 0;
      const name = r.client_name ?? "Sin asignar";
      const isInternal = Boolean(r.is_internal);
      const tracked = Number(r.tracked) || 0;

      if (!trackedByWeekClient.has(week)) trackedByWeekClient.set(week, new Map());
      const inner = trackedByWeekClient.get(week)!;
      inner.set(clientId, (inner.get(clientId) || 0) + tracked);
      trackedByWeek.set(week, (trackedByWeek.get(week) || 0) + tracked);

      if (!countsByWeekClient.has(week)) countsByWeekClient.set(week, new Map());
      countsByWeekClient.get(week)!.set(clientId, {
        images: Number(r.images) || 0,
        videos: Number(r.videos) || 0,
        texts: Number(r.texts) || 0,
        audios: Number(r.audios) || 0,
        music: Number(r.music_pcs) || 0,
      });

      if (!clientsMeta.has(clientId)) {
        clientsMeta.set(clientId, { name, isInternal });
      }
    }

    // Build final clients array with per-week totals (tracked + prorated infra)
    const clients: ClientBucket[] = [];
    for (const [clientId, meta] of clientsMeta.entries()) {
      const bucket: ClientBucket = {
        clientId,
        name: meta.name,
        isInternal: meta.isInternal,
        perWeek: {},
        countsPerWeek: {},
        trackedTotal: 0,
        proratedTotal: 0,
        grandTotal: 0,
        countsTotal: { ...EMPTY_COUNTS },
      };

      for (const w of weeks) {
        const weekTracked = trackedByWeek.get(w.start) || 0;
        const weekInfra = infraByWeek.get(w.start) || 0;
        const clientTracked = trackedByWeekClient.get(w.start)?.get(clientId) || 0;
        const share = weekTracked > 0 ? clientTracked / weekTracked : 0;
        const prorated = share * weekInfra;
        const total = clientTracked + prorated;
        if (total !== 0) bucket.perWeek[w.start] = total;
        bucket.trackedTotal += clientTracked;
        bucket.proratedTotal += prorated;
        bucket.grandTotal += total;

        const counts = countsByWeekClient.get(w.start)?.get(clientId);
        if (counts) {
          bucket.countsPerWeek[w.start] = counts;
          bucket.countsTotal.images += counts.images;
          bucket.countsTotal.videos += counts.videos;
          bucket.countsTotal.texts += counts.texts;
          bucket.countsTotal.audios += counts.audios;
          bucket.countsTotal.music += counts.music;
        }
      }

      clients.push(bucket);
    }

    // Orden: grand desc, pero "Sin asignar" al final siempre
    clients.sort((a, b) => {
      if (a.clientId === 0) return 1;
      if (b.clientId === 0) return -1;
      return b.grandTotal - a.grandTotal;
    });

    // === Desglose por usuario ===
    // Usa el MISMO total tracked por semana que los clientes, para que el prorateo
    // de infra sea consistente (share_usuario × infra_semana).
    const trackedByWeekUser = new Map<string, Map<number, number>>();
    const countsByWeekUser = new Map<string, Map<number, PieceCounts>>();
    const usersMeta = new Map<number, { name: string; email: string | null }>();

    for (const r of userTrackedRows) {
      const week = r.week_start;
      const userId = r.user_id;
      const tracked = Number(r.tracked) || 0;

      if (!trackedByWeekUser.has(week)) trackedByWeekUser.set(week, new Map());
      trackedByWeekUser.get(week)!.set(userId, (trackedByWeekUser.get(week)!.get(userId) || 0) + tracked);

      if (!countsByWeekUser.has(week)) countsByWeekUser.set(week, new Map());
      countsByWeekUser.get(week)!.set(userId, {
        images: Number(r.images) || 0,
        videos: Number(r.videos) || 0,
        texts: Number(r.texts) || 0,
        audios: Number(r.audios) || 0,
        music: Number(r.music_pcs) || 0,
      });

      if (!usersMeta.has(userId)) {
        usersMeta.set(userId, { name: r.user_name ?? "(sin nombre)", email: r.user_email });
      }
    }

    const users: UserBucket[] = [];
    for (const [userId, meta] of usersMeta.entries()) {
      const bucket: UserBucket = {
        userId,
        name: meta.name,
        email: meta.email,
        perWeek: {},
        countsPerWeek: {},
        trackedTotal: 0,
        proratedTotal: 0,
        grandTotal: 0,
        countsTotal: { ...EMPTY_COUNTS },
      };

      for (const w of weeks) {
        const weekTracked = trackedByWeek.get(w.start) || 0;
        const weekInfra = infraByWeek.get(w.start) || 0;
        const userTracked = trackedByWeekUser.get(w.start)?.get(userId) || 0;
        const share = weekTracked > 0 ? userTracked / weekTracked : 0;
        const prorated = share * weekInfra;
        const total = userTracked + prorated;
        if (total !== 0) bucket.perWeek[w.start] = total;
        bucket.trackedTotal += userTracked;
        bucket.proratedTotal += prorated;
        bucket.grandTotal += total;

        const counts = countsByWeekUser.get(w.start)?.get(userId);
        if (counts) {
          bucket.countsPerWeek[w.start] = counts;
          bucket.countsTotal.images += counts.images;
          bucket.countsTotal.videos += counts.videos;
          bucket.countsTotal.texts += counts.texts;
          bucket.countsTotal.audios += counts.audios;
          bucket.countsTotal.music += counts.music;
        }
      }

      users.push(bucket);
    }

    users.sort((a, b) => b.grandTotal - a.grandTotal);

    const rangeTracked = clients.reduce((s, c) => s + c.trackedTotal, 0);
    const rangeProrated = clients.reduce((s, c) => s + c.proratedTotal, 0);
    const rangeGrand = rangeTracked + rangeProrated;

    const globalSpentUsd =
      Number(totalTrackedHist[0]?.total || 0) + Number(totalInfraHist[0]?.total || 0);

    return NextResponse.json({
      year,
      currency: "USD",
      weeks,
      clients,
      users,
      totals: {
        tracked: rangeTracked,
        infra: rangeProrated,
        grand: rangeGrand,
      },
      globalSpentUsd,
    });
  } catch (error) {
    console.error("Error en weekly report:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
