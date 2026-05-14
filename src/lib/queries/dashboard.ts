import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, Enums } from "@/types/database"
import { getSalesBreakdown } from "./sales-kpi"

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
  address_line1: string | null
  city: string | null
  telehealth_link: string | null
  clinic_name: string | null
  lead_id: string
  lead_first_name: string
  lead_last_name: string | null
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
  return data?.timezone ?? "America/Mexico_City"
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
  range: DayRange
): Promise<CallsKpi> {
  let q = supabase
    .from("calls")
    .select("outcome")
    .eq("rep_id", userId)
    .gte("called_at", range.start)
    .lt("called_at", range.end)
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
  range: DayRange
): Promise<ApptsKpi> {
  let q = supabase
    .from("appointments")
    .select("status")
    .eq("rep_id", userId)
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
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
  range: DayRange
): Promise<SalesKpi> {
  const breakdown = await getSalesBreakdown(supabase, {
    brandId,
    repId: userId,
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
  brandId: string | null
): Promise<PendingKpi> {
  const overdueThreshold = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const breakdown = await getSalesBreakdown(supabase, {
    brandId,
    repId: userId,
  })

  // overdue_count: cuántas open están "viejas" (sin cobrar tras 7 días).
  // Necesitamos los created_at por separado — query barata.
  let staleQ = supabase
    .from("sales")
    .select("created_at")
    .eq("rep_id", userId)
    .in("payment_status", ["pending", "partial"])
    .lt("created_at", overdueThreshold)
  if (brandId) staleQ = staleQ.eq("brand_id", brandId)
  const { data: stale } = await staleQ

  return {
    count: breakdown.openCount,
    total_cents: breakdown.outstandingCents,
    overdue_count: (stale ?? []).length,
  }
}

// ─── Fetch: today's appointments (list) ─────────────────────────────────────

export async function fetchTodayAppts(
  supabase: SB,
  userId: string,
  brandId: string | null,
  range: DayRange
): Promise<TodayAppt[]> {
  let q = supabase
    .from("appointments")
    .select(
      "id, scheduled_at, duration_minutes, type, status, address_line1, city, telehealth_link, clinics(name), leads!inner(id, first_name, last_name), brands!inner(slug, name)"
    )
    .eq("rep_id", userId)
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
    .neq("status", "cancelled")
    .order("scheduled_at")
  if (brandId) q = q.eq("brand_id", brandId)

  const { data } = await q
  if (!data) return []

  return data.map((row) => {
    const lead = row.leads as { id: string; first_name: string; last_name: string | null }
    const brand = row.brands as { slug: string; name: string }
    const clinic = row.clinics as { name: string } | null
    return {
      id: row.id,
      scheduled_at: row.scheduled_at,
      duration_minutes: row.duration_minutes,
      type: row.type,
      status: row.status,
      address_line1: row.address_line1,
      city: row.city,
      telehealth_link: row.telehealth_link,
      clinic_name: clinic?.name ?? null,
      lead_id: lead.id,
      lead_first_name: lead.first_name,
      lead_last_name: lead.last_name,
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
  range: DayRange
): Promise<UrgentLead[]> {
  const staleThreshold = new Date(Date.now() - 5 * 86_400_000).toISOString()
  // Include today + tomorrow (24h window after start of today)
  const tomorrowEnd = new Date(new Date(range.end).getTime() + 86_400_000).toISOString()
  const overdueThreshold = new Date(Date.now() - 7 * 86_400_000).toISOString()

  let staleQ = supabase
    .from("leads")
    .select("id, first_name, last_name, last_contacted_at")
    .eq("assigned_rep_id", userId)
    .not("status", "in", "(sold,lost)")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${staleThreshold}`)
    .limit(5)
  if (brandId) staleQ = staleQ.eq("brand_id", brandId)

  let unconfirmedQ = supabase
    .from("appointments")
    .select("lead_id, leads!inner(id, first_name, last_name, last_contacted_at)")
    .eq("rep_id", userId)
    .eq("status", "scheduled")
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", tomorrowEnd)
    .limit(5)
  if (brandId) unconfirmedQ = unconfirmedQ.eq("brand_id", brandId)

  let overdueQ = supabase
    .from("sales")
    .select("lead_id, amount_cents, leads!inner(id, first_name, last_name, last_contacted_at)")
    .eq("rep_id", userId)
    .eq("payment_status", "pending")
    .lt("created_at", overdueThreshold)
    .limit(5)
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
  range: DayRange
): Promise<PivotStats> {
  const staleThreshold3d = new Date(Date.now() - 3 * 86_400_000).toISOString()

  let apptsQ = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("rep_id", userId)
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
    .in("status", ["scheduled", "confirmed"])
  if (brandId) apptsQ = apptsQ.eq("brand_id", brandId)

  let pendingQ = supabase
    .from("sales")
    .select("amount_cents")
    .eq("rep_id", userId)
    .eq("payment_status", "pending")
  if (brandId) pendingQ = pendingQ.eq("brand_id", brandId)

  let staleQ = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("assigned_rep_id", userId)
    .not("status", "in", "(sold,lost)")
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${staleThreshold3d}`)
  if (brandId) staleQ = staleQ.eq("brand_id", brandId)

  const [apptsRes, pendingRes, staleRes] = await Promise.all([
    apptsQ,
    pendingQ,
    staleQ,
  ])

  const pendingCents = (pendingRes.data ?? []).reduce(
    (sum, r) => sum + r.amount_cents,
    0
  )

  return {
    appts_today: apptsRes.count ?? 0,
    pending_cents: pendingCents,
    stale_count: staleRes.count ?? 0,
  }
}
