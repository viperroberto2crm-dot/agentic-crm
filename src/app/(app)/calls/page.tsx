import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { Badge } from "@/components/ui/badge"
import { NewCallButton } from "./_components/new-call-button"

type TypedClient = SupabaseClient<Database>
type CallOutcome = Database["public"]["Enums"]["call_outcome"]
type CallDirection = Database["public"]["Enums"]["call_direction"]

const OUTCOME_CONFIG: Record<CallOutcome, { label: string; cls: string }> = {
  connected:           { label: "Conectado",          cls: "border-emerald-500/40 text-emerald-400" },
  appointment_set:     { label: "Cita agendada",       cls: "border-blue-500/40 text-blue-400" },
  callback_requested:  { label: "Devolución",          cls: "border-violet-500/40 text-violet-400" },
  voicemail:           { label: "Buzón",               cls: "border-amber-500/40 text-amber-400" },
  no_answer:           { label: "Sin respuesta",       cls: "border-zinc-600 text-zinc-500" },
  not_interested:      { label: "No interesado",       cls: "border-red-500/40 text-red-400" },
  wrong_number:        { label: "N° equivocado",       cls: "border-zinc-600 text-zinc-600" },
}

function fmtDuration(s: number | null) {
  if (!s) return "—"
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
}

function fmtDate(d: string) {
  return new Intl.DateTimeFormat("es-MX", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(d))
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

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const outcomeFilter = typeof sp.outcome === "string" ? sp.outcome : null
  const dirFilter = typeof sp.direction === "string" ? sp.direction : null

  let query = sb
    .from("calls")
    .select(
      `id, direction, outcome, duration_seconds, called_at, notes,
       lead:leads!calls_lead_id_fkey(id, first_name, last_name),
       rep:users!calls_rep_id_fkey(id, name)`,
      { count: "exact" }
    )
    .order("called_at", { ascending: false })
    .limit(100)

  if (role === "rep") query = query.eq("rep_id", user.id)
  if (brandId) query = query.eq("brand_id", brandId)
  if (outcomeFilter) query = query.eq("outcome", outcomeFilter as CallOutcome)
  if (dirFilter) query = query.eq("direction", dirFilter as CallDirection)

  const { data: raw, count } = await query

  type CallItem = {
    id: string; direction: CallDirection; outcome: CallOutcome | null
    duration_seconds: number | null; called_at: string; notes: string | null
    lead: { id: string; first_name: string; last_name: string | null } | null
    rep: { id: string; name: string } | null
  }
  const calls = (raw ?? []) as unknown as CallItem[]

  // leads for modal
  let leadsForModal: { id: string; first_name: string; last_name: string | null; phone: string }[] = []
  if (brandId) {
    let lq = sb.from("leads").select("id, first_name, last_name, phone")
      .eq("brand_id", brandId).order("first_name").limit(200)
    if (role === "rep") lq = lq.eq("assigned_rep_id", user.id)
    const { data } = await lq
    leadsForModal = (data ?? []) as typeof leadsForModal
  }

  const outcomeTabs = [
    { value: null,               label: "Todas" },
    { value: "connected",        label: "Conectadas" },
    { value: "appointment_set",  label: "Cita agendada" },
    { value: "voicemail",        label: "Buzón" },
    { value: "no_answer",        label: "Sin respuesta" },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-100">Llamadas</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-600">{count ?? calls.length} total</span>
          {brandId && <NewCallButton brandId={brandId} leads={leadsForModal} />}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {outcomeTabs.map((tab) => {
          const isActive = outcomeFilter === tab.value
          return (
            <Link
              key={tab.label}
              href={tab.value ? `/calls?outcome=${tab.value}` : "/calls"}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                isActive ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
        <span className="text-zinc-800">|</span>
        {([
          { value: null,       label: "↕ Todas" },
          { value: "outbound", label: "↑ Salientes" },
          { value: "inbound",  label: "↓ Entrantes" },
        ] as const).map((tab) => {
          const isActive = dirFilter === tab.value
          return (
            <Link
              key={tab.label}
              href={tab.value
                ? (outcomeFilter ? `/calls?outcome=${outcomeFilter}&direction=${tab.value}` : `/calls?direction=${tab.value}`)
                : (outcomeFilter ? `/calls?outcome=${outcomeFilter}` : "/calls")
              }
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
        {calls.length === 0 ? (
          <p className="text-sm text-zinc-600 py-8 text-center">Sin llamadas con estos filtros.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4">Fecha</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4">Lead</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4 hidden sm:table-cell">Dir.</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4">Resultado</th>
                <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 pr-4 hidden md:table-cell">Duración</th>
                {role !== "rep" && (
                  <th className="text-left text-[10px] text-zinc-600 font-semibold uppercase tracking-widest pb-2 hidden lg:table-cell">Rep</th>
                )}
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const cfg = c.outcome ? OUTCOME_CONFIG[c.outcome] : null
                return (
                  <tr key={c.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                    <td className="py-3 pr-4">
                      <span className="text-zinc-500 text-xs tabular-nums">{fmtDate(c.called_at)}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {c.lead ? (
                        <Link href={`/leads/${c.lead.id}`} className="text-zinc-200 hover:text-white font-medium transition-colors">
                          {c.lead.first_name} {c.lead.last_name ?? ""}
                        </Link>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <span className="text-xs text-zinc-600">
                        {c.direction === "outbound" ? "↑ Saliente" : "↓ Entrante"}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {cfg ? (
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-normal ${cfg.cls}`}>
                          {cfg.label}
                        </Badge>
                      ) : (
                        <span className="text-zinc-700 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 hidden md:table-cell">
                      <span className="text-xs text-zinc-600 tabular-nums">{fmtDuration(c.duration_seconds)}</span>
                    </td>
                    {role !== "rep" && (
                      <td className="py-3 hidden lg:table-cell">
                        <span className="text-xs text-zinc-500">{c.rep?.name ?? "—"}</span>
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
