import { createClient } from "@/lib/supabase/server"
import { redirect, notFound } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { fetchLeadById } from "@/lib/queries/leads"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { LeadHeader } from "./_components/lead-header"
import { LeadActions } from "./_components/lead-actions"
import { ActivityTimeline } from "./_components/activity-timeline"

type TypedClient = SupabaseClient<Database>

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient

  const [lead, profileRes, callsRes, apptsRes, salesRes] = await Promise.all([
    fetchLeadById(sb, id),
    sb.from("users").select("role").eq("id", user.id).single(),
    sb.from("calls")
      .select("id, called_at, direction, outcome, duration_seconds, notes, source")
      .eq("lead_id", id).order("called_at", { ascending: false }).limit(50),
    sb.from("appointments")
      .select("id, scheduled_at, type, status, service")
      .eq("lead_id", id).order("scheduled_at", { ascending: false }).limit(20),
    sb.from("sales")
      .select("id, created_at, amount_cents, payment_status, payment_method")
      .eq("lead_id", id).order("created_at", { ascending: false }).limit(20),
  ])

  if (!lead) notFound()

  const role = (profileRes.data?.role ?? "rep") as string

  // Fetch reps for assign dropdown (managers/admins only)
  let reps: { id: string; name: string }[] = []
  if (role === "admin" || role === "manager") {
    const { data } = await sb
      .from("users")
      .select("id, name")
      .eq("active", true)
      .order("name")
    reps = (data ?? []) as { id: string; name: string }[]
  }

  const calls = (callsRes.data ?? []) as Array<{
    id: string; called_at: string
    direction: Database["public"]["Enums"]["call_direction"]
    outcome: Database["public"]["Enums"]["call_outcome"] | null
    duration_seconds: number | null; notes: string | null; source: string
  }>

  const appointments = (apptsRes.data ?? []) as Array<{
    id: string; scheduled_at: string
    type: Database["public"]["Enums"]["appointment_type"]
    status: Database["public"]["Enums"]["appointment_status"]
    service: string | null
  }>

  const sales = (salesRes.data ?? []) as Array<{
    id: string; created_at: string; amount_cents: number
    payment_status: Database["public"]["Enums"]["payment_status"]
    payment_method: Database["public"]["Enums"]["payment_method"]
  }>

  const totalSalesCents = sales
    .filter((s) => s.payment_status === "paid")
    .reduce((sum, s) => sum + s.amount_cents, 0)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      <LeadHeader lead={lead} />

      <LeadActions lead={lead} role={role} reps={reps} />

      <Separator className="bg-zinc-800/50" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3">
          <Card className="bg-zinc-900 border-zinc-800/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">
                Resumen
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Stat label="Llamadas" value={calls.length} />
              <Stat label="Citas" value={appointments.length} />
              <Stat label="Ventas cerradas" value={
                (totalSalesCents / 100).toLocaleString("es-MX", { style: "currency", currency: "USD" })
              } />
              {lead.source && <Stat label="Fuente" value={lead.source} />}
              {lead.ai_score_reason && (
                <div>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Razón del score</p>
                  <p className="text-xs text-zinc-500 leading-relaxed">{lead.ai_score_reason}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="bg-zinc-900 border-zinc-800/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">
                Actividad
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                calls={calls}
                appointments={appointments}
                sales={sales}
                notes={lead.notes}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-zinc-600">{label}</span>
      <span className="text-sm text-zinc-300 font-medium tabular-nums">{value}</span>
    </div>
  )
}
