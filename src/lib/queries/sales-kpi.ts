import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type SB = SupabaseClient<Database>

/**
 * KPI agregado de ventas para una marca / rep. Cuenta correctamente:
 * - Sales standalone con status='paid' (cobradas completas en un solo pago)
 * - Sales que vienen de Payment Plans: se cuentan por SUS ABONOS individuales
 *   (con su propia paid_at), NO por amount_cents de la sale. Esto previene
 *   double-counting temporal cuando un plan multi-abono se completa:
 *   antes del fix, el último abono "convertía" la sale a paid con
 *   paid_at = último abono, y el KPI sumaba el monto FULL en esa semana
 *   aunque los abonos previos ya habían sido contados en semanas anteriores.
 *
 * Tanto Dashboard como /sales (y futuras pantallas) deben usar este helper
 * para garantizar la misma definición de "Collected" y "Outstanding".
 */
export type SalesBreakdown = {
  /** sales con status='paid' contadas (en el rango si se pasó) */
  paidCount: number
  /** dinero ya cobrado: sales standalone paid + abonos de planes (todos), filtrado por rango si aplica */
  collectedCents: number
  /** sales con saldo abierto (pending + partial) — siempre actuales, sin rango */
  openCount: number
  /** saldo abierto total: pending.amount + partial.amount - abonos cobrados de cada partial */
  outstandingCents: number
}

export type SalesBreakdownOptions = {
  /** si no es null, filtra por brand_id */
  brandId: string | null
  /** si no es null, filtra sales por rep_id (típicamente para rol "rep") */
  repId: string | null
  /**
   * si presente, cuenta como "cobrado" solo paid sales y abonos cuyo
   * paid_at cae en [startIso, endIso). `outstandingCents` siempre es la deuda
   * actual sin filtrar por rango.
   */
  paidRange?: { startIso: string; endIso: string }
}

export async function getSalesBreakdown(
  sb: SB,
  opts: SalesBreakdownOptions,
): Promise<SalesBreakdown> {
  const { brandId, repId, paidRange } = opts

  // 1) Sales paid completas (filtradas por rango si aplica)
  let paidQuery = sb
    .from("sales")
    .select("id, amount_cents, paid_at")
    .eq("payment_status", "paid")
  if (brandId) paidQuery = paidQuery.eq("brand_id", brandId)
  if (repId) paidQuery = paidQuery.eq("rep_id", repId)
  if (paidRange) {
    paidQuery = paidQuery
      .gte("paid_at", paidRange.startIso)
      .lt("paid_at", paidRange.endIso)
  }
  const { data: paidRows } = await paidQuery
  const paid = paidRows ?? []

  // 2) Sales con saldo abierto (pending + partial) — sin filtro de rango
  let openQuery = sb
    .from("sales")
    .select("id, amount_cents, payment_status")
    .in("payment_status", ["pending", "partial"])
  if (brandId) openQuery = openQuery.eq("brand_id", brandId)
  if (repId) openQuery = openQuery.eq("rep_id", repId)
  const { data: openRows } = await openQuery
  const open = openRows ?? []
  const partialSaleIds = open
    .filter((r) => r.payment_status === "partial")
    .map((r) => r.id)

  // 3) Identificar cuáles sales paid tienen plan asociado (para excluir su
  // amount_cents del collected y contar abonos en su lugar).
  const paidSaleIds = paid.map((r) => r.id)
  const planRelevantSaleIds = [...partialSaleIds, ...paidSaleIds]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: planRows } = planRelevantSaleIds.length > 0
    ? await (sb as any)
        .from("payment_plans")
        .select("id, sale_id")
        .in("sale_id", planRelevantSaleIds)
    : { data: [] }
  const planRowsTyped = (planRows ?? []) as Array<{ id: string; sale_id: string }>
  const planToSale = new Map<string, string>(
    planRowsTyped.map((p) => [p.id, p.sale_id]),
  )
  const saleIdsWithPlan = new Set<string>(planRowsTyped.map((p) => p.sale_id))

  // 4) Sales paid SIN plan: cuentan por su amount_cents (caso normal).
  // Sales paid CON plan: se EXCLUYEN — sus abonos se sumarán abajo igual
  // que las partial.
  const paidStandaloneCents = paid
    .filter((r) => !saleIdsWithPlan.has(r.id))
    .reduce((s, r) => s + r.amount_cents, 0)

  // 5) Abonos de TODOS los planes relevantes (de sales partial Y paid-con-plan).
  // Se filtran por paid_at del abono → cada abono cuenta en SU semana real,
  // no en la semana en que el plan se completó.
  const collectedByPartialSaleAllTime = new Map<string, number>()
  let collectedFromAbonosInRangeCents = 0

  const planIds = Array.from(planToSale.keys())
  if (planIds.length > 0) {
    let abonosQuery = sb
      .from("abonos")
      .select("plan_id, amount_cents, paid_at")
      .in("plan_id", planIds)
    if (paidRange) {
      abonosQuery = abonosQuery
        .gte("paid_at", paidRange.startIso.slice(0, 10))
        .lt("paid_at", paidRange.endIso.slice(0, 10))
    }
    const { data: abonoRowsInRange } = await abonosQuery
    collectedFromAbonosInRangeCents = (abonoRowsInRange ?? []).reduce(
      (s: number, a: { amount_cents: number }) => s + a.amount_cents,
      0,
    )

    // Para outstanding necesitamos abonos totales de planes PARTIAL solamente
    // (los paid ya están saldados por definición y no tienen outstanding).
    const partialPlanIds = planRowsTyped
      .filter((p) => partialSaleIds.includes(p.sale_id))
      .map((p) => p.id)
    if (partialPlanIds.length > 0) {
      if (paidRange) {
        const { data: abonoRowsAll } = await sb
          .from("abonos")
          .select("plan_id, amount_cents")
          .in("plan_id", partialPlanIds)
        for (const a of (abonoRowsAll ?? []) as Array<{
          plan_id: string
          amount_cents: number
        }>) {
          const saleId = planToSale.get(a.plan_id)
          if (!saleId) continue
          collectedByPartialSaleAllTime.set(
            saleId,
            (collectedByPartialSaleAllTime.get(saleId) ?? 0) + a.amount_cents,
          )
        }
      } else {
        // Sin rango: reusa los abonos ya traídos, pero solo los de partial plans
        for (const a of (abonoRowsInRange ?? []) as Array<{
          plan_id: string
          amount_cents: number
        }>) {
          if (!partialPlanIds.includes(a.plan_id)) continue
          const saleId = planToSale.get(a.plan_id)
          if (!saleId) continue
          collectedByPartialSaleAllTime.set(
            saleId,
            (collectedByPartialSaleAllTime.get(saleId) ?? 0) + a.amount_cents,
          )
        }
      }
    }
  }

  // 6) Outstanding = saldo abierto real (pending full + partial - cobrado)
  const outstandingCents = open.reduce((sum, r) => {
    if (r.payment_status === "pending") return sum + r.amount_cents
    const collected = collectedByPartialSaleAllTime.get(r.id) ?? 0
    return sum + Math.max(0, r.amount_cents - collected)
  }, 0)

  return {
    paidCount: paid.length,
    collectedCents: paidStandaloneCents + collectedFromAbonosInRangeCents,
    openCount: open.length,
    outstandingCents,
  }
}
