/**
 * Data layer compartido para el reporte Excel multi-hoja.
 * Usado por:
 *   - GET /api/exports/report (botón Export del CRM)
 *   - Tool del bot `generate_sales_report` (src/lib/agent/file-tools.ts)
 *
 * Aplica filtros explícitos por rol/brand/rep para no depender de RLS
 * (la tool del bot usa service client; el endpoint usa SSR).
 *
 * Las reglas anti-doble-conteo son consistentes con:
 *   - src/lib/queries/sales-kpi.ts:getSalesBreakdown
 *   - src/app/(app)/leads/[id]/page.tsx:106-132
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getSalesBreakdown } from "@/lib/queries/sales-kpi"

type SB = SupabaseClient<Database>
type PaymentStatus = Database["public"]["Enums"]["payment_status"]

const HARD_ROW_LIMIT = 50_000

export type ReportContext = {
  /** userId actual (siempre se respeta como floor del scope) */
  userId: string
  /** rol del user actual: rep | manager | admin */
  role: "rep" | "manager" | "admin" | string
}

export type ReportFilters = {
  /** ISO string del inicio del rango (paid_at >= from) */
  from?: string | null
  /** ISO string del fin del rango (paid_at < to) */
  to?: string | null
  /** Si true, ignora from/to */
  historico?: boolean
  /** Filtro por marca específica (null = todas las visibles) */
  brandId?: string | null
  /** Filtro por rep. Solo aplicable si role es manager/admin. Si role=rep se ignora y se fuerza userId. */
  repId?: string | null
  /** Filtra transacciones de la Hoja 2 por status. Default 'all' */
  status?: "all" | "paid" | "pending"
}

export type ResumenRow = {
  brand_name: string
  lead_id: string
  lead_name: string
  email: string | null
  phone: string | null
  rep_name: string | null
  num_sales: number
  total_contratado_cents: number
  total_cobrado_cents: number
  saldo_pendiente_cents: number
  proxima_cuota_fecha: string | null
  proxima_cuota_cents: number | null
  status_text: string
}

export type TransaccionRow = {
  fecha_cobro: string
  brand_name: string
  lead_name: string
  rep_name: string | null
  tipo: "Venta" | "Abono plan"
  producto: string | null
  monto_cents: number
  metodo_pago: string | null
  notas: string | null
}

export type Kpis = {
  periodo_label: string
  marca_label: string
  total_cobrado_cents: number
  total_por_cobrar_cents: number
  ventas_nuevas_count: number
  planes_activos_count: number
  promedio_ticket_cents: number
  por_marca: Array<{ brand_name: string; cobrado_cents: number; pendiente_cents: number }>
  por_rep: Array<{ rep_name: string; cobrado_cents: number; ventas_count: number }>
}

export type ReportData = {
  resumen: ResumenRow[]
  transacciones: TransaccionRow[]
  kpis: Kpis
  meta: {
    generated_at: string
    generated_by_user_id: string
    filters_applied: ReportFilters
    row_counts: { resumen: number; transacciones: number }
  }
}

export type BuildReportResult =
  | { ok: true; data: ReportData }
  | { ok: false; error: string; code: "too_large" | "invalid_range" | "no_brand_access" | "internal" }

type SaleRow = {
  id: string
  brand_id: string
  lead_id: string | null
  rep_id: string | null
  amount_cents: number
  payment_status: PaymentStatus
  payment_method: string | null
  paid_at: string | null
  created_at: string
  notes: string | null
}

type PlanRow = {
  id: string
  brand_id: string
  lead_id: string | null
  sale_id: string | null
  product_name: string
  total_amount_cents: number
  installment_count: number | null
  installment_amount_cents: number | null
  frequency_days: number | null
  first_due_date: string | null
  installment_overrides: Record<string, { due_date?: string; amount_cents?: number }> | null
}

type AbonoRow = {
  id: string
  plan_id: string
  lead_id: string | null
  brand_id: string
  amount_cents: number
  paid_at: string
  payment_method: string | null
  notes: string | null
}

type LeadInfo = {
  id: string
  first_name: string
  last_name: string | null
  email: string | null
  phone: string | null
  brand_id: string
  assigned_rep_id: string | null
}

function formatPeriodLabel(filters: ReportFilters): string {
  if (filters.historico || (!filters.from && !filters.to)) return "Histórico completo"
  const fmt = (iso: string) => iso.slice(0, 10)
  return `${filters.from ? fmt(filters.from) : "—"} → ${filters.to ? fmt(filters.to) : "—"}`
}

function fullName(first: string, last: string | null): string {
  return last ? `${first} ${last}`.trim() : first
}

/**
 * Computa la próxima cuota futura no pagada de un plan.
 * Las cuotas son virtuales (calculadas desde first_due_date + N*frequency_days).
 * Aplica installment_overrides y descarta cuotas ya pagadas según el orden FIFO
 * de abonos.
 */
function computeNextInstallment(
  plan: PlanRow,
  abonosOfPlan: AbonoRow[],
): { fecha: string | null; amountCents: number | null } {
  if (!plan.first_due_date || !plan.installment_count || !plan.frequency_days) {
    return { fecha: null, amountCents: null }
  }

  const overrides = plan.installment_overrides ?? {}
  const defaultAmount = plan.installment_amount_cents ?? 0

  // Total ya pagado en abonos
  let remainingPaid = abonosOfPlan.reduce((s, a) => s + a.amount_cents, 0)

  // Iteramos cuotas hasta encontrar la primera no cubierta
  const baseDate = new Date(plan.first_due_date + "T00:00:00")
  for (let seq = 1; seq <= plan.installment_count; seq++) {
    const ov = overrides[String(seq)] ?? {}
    const dueDate = ov.due_date
      ?? new Date(baseDate.getTime() + (seq - 1) * plan.frequency_days * 86_400_000).toISOString().slice(0, 10)
    const amount = ov.amount_cents ?? defaultAmount

    if (remainingPaid >= amount) {
      remainingPaid -= amount
      continue
    }

    // Esta cuota no está cubierta — primera pendiente
    return { fecha: dueDate, amountCents: amount }
  }
  return { fecha: null, amountCents: null }
}

function computePlanStatusText(
  plan: PlanRow,
  abonosOfPlan: AbonoRow[],
): string {
  const totalPaid = abonosOfPlan.reduce((s, a) => s + a.amount_cents, 0)
  if (totalPaid >= plan.total_amount_cents) return "Plan completo"

  const next = computeNextInstallment(plan, abonosOfPlan)
  if (!next.fecha) return "Al día"

  const today = new Date()
  const due = new Date(next.fecha + "T00:00:00")
  const diffDays = Math.floor((today.getTime() - due.getTime()) / 86_400_000)
  if (diffDays > 0) return `Atrasado ${diffDays} día${diffDays !== 1 ? "s" : ""}`
  return "Al día"
}

/**
 * Resuelve los filtros respetando el rol del user actual.
 * Reglas:
 *  - role='rep' → siempre forzar repId = userId (ignora repId pasado)
 *  - role='manager' o 'admin' → respeta repId si fue pasado
 */
function resolveScope(ctx: ReportContext, filters: ReportFilters): { repId: string | null } {
  if (ctx.role === "rep") return { repId: ctx.userId }
  return { repId: filters.repId ?? null }
}

export async function buildReportData(
  sb: SB,
  ctx: ReportContext,
  filters: ReportFilters,
): Promise<BuildReportResult> {
  // Validar rango
  if (!filters.historico && filters.from && filters.to && filters.from > filters.to) {
    return { ok: false, error: "El rango es inválido (from > to)", code: "invalid_range" }
  }

  const { repId } = resolveScope(ctx, filters)
  const useRange = !filters.historico && filters.from && filters.to

  // ── 1. Cargar SALES en scope ──────────────────────────────────────────────
  let salesQ = sb
    .from("sales")
    .select("id, brand_id, lead_id, rep_id, amount_cents, payment_status, payment_method, paid_at, created_at, notes")
    .order("created_at", { ascending: false })
    .limit(HARD_ROW_LIMIT)

  if (filters.brandId) salesQ = salesQ.eq("brand_id", filters.brandId)
  if (repId) salesQ = salesQ.eq("rep_id", repId)
  if (useRange) {
    salesQ = salesQ.gte("created_at", filters.from!).lt("created_at", filters.to!)
  }

  const { data: salesData, error: salesErr } = await salesQ
  if (salesErr) return { ok: false, error: salesErr.message, code: "internal" }
  const allSales = (salesData ?? []) as SaleRow[]

  // ── 2. Cargar PAYMENT_PLANS en scope (mismas marcas, mismos leads visibles) ──
  // Filtramos por brand + lead_ids del scope. Sales y plans pueden estar en
  // distintos rangos temporales — el plan es "del paciente", no del periodo.
  const leadIdsFromSales = new Set(allSales.map((s) => s.lead_id).filter((x): x is string => !!x))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plansQ: any = (sb as any)
    .from("payment_plans")
    .select("id, brand_id, lead_id, sale_id, product_name, total_amount_cents, installment_count, installment_amount_cents, frequency_days, first_due_date, installment_overrides")
    .order("created_at", { ascending: false })
    .limit(HARD_ROW_LIMIT)
  if (filters.brandId) plansQ = plansQ.eq("brand_id", filters.brandId)

  const { data: plansData, error: plansErr } = await plansQ
  if (plansErr) return { ok: false, error: plansErr.message, code: "internal" }
  let allPlans = (plansData ?? []) as PlanRow[]

  // Si role='rep', restringimos también plans al rep — los planes no tienen
  // rep_id, así que filtramos por sale_id linkeado al rep.
  if (repId) {
    const repSaleIds = new Set(allSales.map((s) => s.id))
    allPlans = allPlans.filter((p) => p.sale_id && repSaleIds.has(p.sale_id))
  }

  // Agregamos los leads de los planes al set (puede haber planes con sales fuera del rango)
  for (const p of allPlans) {
    if (p.lead_id) leadIdsFromSales.add(p.lead_id)
  }

  // ── 3. Cargar ABONOS de los planes ────────────────────────────────────────
  const planIds = allPlans.map((p) => p.id)
  let allAbonos: AbonoRow[] = []
  if (planIds.length > 0) {
    let abonosQ = sb
      .from("abonos")
      .select("id, plan_id, lead_id, brand_id, amount_cents, paid_at, payment_method, notes")
      .in("plan_id", planIds)
      .limit(HARD_ROW_LIMIT)
    // Para Hoja 2 (Transacciones) restringimos al rango. Para Hoja 1 (Resumen)
    // necesitamos TODOS los abonos para calcular saldos correctos. Por eso
    // traemos TODOS y filtramos en memoria para la Hoja 2.
    const { data: abonosData, error: abonosErr } = await abonosQ
    if (abonosErr) return { ok: false, error: abonosErr.message, code: "internal" }
    allAbonos = (abonosData ?? []) as AbonoRow[]
  }

  // Cap total
  const totalRows = allSales.length + allAbonos.length
  if (totalRows > HARD_ROW_LIMIT) {
    return {
      ok: false,
      error: `Reporte muy grande (${totalRows} filas). Achicá el rango o filtrá por marca.`,
      code: "too_large",
    }
  }

  // ── 4. Cargar metadatos: leads, brands, reps ──────────────────────────────
  const leadIds = Array.from(leadIdsFromSales)
  const brandIds = Array.from(new Set([
    ...allSales.map((s) => s.brand_id),
    ...allPlans.map((p) => p.brand_id),
  ]))
  const repIdsAll = Array.from(new Set(allSales.map((s) => s.rep_id).filter((x): x is string => !!x)))

  const [leadsRes, brandsRes, repsRes] = await Promise.all([
    leadIds.length > 0
      ? sb.from("leads")
          .select("id, first_name, last_name, email, phone, brand_id, assigned_rep_id")
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    brandIds.length > 0
      ? sb.from("brands").select("id, name").in("id", brandIds)
      : Promise.resolve({ data: [], error: null }),
    repIdsAll.length > 0
      ? sb.from("users").select("id, name").in("id", repIdsAll)
      : Promise.resolve({ data: [], error: null }),
  ])

  const leadsMap = new Map<string, LeadInfo>(
    ((leadsRes.data ?? []) as LeadInfo[]).map((l) => [l.id, l]),
  )
  const brandsMap = new Map<string, string>(
    ((brandsRes.data ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]),
  )
  const repsMap = new Map<string, string>(
    ((repsRes.data ?? []) as Array<{ id: string; name: string }>).map((r) => [r.id, r.name]),
  )

  // También necesitamos nombres de reps asignados a leads (para mostrar Rep aunque
  // no haya venta en el periodo) — los completamos del mismo map si ya están,
  // sino los pedimos.
  const extraRepIds = Array.from(new Set(
    Array.from(leadsMap.values()).map((l) => l.assigned_rep_id).filter((x): x is string => !!x && !repsMap.has(x))
  ))
  if (extraRepIds.length > 0) {
    const { data: extraReps } = await sb.from("users").select("id, name").in("id", extraRepIds)
    for (const r of (extraReps ?? []) as Array<{ id: string; name: string }>) {
      repsMap.set(r.id, r.name)
    }
  }

  // ── 5. Computar planSaleIds (anti-doble-conteo) ───────────────────────────
  const planSaleIds = new Set(
    allPlans.map((p) => p.sale_id).filter((x): x is string => !!x),
  )

  // ── 6. HOJA 1: Resumen por paciente ───────────────────────────────────────
  // Agrupamos por lead_id
  const byLead = new Map<string, {
    sales: SaleRow[]
    plans: PlanRow[]
  }>()
  for (const s of allSales) {
    if (!s.lead_id) continue
    if (!byLead.has(s.lead_id)) byLead.set(s.lead_id, { sales: [], plans: [] })
    byLead.get(s.lead_id)!.sales.push(s)
  }
  for (const p of allPlans) {
    if (!p.lead_id) continue
    if (!byLead.has(p.lead_id)) byLead.set(p.lead_id, { sales: [], plans: [] })
    byLead.get(p.lead_id)!.plans.push(p)
  }

  const abonosByPlan = new Map<string, AbonoRow[]>()
  for (const a of allAbonos) {
    if (!abonosByPlan.has(a.plan_id)) abonosByPlan.set(a.plan_id, [])
    abonosByPlan.get(a.plan_id)!.push(a)
  }

  const resumen: ResumenRow[] = []
  for (const [leadId, grp] of byLead.entries()) {
    const lead = leadsMap.get(leadId)
    if (!lead) continue

    // Excluimos sales auto-generadas por planes (planSaleIds) y refunded/cancelled
    const standaloneSales = grp.sales.filter(
      (s) => !planSaleIds.has(s.id) &&
        s.payment_status !== "refunded" &&
        (s.payment_status as string) !== "cancelled",
    )

    const totalContratadoStandalone = standaloneSales.reduce((sum, s) => sum + s.amount_cents, 0)
    const totalContratadoPlans = grp.plans.reduce((sum, p) => sum + p.total_amount_cents, 0)
    const totalContratado = totalContratadoStandalone + totalContratadoPlans

    const standalonePaid = standaloneSales
      .filter((s) => s.payment_status === "paid")
      .reduce((sum, s) => sum + s.amount_cents, 0)
    const planAbonosTotal = grp.plans.reduce((sum, p) => {
      const ab = abonosByPlan.get(p.id) ?? []
      return sum + ab.reduce((s, a) => s + a.amount_cents, 0)
    }, 0)
    const totalCobrado = standalonePaid + planAbonosTotal

    const saldoPendiente = Math.max(0, totalContratado - totalCobrado)

    // Próxima cuota: tomamos la primera entre todos los planes del lead
    let proximaCuota: { fecha: string | null; amountCents: number | null } = { fecha: null, amountCents: null }
    let statusText = standaloneSales.length === grp.sales.length && grp.plans.length === 0 ? "Sin plan" : "Al día"

    for (const p of grp.plans) {
      const ab = abonosByPlan.get(p.id) ?? []
      const next = computeNextInstallment(p, ab)
      if (next.fecha && (!proximaCuota.fecha || next.fecha < proximaCuota.fecha)) {
        proximaCuota = next
      }
      const planStatus = computePlanStatusText(p, ab)
      // El status text más "grave" se queda — atrasado > al día > completo
      if (planStatus.startsWith("Atrasado")) statusText = planStatus
      else if (statusText === "Sin plan") statusText = planStatus
    }

    resumen.push({
      brand_name: brandsMap.get(lead.brand_id) ?? "—",
      lead_id: lead.id,
      lead_name: fullName(lead.first_name, lead.last_name),
      email: lead.email,
      phone: lead.phone,
      rep_name: lead.assigned_rep_id ? (repsMap.get(lead.assigned_rep_id) ?? null) : null,
      num_sales: standaloneSales.length,
      total_contratado_cents: totalContratado,
      total_cobrado_cents: totalCobrado,
      saldo_pendiente_cents: saldoPendiente,
      proxima_cuota_fecha: proximaCuota.fecha,
      proxima_cuota_cents: proximaCuota.amountCents,
      status_text: statusText,
    })
  }

  // Orden por saldo pendiente desc (los que más deben primero)
  resumen.sort((a, b) => b.saldo_pendiente_cents - a.saldo_pendiente_cents)

  // ── 7. HOJA 2: Transacciones ──────────────────────────────────────────────
  const transacciones: TransaccionRow[] = []

  // 7a) Sales standalone PAGADAS en el rango (excluye auto-generadas y refunded)
  for (const s of allSales) {
    if (planSaleIds.has(s.id)) continue
    if (s.payment_status === "refunded" || (s.payment_status as string) === "cancelled") {
      // En el spec dijimos que sí aparecen en Hoja 2 con status visible si status=all
      if (filters.status === "paid") continue
    }
    const lead = s.lead_id ? leadsMap.get(s.lead_id) : null
    const rep = s.rep_id ? repsMap.get(s.rep_id) ?? null : null
    const fecha = s.paid_at ?? s.created_at
    if (useRange && (fecha < filters.from! || fecha >= filters.to!)) continue

    // Aplicar filtro status
    if (filters.status === "paid" && s.payment_status !== "paid") continue
    if (filters.status === "pending" && s.payment_status !== "pending" && s.payment_status !== "partial") continue

    transacciones.push({
      fecha_cobro: fecha,
      brand_name: brandsMap.get(s.brand_id) ?? "—",
      lead_name: lead ? fullName(lead.first_name, lead.last_name) : "—",
      rep_name: rep,
      tipo: "Venta",
      producto: null,
      monto_cents: s.amount_cents,
      metodo_pago: s.payment_method,
      notas: s.notes,
    })
  }

  // 7b) Abonos de planes (en el rango si useRange)
  if (filters.status !== "pending") {
    for (const a of allAbonos) {
      if (useRange && (a.paid_at < filters.from!.slice(0, 10) || a.paid_at >= filters.to!.slice(0, 10))) continue
      const plan = allPlans.find((p) => p.id === a.plan_id)
      if (!plan) continue
      const lead = a.lead_id ? leadsMap.get(a.lead_id) : null
      // Rep del abono = rep del sale del plan
      const planSale = plan.sale_id ? allSales.find((s) => s.id === plan.sale_id) : null
      const rep = planSale?.rep_id ? repsMap.get(planSale.rep_id) ?? null : null

      transacciones.push({
        fecha_cobro: a.paid_at,
        brand_name: brandsMap.get(a.brand_id) ?? "—",
        lead_name: lead ? fullName(lead.first_name, lead.last_name) : "—",
        rep_name: rep,
        tipo: "Abono plan",
        producto: plan.product_name,
        monto_cents: a.amount_cents,
        metodo_pago: a.payment_method,
        notas: a.notes,
      })
    }
  }

  transacciones.sort((a, b) => b.fecha_cobro.localeCompare(a.fecha_cobro))

  // ── 8. HOJA 3: KPIs ───────────────────────────────────────────────────────
  // Usamos getSalesBreakdown para los totales globales (consistencia con dashboard).
  const breakdown = await getSalesBreakdown(sb, {
    brandId: filters.brandId ?? null,
    repId,
    paidRange: useRange
      ? { startIso: filters.from!, endIso: filters.to! }
      : undefined,
  })

  // KPIs por marca
  const porMarcaMap = new Map<string, { cobrado: number; pendiente: number }>()
  for (const r of resumen) {
    if (!porMarcaMap.has(r.brand_name)) porMarcaMap.set(r.brand_name, { cobrado: 0, pendiente: 0 })
    const m = porMarcaMap.get(r.brand_name)!
    m.cobrado += r.total_cobrado_cents
    m.pendiente += r.saldo_pendiente_cents
  }

  // KPIs por rep (top 10 por monto cobrado en periodo)
  const porRepMap = new Map<string, { cobrado: number; ventas: number }>()
  for (const t of transacciones) {
    const rep = t.rep_name ?? "Sin rep"
    if (!porRepMap.has(rep)) porRepMap.set(rep, { cobrado: 0, ventas: 0 })
    const r = porRepMap.get(rep)!
    r.cobrado += t.monto_cents
    if (t.tipo === "Venta") r.ventas += 1
  }
  const porRep = Array.from(porRepMap.entries())
    .map(([rep_name, v]) => ({ rep_name, cobrado_cents: v.cobrado, ventas_count: v.ventas }))
    .sort((a, b) => b.cobrado_cents - a.cobrado_cents)
    .slice(0, 10)

  const ventasNuevasCount = useRange
    ? allSales.filter((s) => !planSaleIds.has(s.id) && s.created_at >= filters.from! && s.created_at < filters.to!).length
    : allSales.filter((s) => !planSaleIds.has(s.id)).length

  const kpis: Kpis = {
    periodo_label: formatPeriodLabel(filters),
    marca_label: filters.brandId ? (brandsMap.get(filters.brandId) ?? "—") : "Todas",
    total_cobrado_cents: breakdown.collectedCents,
    total_por_cobrar_cents: breakdown.outstandingCents,
    ventas_nuevas_count: ventasNuevasCount,
    planes_activos_count: allPlans.length,
    promedio_ticket_cents: breakdown.paidCount > 0
      ? Math.round(breakdown.collectedCents / breakdown.paidCount)
      : 0,
    por_marca: Array.from(porMarcaMap.entries()).map(([brand_name, v]) => ({
      brand_name,
      cobrado_cents: v.cobrado,
      pendiente_cents: v.pendiente,
    })).sort((a, b) => b.cobrado_cents - a.cobrado_cents),
    por_rep: porRep,
  }

  return {
    ok: true,
    data: {
      resumen,
      transacciones,
      kpis,
      meta: {
        generated_at: new Date().toISOString(),
        generated_by_user_id: ctx.userId,
        filters_applied: filters,
        row_counts: { resumen: resumen.length, transacciones: transacciones.length },
      },
    },
  }
}
