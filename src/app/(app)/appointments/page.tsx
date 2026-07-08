import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug, fetchTimezone } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { NewAppointmentButton } from "./_components/new-appointment-button"
import { AppointmentStatusActions } from "./_components/appointment-status-actions"
import { EditAppointmentButton } from "./_components/edit-appointment-button"
import { getLocale, getTranslations } from "next-intl/server"
import { formatApptDateTime } from "@/lib/datetime"
import { RepCellSelectClient } from "./_components/rep-cell-select-client"
import { ProviderCellSelectClient } from "./_components/provider-cell-select-client"
import { PatientSearchInput } from "@/components/ui/patient-search-input"
import { DeleteAppointmentButton } from "./_components/delete-appointment-button"
import {
  dateOnlyRangeToUtc,
  formatYmdForDisplay,
  resolveActiveRange,
  type DashboardSearchParams,
} from "@/lib/dashboard/date-ranges"
import { DateRangeFilter } from "../dashboard/_components/date-range-filter"

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

  const STATUS_CONFIG: Record<ApptStatus, { label: string; cls: string }> = {
    scheduled:   { label: t("appointmentStatuses.scheduled"),   cls: "border-blue-500/40 text-blue-400" },
    confirmed:   { label: t("appointmentStatuses.confirmed"),   cls: "border-emerald-500/40 text-emerald-400" },
    completed:   { label: t("appointmentStatuses.completed"),   cls: "border-zinc-500/40 text-gray-500" },
    cancelled:   { label: t("appointmentStatuses.cancelled"),   cls: "border-red-500/40 text-red-400" },
    no_show:     { label: t("appointmentStatuses.no_show"),     cls: "border-amber-500/40 text-amber-400" },
    rescheduled: { label: t("appointmentStatuses.rescheduled"), cls: "border-violet-500/40 text-violet-400" },
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
          <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
          <p className="text-[11px] text-gray-400 mt-1 leading-snug">
            {active.from === active.to ? fromLabel : `${fromLabel} – ${toLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400">{count ?? appts.length} total</span>
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
              className={`px-3 py-1 rounded text-xs transition-colors ${
                isActive ? "bg-gray-200 text-gray-900" : "text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg px-4 py-2">
        {appts.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">{t("noApptsFilter")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colDateTime")}</th>
                {allMode && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{tc("colCompany")}</th>
                )}
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{tc("colLead")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">{t("colType")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colStatus")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">{t("colService")}</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden lg:table-cell">{tc("colRep")}</th>
                )}
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden lg:table-cell">{tc("colProvider")}</th>
                )}
                <th className="text-right text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {appts.map((a) => {
                const cfg = STATUS_CONFIG[a.status]
                const brand = allMode && a.brand_id ? brandsById.get(a.brand_id) : null
                return (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4">
                      <span className="text-gray-700 text-xs tabular-nums">{fmtDate(a.scheduled_at)}</span>
                    </td>
                    {allMode && (
                      <td className="py-3 pr-4">
                        {brand ? (
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: brand.brand_color ?? FALLBACK_COLORS[brand.slug] ?? "#3B82F6" }}
                            />
                            <span className="text-xs text-gray-500 truncate max-w-[140px]">{brand.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-3 pr-4">
                      {a.lead ? (
                        <Link href={`/leads/${a.lead.id}`} className="text-gray-800 hover:text-gray-900 font-medium transition-colors">
                          {a.lead.first_name} {a.lead.last_name ?? ""}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-gray-400">{TYPE_LABEL[a.type]}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${cfg.cls}`}>
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <span className="text-xs text-gray-400">{a.service ?? "—"}</span>
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
