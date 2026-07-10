import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import Link from "next/link"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { getTranslations } from "next-intl/server"
import { PaymentsTable } from "./_components/payments-table"

type TypedClient = SupabaseClient<Database>

function fmtCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T12:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0]
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T12:00:00").getTime()
  const b = new Date(toIso + "T12:00:00").getTime()
  return Math.round((b - a) / 86_400_000)
}

type InstallmentOverride = {
  due_date?: string
  amount_cents?: number
  deleted?: boolean
}

type RawPlan = {
  id: string
  product_name: string
  total_amount_cents: number
  installment_count: number
  installment_amount_cents: number | null
  frequency_days: number
  first_due_date: string
  installment_overrides: Record<string, InstallmentOverride> | null
  lead: {
    id: string
    first_name: string
    last_name: string | null
    brand_id: string
    assigned_rep_id: string | null
  } | null
  abonos: { id: string; amount_cents: number; paid_at: string }[]
}

export default async function PaymentsDuePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const sb = supabase as unknown as TypedClient
  const t = await getTranslations("paymentsDue")
  const tc = await getTranslations("common")

  const [profileRes, cookieStore, params] = await Promise.all([
    sb.from("users").select("role").eq("id", user.id).single(),
    cookies(),
    searchParams,
  ])

  const role = (profileRes.data?.role ?? "rep") as string
  if (role === "provider") redirect("/appointments")
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug ? await getBrandIdBySlug(brandSlug, sb) : null

  const sp = params as Record<string, string | string[] | undefined>
  const filter = typeof sp.filter === "string" ? sp.filter : null

  // Fetch all plans with schedule (installment_count NOT NULL).
  // installment_overrides necesario para reflejar ediciones individuales de
  // cuota (fecha/monto custom o cuota borrada) — sin esto, la siguiente cuota
  // mostrada usa el schedule original e ignora cambios manuales.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = (sb as any)
    .from("payment_plans")
    .select(
      `id, product_name, total_amount_cents, installment_count, installment_amount_cents,
       frequency_days, first_due_date, installment_overrides,
       lead:leads!payment_plans_lead_id_fkey(id, first_name, last_name, brand_id, assigned_rep_id),
       abonos(id, amount_cents, paid_at)`
    )
    .not("installment_count", "is", null)
    .not("first_due_date", "is", null)
    .not("frequency_days", "is", null)

  if (brandId) query = query.eq("brand_id", brandId)

  const { data: rawPlans, error } = (await query) as {
    data: RawPlan[] | null
    error: { message: string } | null
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <p className="text-sm text-red-500">{error.message}</p>
      </div>
    )
  }

  const today = todayIso()
  const inSevenDays = addDaysIso(today, 7)
  const inThirtyDays = addDaysIso(today, 30)

  type Row = {
    planId: string
    leadId: string
    leadName: string
    productName: string
    nextAmountCents: number
    nextDueDate: string
    daysRemaining: number
    paidCount: number
    totalCount: number
  }

  const rows: Row[] = []

  for (const plan of rawPlans ?? []) {
    if (!plan.lead) continue
    // Scope: reps only see plans for their own leads.
    if (role === "rep" && plan.lead.assigned_rep_id !== user.id) continue

    const overrides = plan.installment_overrides ?? {}
    const baseExpected =
      plan.installment_amount_cents ??
      Math.round(plan.total_amount_cents / plan.installment_count)

    // Construir cuotas visibles aplicando overrides; saltar las deleted.
    const visible: { seq: number; dueDate: string; amountCents: number }[] = []
    for (let i = 0; i < plan.installment_count; i++) {
      const seq = i + 1
      const o = overrides[String(seq)] ?? {}
      if (o.deleted === true) continue
      const dueDate = o.due_date ?? addDaysIso(plan.first_due_date, i * plan.frequency_days)
      const amountCents = o.amount_cents ?? baseExpected
      visible.push({ seq, dueDate, amountCents })
    }

    // Considerar fully-paid por MONTO también: si los abonos cubren el
    // total_amount_cents (aunque haya menos abonos que cuotas), el plan está
    // saldado y no debe seguir apareciendo como overdue. Esto pasa cuando el
    // cliente paga todo en un solo abono pero el schedule se mantiene para
    // tracking de citas/sesiones.
    const paidCents = plan.abonos.reduce((s, a) => s + a.amount_cents, 0)
    if (plan.total_amount_cents > 0 && paidCents >= plan.total_amount_cents) continue
    const totalCount = visible.length

    // FIFO real: aplicar paidCents en orden a las cuotas y encontrar la
    // primera no cubierta. Antes usaba `plan.abonos.length` como índice, lo
    // que rompía si un solo abono cubría múltiples cuotas (ej: 1 abono de
    // $500 cubre 2 cuotas de $250 → el siguiente debido es la cuota 3, no
    // la 2). Ahora replica la lógica de `computeNextInstallment` del Excel.
    let remainingPaid = paidCents
    let coveredCount = 0
    let next: { seq: number; dueDate: string; amountCents: number } | null = null
    for (const cu of visible) {
      if (remainingPaid >= cu.amountCents) {
        remainingPaid -= cu.amountCents
        coveredCount++
        continue
      }
      next = cu
      break
    }
    if (!next) continue // todas las cuotas cubiertas
    const paidCount = coveredCount
    const daysRemaining = daysBetween(today, next.dueDate)

    rows.push({
      planId: plan.id,
      leadId: plan.lead.id,
      leadName: `${plan.lead.first_name} ${plan.lead.last_name ?? ""}`.trim(),
      productName: plan.product_name,
      nextAmountCents: next.amountCents,
      nextDueDate: next.dueDate,
      daysRemaining,
      paidCount,
      totalCount,
    })
  }

  // Apply filter
  let filteredRows = rows
  if (filter === "overdue") {
    filteredRows = rows.filter((r) => r.daysRemaining < 0)
  } else if (filter === "thisWeek") {
    filteredRows = rows.filter((r) => r.nextDueDate >= today && r.nextDueDate <= inSevenDays)
  } else if (filter === "next30") {
    filteredRows = rows.filter((r) => r.nextDueDate >= today && r.nextDueDate <= inThirtyDays)
  }

  // Sort: most overdue / soonest first
  filteredRows.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate))

  const overdueCount = rows.filter((r) => r.daysRemaining < 0).length
  const thisWeekCount = rows.filter(
    (r) => r.nextDueDate >= today && r.nextDueDate <= inSevenDays
  ).length
  const next30Count = rows.filter(
    (r) => r.nextDueDate >= today && r.nextDueDate <= inThirtyDays
  ).length

  const tabs = [
    { value: null, label: tc("all"), count: rows.length },
    { value: "overdue", label: t("filterOverdue"), count: overdueCount },
    { value: "thisWeek", label: t("filterThisWeek"), count: thisWeekCount },
    { value: "next30", label: t("filterNext30"), count: next30Count },
  ] as const

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#20342C]">{t("title")}</h1>
          <p className="text-[13px] text-[#93A39D] mt-1">
            {filteredRows.length} {tc("records")}
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.map((tab) => {
          const isActive = filter === tab.value
          const href = tab.value ? `/payments-due?filter=${tab.value}` : "/payments-due"
          return (
            <Link
              key={tab.label}
              href={href}
              className={`inline-flex items-center h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-[#20342C] text-white border-[#20342C]"
                  : "bg-card text-[#5C6F68] border-[#ECE3D3] hover:border-[#D8CDB5] hover:text-[#20342C]"
              }`}
            >
              {tab.label}
              <span className="ml-1.5 tabular-nums text-[11px] opacity-70">
                {tab.count}
              </span>
            </Link>
          )
        })}
      </div>

      <PaymentsTable
        rows={filteredRows}
        labels={{
          empty: t("empty"),
          colLead: tc("colLead"),
          product: t("product"),
          nextPaymentAmount: t("nextPaymentAmount"),
          dueOn: t("dueOn"),
          daysRemaining: t("daysRemaining"),
          daysRemainingShort: t("daysRemainingShort"),
          daysOverdue: t("daysOverdue"),
          progress: t("progress"),
          searchPlaceholder: `${tc("search")}…`,
          records: tc("records"),
        }}
      />
    </div>
  )
}
