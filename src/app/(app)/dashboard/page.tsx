import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import type { Tables } from "@/types/database"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
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
  fetchKpiTrends,
  formatCurrency as fmtCurrency,
} from "@/lib/queries/dashboard"
import { getLocale, getTranslations } from "next-intl/server"
import {
  dateOnlyRangeToUtc,
  formatYmdForDisplay,
  resolveActiveRange,
  type DashboardSearchParams,
  type DateRangePreset,
} from "@/lib/dashboard/date-ranges"
import { DateRangeFilter } from "./_components/date-range-filter"

// Cast to bypass @supabase/ssr↔@supabase/supabase-js@2.46 type param mismatch
type TypedClient = SupabaseClient<Database>
import { fetchDashboardAnalytics } from "@/lib/queries/dashboard-analytics"
import { CallsKpiCard, ApptsKpiCard, SalesKpiCard, PendingKpiCard } from "./_components/kpi-cards"
import { AnalyticsPanel } from "./_components/analytics-panel"
import { TodayApptList } from "./_components/appt-list"
import { UrgentLeadList } from "./_components/urgent-list"
import { AgentSummaryCard } from "./_components/agent-summary"
import { DailyInsightsPanel, type DailyInsightLead } from "./_components/daily-insights-panel"
import { detectStaleLeads } from "@/lib/agent/daily-insights"
import type { PivotStats } from "@/lib/queries/dashboard"

type UserProfile = Pick<Tables<"users">, "name" | "role">

type ClinicOption = {
  id: string
  name: string
  address_line1: string | null
  city: string | null
  state: string | null
}

function getGreeting(timezone: string, t: Awaited<ReturnType<typeof getTranslations<"dashboard">>>): string {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  )
  if (hour < 12) return t("greetingMorning")
  if (hour < 19) return t("greetingAfternoon")
  return t("greetingEvening")
}

function buildKpiLabel(
  kind: "calls" | "appts" | "sales",
  preset: DateRangePreset,
  t: Awaited<ReturnType<typeof getTranslations<"dashboard">>>,
  tFilters: Awaited<ReturnType<typeof getTranslations<"dashboard.filters">>>,
  customRangeLabel: string,
): string {
  if (preset === "today") {
    return t(`${kind}Today` as "callsToday" | "apptsToday" | "salesToday")
  }
  const base = t(`${kind}Label` as "callsLabel" | "apptsLabel" | "salesLabel")
  const range =
    preset === "custom"
      ? customRangeLabel
      : tFilters(preset)
  return `${base} — ${range}`
}

function buildPivotText(pivot: PivotStats, t: Awaited<ReturnType<typeof getTranslations<"dashboard">>>): string {
  if (
    pivot.appts_today === 0 &&
    pivot.pending_cents === 0 &&
    pivot.stale_count === 0
  ) {
    return t("pipelineOnTrack")
  }
  const parts: string[] = []
  if (pivot.appts_today > 0)
    parts.push(`${pivot.appts_today} ${pivot.appts_today !== 1 ? t("apptPlural") : t("apptSingular")}`)
  if (pivot.pending_cents > 0)
    parts.push(`${fmtCurrency(pivot.pending_cents)} ${t("toCollect")}`)
  if (pivot.stale_count > 0)
    parts.push(`${pivot.stale_count} ${pivot.stale_count !== 1 ? t("staleLeadPlural") : t("staleLeadSingular")}`)
  return t("focusToday", { parts: parts.join(", ") })
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Cast to bypass @supabase/ssr ↔ @supabase/supabase-js@2.46 generic mismatch
  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("dashboard")
  const tFilters = await getTranslations("dashboard.filters")
  const locale = await getLocale()

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
  const role = profile?.role ?? "rep"
  if (role === "provider") redirect("/appointments")

  // Resolve active date range from URL searchParams.
  const resolvedParams = await searchParams
  const active = resolveActiveRange(resolvedParams, timezone)
  const range = dateOnlyRangeToUtc(active.from, active.to, timezone)

  // Brand filter from cookie (set by BrandProvider on client)
  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  // Clinicas para el modal de edit-appointment (solo si hay marca activa)
  const clinicsForModalPromise: Promise<ClinicOption[]> = (async () => {
    if (!brandId) return []
    const { data } = await sb
      .from("clinics")
      .select("id, name, address_line1, city, state")
      .eq("brand_id", brandId)
      .eq("active", true)
      .order("name")
    return (data ?? []) as ClinicOption[]
  })()

  // Providers de la marca para el dropdown del modal Edit (solo admin/manager).
  const canReassign = role === "admin" || role === "manager"
  const providersForModalPromise: Promise<{ id: string; name: string }[]> = (async () => {
    if (!brandId || !canReassign) return []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ubData } = await (sb as any)
      .from("user_brands")
      .select("user_id")
      .eq("brand_id", brandId)
    const userIds = ((ubData ?? []) as { user_id: string }[]).map((r) => r.user_id)
    if (userIds.length === 0) return []
    const { data } = await sb
      .from("users")
      .select("id, name")
      .in("id", userIds)
      .eq("active", true)
      .eq("role", "provider")
      .order("name")
    return ((data ?? []) as { id: string; name: string | null }[]).map((u) => ({
      id: u.id,
      name: u.name ?? "—",
    }))
  })()

  // 11 parallel fetches — one per dashboard section
  const [
    kpiCalls,
    kpiAppts,
    kpiSales,
    kpiPending,
    todayAppts,
    urgentLeads,
    summary,
    pivot,
    staleLeadsRaw,
    clinicsForModal,
    providersForModal,
    kpiTrends,
    analytics,
  ] = await Promise.all([
    fetchCallsKpi(sb, user.id, brandId, range, role),
    fetchApptsKpi(sb, user.id, brandId, range, role),
    fetchSalesKpi(sb, user.id, brandId, range, role),
    fetchPendingKpi(sb, user.id, brandId, role),
    fetchTodayAppts(sb, user.id, brandId, range, role),
    fetchUrgentLeads(sb, user.id, brandId, range, role),
    fetchAgentSummary(sb, user.id, range),
    fetchPivotStats(sb, user.id, brandId, range, role),
    detectStaleLeads(sb, user.id, undefined, brandId).catch(() => []),
    clinicsForModalPromise,
    providersForModalPromise,
    fetchKpiTrends(sb, user.id, brandId, role, timezone),
    fetchDashboardAnalytics(sb, user.id, role, { brandId, timezone }),
  ])

  const staleLeadsForPanel: DailyInsightLead[] = staleLeadsRaw.map((l) => ({
    id: l.id,
    name: l.last_name ? `${l.first_name} ${l.last_name}` : l.first_name,
    brand_name: l.brand_name,
    days_stale: l.days_stale,
  }))

  // Dedup: si un lead ya aparece en "Appointments today", sacarlo de "Urgent leads"
  // (estaba duplicado en ambas listas, confundía a los reps).
  const todayApptLeadIds = new Set(todayAppts.map((a) => a.lead_id))
  const urgentLeadsDeduped = urgentLeads.filter((l) => !todayApptLeadIds.has(l.id))

  const greeting = getGreeting(timezone, t)
  const pivotText = buildPivotText(pivot, t)
  const name = profile?.name ?? user.email ?? "—"

  const fromLabel = formatYmdForDisplay(active.from, locale)
  const toLabel = formatYmdForDisplay(active.to, locale)
  const showingLabel = tFilters("showing", {
    from: fromLabel,
    to: toLabel,
  })

  const customRangeLabel = `${fromLabel} – ${toLabel}`
  const callsLabel = buildKpiLabel("calls", active.preset, t, tFilters, customRangeLabel)
  const apptsLabel = buildKpiLabel("appts", active.preset, t, tFilters, customRangeLabel)
  const salesLabel = buildKpiLabel("sales", active.preset, t, tFilters, customRangeLabel)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      {/* Section 1: Greeting + pivot stats + date range filter */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="font-display text-sm font-medium text-[#5C6F68]">{greeting}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#2E8B6F] mt-0.5">{name}</h1>
          <p className="text-[11px] text-[#93A39D] mt-1.5 leading-snug">{pivotText}</p>
          <p className="text-[11px] text-[#93A39D] mt-1 leading-snug">{showingLabel}</p>
        </div>
        <div className="shrink-0">
          <DateRangeFilter
            preset={active.preset}
            from={active.from}
            to={active.to}
            timezone={timezone}
          />
        </div>
      </div>

      {/* Section 2: KPI grid — arriba, lo primero que ve el usuario */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CallsKpiCard data={kpiCalls} label={callsLabel} trend={kpiTrends.calls} />
        <ApptsKpiCard data={kpiAppts} label={apptsLabel} trend={kpiTrends.appts} />
        <SalesKpiCard data={kpiSales} label={salesLabel} trend={kpiTrends.sales} />
        <PendingKpiCard data={kpiPending} />
      </div>

      {/* Panel Analítica (estilo dashboard moderno) — data real, últimas 8 semanas */}
      <AnalyticsPanel data={analytics} />

      {/* PHASE B plug-in: Daily Insights (leads sin contactar) */}
      <DailyInsightsPanel leads={staleLeadsForPanel} />

      {/* Section 3: Agent daily summary */}
      <AgentSummaryCard summary={summary} timezone={timezone} />

      {/* PHASE D plug-in: skill applications relevant to today's pipeline */}

      {/* Section 4 + 5: Today's appointments + Urgent leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TodayApptList
          appts={todayAppts}
          timezone={timezone}
          label={apptsLabel}
          clinics={clinicsForModal}
          userRole={role}
          providers={providersForModal}
          canAssign={canReassign}
        />
        <UrgentLeadList leads={urgentLeadsDeduped} />
      </div>

    </div>
  )
}
