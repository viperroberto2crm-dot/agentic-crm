import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type SB = SupabaseClient<Database>

/**
 * KPI agregado de ventas para una marca / rep. Cuenta correctamente:
 * - Sales con status='paid' (cobradas completas)
 * - Sales con status='partial' (Payment Plans) y sus abonos parciales
 * - Sales con status='pending' (sin cobrar todavía)
 *
 * Tanto Dashboard como /sales (y futuras pantallas) deben usar este helper
 * para garantizar la misma definición de "Collected" y "Outstanding".
 */
export type SalesBreakdown = {
  /** sales con status='paid' contadas (en el rango si se pasó) */
  paidCount: number
  /** dinero ya cobrado: paid+abonos. Si paidRange está presente, restringido al rango */
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
  const paidFromFullSalesCents = paid.reduce((s, r) => s + r.amount_cents, 0)

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

  // 3) Abonos para sales partial. Construimos un map sale_id -> total abonos.
  // También, si paidRange está presente, calculamos abonos en el rango como "cobrado".
  const collectedByPartialSaleAllTime = new Map<string, number>()
  let collectedFromAbonosInRangeCents = 0

  if (partialSaleIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: planRows } = await (sb as any)
      .from("payment_plans")
      .select("id, sale_id")
      .in("sale_id", partialSaleIds)
    const planToSale = new Map<string, string>(
      (planRows ?? []).map((p: { id: string; sale_id: string }) => [
        p.id,
        p.sale_id,
      ]),
    )
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

      // Para outstanding necesitamos abonos totales (sin filtro de rango)
      if (paidRange) {
        const { data: abonoRowsAll } = await sb
          .from("abonos")
          .select("plan_id, amount_cents")
          .in("plan_id", planIds)
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
        // Sin rango: reusa los abonos ya traídos
        for (const a of (abonoRowsInRange ?? []) as Array<{
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
      }
    }
  }

  // 4) Outstanding = saldo abierto real (pending full + partial - cobrado)
  const outstandingCents = open.reduce((sum, r) => {
    if (r.payment_status === "pending") return sum + r.amount_cents
    const collected = collectedByPartialSaleAllTime.get(r.id) ?? 0
    return sum + Math.max(0, r.amount_cents - collected)
  }, 0)

  return {
    paidCount: paid.length,
    collectedCents: paidFromFullSalesCents + collectedFromAbonosInRangeCents,
    openCount: open.length,
    outstandingCents,
  }
}
