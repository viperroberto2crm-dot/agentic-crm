import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { NewAppointmentButton } from "./_components/new-appointment-button"

type TypedClient = SupabaseClient<Database>
type ApptStatus = Database["public"]["Enums"]["appointment_status"]
type ApptType = Database["public"]["Enums"]["appointment_type"]

const STATUS_CONFIG: Record<ApptStatus, { label: string; cls: string }> = {
  scheduled: { label: "Agendada",      cls: "border-blue-500/40 text-blue-400" },
  confirmed: { label: "Confirmada",    cls: "border-emerald-500/40 text-emerald-400" },
  completed: { label: "Completada",    cls: "border-zinc-500/40 text-zinc-400" },
  cancelled: { label: "Cancelada",     cls: "border-red-500/40 text-red-400" },
  no_show:   { label: "No se presentó", cls: "border-amber-500/40 text-amber-400" },
}

const TYPE_LABEL: Record<ApptType, string> = {
  clinic:     "Clínica",
  home:       "Domicilio",
  telehealth: "Telesalud",
}

function fmtDate(d: string) {
  return new Intl.DateTimeFormat("es-MX", {
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
      `id, scheduled_at, type, status, service, duration_minutes,
       lead:leads!appointments_lead_id_fkey(id, first_name, last_name),
       rep:users!appointments_rep_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("scheduled_at", { ascending: false })
    .limit(100)

  if (role === "rep") query = query.eq("rep_id", user.id)
  if (brandId) query = query.eq("brand_id", brandId)
  if (statusFilter) query = query.eq("status", statusFilter as ApptStatus)

  const { data: raw, count } = await query

  type ApptItem = {
    id: string; scheduled_at: string; type: ApptType; status: ApptStatus
    service: string | null; duration_minutes: number
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
  }
  const appts = (raw ?? []) as unknown as ApptItem[]

  // leads list for new-appointment modal
  let leadsForModal: { id: string; first_name: string; last_name: string | null; phone: string }[] = []
  if (brandId) {
    let lq = sb.from("leads").select("id, first_name, last_name, phone")
      .eq("brand_id", brandId).order("first_name").limit(200)
    if (role === "rep") lq = lq.eq("assigned_rep_id", user.id)
    const { data } = await lq
    leadsForModal = (data ?? []) as typeof leadsForModal
  }

  const tabs = [
    { value: null,        label: "Todas" },
    { value: "scheduled", label: "Agendadas" },
    { value: "confirmed", label: "Confirmadas" },
    { value: "completed", label: "Completadas" },
    { value: "cancelled", label: "Canceladas" },
    { value: "no_show",   label: "No show" },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Citas</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-600">{count ?? appts.length} total</span>
          {brandId && <NewAppointmentButton brandId={brandId} leads={leadsForModal} />}
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
                isActive ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-lg px-4 py-2">
        {appts.length === 0 ? (
          <p className="text-sm text-zinc-600 py-8 text-center">Sin citas con estos filtros.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4">Fecha / Hora</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4">Lead</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">Tipo</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4">Status</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">Servicio</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">Rep</th>
                )}
              </tr>
            </thead>
            <tbody>
              {appts.map((a) => {
                const cfg = STATUS_CONFIG[a.status]
                return (
                  <tr key={a.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                    <td className="py-3 pr-4">
                      <span className="text-zinc-300 text-xs tabular-nums">{fmtDate(a.scheduled_at)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {a.lead ? (
                        <Link href={`/leads/${a.lead.id}`} className="text-zinc-200 hover:text-white font-medium transition-colors">
                          {a.lead.first_name} {a.lead.last_name ?? ""}
                        </Link>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-zinc-500">{TYPE_LABEL[a.type]}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${cfg.cls}`}>
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <span className="text-xs text-zinc-500">{a.service ?? "—"}</span>
                    </td>
                    {role !== "rep" && (
                      <td className="py-3 hidden lg:table-cell">
                        <span className="text-xs text-zinc-500">{a.rep?.name ?? "—"}</span>
                      </td>
                    )}
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
