import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { NewAppointmentButton } from "./_components/new-appointment-button"
import { AppointmentStatusActions } from "./_components/appointment-status-actions"
import { EditAppointmentButton } from "./_components/edit-appointment-button"
import { getTranslations } from "next-intl/server"

type TypedClient = SupabaseClient<Database>
type ApptStatus = Database["public"]["Enums"]["appointment_status"]
type ApptType = Database["public"]["Enums"]["appointment_type"]

function fmtDate(d: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(d))
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

  const STATUS_CONFIG: Record<ApptStatus, { label: string; cls: string }> = {
    scheduled: { label: t("appointmentStatuses.scheduled"), cls: "border-blue-500/40 text-blue-400" },
    confirmed: { label: t("appointmentStatuses.confirmed"), cls: "border-emerald-500/40 text-emerald-400" },
    completed: { label: t("appointmentStatuses.completed"), cls: "border-zinc-500/40 text-gray-500" },
    cancelled: { label: t("appointmentStatuses.cancelled"), cls: "border-red-500/40 text-red-400" },
    no_show:   { label: t("appointmentStatuses.no_show"),   cls: "border-amber-500/40 text-amber-400" },
  }

  const TYPE_LABEL: Record<ApptType, string> = {
    clinic:     t("types.clinic"),
    home:       t("types.home"),
    telehealth: t("types.telehealth"),
  }

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const statusFilter = typeof sp.status === "string" ? sp.status : null

  let query = sb
    .from("appointments")
    .select(
      `id, scheduled_at, type, status, service, duration_minutes, notes,
       clinic_id, telehealth_link, lead_id,
       lead:leads!appointments_lead_id_fkey(id, first_name, last_name),
       rep:users!appointments_rep_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("scheduled_at", { ascending: false })
    .limit(100)

  if (role === "rep" || role === "provider") query = query.eq("rep_id", user.id)
  if (brandId) query = query.eq("brand_id", brandId)
  if (statusFilter) query = query.eq("status", statusFilter as ApptStatus)

  const { data: raw, count } = await query

  type ApptItem = {
    id: string; scheduled_at: string; type: ApptType; status: ApptStatus
    service: string | null; duration_minutes: number; notes: string | null
    clinic_id: string | null; telehealth_link: string | null; lead_id: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
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
        .eq("rep_id", user.id)
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

  const tabs = [
    { value: null,        label: t("allAppts") },
    { value: "scheduled", label: t("scheduledTab") },
    { value: "confirmed", label: t("confirmedTab") },
    { value: "completed", label: t("completedTab") },
    { value: "cancelled", label: t("cancelledTab") },
    { value: "no_show",   label: t("noShowTab") },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">{count ?? appts.length} total</span>
          {brandId && role !== "provider" && (
            <NewAppointmentButton
              brandId={brandId}
              leads={leadsForModal}
              clinics={clinicsForModal}
            />
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => {
          const isActive = statusFilter === tab.value
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/appointments?status=${tab.value}` : "/appointments"}
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
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">Lead</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">{t("colType")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4">{t("colStatus")}</th>
                <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">{t("colService")}</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2 pr-4 hidden lg:table-cell">Rep</th>
                )}
                <th className="text-right text-[10px] text-gray-400 font-semibold uppercase tracking-widest pb-2">{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {appts.map((a) => {
                const cfg = STATUS_CONFIG[a.status]
                return (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-3 pr-4">
                      <span className="text-gray-700 text-xs tabular-nums">{fmtDate(a.scheduled_at)}</span>
                    </td>
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
                        <span className="text-xs text-gray-400">{a.rep?.name ?? "—"}</span>
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
                          }}
                          leads={leadsForModal}
                          clinics={clinicsForModal}
                          userRole={role}
                        />
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
