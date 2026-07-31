/**
 * Saldo pendiente ("Debe $X") por paciente. Mismo criterio que el "Por cobrar"
 * de la ficha (leads/[id]/page.tsx): ventas standalone pendientes/parciales +
 * balance de planes de pago (total − abonos). NO incluye pagos Stripe/Square
 * (esos no tienen concepto de "pendiente" en el CRM).
 *
 * computeOwedForLeads usa admin client acotado a los leadIds que ya vienen con
 * el alcance de marca del usuario (mismo patrón/seguridad que coverage.ts).
 */

import { createAdminClient } from "@/lib/supabase/admin"

const PAGE = 1000

/** Trae TODAS las filas paginando (evita el tope de 1000 de Supabase). */
async function fetchAllRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildPage: (from: number, to: number) => any,
  label: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; from < 500_000; from += PAGE) {
    const { data, error } = await buildPage(from, from + PAGE - 1)
    if (error) {
      console.error(`[owed] ${label}:`, error.message)
      break
    }
    const rows = (data ?? []) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function computeOwedForLeads(
  leadIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const ids = Array.from(new Set(leadIds.filter(Boolean)))
  if (ids.length === 0) return result
  for (const id of ids) result.set(id, 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const add = (leadId: string, cents: number) =>
    result.set(leadId, (result.get(leadId) ?? 0) + cents)

  // Todo PAGINADO (Fable #2: abonos de 50 pacientes pueden pasar de 1000) y con
  // errores registrados (Fable #6). order("id") = desempate estable en la
  // paginación (Fable #4).
  const [planRows, abonoRows, salesRows] = await Promise.all([
    fetchAllRows(
      (f, t) => sb.from("payment_plans").select("id, lead_id, total_amount_cents, sale_id")
        .in("lead_id", ids).order("id", { ascending: true }).range(f, t),
      "computeOwed:payment_plans",
    ),
    fetchAllRows(
      (f, t) => sb.from("abonos").select("plan_id, amount_cents")
        .in("lead_id", ids).order("id", { ascending: true }).range(f, t),
      "computeOwed:abonos",
    ),
    fetchAllRows(
      (f, t) => sb.from("sales").select("id, lead_id, amount_cents, payment_status")
        .in("lead_id", ids).in("payment_status", ["pending", "partial"])
        .order("id", { ascending: true }).range(f, t),
      "computeOwed:sales",
    ),
  ])

  // Balance de planes = total − suma de abonos. sale_id evita doble-contar la
  // venta auto-generada del plan como "pendiente standalone".
  const planSaleIds = new Set(planRows.map((p) => p.sale_id as string | null).filter(Boolean))
  const abonoByPlan = new Map<string, number>()
  for (const a of abonoRows) {
    const pid = a.plan_id as string
    if (!pid) continue
    abonoByPlan.set(pid, (abonoByPlan.get(pid) ?? 0) + ((a.amount_cents as number) ?? 0))
  }
  for (const p of planRows) {
    const leadId = p.lead_id as string | null
    if (!leadId) continue
    const paid = abonoByPlan.get(p.id as string) ?? 0
    const bal = Math.max(0, ((p.total_amount_cents as number) ?? 0) - paid)
    if (bal > 0) add(leadId, bal)
  }
  for (const s of salesRows) {
    const leadId = s.lead_id as string | null
    if (!leadId || planSaleIds.has(s.id as string)) continue
    add(leadId, (s.amount_cents as number) ?? 0)
  }

  return result
}

/**
 * lead_ids con saldo pendiente > 0, para el filtro "Debe". Cliente de SESIÓN
 * (RLS por marca). fetchLeads vuelve a filtrar por marca sobre estos IDs.
 */
export async function owedLeadIdsInScope(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<string[]> {
  const owe = new Set<string>()
  try {
    // Todo paginado (sin tope de 1000). Ventas pendientes/parciales, planes y abonos.
    const [salesRows, planRows, abonoRows] = await Promise.all([
      fetchAllRows(
        (f, t) => sb.from("sales").select("lead_id, id")
          .in("payment_status", ["pending", "partial"]).not("lead_id", "is", null)
          .order("id", { ascending: true }).range(f, t),
        "sales",
      ),
      fetchAllRows(
        (f, t) => sb.from("payment_plans").select("id, lead_id, total_amount_cents, sale_id")
          .not("lead_id", "is", null).order("id", { ascending: true }).range(f, t),
        "payment_plans",
      ),
      fetchAllRows(
        (f, t) => sb.from("abonos").select("plan_id, amount_cents")
          .not("plan_id", "is", null).order("id", { ascending: true }).range(f, t),
        "abonos",
      ),
    ])

    const planSaleIds = new Set<string>()
    for (const p of planRows) {
      const sid = p.sale_id as string | null
      if (sid) planSaleIds.add(sid)
    }
    for (const s of salesRows) {
      const leadId = s.lead_id as string | null
      if (leadId && !planSaleIds.has(s.id as string)) owe.add(leadId)
    }
    const abonoByPlan = new Map<string, number>()
    for (const a of abonoRows) {
      const pid = a.plan_id as string
      if (!pid) continue
      abonoByPlan.set(pid, (abonoByPlan.get(pid) ?? 0) + ((a.amount_cents as number) ?? 0))
    }
    for (const p of planRows) {
      const leadId = p.lead_id as string | null
      if (!leadId) continue
      const paid = abonoByPlan.get(p.id as string) ?? 0
      if (((p.total_amount_cents as number) ?? 0) - paid > 0) owe.add(leadId)
    }
  } catch {
    /* ignore */
  }
  return Array.from(owe)
}
