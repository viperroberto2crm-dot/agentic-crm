import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import type { Tables } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  getDayRange,
  fetchTimezone,
  getBrandIdBySlug,
  fetchCallsKpi,
  fetchApptsKpi,
  fetchSalesKpi,
  fetchPendingKpi,
  fetchTodayAppts,
  fetchUrgentLeads,
  fetchAgentSummary,
  fetchPivotStats,
  formatCurrency as fmtCurrency,
} from "@/lib/queries/dashboard"

// Cast to bypass @supabase/ssr↔@supabase/supabase-js@2.46 type param mismatch
type TypedClient = SupabaseClient<Database>
import { CallsKpiCard, ApptsKpiCard, SalesKpiCard, PendingKpiCard } from "./_components/kpi-cards"
import { TodayApptList } from "./_components/appt-list"
import { UrgentLeadList } from "./_components/urgent-list"
import { AgentSummaryCard } from "./_components/agent-summary"
import type { PivotStats } from "@/lib/queries/dashboard"

type UserProfile = Pick<Tables<"users">, "name" | "role">

function getGreeting(timezone: string): string {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  )
  if (hour < 12) return "Buen día"
  if (hour < 19) return "Buenas tardes"
  return "Buenas noches"
}

function buildPivotText(pivot: PivotStats): string {
  if (
    pivot.appts_today === 0 &&
    pivot.pending_cents === 0 &&
    pivot.stale_count === 0
  ) {
    return "Tu pipeline está al día."
  }
  const parts: string[] = []
  if (pivot.appts_today > 0)
    parts.push(`${pivot.appts_today} cita${pivot.appts_today !== 1 ? "s" : ""}`)
  if (pivot.pending_cents > 0)
    parts.push(`${fmtCurrency(pivot.pending_cents)} por cobrar`)
  if (pivot.stale_count > 0)
    parts.push(
      `${pivot.stale_count} lead${pivot.stale_count !== 1 ? "s" : ""} sin contactar`
    )
  return `Tu enfoque hoy: ${parts.join(", ")}`
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Cast to bypass @supabase/ssr ↔ @supabase/supabase-js@2.46 generic mismatch
  const sb = supabase as unknown as TypedClient

  // Profile + timezone in parallel (needed before parallel fetches)
  const [profileRes, timezone] = await Promise.all([
    sb
      .from("users")
      .select("name, role")
      .eq("id", user.id)
      .single() as unknown as Promise<{ data: UserProfile | null; error: unknown }>,
    fetchTimezone(sb, user.id),
  ])

  const profile = profileRes.data
  const dayRange = getDayRange(timezone)

  // Brand filter from cookie (set by BrandProvider on client)
  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  // 8 parallel fetches — one per dashboard section
  const [
    kpiCalls,
    kpiAppts,
    kpiSales,
    kpiPending,
    todayAppts,
    urgentLeads,
    summary,
    pivot,
  ] = await Promise.all([
    fetchCallsKpi(sb, user.id, brandId, dayRange),
    fetchApptsKpi(sb, user.id, brandId, dayRange),
    fetchSalesKpi(sb, user.id, brandId, dayRange),
    fetchPendingKpi(sb, user.id, brandId),
    fetchTodayAppts(sb, user.id, brandId, dayRange),
    fetchUrgentLeads(sb, user.id, brandId, dayRange),
    fetchAgentSummary(sb, user.id, dayRange),
    fetchPivotStats(sb, user.id, brandId, dayRange),
  ])

  const greeting = getGreeting(timezone)
  const pivotText = buildPivotText(pivot)
  const name = profile?.name ?? user.email ?? "—"

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      {/* Section 1: Greeting + pivot stats */}
      <div>
        <p className="text-sm text-gray-400">{greeting}</p>
        <h1 className="text-2xl font-semibold text-gray-900 mt-0.5">{name}</h1>
        <p className="text-[11px] text-gray-400 mt-1.5 leading-snug">{pivotText}</p>
      </div>

      {/* PHASE B plug-in: pending agent actions for this user */}

      {/* Section 2: Agent daily summary */}
      <AgentSummaryCard summary={summary} timezone={timezone} />

      {/* PHASE D plug-in: skill applications relevant to today's pipeline */}

      {/* Section 3: KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CallsKpiCard data={kpiCalls} />
        <ApptsKpiCard data={kpiAppts} />
        <SalesKpiCard data={kpiSales} />
        <PendingKpiCard data={kpiPending} />
      </div>

      {/* Section 4 + 5: Today's appointments + Urgent leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TodayApptList appts={todayAppts} timezone={timezone} />
        <UrgentLeadList leads={urgentLeads} />
      </div>

    </div>
  )
}
