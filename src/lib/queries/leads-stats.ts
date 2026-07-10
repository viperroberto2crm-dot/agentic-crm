import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getSalesBreakdown } from "./sales-kpi"
import { getPresetRange, dateOnlyRangeToUtc, ymdToParts, formatYmd } from "@/lib/dashboard/date-ranges"

type SB = SupabaseClient<Database>

// Estadísticas para la tira superior de la página de Leads. Respeta EXACTAMENTE
// el mismo scope de marca/rol que la lista de leads (revisado con Fable):
// - modo "todas": lista blanca `brandIds` (nunca brandId null = todas, evita fuga)
// - una marca: `brandId`
// - rep: solo lo suyo. Provider NO usa esta tira (la página la oculta).
// Semana/mes con timezone del usuario (no medianoche UTC del server).
// Dinero SOLO vía getSalesBreakdown (maneja el double-counting de planes/abonos).

export type LeadsStats = {
  activeLeads: number
  newThisWeek: number
  leadsTrend: number[] // nuevos/día, rolling 7 días
  apptsThisWeek: number
  apptsTrend: number[] // por día de ESTA semana (lun→dom), suma = apptsThisWeek
  collectedCentsMonth: number
  salesTrend: number[] // ventas cerradas/día, rolling 7 días
  unassigned: number // leads activos sin rep asignado
}

export type LeadsStatsScope = {
  userId: string
  role: string
  brandId: string | null
  brandIds?: string[] // modo "todas": lista blanca de marcas autorizadas
  timezone: string
}

const ACTIVE = "(sold,lost)" // status NOT IN → leads "activos"

// Llaves YYYY-MM-DD de los últimos 7 días (rolling), en el timezone del usuario.
function rolling7(tz: string): { keys: string[]; fmt: Intl.DateTimeFormat; sinceIso: string } {
  const zone = tz || "America/Los_Angeles"
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
  const keys: string[] = []
  for (let i = 6; i >= 0; i--) keys.push(fmt.format(new Date(Date.now() - i * 86_400_000)))
  return { keys, fmt, sinceIso: new Date(Date.now() - 7 * 86_400_000).toISOString() }
}

// Las 7 llaves YYYY-MM-DD de una semana a partir de su fecha inicial (calendario).
function weekKeys(fromYmd: string): string[] {
  const p = ymdToParts(fromYmd)
  if (!p) return []
  const keys: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + i))
    keys.push(formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))
  }
  return keys
}

export async function fetchLeadsStats(sb: SB, scope: LeadsStatsScope): Promise<LeadsStats> {
  const { userId, role, brandId, brandIds, timezone } = scope
  const tz = timezone || "America/Los_Angeles"
  const repFilter = role === "rep" ? userId : null // admin/manager: null; provider no usa esta tira

  const empty: LeadsStats = {
    activeLeads: 0, newThisWeek: 0, leadsTrend: new Array(7).fill(0),
    apptsThisWeek: 0, apptsTrend: new Array(7).fill(0), collectedCentsMonth: 0,
    salesTrend: new Array(7).fill(0), unassigned: 0,
  }
  // Lista blanca vacía = usuario sin marcas autorizadas → nada (nunca query sin filtro).
  if (brandIds && brandIds.length === 0) return empty

  // Filtro de marca idéntico a fetchLeads: lista blanca, o marca única, o (admin) todas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const brand = (q: any) =>
    brandIds && brandIds.length > 0 ? q.in("brand_id", brandIds) : brandId ? q.eq("brand_id", brandId) : q
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repLead = (q: any) => (repFilter ? q.eq("assigned_rep_id", repFilter) : q)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repRow = (q: any) => (repFilter ? q.eq("rep_id", repFilter) : q)

  const roll = rolling7(tz)
  const rollIdx = new Map(roll.keys.map((k, i) => [k, i]))

  // Semana (lun→dom) y mes actuales, en el timezone del usuario.
  const wk = getPresetRange("thisWeek", tz)
  const wkUtc = dateOnlyRangeToUtc(wk.from, wk.to, tz)
  const wkKeys = weekKeys(wk.from)
  const wkIdx = new Map(wkKeys.map((k, i) => [k, i]))

  const mo = getPresetRange("thisMonth", tz)
  const moUtc = dateOnlyRangeToUtc(mo.from, mo.to, tz)

  // ── Queries en paralelo ────────────────────────────────────────────────────
  const activeQ = repLead(brand(
    sb.from("leads").select("id", { count: "exact", head: true }).not("status", "in", ACTIVE),
  ))
  const unassignedQ = repLead(brand(
    sb.from("leads").select("id", { count: "exact", head: true }).not("status", "in", ACTIVE).is("assigned_rep_id", null),
  ))
  const newLeadsQ = repLead(brand(
    sb.from("leads").select("created_at").not("status", "in", ACTIVE).gte("created_at", roll.sinceIso),
  ))
  const apptsQ = repRow(brand(
    sb.from("appointments").select("scheduled_at").neq("status", "cancelled").gte("scheduled_at", wkUtc.start).lt("scheduled_at", wkUtc.end),
  ))
  const salesTrendQ = repRow(brand(
    sb.from("sales").select("paid_at").eq("payment_status", "paid").not("paid_at", "is", null).gte("paid_at", roll.sinceIso),
  ))

  const [activeRes, unassignedRes, newLeadsRes, apptsRes, salesTrendRes] = await Promise.all([
    activeQ, unassignedQ, newLeadsQ, apptsQ, salesTrendQ,
  ])

  // Series
  const leadsTrend = new Array(7).fill(0)
  for (const r of (newLeadsRes.data ?? []) as { created_at: string }[]) {
    const i = rollIdx.get(roll.fmt.format(new Date(r.created_at)))
    if (i !== undefined) leadsTrend[i]++
  }
  const apptsTrend = new Array(7).fill(0)
  for (const r of (apptsRes.data ?? []) as { scheduled_at: string }[]) {
    const i = wkIdx.get(roll.fmt.format(new Date(r.scheduled_at)))
    if (i !== undefined) apptsTrend[i]++
  }
  const salesTrend = new Array(7).fill(0)
  for (const r of (salesTrendRes.data ?? []) as { paid_at: string | null }[]) {
    if (!r.paid_at) continue
    const i = rollIdx.get(roll.fmt.format(new Date(r.paid_at)))
    if (i !== undefined) salesTrend[i]++
  }

  // Cobrado del mes: getSalesBreakdown por marca (sin cruzar marcas no autorizadas).
  const paidRange = { startIso: moUtc.start, endIso: moUtc.end }
  let collectedCentsMonth = 0
  if (brandIds && brandIds.length > 0) {
    const parts = await Promise.all(brandIds.map((b) => getSalesBreakdown(sb, { brandId: b, repId: repFilter, paidRange })))
    collectedCentsMonth = parts.reduce((s, p) => s + p.collectedCents, 0)
  } else {
    const bd = await getSalesBreakdown(sb, { brandId, repId: repFilter, paidRange })
    collectedCentsMonth = bd.collectedCents
  }

  return {
    activeLeads: activeRes.count ?? 0,
    newThisWeek: leadsTrend.reduce((a, b) => a + b, 0),
    leadsTrend,
    apptsThisWeek: apptsTrend.reduce((a, b) => a + b, 0),
    apptsTrend,
    collectedCentsMonth,
    salesTrend,
    unassigned: unassignedRes.count ?? 0,
  }
}
