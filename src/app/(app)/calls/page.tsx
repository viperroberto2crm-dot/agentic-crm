import { createClient } from "@/lib/supabase/server"
import { applyLeadSearch } from "@/lib/queries/search"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Phone } from "lucide-react"
import { NewCallButton } from "./_components/new-call-button"
import { getTranslations } from "next-intl/server"
import { ExportButton } from "@/components/exports/export-button"
import { BRAND_TIMEZONE, parseDbDate } from "@/lib/datetime"
import { PatientSearchInput } from "@/components/ui/patient-search-input"

type TypedClient = SupabaseClient<Database>
type CallOutcome = Database["public"]["Enums"]["call_outcome"]
type CallDirection = Database["public"]["Enums"]["call_direction"]

// Fallback dot colors by slug, mirrors leads-table-bulk's BRAND_COLORS.
const FALLBACK_COLORS: Record<string, string> = {
  "si-se-pierde": "#E11D48",
  "sunny-slim": "#F59E0B",
}

// Degradados cálidos para avatar de paciente; se eligen de forma estable por el nombre.
const GRADS = [
  "linear-gradient(150deg,#EF7B5C,#E2653F)",
  "linear-gradient(150deg,#3FA278,#2C6B57)",
  "linear-gradient(150deg,#5F8CE6,#3E63B8)",
  "linear-gradient(150deg,#E0A64E,#C88A2E)",
  "linear-gradient(150deg,#8E7CC3,#6E5AA6)",
  "linear-gradient(150deg,#D5807E,#B85D5B)",
]
function grad(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return GRADS[h % GRADS.length]
}
function initials(n: string): string {
  const p = (n || "?").trim().split(/\s+/)
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "") || "?").toUpperCase()
}

function CallAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="w-10 h-10 rounded-[13px] shrink-0 grid place-items-center text-white font-semibold text-[14px] shadow-[0_2px_6px_rgba(18,60,48,0.14)] select-none"
      style={{ background: grad(name) }}
    >
      {initials(name)}
    </span>
  )
}

function PhoneSquare() {
  return (
    <span
      aria-hidden
      className="w-10 h-10 rounded-xl shrink-0 grid place-items-center"
      style={{ background: "#EFEAF9" }}
    >
      <Phone className="w-[18px] h-[18px]" style={{ stroke: "#8E7CC3" }} />
    </span>
  )
}

function fmtDuration(s: number | null) {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function fmtDate(d: string) {
  const parsed = parseDbDate(d)
  if (!parsed) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(parsed)
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("calls")
  const tc = await getTranslations("common")

  const OUTCOME_CONFIG: Record<CallOutcome, { label: string; bg: string; text: string; dot: string }> = {
    connected:           { label: t("outcomes.connected"),          bg: "#E6F3EC", text: "#2E7E5B", dot: "#3FA278" },
    appointment_set:     { label: t("outcomes.appointment_set"),    bg: "#E4F2EE", text: "#2E8B6F", dot: "#3FA278" },
    callback_requested:  { label: t("outcomes.callback_requested"), bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" },
    voicemail:           { label: t("outcomes.voicemail"),          bg: "#FBF1DD", text: "#B67C22", dot: "#D79A3E" },
    no_answer:           { label: t("outcomes.no_answer"),          bg: "#F0EBE0", text: "#7C7259", dot: "#C7B48A" },
    not_interested:      { label: t("outcomes.not_interested"),     bg: "#FAEBEA", text: "#B85D5B", dot: "#D5807E" },
    wrong_number:        { label: t("outcomes.wrong_number"),       bg: "#F0EBE0", text: "#7C7259", dot: "#C7B48A" },
  }

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  if (role === "provider") redirect("/appointments")
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
    // Display labels/colors only (names + colors, not call data).
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
  const outcomeFilter = typeof sp.outcome === "string" ? sp.outcome : null
  const dirFilter = typeof sp.direction === "string" ? sp.direction : null
  const searchTerm = typeof sp.search === "string" ? sp.search.trim() : null

  let leadIdsFilter: string[] | null = null
  if (searchTerm && (brandId || (allMode && authorizedBrandIds.length > 0))) {
    const base = sb.from("leads").select("id")
    const scoped = allMode
      ? base.in("brand_id", authorizedBrandIds)
      : base.eq("brand_id", brandId!)
    const { data: matchingLeads } = await applyLeadSearch(scoped, searchTerm).limit(500)
    leadIdsFilter = (matchingLeads ?? []).map((l) => l.id)
    if (leadIdsFilter.length === 0) leadIdsFilter = ["00000000-0000-0000-0000-000000000000"]
  }

  let query = sb
    .from("calls")
    .select(
      `id, direction, outcome, duration_seconds, called_at, notes, caller_e164, brand_id,
       lead:leads!calls_lead_id_fkey(id, first_name, last_name),
       rep:users!calls_rep_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("called_at", { ascending: false })
    .limit(100)

  if (role === "rep") query = query.eq("rep_id", user.id)
  if (allMode) {
    // "All companies" = ONLY authorized brands. Empty list → no rows.
    query = query.in(
      "brand_id",
      authorizedBrandIds.length ? authorizedBrandIds : ["00000000-0000-0000-0000-000000000000"],
    )
  } else if (brandId) {
    query = query.eq("brand_id", brandId)
  }
  if (outcomeFilter) query = query.eq("outcome", outcomeFilter as CallOutcome)
  if (dirFilter) query = query.eq("direction", dirFilter as CallDirection)
  if (leadIdsFilter) query = query.in("lead_id", leadIdsFilter)

  const { data: raw, count } = await query

  type CallItem = {
    id: string; direction: CallDirection; outcome: CallOutcome | null
    duration_seconds: number | null; called_at: string; notes: string | null
    caller_e164: string | null
    brand_id: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
  }
  const calls = (raw ?? []) as unknown as CallItem[]

  let leadsForModal: { id: string; first_name: string; last_name: string | null; phone: string }[] = []
  if (brandId) {
    let lq = sb.from("leads").select("id, first_name, last_name, phone")
      .eq("brand_id", brandId).order("first_name").limit(200)
    if (role === "rep") lq = lq.eq("assigned_rep_id", user.id)
    const { data } = await lq
    leadsForModal = (data ?? []) as typeof leadsForModal
  }

  const outcomeTabs = [
    { value: null,               label: t("allCalls") },
    { value: "connected",        label: t("connectedTab") },
    { value: "appointment_set",  label: t("appointmentSetTab") },
    { value: "voicemail",        label: t("voicemailTab") },
    { value: "no_answer",        label: t("noAnswerTab") },
  ] as const

  const dirTabs = [
    { value: null,       label: t("allDirections") },
    { value: "outbound", label: t("outboundCalls") },
    { value: "inbound",  label: t("inboundCalls") },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">{t("title")}</h1>
          <p className="text-[13px] text-[#93A39D] mt-1">{count ?? calls.length} total</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <ExportButton
            entity="calls"
            extraParams={{ outcome: outcomeFilter, direction: dirFilter }}
          />
          {brandId && <NewCallButton brandId={brandId} leads={leadsForModal} />}
        </div>
      </div>

      <PatientSearchInput placeholder={tc("searchPatientPlaceholder")} />

      <div className="flex gap-2 flex-wrap items-center">
        {outcomeTabs.map((tab) => {
          const isActive = outcomeFilter === tab.value
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/calls?outcome=${tab.value}` : "/calls"}
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
        <span className="text-[#D8CDB5] px-1">|</span>
        {dirTabs.map((tab) => {
          const isActive = dirFilter === tab.value
          return (
            <Link
              key={tab.label}
              href={tab.value
                ? (outcomeFilter ? `/calls?outcome=${outcomeFilter}&direction=${tab.value}` : `/calls?direction=${tab.value}`)
                : (outcomeFilter ? `/calls?outcome=${outcomeFilter}` : "/calls")
              }
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

      <div className="bg-card border border-[#ECE3D3] rounded-2xl px-4 py-1 shadow-[0_1px_2px_rgba(26,46,40,0.05),0_10px_28px_-14px_rgba(26,46,40,0.12)]">
        {calls.length === 0 ? (
          <p className="text-sm text-[#93A39D] py-16 text-center">{t("noCallsFilter")}</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#ECE3D3]">
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">{t("colDate")}</th>
                {allMode && (
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">{tc("colCompany")}</th>
                )}
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 min-w-[180px]">{tc("colLead")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">{t("colDir")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4">{t("colOutcome")}</th>
                <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">{t("colDuration")}</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-[#93A39D] font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">{t("colRep")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const cfg = c.outcome ? OUTCOME_CONFIG[c.outcome] : null
                const brand = allMode && c.brand_id ? brandsById.get(c.brand_id) : null
                return (
                  <tr key={c.id} className="border-b border-[#F1EADD] hover:bg-[#FBF6EC] transition-colors cursor-pointer relative">
                    <td className="py-3 pr-4 relative">
                      <Link
                        href={`/calls/${c.id}`}
                        className="absolute inset-0 z-0"
                        aria-label={`Open call ${c.id}`}
                      />
                      <span className="text-[#93A39D] text-xs tabular-nums relative z-0">{fmtDate(c.called_at)}</span>
                    </td>
                    {allMode && (
                      <td className="py-3 pr-4">
                        {brand ? (
                          <span className="flex items-center gap-1.5 min-w-0 relative z-10">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: brand.brand_color ?? FALLBACK_COLORS[brand.slug] ?? "#3B82F6" }}
                            />
                            <span className="text-[13px] text-[#5C6F68] truncate max-w-[140px]">{brand.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-[#C9C0AF]">—</span>
                        )}
                      </td>
                    )}
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {c.lead ? (
                          <CallAvatar name={`${c.lead.first_name} ${c.lead.last_name ?? ""}`} />
                        ) : (
                          <PhoneSquare />
                        )}
                        <div className="min-w-0">
                          {c.lead ? (
                            <Link href={`/leads/${c.lead.id}`} className="relative z-10 font-semibold text-[15px] text-[#20342C] hover:text-[#12483B] transition-colors block leading-tight truncate">
                              {c.lead.first_name} {c.lead.last_name ?? ""}
                            </Link>
                          ) : c.caller_e164 ? (
                            <span className="relative z-10 text-[13px] text-[#5C6F68] tabular-nums">{c.caller_e164}</span>
                          ) : (
                            <span className="text-[#93A39D]">—</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <span className="text-xs text-[#93A39D]">
                        {c.direction === "outbound" ? t("outboundRow") : t("inboundRow")}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {cfg ? (
                        <span
                          className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap relative z-10"
                          style={{ backgroundColor: cfg.bg, color: cfg.text }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
                          {cfg.label}
                        </span>
                      ) : (
                        <span className="text-[#C9C0AF] text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-[#5C6F68] tabular-nums">{fmtDuration(c.duration_seconds)}</span>
                    </td>
                    {role !== "rep" && (
                      <td className="py-3 hidden lg:table-cell">
                        <span className="text-xs text-[#93A39D]">{c.rep?.name ?? "—"}</span>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

    </div>
  )
}
