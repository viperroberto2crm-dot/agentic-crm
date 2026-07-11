import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import { CalendarDays } from "lucide-react"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug, fetchTimezone } from "@/lib/queries/dashboard"
import { NewAppointmentButton } from "./_components/new-appointment-button"
import { AppointmentStatusActions } from "./_components/appointment-status-actions"
import { EditAppointmentButton } from "./_components/edit-appointment-button"
import { getLocale, getTranslations } from "next-intl/server"
import { formatApptDateTime, formatTime, parseDbDate, BRAND_TIMEZONE } from "@/lib/datetime"
import { RepCellSelectClient } from "./_components/rep-cell-select-client"
import { ProviderCellSelectClient } from "./_components/provider-cell-select-client"
import { PatientSearchInput } from "@/components/ui/patient-search-input"
import { DeleteAppointmentButton } from "./_components/delete-appointment-button"
import {
  dateOnlyRangeToUtc,
  formatYmd,
  formatYmdForDisplay,
  getPresetRange,
  resolveActiveRange,
  ymdFromDateInTz,
  type DashboardSearchParams,
} from "@/lib/dashboard/date-ranges"
import { DateRangeFilter } from "../dashboard/_components/date-range-filter"
import { AppointmentsCalendar, type CalendarAppt } from "./_components/appointments-calendar"

type TypedClient = SupabaseClient<Database>
type ApptStatus = Database["public"]["Enums"]["appointment_status"]
type ApptType = Database["public"]["Enums"]["appointment_type"]

// Fallback dot colors by slug, mirrors leads-table-bulk's BRAND_COLORS.
const FALLBACK_COLORS: Record<string, string> = {
  "si-se-pierde": "#E11D48",
  "sunny-slim": "#F59E0B",
}

function fmtDate(d: string) {
  return formatApptDateTime(d)
}

// Avatares cálidos por paciente (gradientes deterministas por nombre).
const GRADS = [
  "linear-gradient(150deg,#EF7B5C,#E2653F)",
  "linear-gradient(150deg,#3FA278,#2C6B57)",
  "linear-gradient(150deg,#5F8CE6,#3E63B8)",
  "linear-gradient(150deg,#E0A64E,#C88A2E)",
  "linear-gradient(150deg,#8E7CC3,#6E5AA6)",
  "linear-gradient(150deg,#D5807E,#B85D5B)",
]
function grad(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return GRADS[h % GRADS.length]
}
function initials(n: string) {
  const p = (n || "?").trim().split(/\s+/)
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "") || "?").toUpperCase()
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("appointments")
  const tc = await getTranslations("common")

  const STATUS_CONFIG: Record<ApptStatus, { label: string; bg: string; text: string; dot: string }> = {
    scheduled:   { label: t("appointmentStatuses.scheduled"),   bg: "#E4F2EE", text: "#2E8B6F", dot: "#3FA278" },
    confirmed:   { label: t("appointmentStatuses.confirmed"),   bg: "#E4F2EE", text: "#2E8B6F", dot: "#3FA278" },
    completed:   { label: t("appointmentStatuses.completed"),   bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" },
    cancelled:   { label: t("appointmentStatuses.cancelled"),   bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" },
    no_show:     { label: t("appointmentStatuses.no_show"),     bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" },
    rescheduled: { label: t("appointmentStatuses.rescheduled"), bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" },
  }

  const TYPE_LABEL: Record<ApptType, string> = {
    clinic:     t("types.clinic"),
    home:       t("types.home"),
    telehealth: t("types.telehealth"),
  }

  const [profileRes, cookieStore, params, timezone] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
    fetchTimezone(sb, user.id),
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const allMode = brandSlug === "__all__"
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  // "All companies" mode: strictly limit to the user's AUTHORIZED brands.
  // admin → every brand; non-admin → only their user_brands rows.
  let authorizedBrandIds: string[] = []
  const brandsById = new Map<
    string,
    { id: string; name: string; slug: string; brand_color: string | null }
  >()
  if (allMode) {
    if (role === "admin") {
      const { data: brandRows } = await sb.from("brands").select("id")
      authorizedBrandIds = (brandRows ?? []).map((b) => b.id as string)
    } else {
      const { data: ubRows } = await sb
        .from("user_brands")
        .select("brand_id")
        .eq("user_id", user.id)
      authorizedBrandIds = (ubRows ?? []).map((r) => r.brand_id as string)
    }
    // Display labels/colors only (names + colors, not appointment data).
    const { data: brandRows } = await sb
      .from("brands")
      .select("id, name, slug, brand_color")
    for (const b of brandRows ?? []) {
      brandsById.set(b.id as string, {
        id: b.id as string,
        name: b.name as string,
        slug: b.slug as string,
        brand_color: (b.brand_color as string | null) ?? null,
      })
    }
  }

  const sp = params as Record<string, string | string[] | undefined>
  const statusFilter = typeof sp.status === "string" ? sp.status : null
  const searchTerm = typeof sp.search === "string" ? sp.search.trim() : null
  const locale = await getLocale()
  const active = resolveActiveRange(sp as DashboardSearchParams, timezone)
  const range = dateOnlyRangeToUtc(active.from, active.to, timezone)

  let leadIdsFilter: string[] | null = null
  if (searchTerm && (brandId || (allMode && authorizedBrandIds.length > 0))) {
    const tokens = searchTerm.replace(/[(),]/g, " ").split(/\s+/).filter(Boolean)
    const orParts: string[] = []
    for (const tok of tokens) {
      const t = tok.replace(/%/g, "")
      orParts.push(`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `phone.ilike.%${t}%`)
    }
    const base = sb.from("leads").select("id")
    const scoped = allMode
      ? base.in("brand_id", authorizedBrandIds)
      : base.eq("brand_id", brandId!)
    const { data: matchingLeads } = await scoped.or(orParts.join(",")).limit(500)
    leadIdsFilter = (matchingLeads ?? []).map((l) => l.id)
    if (leadIdsFilter.length === 0) leadIdsFilter = ["00000000-0000-0000-0000-000000000000"]
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = (sb as any)
    .from("appointments")
    .select(
      `id, scheduled_at, type, status, service, duration_minutes, notes,
       clinic_id, telehealth_link, lead_id, provider_id, brand_id,
       provider_approved, provider_approved_at, provider_notes, shipped_at,
       lead:leads!appointments_lead_id_fkey(id, first_name, last_name),
       rep:users!appointments_rep_id_fkey(id, name),
       provider:users!appointments_provider_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("scheduled_at", { ascending: false })
    .limit(100)

  if (role === "rep") query = query.eq("rep_id", user.id)
  if (role === "provider") query = query.eq("provider_id", user.id)
  if (allMode) {
    // "All companies" = ONLY authorized brands. Empty list → no rows.
    query = query.in(
      "brand_id",
      authorizedBrandIds.length ? authorizedBrandIds : ["00000000-0000-0000-0000-000000000000"],
    )
  } else if (brandId) {
    query = query.eq("brand_id", brandId)
  }
  if (statusFilter) query = query.eq("status", statusFilter as ApptStatus)
  if (leadIdsFilter) query = query.in("lead_id", leadIdsFilter)
  query = query.gte("scheduled_at", range.start).lt("scheduled_at", range.end)

  const { data: raw, count } = await query

  type ApptItem = {
    id: string; scheduled_at: string; type: ApptType; status: ApptStatus
    service: string | null; duration_minutes: number; notes: string | null
    clinic_id: string | null; telehealth_link: string | null; lead_id: string | null
    provider_id: string | null
    brand_id: string | null
    provider_approved: boolean | null
    provider_approved_at: string | null
    provider_notes: string | null
    shipped_at: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
    provider: { id: string; name: string } | null
  }
  const appts = (raw ?? []) as unknown as ApptItem[]

  // ── Datos para el CALENDARIO mensual (query DEDICADA — revisado con Fable) ──
  // NO reusa la lista (.limit(100) ocultaría citas). Todo en BRAND_TIMEZONE
  // (Pacific) para que el día de la celda cuadre con la hora mostrada. Paginado
  // hasta traer todas; si algo no cabe, se AVISA (nunca truncado mudo).
  const calYear = parseInt(active.from.slice(0, 4), 10)
  const calMonth = parseInt(active.from.slice(5, 7), 10)
  const calLastDay = new Date(Date.UTC(calYear, calMonth, 0)).getUTCDate()
  const calFrom = formatYmd(calYear, calMonth, 1)
  const calTo = formatYmd(calYear, calMonth, calLastDay)
  const calRange = dateOnlyRangeToUtc(calFrom, calTo, BRAND_TIMEZONE)

  type CalRow = {
    id: string; scheduled_at: string; status: ApptStatus; service: string | null; type: ApptType
    brand_id: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
  }
  const calRows: CalRow[] = []
  let calCount = 0
  {
    const PAGE = 1000
    const MAX_PAGES = 5 // tope de seguridad (5,000 citas/mes no es realista hoy)
    for (let p = 0; p < MAX_PAGES; p++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cq: any = (sb as any)
        .from("appointments")
        .select(
          "id, scheduled_at, status, service, type, brand_id, lead:leads!appointments_lead_id_fkey(id, first_name, last_name)",
          { count: "exact" },
        )
        .gte("scheduled_at", calRange.start)
        .lt("scheduled_at", calRange.end)
        .order("scheduled_at", { ascending: true })
        .range(p * PAGE, p * PAGE + PAGE - 1)
      // MISMO scope que la lista (seguridad/alcance)
      if (role === "rep") cq = cq.eq("rep_id", user.id)
      if (role === "provider") cq = cq.eq("provider_id", user.id)
      if (allMode) {
        cq = cq.in("brand_id", authorizedBrandIds.length ? authorizedBrandIds : ["00000000-0000-0000-0000-000000000000"])
      } else if (brandId) {
        cq = cq.eq("brand_id", brandId)
      }
      if (statusFilter) cq = cq.eq("status", statusFilter as ApptStatus)
      if (leadIdsFilter) cq = cq.in("lead_id", leadIdsFilter)
      const { data: cData, count: cCount } = await cq
      if (typeof cCount === "number") calCount = cCount
      const batch = (cData ?? []) as CalRow[]
      calRows.push(...batch)
      if (batch.length < PAGE) break
    }
  }

  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAND_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  })
  let calInvalid = 0
  const calItems: CalendarAppt[] = calRows.flatMap((a) => {
    const d = parseDbDate(a.scheduled_at)
    if (!d) { calInvalid++; return [] }
    const cfg = STATUS_CONFIG[a.status] ?? STATUS_CONFIG.scheduled
    const nm = a.lead ? `${a.lead.first_name} ${a.lead.last_name ?? ""}`.trim() : ""
    return [{
      id: a.id,
      dayKey: dayKeyFmt.format(d),
      time: formatTime(a.scheduled_at),
      sortKey: d.getTime(),
      leadName: nm || "(sin paciente)",
      leadId: a.lead?.id ?? null,
      dot: cfg.dot,
      statusLabel: cfg.label,
      statusBg: cfg.bg,
      statusText: cfg.text,
      service: a.service ?? null,
      typeLabel: TYPE_LABEL[a.type],
    }]
  })
  // Aviso si algo NO se pudo mostrar (tope de páginas o fecha inválida). Nunca mudo.
  const calHidden = Math.max(0, calCount - calRows.length) + calInvalid

  const calMonthLabel = new Intl.DateTimeFormat(locale, {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(calYear, calMonth - 1, 1)))
  const calTodayKey = ymdFromDateInTz(new Date(), BRAND_TIMEZONE)
  const monthHref = (from: string, to: string): string => {
    const qs = new URLSearchParams()
    qs.set("preset", "custom"); qs.set("from", from); qs.set("to", to)
    if (statusFilter) qs.set("status", statusFilter)
    if (searchTerm) qs.set("search", searchTerm)
    return `/appointments?${qs.toString()}`
  }
  const prevD = new Date(Date.UTC(calYear, calMonth - 2, 1))
  const nextD = new Date(Date.UTC(calYear, calMonth, 1))
  const calPrevHref = monthHref(
    formatYmd(prevD.getUTCFullYear(), prevD.getUTCMonth() + 1, 1),
    formatYmd(prevD.getUTCFullYear(), prevD.getUTCMonth() + 1, new Date(Date.UTC(prevD.getUTCFullYear(), prevD.getUTCMonth() + 1, 0)).getUTCDate()),
  )
  const calNextHref = monthHref(
    formatYmd(nextD.getUTCFullYear(), nextD.getUTCMonth() + 1, 1),
    formatYmd(nextD.getUTCFullYear(), nextD.getUTCMonth() + 1, new Date(Date.UTC(nextD.getUTCFullYear(), nextD.getUTCMonth() + 1, 0)).getUTCDate()),
  )
  const thisMonthRange = getPresetRange("thisMonth", timezone)
  const calTodayHref = monthHref(thisMonthRange.from, thisMonthRange.to)

  let leadsForModal: {
    id: string
    first_name: string
    last_name: string | null
    phone: string
    address_line1: string | null
    address_line2: string | null
    city: string | null
    state: string | null
    zip: string | null
  }[] = []
  let clinicsForModal: {
    id: string
    name: string
    address_line1: string | null
    city: string | null
    state: string | null
  }[] = []
  if (brandId) {
    let lq = sb
      .from("leads")
      .select("id, first_name, last_name, phone, address_line1, address_line2, city, state, zip")
      .eq("brand_id", brandId)
      .order("first_name")
      .limit(200)
    if (role === "rep") lq = lq.eq("assigned_rep_id", user.id)
    if (role === "provider") {
      const { data: leadIdsRows } = await sb
        .from("appointments")
        .select("lead_id")
        .eq("provider_id", user.id)
        .not("lead_id", "is", null)
      const providerLeadIds = Array.from(
        new Set(
          (leadIdsRows ?? [])
            .map((r) => r.lead_id)
            .filter((x): x is string => Boolean(x))
        )
      )
      if (providerLeadIds.length === 0) {
        lq = lq.eq("id", "00000000-0000-0000-0000-000000000000")
      } else {
        lq = lq.in("id", providerLeadIds)
      }
    }
    const { data } = await lq
    leadsForModal = (data ?? []) as typeof leadsForModal

    const { data: clinicsData } = await sb
      .from("clinics")
      .select("id, name, address_line1, city, state")
      .eq("brand_id", brandId)
      .eq("active", true)
      .order("name")
    clinicsForModal = (clinicsData ?? []) as typeof clinicsForModal
  }

  // Admin/manager pueden reasignar rep o provider de la cita.
  // brandReps = solo reps/admin/manager (dueños venta). brandProviders = providers (atienden cita).
  const canReassign = role === "admin" || role === "manager"
  let brandReps: { id: string; name: string; role: string }[] = []
  let brandProviders: { id: string; name: string; role: string }[] = []
  if (canReassign && brandId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ubData } = await (sb as any)
      .from("user_brands")
      .select("user_id")
      .eq("brand_id", brandId)
    const userIds = ((ubData ?? []) as { user_id: string }[]).map((r) => r.user_id)
    if (userIds.length > 0) {
      const { data: allUsers } = await sb
        .from("users")
        .select("id, name, role")
        .in("id", userIds)
        .eq("active", true)
        .in("role", ["admin", "manager", "rep", "provider"])
        .order("name")
      const rows = (allUsers ?? []).map((u) => ({
        id: u.id as string,
        name: (u.name as string | null) ?? "—",
        role: (u.role as string | null) ?? "rep",
      }))
      brandReps = rows.filter((u) => u.role !== "provider")
      brandProviders = rows.filter((u) => u.role === "provider")
    }
  }

  const tabs = [
    { value: null,          label: t("allAppts") },
    { value: "scheduled",   label: t("scheduledTab") },
    { value: "confirmed",   label: t("confirmedTab") },
    { value: "completed",   label: t("completedTab") },
    { value: "rescheduled", label: t("rescheduledTab") },
    { value: "cancelled",   label: t("cancelledTab") },
    { value: "no_show",     label: t("noShowTab") },
  ] as const

  const fromLabel = formatYmdForDisplay(active.from, locale)
  const toLabel = formatYmdForDisplay(active.to, locale)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">{t("title")}</h1>
          <p className="text-[13px] text-[#93A39D] mt-1 leading-snug">
            {active.from === active.to ? fromLabel : `${fromLabel} – ${toLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[13px] text-[#93A39D] tabular-nums">{count ?? appts.length} total</span>
          <DateRangeFilter
            preset={active.preset}
            from={active.from}
            to={active.to}
            timezone={timezone}
          />
          {brandId && role !== "provider" && (
            <NewAppointmentButton
              brandId={brandId}
              leads={leadsForModal}
              clinics={clinicsForModal}
              assignableUsers={brandReps}
              assignableProviders={brandProviders}
              canAssign={canReassign}
            />
          )}
        </div>
      </div>

      <PatientSearchInput placeholder={tc("searchPatientPlaceholder")} />

      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => {
          const isActive = statusFilter === tab.value
          // Preservar params de fecha (from/to/preset) y search al cambiar de tab
          const qs = new URLSearchParams()
          if (typeof sp.from === "string") qs.set("from", sp.from)
          if (typeof sp.to === "string") qs.set("to", sp.to)
          if (typeof sp.preset === "string") qs.set("preset", sp.preset)
          if (typeof sp.search === "string") qs.set("search", sp.search)
          if (tab.value) qs.set("status", tab.value)
          const href = qs.toString() ? `/appointments?${qs.toString()}` : "/appointments"
          return (
            <Link
              key={tab.label}
              href={href}
              className={`h-8 px-3.5 inline-flex items-center rounded-full text-[13px] font-medium border transition-colors ${
                isActive
                  ? "bg-[#20342C] text-white border-[#20342C]"
                  : "bg-card text-[#5C6F68] border-[#ECE3D3] hover:border-[#D8CDB5]"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <AppointmentsCalendar
        items={calItems}
        year={calYear}
        month={calMonth}
        monthLabel={calMonthLabel}
        todayKey={calTodayKey}
        locale={locale}
        total={calCount}
        hiddenCount={calHidden}
        prevHref={calPrevHref}
        nextHref={calNextHref}
        todayHref={calTodayHref}
      />

      <div className="bg-card border border-[#ECE3D3] rounded-2xl shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)] px-4 py-2">
        {appts.length === 0 ? (
          <p className="text-sm text-[#93A39D] py-10 text-center">{t("noApptsFilter")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#ECE3D3]">
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4">{t("colDateTime")}</th>
                {allMode && (
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4">{tc("colCompany")}</th>
                )}
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4">{tc("colLead")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4 hidden md:table-cell">{t("colType")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4">{t("colStatus")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4 hidden sm:table-cell">{t("colService")}</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4 hidden lg:table-cell">{tc("colRep")}</th>
                )}
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1 pr-4 hidden lg:table-cell">{tc("colProvider")}</th>
                )}
                <th className="text-right text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2.5 pt-1">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {appts.map((a) => {
                const cfg = STATUS_CONFIG[a.status]
                const brand = allMode && a.brand_id ? brandsById.get(a.brand_id) : null
                const leadName = a.lead ? `${a.lead.first_name} ${a.lead.last_name ?? ""}`.trim() : ""
                return (
                  <tr key={a.id} className="border-b border-[#F1EADD] hover:bg-[#FBF6EC] transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {leadName ? (
                          <span
                            className="w-10 h-10 rounded-[13px] shrink-0 grid place-items-center text-white font-semibold text-[14px] shadow-[0_2px_6px_rgba(18,60,48,0.14)]"
                            style={{ background: grad(leadName) }}
                          >
                            {initials(leadName)}
                          </span>
                        ) : (
                          <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0 bg-[#E4F2EE]">
                            <CalendarDays className="w-5 h-5" style={{ color: "#2E8B6F" }} />
                          </span>
                        )}
                        <span className="font-semibold text-[13.5px] text-[#20342C] tabular-nums whitespace-nowrap">{fmtDate(a.scheduled_at)}</span>
                      </div>
                    </td>
                    {allMode && (
                      <td className="py-3 pr-4">
                        {brand ? (
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: brand.brand_color ?? FALLBACK_COLORS[brand.slug] ?? "#3B82F6" }}
                            />
                            <span className="text-[13px] text-[#5C6F68] truncate max-w-[140px]">{brand.name}</span>
                          </span>
                        ) : (
                          <span className="text-[13px] text-[#B7AE9C]">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-3 pr-4">
                      {a.lead ? (
                        <Link href={`/leads/${a.lead.id}`} className="font-semibold text-[15px] text-[#20342C] hover:text-[#2E8B6F] transition-colors">
                          {a.lead.first_name} {a.lead.last_name ?? ""}
                        </Link>
                      ) : (
                        <span className="text-[#B7AE9C]">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-[13px] text-[#93A39D]">{TYPE_LABEL[a.type]}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold whitespace-nowrap"
                        style={{ backgroundColor: cfg.bg, color: cfg.text }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <span className="text-[13px] text-[#5C6F68]">{a.service ?? "—"}</span>
                    </td>
                    {role !== "rep" && (
                      <td className="py-3 pr-4 hidden lg:table-cell">
                        <RepCellSelectClient
                          appointmentId={a.id}
                          currentRepId={a.rep?.id ?? null}
                          currentRepName={a.rep?.name ?? null}
                          reps={brandReps}
                          canEdit={canReassign}
                        />
                      </td>
                    )}
                    {role !== "rep" && (
                      <td className="py-3 pr-4 hidden lg:table-cell">
                        <ProviderCellSelectClient
                          appointmentId={a.id}
                          currentProviderId={a.provider?.id ?? null}
                          currentProviderName={a.provider?.name ?? null}
                          providers={brandProviders}
                          canEdit={canReassign}
                        />
                      </td>
                    )}
                    <td className="py-3 text-right">
                      <div className="flex justify-end items-center gap-1">
                        <AppointmentStatusActions appointmentId={a.id} status={a.status} />
                        <EditAppointmentButton
                          appointment={{
                            id: a.id,
                            lead_id: a.lead_id,
                            type: a.type,
                            status: a.status,
                            scheduled_at: a.scheduled_at,
                            duration_minutes: a.duration_minutes,
                            service: a.service,
                            notes: a.notes,
                            clinic_id: a.clinic_id,
                            telehealth_link: a.telehealth_link,
                            provider_id: a.provider?.id ?? null,
                            provider_approved: a.provider_approved,
                            provider_approved_at: a.provider_approved_at,
                            provider_notes: a.provider_notes,
                            shipped_at: a.shipped_at,
                          }}
                          leads={leadsForModal}
                          clinics={clinicsForModal}
                          userRole={role}
                          assignableProviders={brandProviders}
                          canAssign={canReassign}
                        />
                        {role !== "provider" && (
                          <DeleteAppointmentButton appointmentId={a.id} />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
