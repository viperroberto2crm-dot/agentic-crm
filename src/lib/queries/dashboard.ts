import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, Enums } from "@/types/database"
import { getSalesBreakdown } from "./sales-kpi"

/**
 * Admin/manager ven datos de todos los reps del brand; rep/provider solo los
 * suyos. Devuelve null cuando NO se debe filtrar por rep_id.
 */
function scopeRep(userId: string, role: string): string | null {
  return role === "admin" || role === "manager" ? null : userId
}

// SupabaseClient<Database> uses Database["public"] as Schema (after the GenericSchema fix)
// Page components must cast their client: `supabase as unknown as SB`
type SB = SupabaseClient<Database>

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

// ─── Types ─────────────────────────────────────────────────────────────────

export type DayRange = { start: string; end: string }

export type CallsKpi = {
  total: number
  connected: number
  to_appt: number
  goal: number | null
}

export type ApptsKpi = {
  total: number
  confirmed: number
  pending: number
  completed: number
  no_show: number
}

export type SalesKpi = {
  count: number
  total_cents: number
}

export type PendingKpi = {
  count: number
  total_cents: number
  overdue_count: number
}

export type TodayAppt = {
  id: string
  scheduled_at: string
  duration_minutes: number
  type: Enums<"appointment_type">
  status: Enums<"appointment_status">
  service: string | null
  notes: string | null
  address_line1: string | null
  city: string | null
  telehealth_link: string | null
  clinic_id: string | null
  clinic_name: string | null
  provider_id: string | null
  provider_name: string | null
  rep_id: string
  rep_name: string | null
  lead_id: string
  lead_first_name: string
  lead_last_name: string | null
  lead_phone: string
  lead_address_line1: string | null
  lead_address_line2: string | null
  lead_city: string | null
  lead_state: string | null
  lead_zip: string | null
  brand_slug: string
  brand_name: string
}

export type UrgentLead = {
  id: string
  first_name: string
  last_name: string | null
  last_contacted_at: string | null
  reason: "stale" | "unconfirmed_appt" | "payment_overdue"
  days_stale: number | null
  amount_cents: number | null
  priority_rank: number
}

export type AgentSummary = {
  body: string
  created_at: string
  related_lead_id: string | null
} | null

export type PivotStats = {
  appts_today: number
  pending_cents: number
  stale_count: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getDayRange(timezone: string): DayRange {
  const tz = timezone || "America/Mexico_City"
  const now = new Date()

  // Approximate offset: compare "now" as seen in target TZ vs UTC
  const localStr = now.toLocaleString("en-US", { timeZone: tz })
  const localDate = new Date(localStr)
  const offsetMs = localDate.getTime() - now.getTime()

  // Midnight today in the target timezone
  const nowInTz = new Date(now.getTime() + offsetMs)
  const midnight = new Date(nowInTz)
  midnight.setHours(0, 0, 0, 0)

  const startUtc = new Date(midnight.getTime() - offsetMs)
  const endUtc = new Date(startUtc.getTime() + 86_400_000)

  return { start: startUtc.toISOString(), end: endUtc.toISOString() }
}

// ─── Fetch: timezone ────────────────────────────────────────────────────────

export async function fetchTimezone(supabase: SB, userId: string): Promise<string> {
  const { data } = await supabase
    .from("notification_prefs")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle()
  // Default a Pacific Time (oficina/clínicas en California). Si un user
  // específico está en otro TZ debe guardar su preferencia explícita.
  return data?.timezone ?? "America/Los_Angeles"
}

// ─── Fetch: brand id from slug ───────────────────────────────────────────────

export async function getBrandIdBySlug(
  slug: string,
  supabase: SB
): Promise<string | null> {
  const { data } = await supabase
    .from("brands")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()
  return data?.id ?? null
}

// ─── Fetch: KPI calls ────────────────────────────────────────────────────────

export async function fetchCallsKpi(
  supabase: SB,
  userId: string,
  brandId: string | null,
  range: DayRange,
  role: string = "rep"
): Promise<CallsKpi> {
  const repFilter = scopeRep(userId, role)
  let q = supabase
    .from("calls")
    .select("outcome")
    .gte("called_at", range.start)
    .lt("called_at", range.end)
  if (repFilter) q = q.eq("rep_id", repFilter)
  if (brandId) q = q.eq("brand_id", brandId)

  let goalQ = supabase
    .from("goals")
    .select("target_value")
    .eq("rep_id", userId)
    .eq("metric", "calls")
    .eq("period", "daily")
    .eq("active", true)
    .limit(1)
  if (brandId) goalQ = goalQ.eq("brand_id", brandId)

  const [{ data: rows }, { data: goalRows }] = await Promise.all([q, goalQ])
  const calls = rows ?? []

  return {
    total: calls.filter((r) => r.outcome !== null).length,
    connected: calls.filter((r) => r.outcome === "connected").length,
    to_appt: calls.filter((r) => r.outcome === "appointment_set").length,
    goal: goalRows?.[0]?.target_value ?? null,
  }
}

// ─── Fetch: KPI appointments ─────────────────────────────────────────────────

export async function fetchApptsKpi(
  supabase: SB,
  userId: string,
  brandId: string | null,
  range: DayRange,
  role: string = "rep"
): Promise<ApptsKpi> {
  const repFilter = scopeRep(userId, role)
  let q = supabase
    .from("appointments")
    .select("status")
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
  if (repFilter) q = q.eq("rep_id", repFilter)
  if (brandId) q = q.eq("brand_id", brandId)

  const { data } = await q
  const rows = data ?? []

  return {
    total: rows.length,
    confirmed: rows.filter((r) => r.status === "confirmed").length,
    pending: rows.filter((r) => r.status === "scheduled").length,
    completed: rows.filter((r) => r.status === "completed").length,
    no_show: rows.filter((r) => r.status === "no_show").length,
  }
}

// ─── Fetch: KPI sales ────────────────────────────────────────────────────────

export async function fetchSalesKpi(
  supabase: SB,
  userId: string,
  brandId: string | null,
  range: DayRange,
  role: string = "rep"
): Promise<SalesKpi> {
  const breakdown = await getSalesBreakdown(supabase, {
    brandId,
    repId: scopeRep(userId, role),
    paidRange: { startIso: range.start, endIso: range.end },
  })
  return {
    count: breakdown.paidCount,
    total_cents: breakdown.collectedCents,
  }
}

// ─── Fetch: KPI pending payments ─────────────────────────────────────────────

export async function fetchPendingKpi(
  supabase: SB,
  userId: string,
  brandId: string | null,
  role: string = "rep"
): Promise<PendingKpi> {
  const overdueThreshold = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const repFilter = scopeRep(userId, role)

  const breakdown = await getSalesBreakdown(supabase, {
    brandId,
    repId: repFilter,
  })

  // overdue_count: cuántas open están "viejas" (sin cobrar tras 7 días).
  // Necesitamos los created_at por separado — query barata.
  let staleQ = supabase
    .from("sales")
    .select("created_at")
    .in("payment_status", ["pending", "partial"])
    .lt("created_at", overdueThreshold)
  if (repFilter) staleQ = staleQ.eq("rep_id", repFilter)
  if (brandId) staleQ = staleQ.eq("brand_id", brandId)
  const { data: stale } = await staleQ

  return {
    count: breakdown.openCount,
    total_cents: breakdown.outstandingCents,
    overdue_count: (stale ?? []).length,
  }
}

// ─── Fetch: mini-series de 7 días para sparklines de las KPI cards ───────────
// Conteos por día (no montos) para evitar replicar la lógica de planes/abonos:
// llamadas registradas, citas agendadas y ventas cerradas. Solo lectura, mismo
// scope de rol/marca que las KPI. Bucketea por día LOCAL (timezone del usuario).

export type KpiTrends = { calls: number[]; appts: number[]; sales: number[] }

export async function fetchKpiTrends(
  supabase: SB,
  userId: string,
  brandId: string | null,
  role: string,
  timezone: string,
): Promise<KpiTrends> {
  const days = 7
  const repFilter = scopeRep(userId, role)
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString()
  const tz = timezone || "America/Los_Angeles"
  // en-CA da formato YYYY-MM-DD, estable para usar como llave de día.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    keys.push(fmt.format(new Date(Date.now() - i * 86_400_000)))
  }
  const idx = new Map(keys.map((k, i) => [k, i]))
  const zero = () => new Array(days).fill(0) as number[]

  let callsQ = supabase
    .from("calls")
    .select("called_at")
    .not("outcome", "is", null)
    .gte("called_at", sinceIso)
  if (repFilter) callsQ = callsQ.eq("rep_id", repFilter)
  if (brandId) callsQ = callsQ.eq("brand_id", brandId)

  let apptsQ = supabase
    .from("appointments")
    .select("scheduled_at")
    .neq("status", "cancelled")
    .gte("scheduled_at", sinceIso)
  if (repFilter) apptsQ = apptsQ.eq("rep_id", repFilter)
  if (brandId) apptsQ = apptsQ.eq("brand_id", brandId)

  let salesQ = supabase
    .from("sales")
    .select("paid_at")
    .eq("payment_status", "paid")
    .not("paid_at", "is", null)
    .gte("paid_at", sinceIso)
  if (repFilter) salesQ = salesQ.eq("rep_id", repFilter)
  if (brandId) salesQ = salesQ.eq("brand_id", brandId)

  const [c, a, s] = await Promise.all([callsQ, apptsQ, salesQ])

  const calls = zero()
  const appts = zero()
  const sales = zero()
  for (const r of (c.data ?? []) as { called_at: string }[]) {
    const i = idx.get(fmt.format(new Date(r.called_at)))
    if (i !== undefined) calls[i]++
  }
  for (const r of (a.data ?? []) as { scheduled_at: string }[]) {
    const i = idx.get(fmt.format(new Date(r.scheduled_at)))
    if (i !== undefined) appts[i]++
  }
  for (const r of (s.data ?? []) as { paid_at: string | null }[]) {
    if (!r.paid_at) continue
    const i = idx.get(fmt.format(new Date(r.paid_at)))
    if (i !== undefined) sales[i]++
  }
  return { calls, appts, sales }
}

// ─── Fetch: today's appointments (list) ─────────────────────────────────────

export async function fetchTodayAppts(
  supabase: SB,
  userId: string,
  brandId: string | null,
  range: DayRange,
  role: string = "rep"
): Promise<TodayAppt[]> {
  const repFilter = scopeRep(userId, role)
  let q = supabase
    .from("appointments")
    .select(
      "id, scheduled_at, duration_minutes, type, status, service, notes, address_line1, city, telehealth_link, clinic_id, rep_id, provider_id, clinics(name), rep:users!appointments_rep_id_fkey(name), provider:users!appointments_provider_id_fkey(name), leads!inner(id, first_name, last_name, phone, address_line1, address_line2, city, state, zip), brands!inner(slug, name)"
    )
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
    .neq("status", "cancelled")
    .order("scheduled_at")
  if (repFilter) q = q.eq("rep_id", repFilter)
  if (brandId) q = q.eq("brand_id", brandId)

  const { data } = await q
  if (!data) return []

  return data.map((row) => {
    const lead = row.leads as {
      id: string
      first_name: string
      last_name: string | null
      phone: string
      address_line1: string | null
      address_line2: string | null
      city: string | null
      state: string | null
      zip: string | null
    }
    const brand = row.brands as { slug: string; name: string }
    const clinic = row.clinics as { name: string } | null
    const rep = (row as unknown as { rep?: { name: string } | null }).rep ?? null
    const provider = (row as unknown as { provider?: { name: string } | null }).provider ?? null
    return {
      id: row.id,
      scheduled_at: row.scheduled_at,
      duration_minutes: row.duration_minutes,
      type: row.type,
      status: row.status,
      service: row.service,
      notes: row.notes,
      address_line1: row.address_line1,
      city: row.city,
      telehealth_link: row.telehealth_link,
      clinic_id: row.clinic_id,
      clinic_name: clinic?.name ?? null,
      provider_id: (row as unknown as { provider_id: string | null }).provider_id ?? null,
      provider_name: provider?.name ?? null,
      rep_id: (row as unknown as { rep_id: string }).rep_id,
      rep_name: rep?.name ?? null,
      lead_id: lead.id,
      lead_first_name: lead.first_name,
      lead_last_name: lead.last_name,
      lead_phone: lead.phone,
      lead_address_line1: lead.address_line1,
      lead_address_line2: lead.address_line2,
      lead_city: lead.city,
      lead_state: lead.state,
      lead_zip: lead.zip,
      brand_slug: brand.slug,
      brand_name: brand.name,
    }
  })
}

// ─── Fetch: urgent leads ──────────────────────────────────────────────────────
// 3 separate queries merged + deduplicated in JS (Supabase JS can't run CTEs)

type LeadRow = { id: string; first_name: string; last_name: string | null; last_contacted_at: string | null }
type ApptRow = { lead_id: string; leads: LeadRow }
type SaleRow = { lead_id: string; amount_cents: number; leads: LeadRow }

export async function fetchUrgentLeads(
  supabase: SB,
  userId: string,
  brandId: string | null,
  range: DayRange,
  role: string = "rep"
): Promise<UrgentLead[]> {
  const staleThreshold = new Date(Date.now() - 5 * 86_400_000).toISOString()
  const nowIso = new Date().toISOString()
  // Include today + tomorrow (24h window after start of today)
  const tomorrowEnd = new Date(new Date(range.end).getTime() + 86_400_000).toISOString()
  const overdueThreshold = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const repFilter = scopeRep(userId, role)

  let staleQ = supabase
    .from("leads")
    .select("id, first_name, last_name, last_contacted_at")
    .not("status", "in", "(sold,lost)")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${staleThreshold}`)
    .limit(5)
  if (repFilter) staleQ = staleQ.eq("assigned_rep_id", repFilter)
  if (brandId) staleQ = staleQ.eq("brand_id", brandId)

  // Solo citas FUTURAS scheduled — las que ya pasaron no necesitan "confirmación",
  // necesitan que el rep marque outcome (separado).
  let unconfirmedQ = supabase
    .from("appointments")
    .select("lead_id, leads!inner(id, first_name, last_name, last_contacted_at)")
    .eq("status", "scheduled")
    .gte("scheduled_at", nowIso)
    .lt("scheduled_at", tomorrowEnd)
    .limit(5)
  if (repFilter) unconfirmedQ = unconfirmedQ.eq("rep_id", repFilter)
  if (brandId) unconfirmedQ = unconfirmedQ.eq("brand_id", brandId)

  let overdueQ = supabase
    .from("sales")
    .select("lead_id, amount_cents, leads!inner(id, first_name, last_name, last_contacted_at)")
    .eq("payment_status", "pending")
    .lt("created_at", overdueThreshold)
    .limit(5)
  if (repFilter) overdueQ = overdueQ.eq("rep_id", repFilter)
  if (brandId) overdueQ = overdueQ.eq("brand_id", brandId)

  const [staleRes, unconfirmedRes, overdueRes] = await Promise.all([
    staleQ,
    unconfirmedQ,
    overdueQ,
  ])

  const seen = new Set<string>()
  const results: UrgentLead[] = []

  const daysSince = (iso: string | null) =>
    iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null

  // Priority 1: overdue payments
  for (const row of (overdueRes.data ?? []) as unknown as SaleRow[]) {
    if (seen.has(row.leads.id)) continue
    seen.add(row.leads.id)
    results.push({
      id: row.leads.id,
      first_name: row.leads.first_name,
      last_name: row.leads.last_name,
      last_contacted_at: row.leads.last_contacted_at,
      reason: "payment_overdue",
      days_stale: daysSince(row.leads.last_contacted_at),
      amount_cents: row.amount_cents,
      priority_rank: 1,
    })
  }

  // Priority 2: unconfirmed appointments today/tomorrow
  for (const row of (unconfirmedRes.data ?? []) as unknown as ApptRow[]) {
    if (seen.has(row.leads.id)) continue
    seen.add(row.leads.id)
    results.push({
      id: row.leads.id,
      first_name: row.leads.first_name,
      last_name: row.leads.last_name,
      last_contacted_at: row.leads.last_contacted_at,
      reason: "unconfirmed_appt",
      days_stale: null,
      amount_cents: null,
      priority_rank: 2,
    })
  }

  // Priority 3: stale leads
  for (const row of staleRes.data ?? []) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    results.push({
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      last_contacted_at: row.last_contacted_at,
      reason: "stale",
      days_stale: daysSince(row.last_contacted_at),
      amount_cents: null,
      priority_rank: 3,
    })
  }

  return results.slice(0, 5)
}

// ─── Fetch: agent daily summary ───────────────────────────────────────────────

export async function fetchAgentSummary(
  supabase: SB,
  userId: string,
  range: DayRange
): Promise<AgentSummary> {
  const { data } = await supabase
    .from("notifications")
    .select("body, created_at, related_lead_id")
    .eq("user_id", userId)
    .eq("type", "daily_summary")
    .gte("created_at", range.start)
    .lt("created_at", range.end)
    .order("created_at", { ascending: false })
    .limit(1)

  return (data?.[0] as AgentSummary) ?? null
}

// ─── Fetch: pivot stats (greeting sub-line) ──────────────────────────────────

export async function fetchPivotStats(
  supabase: SB,
  userId: string,
  brandId: string | null,
  range: DayRange,
  role: string = "rep"
): Promise<PivotStats> {
  const staleThreshold3d = new Date(Date.now() - 3 * 86_400_000).toISOString()
  const repFilter = scopeRep(userId, role)

  let apptsQ = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
    .in("status", ["scheduled", "confirmed"])
  if (repFilter) apptsQ = apptsQ.eq("rep_id", repFilter)
  if (brandId) apptsQ = apptsQ.eq("brand_id", brandId)

  let staleQ = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("status", "in", "(sold,lost)")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${staleThreshold3d}`)
  if (repFilter) staleQ = staleQ.eq("assigned_rep_id", repFilter)
  if (brandId) staleQ = staleQ.eq("brand_id", brandId)

  // pending_cents debe coincidir con el KPI Pending del dashboard. Antes esta
  // query sumaba amount_cents de sales pending SIN descontar abonos parciales
  // y omitía las 'partial' → inflaba el número del greeting respecto al KPI
  // (que usa getSalesBreakdown con la lógica correcta). Ahora usamos el mismo
  // helper para consistencia entre el greeting y la KPI card.
  const [apptsRes, breakdown, staleRes] = await Promise.all([
    apptsQ,
    getSalesBreakdown(supabase, { brandId, repId: repFilter }),
    staleQ,
  ])

  return {
    appts_today: apptsRes.count ?? 0,
    pending_cents: breakdown.outstandingCents,
    stale_count: staleRes.count ?? 0,
  }
}
