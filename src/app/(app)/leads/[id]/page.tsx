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
import { PaymentPlansSection } from "./_components/payment-plans-section"
import { JustCreatedBanner } from "./_components/just-created-banner"
import { fetchPaymentPlans } from "./actions"
import { getTranslations } from "next-intl/server"

type TypedClient = SupabaseClient<Database>

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const { id } = await params
  const { created } = await searchParams
  const justCreated = created === "1"

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("leads")

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
      .select("id, created_at, paid_at, amount_cents, payment_status, payment_method")
      .eq("lead_id", id).order("created_at", { ascending: false }).limit(20),
  ])

  let clinicsForModal: {
    id: string
    name: string
    address_line1: string | null
    city: string | null
    state: string | null
  }[] = []
  if (lead?.brand_id) {
    const { data: clinicsData } = await sb
      .from("clinics")
      .select("id, name, address_line1, city, state")
      .eq("brand_id", lead.brand_id)
      .eq("active", true)
      .order("name")
    clinicsForModal = (clinicsData ?? []) as typeof clinicsForModal
  }

  const paymentPlans = await fetchPaymentPlans(id).catch(() => [])

  // Detectar si hay cita aprobada por provider pero no shippeada (badge "Ready to Ship")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: readyToShipCount } = await (sb as any)
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", id)
    .eq("provider_approved", true)
    .is("shipped_at", null)
  const readyToShip = ((readyToShipCount as number | null) ?? 0) > 0

  if (!lead) notFound()

  const role = (profileRes.data?.role ?? "rep") as string

  if (role === "rep" && lead.assigned_rep_id !== user.id) notFound()

  // Providers can only see leads that have at least one appointment where they
  // are assigned as provider. Bug fix 2026-05-27: este check filtraba por
  // rep_id (legacy de antes del split rep/provider). Después de commit 779a819
  // los providers están en provider_id, así que con rep_id siempre era 0 y
  // notFound() bloqueaba a los providers de ver CUALQUIER lead.
  if (role === "provider") {
    const { count: providerApptCount } = await sb
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", id)
      .eq("provider_id", user.id)
    if (!providerApptCount || providerApptCount === 0) notFound()
  }

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
    id: string; created_at: string; paid_at: string | null; amount_cents: number
    payment_status: Database["public"]["Enums"]["payment_status"]
    payment_method: Database["public"]["Enums"]["payment_method"]
  }>

  // IDs de las sales auto-generadas por payment plans (para evitar doble-cuenta)
  const planSaleIds = new Set(
    paymentPlans.map((p) => p.sale_id).filter((x): x is string => !!x),
  )

  // COBRADO real = sales pagadas (sin plan) + sum de abonos de planes
  const standalonePaidCents = sales
    .filter((s) => s.payment_status === "paid" && !planSaleIds.has(s.id))
    .reduce((sum, s) => sum + s.amount_cents, 0)
  const planAbonosCents = paymentPlans.reduce(
    (sum, p) => sum + p.abonos.reduce((s, a) => s + a.amount_cents, 0),
    0,
  )
  const totalCollectedCents = standalonePaidCents + planAbonosCents

  // POR COBRAR = pendiente de sales standalone + balance de planes
  const standalonePendingCents = sales
    .filter(
      (s) =>
        (s.payment_status === "pending" || s.payment_status === "partial") &&
        !planSaleIds.has(s.id),
    )
    .reduce((sum, s) => sum + s.amount_cents, 0)
  const planPendingCents = paymentPlans.reduce((sum, p) => {
    const paid = p.abonos.reduce((s, a) => s + a.amount_cents, 0)
    return sum + Math.max(0, p.total_amount_cents - paid)
  }, 0)
  const totalPendingCents = standalonePendingCents + planPendingCents

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">

      <LeadHeader lead={lead} readyToShip={readyToShip} />

      {justCreated && <JustCreatedBanner />}

      {role !== "provider" && (
        <LeadActions lead={lead} role={role} reps={reps} clinics={clinicsForModal} />
      )}

      <Separator className="bg-border" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3">
          <Card className="bg-white border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                {t("summary")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {role !== "provider" && <Stat label={t("callCount")} value={calls.length} />}
              <Stat label={t("apptCount")} value={appointments.length} />
              {role !== "provider" && (
                <Stat label={t("closedSales")} value={
                  (totalCollectedCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
                } />
              )}
              {role !== "provider" && totalPendingCents > 0 && (
                <Stat
                  label="Por cobrar"
                  value={
                    (totalPendingCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
                  }
                />
              )}
              {lead.source && role !== "provider" && <Stat label={t("source")} value={lead.source} />}
              {lead.ai_score_reason && role !== "provider" && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{t("scoreReason")}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{lead.ai_score_reason}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="bg-white border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
                {t("activityTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline
                calls={role === "provider" ? [] : calls}
                appointments={appointments}
                sales={role === "provider" ? [] : sales}
                notes={lead.notes}
                leadId={role !== "provider" ? id : undefined}
                planSaleIds={Array.from(planSaleIds)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {lead.brand_id && role !== "provider" && (
        <Card className="bg-white border-border/60">
          <CardContent className="pt-5">
            <PaymentPlansSection
              plans={paymentPlans}
              leadId={id}
              brandId={lead.brand_id}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground font-medium tabular-nums">{value}</span>
    </div>
  )
}
