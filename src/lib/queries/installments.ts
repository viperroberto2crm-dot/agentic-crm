/**
 * Helper para calcular cuotas próximas / vencidas de payment_plans.
 *
 * Las cuotas no son una tabla — se calculan en runtime desde payment_plans
 * (installment_count, installment_amount_cents, frequency_days, first_due_date),
 * aplicando installment_overrides (JSONB con due_date/amount_cents/deleted por seq)
 * y restando los abonos pagados en orden.
 *
 * Usado por:
 *  - /appointments page: mergear cuotas como filas virtuales tipo "Cobro"
 *  - notification bell: items virtuales "Cobro próximo" / "Cobro vencido"
 *
 * No inserta nada en BD — todo se computa al vuelo.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>

export type UpcomingInstallment = {
  /** Identificador único compuesto: `${planId}-${seq}`. Usado como key en UI y notif virtual. */
  key: string
  planId: string
  leadId: string
  leadFirstName: string
  leadLastName: string | null
  brandId: string
  productName: string
  /** Número de cuota (1-based) — refleja overrides aplicados (orden visible). */
  seq: number
  /** Fecha de vencimiento YYYY-MM-DD (TZ-naive). */
  dueDate: string
  amountCents: number
  /** Asignación de rep del lead. */
  repId: string | null
  repName: string | null
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
  brand_id: string
  lead: {
    id: string
    first_name: string
    last_name: string | null
    assigned_rep_id: string | null
    rep: { id: string; name: string } | null
  } | null
  abonos: { id: string; amount_cents: number; paid_at: string }[]
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

/**
 * Devuelve cuotas pendientes cuya `dueDate` cae en [fromIso, toIso] inclusive.
 *
 * Filtros:
 *  - admin/manager: todas las del brand
 *  - rep: solo de leads donde assigned_rep_id = userId
 *  - provider: devuelve [] (no maneja cobros)
 *
 * Excluye:
 *  - planes fully paid por monto (sumAbonos >= total)
 *  - cuotas ya cubiertas por abonos previos (los abonos se asignan en orden a las visibles)
 *  - cuotas marcadas `deleted` en overrides
 */
export async function getUpcomingInstallments(opts: {
  sb: TypedClient
  userId: string
  role: string
  brandId: string | null
  fromIso: string
  toIso: string
}): Promise<UpcomingInstallment[]> {
  const { sb, userId, role, brandId, fromIso, toIso } = opts

  if (role === "provider") return []
  if (!brandId) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = (sb as any)
    .from("payment_plans")
    .select(
      `id, product_name, total_amount_cents, installment_count, installment_amount_cents,
       frequency_days, first_due_date, installment_overrides, brand_id,
       lead:leads!payment_plans_lead_id_fkey(
         id, first_name, last_name, assigned_rep_id,
         rep:users!leads_assigned_rep_id_fkey(id, name)
       ),
       abonos(id, amount_cents, paid_at)`
    )
    .eq("brand_id", brandId)
    .not("installment_count", "is", null)
    .not("first_due_date", "is", null)
    .not("frequency_days", "is", null)

  const { data: rawPlans } = (await query) as { data: RawPlan[] | null }

  const result: UpcomingInstallment[] = []

  for (const plan of rawPlans ?? []) {
    if (!plan.lead) continue
    if (role === "rep" && plan.lead.assigned_rep_id !== userId) continue

    const overrides = plan.installment_overrides ?? {}
    const baseExpected =
      plan.installment_amount_cents ??
      Math.round(plan.total_amount_cents / plan.installment_count)

    // Construir cuotas visibles (saltar deleted, aplicar overrides).
    const visible: { seq: number; dueDate: string; amountCents: number }[] = []
    for (let i = 0; i < plan.installment_count; i++) {
      const seq = i + 1
      const o = overrides[String(seq)] ?? {}
      if (o.deleted === true) continue
      const dueDate = o.due_date ?? addDaysIso(plan.first_due_date, i * plan.frequency_days)
      const amountCents = o.amount_cents ?? baseExpected
      visible.push({ seq, dueDate, amountCents })
    }

    // Plan fully paid por monto → skip
    const paidCents = plan.abonos.reduce((s, a) => s + a.amount_cents, 0)
    if (plan.total_amount_cents > 0 && paidCents >= plan.total_amount_cents) continue

    const paidCount = plan.abonos.length
    // Cuotas pendientes = desde el index paidCount hacia adelante
    const pending = visible.slice(paidCount)

    for (const cu of pending) {
      if (cu.dueDate < fromIso || cu.dueDate > toIso) continue
      result.push({
        key: `${plan.id}-${cu.seq}`,
        planId: plan.id,
        leadId: plan.lead.id,
        leadFirstName: plan.lead.first_name,
        leadLastName: plan.lead.last_name,
        brandId: plan.brand_id,
        productName: plan.product_name,
        seq: cu.seq,
        dueDate: cu.dueDate,
        amountCents: cu.amountCents,
        repId: plan.lead.assigned_rep_id,
        repName: plan.lead.rep?.name ?? null,
      })
    }
  }

  return result
}
