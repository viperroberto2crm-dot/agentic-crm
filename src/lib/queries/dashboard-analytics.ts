import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getSalesBreakdown } from "./sales-kpi"
import { getPresetRange, dateOnlyRangeToUtc, ymdToParts, formatYmd } from "@/lib/dashboard/date-ranges"
import { formatCurrency } from "./dashboard"

type SB = SupabaseClient<Database>

// Panel "Analítica" del Dashboard. Diseño de datos revisado con Fable:
// - Conteos EXACTOS con { count: "exact", head: true } (no truer filas → no trunca a 1000).
// - Ventana propia: 8 semanas ISO (lun→dom) en timezone del usuario; NO obedece el
//   date-range del dashboard (el UI lo aclara con "últimas 8 semanas").
// - Conversión por COHORTE (sold/creados) → nunca pasa de 100%.
// - Donas con denominador honesto; ratio null cuando denominador = 0 (UI muestra "—").
// - Dinero solo vía getSalesBreakdown. Mismo scope (brandId único/null + scopeRep) que el resto del dashboard.

export type RatioStat = { numerator: number; denominator: number; ratio: number | null }
export type WeeklyPoint = { weekStart: string; leads: number; salesPaid: number; partial: boolean }
export type FeedEvent = { kind: "lead" | "sale_paid" | "sale_open" | "appt" | "call"; at: string; title: string; detail: string }

export type DashboardAnalytics = {
  rangeYmd: { from: string; to: string }
  weekly: WeeklyPoint[]
  conversion: RatioStat
  donuts: { apptShowRate: RatioStat; callContactRate: RatioStat; paymentsCurrent: RatioStat }
  activity: FeedEvent[]
}

function scopeRep(userId: string, role: string): string | null {
  return role === "admin" || role === "manager" ? null : userId
}

const ratio = (numerator: number, denominator: number): RatioStat => ({
  numerator,
  denominator,
  ratio: denominator > 0 ? numerator / denominator : null,
})

const SOURCE_ES: Record<string, string> = {
  inbound_call: "llamada", web_form: "web", referral: "referido", whatsapp: "WhatsApp",
  walk_in: "en persona", social: "social", facebook: "Facebook", other: "otro",
}
const APPT_ES: Record<string, string> = { clinic: "clínica", home: "domicilio", telehealth: "telesalud" }
const OUTCOME_ES: Record<string, string> = {
  no_answer: "sin respuesta", voicemail: "buzón", connected: "contactado",
  appointment_set: "cita agendada", not_interested: "no interesado",
  callback_requested: "pidió callback", wrong_number: "nº equivocado",
}
const PAY_ES: Record<string, string> = { pending: "pendiente", partial: "parcial" }

type LeadName = { first_name: string; last_name: string | null } | null
const nameOf = (l: LeadName): string => (l ? `${l.first_name} ${l.last_name ?? ""}`.trim() : "—")

export async function fetchDashboardAnalytics(
  sb: SB,
  userId: string,
  role: string,
  opts: { brandId: string | null; timezone: string },
): Promise<DashboardAnalytics> {
  const { brandId, timezone } = opts
  const tz = timezone || "America/Los_Angeles"
  const repFilter = scopeRep(userId, role)
  const nowIso = new Date().toISOString()

  // ── Bordes de 8 semanas ISO (lun→dom) en timezone ──────────────────────────
  const thisWeek = getPresetRange("thisWeek", tz)
  const mp = ymdToParts(thisWeek.from)!
  const weeks = Array.from({ length: 8 }, (_, k) => {
    const i = 7 - k // 7 (más vieja) → 0 (actual)
    const md = new Date(Date.UTC(mp.year, mp.month - 1, mp.day - i * 7))
    const monday = formatYmd(md.getUTCFullYear(), md.getUTCMonth() + 1, md.getUTCDate())
    const sd = new Date(Date.UTC(md.getUTCFullYear(), md.getUTCMonth(), md.getUTCDate() + 6))
    const sunday = formatYmd(sd.getUTCFullYear(), sd.getUTCMonth() + 1, sd.getUTCDate())
    return { monday, sunday, utc: dateOnlyRangeToUtc(monday, sunday, tz), partial: monday === thisWeek.from }
  })
  const overall = dateOnlyRangeToUtc(weeks[0].monday, weeks[7].sunday, tz)

  // Helpers de scope (mismo patrón que el dashboard)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scLead = (q: any) => { if (brandId) q = q.eq("brand_id", brandId); if (repFilter) q = q.eq("assigned_rep_id", repFilter); return q }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scRow = (q: any) => { if (brandId) q = q.eq("brand_id", brandId); if (repFilter) q = q.eq("rep_id", repFilter); return q }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cnt = async (qb: any): Promise<number> => ((await qb).count ?? 0)

  const leadsIn = (startIso: string, endIso: string) =>
    scLead(sb.from("leads").select("id", { count: "exact", head: true }).gte("created_at", startIso).lt("created_at", endIso))
  const salesPaidIn = (startIso: string, endIso: string) =>
    scRow(sb.from("sales").select("id", { count: "exact", head: true }).eq("payment_status", "paid").not("paid_at", "is", null).gte("paid_at", startIso).lt("paid_at", endIso))

  // ── Gráfica semanal (16 counts head-only) ──────────────────────────────────
  const weeklyPromise = Promise.all(
    weeks.map(async (w) => {
      const [leads, salesPaid] = await Promise.all([cnt(leadsIn(w.utc.start, w.utc.end)), cnt(salesPaidIn(w.utc.start, w.utc.end))])
      return { weekStart: w.monday, leads, salesPaid, partial: w.partial } as WeeklyPoint
    }),
  )

  // ── Conversión de cohorte (sold / creados en 8 semanas) ────────────────────
  const convDenomP = cnt(leadsIn(overall.start, overall.end))
  const convNumP = cnt(scLead(sb.from("leads").select("id", { count: "exact", head: true }).eq("status", "sold").gte("created_at", overall.start).lt("created_at", overall.end)))

  // ── Dona A: show rate de citas ya ocurridas (8 sem) ─────────────────────────
  const showDenomP = cnt(scRow(sb.from("appointments").select("id", { count: "exact", head: true }).in("status", ["completed", "no_show"]).gte("scheduled_at", overall.start).lt("scheduled_at", nowIso)))
  const showNumP = cnt(scRow(sb.from("appointments").select("id", { count: "exact", head: true }).eq("status", "completed").gte("scheduled_at", overall.start).lt("scheduled_at", nowIso)))

  // ── Dona B: tasa de contacto de llamadas (8 sem) ────────────────────────────
  const callDenomP = cnt(scRow(sb.from("calls").select("id", { count: "exact", head: true }).not("outcome", "is", null).gte("called_at", overall.start).lt("called_at", overall.end)))
  const callNumP = cnt(scRow(sb.from("calls").select("id", { count: "exact", head: true }).in("outcome", ["connected", "appointment_set", "not_interested", "callback_requested"]).gte("called_at", overall.start).lt("called_at", overall.end)))

  // ── Dona C: pagos al día (snapshot actual) ──────────────────────────────────
  const overdueThreshold = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const breakdownP = getSalesBreakdown(sb, { brandId, repId: repFilter })
  const overdueP = cnt(scRow(sb.from("sales").select("id", { count: "exact", head: true }).in("payment_status", ["pending", "partial"]).lt("created_at", overdueThreshold)))

  // ── Feed de actividad (5 queries, limit 6) ──────────────────────────────────
  const leadFeedP = scLead(sb.from("leads").select("id, first_name, last_name, source, created_at").order("created_at", { ascending: false }).limit(6))
  const salePaidFeedP = scRow(sb.from("sales").select("id, amount_cents, paid_at, leads(first_name, last_name)").eq("payment_status", "paid").not("paid_at", "is", null).order("paid_at", { ascending: false }).limit(6))
  const saleOpenFeedP = scRow(sb.from("sales").select("id, amount_cents, created_at, payment_status, leads(first_name, last_name)").in("payment_status", ["pending", "partial"]).order("created_at", { ascending: false }).limit(6))
  const apptFeedP = scRow(sb.from("appointments").select("id, created_at, scheduled_at, status, type, leads(first_name, last_name)").order("created_at", { ascending: false }).limit(6))
  const callFeedP = scRow(sb.from("calls").select("id, called_at, outcome, leads(first_name, last_name)").not("outcome", "is", null).order("called_at", { ascending: false }).limit(6))

  const [
    weekly, convDenom, convNum, showDenom, showNum, callDenom, callNum, breakdown, overdue,
    leadFeed, salePaidFeed, saleOpenFeed, apptFeed, callFeed,
  ] = await Promise.all([
    weeklyPromise, convDenomP, convNumP, showDenomP, showNumP, callDenomP, callNumP, breakdownP, overdueP,
    leadFeedP, salePaidFeedP, saleOpenFeedP, apptFeedP, callFeedP,
  ])

  // Merge del feed
  const events: FeedEvent[] = []
  for (const r of (leadFeed.data ?? []) as { first_name: string; last_name: string | null; source: string | null; created_at: string }[]) {
    events.push({ kind: "lead", at: r.created_at, title: nameOf(r), detail: `Nuevo lead${r.source ? ` · ${SOURCE_ES[r.source] ?? r.source}` : ""}` })
  }
  for (const r of (salePaidFeed.data ?? []) as { amount_cents: number; paid_at: string; leads: LeadName }[]) {
    events.push({ kind: "sale_paid", at: r.paid_at, title: nameOf(r.leads), detail: `Venta cobrada · ${formatCurrency(r.amount_cents)}` })
  }
  for (const r of (saleOpenFeed.data ?? []) as { amount_cents: number; created_at: string; payment_status: string; leads: LeadName }[]) {
    events.push({ kind: "sale_open", at: r.created_at, title: nameOf(r.leads), detail: `Venta ${PAY_ES[r.payment_status] ?? r.payment_status} · ${formatCurrency(r.amount_cents)}` })
  }
  for (const r of (apptFeed.data ?? []) as { created_at: string; type: string; leads: LeadName }[]) {
    events.push({ kind: "appt", at: r.created_at, title: nameOf(r.leads), detail: `Cita agendada · ${APPT_ES[r.type] ?? r.type}` })
  }
  for (const r of (callFeed.data ?? []) as { called_at: string; outcome: string; leads: LeadName }[]) {
    events.push({ kind: "call", at: r.called_at, title: nameOf(r.leads), detail: `Llamada · ${OUTCOME_ES[r.outcome] ?? r.outcome}` })
  }
  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const activity = events.slice(0, 6)

  const open = breakdown.openCount
  return {
    rangeYmd: { from: weeks[0].monday, to: weeks[7].sunday },
    weekly,
    conversion: ratio(convNum, convDenom),
    donuts: {
      apptShowRate: ratio(showNum, showDenom),
      callContactRate: ratio(callNum, callDenom),
      paymentsCurrent: ratio(Math.max(0, open - overdue), open),
    },
    activity,
  }
}
