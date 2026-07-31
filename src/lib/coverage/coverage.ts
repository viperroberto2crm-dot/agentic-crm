/**
 * Cobertura de prepago por paciente: ¿está cubierto AHORA por un plan pagado?
 *
 * Calcula "cubierto hasta" = fecha del último pago de plan + días del plan, de
 * TODAS las fuentes (suscripción, venta con plan, plan importado/abonos, y pagos
 * Stripe/Square), y toma la fecha más lejana. Estado:
 *   - "covered"  🟢 tiene una ventana de prepago vigente (→ coveredUntil).
 *   - "unknown"  🟡 tiene un pago reciente pero no se pudo determinar el plan
 *                    (protege de marcar "Sin cobertura" por error).
 *   - "none"     🔴 sin ventana de prepago vigente.
 *
 * SEGURIDAD: usa el admin client PERO estrictamente acotado a los leadIds que se
 * le pasan — que el llamador ya obtuvo con el alcance de marca del usuario
 * (fetchLeads). No amplía visibilidad; solo lee los pagos de pacientes que el
 * usuario YA puede ver. Confirmar esa precondición en cada call site.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import { parseDbDate, BRAND_TIMEZONE } from "@/lib/datetime"
import { ymdFromDateInTz } from "@/lib/dashboard/date-ranges"
import { cadenceDays, parseCadence } from "./cadence"

export type CoverageState = "covered" | "unknown" | "none"
// hadPayment: hubo ALGÚN pago/plan (aunque venciera). Sirve para NO pintar de
// rojo a prospectos que nunca pagaron: chip solo si covered/unknown, o si es
// "none" pero SÍ pagó antes (venció).
export type Coverage = { state: CoverageState; coveredUntil: string | null; hadPayment: boolean }

const SETTLED = new Set(["completed", "paid", "settled", "succeeded"])

function plusDays(iso: string | null, days: number): Date | null {
  if (!iso) return null
  const d = parseDbDate(iso)
  if (!d) return null
  return new Date(d.getTime() + days * 86_400_000)
}

type Acc = { bestUntil: Date | null; hasUnknown: boolean }

function bump(acc: Map<string, Acc>, leadId: string, until: Date | null, unknown: boolean) {
  const cur = acc.get(leadId) ?? { bestUntil: null, hasUnknown: false }
  if (until && (!cur.bestUntil || until > cur.bestUntil)) cur.bestUntil = until
  if (unknown) cur.hasUnknown = true
  acc.set(leadId, cur)
}

/**
 * Registra un pago según su cadencia:
 *  - recurrente (días > 0) → ventana = paid_at + días.
 *  - one_time (días === 0) → plan CONOCIDO sin cobertura (no ventana, no unknown).
 *  - sin cadencia (null)   → "por confirmar" (unknown → 🟡), NO verde. (Fable #2/#5)
 */
function bumpByCadence(acc: Map<string, Acc>, leadId: string, paidAt: string | null, cadence: string | null) {
  const days = cadenceDays(cadence)
  if (days == null) { bump(acc, leadId, null, true); return }
  if (days === 0) { bump(acc, leadId, null, false); return }
  bump(acc, leadId, plusDays(paidAt, days), false)
}

// Extrae las llaves de oferta (precio) de un pago crudo, por proveedor, para
// mapearlas a cadencia vía offer_brand_map. Best-effort y tolerante a la forma.
function extractOfferKeys(provider: string, raw: unknown): string[] {
  const keys: string[] = []
  const r = (raw ?? {}) as Record<string, unknown>
  const push = (v: unknown) => {
    if (typeof v === "string" && v) keys.push(v)
  }
  if (provider === "stripe") {
    push(r.payment_link)
    const lines = (r as { lines?: { data?: unknown[] } }).lines?.data
    if (Array.isArray(lines) && lines[0]) {
      const l0 = lines[0] as {
        pricing?: { price_details?: { price?: unknown } }
        price?: { id?: unknown }
      }
      push(l0.pricing?.price_details?.price)
      push(l0.price?.id)
    }
  } else {
    // Square: variación / catalog object id en varias formas posibles.
    push(r.catalog_object_id)
    const order = (r as { order?: { line_items?: unknown[] } }).order
    const li = order?.line_items ?? (r as { line_items?: unknown[] }).line_items
    if (Array.isArray(li)) {
      for (const item of li) {
        push((item as { catalog_object_id?: unknown }).catalog_object_id)
      }
    }
  }
  return Array.from(new Set(keys))
}

export async function computeCoverageForLeads(
  leadIds: string[],
  timezone: string = BRAND_TIMEZONE,
): Promise<Map<string, Coverage>> {
  const result = new Map<string, Coverage>()
  const ids = Array.from(new Set(leadIds.filter(Boolean)))
  if (ids.length === 0) return result
  for (const id of ids) result.set(id, { state: "none", coveredUntil: null, hadPayment: false })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = createAdminClient() as any
  const acc = new Map<string, Acc>()

  // 1) Suscripciones — next_billing_at es "cubierto hasta"; fallback a
  //    started_at + días de la cadencia/ciclo.
  try {
    const { data } = await sb
      .from("subscriptions")
      .select("lead_id, cadence, billing_cycle_days, next_billing_at, started_at, status")
      .in("lead_id", ids)
    for (const s of (data ?? []) as Record<string, unknown>[]) {
      const leadId = s.lead_id as string | null
      if (!leadId) continue
      // Allowlist: solo suscripciones que de verdad están pagando. past_due /
      // unpaid / paused / incomplete NO cuentan aunque tengan next_billing_at
      // futuro (evita 🟢 con una renovación fallida). Fable #3.
      const status = (s.status as string | null)?.toLowerCase() ?? ""
      if (status !== "active" && status !== "trialing") continue
      let until: Date | null = s.next_billing_at ? parseDbDate(s.next_billing_at as string) : null
      if (!until) {
        const days =
          (typeof s.billing_cycle_days === "number" ? s.billing_cycle_days : null) ??
          cadenceDays(s.cadence as string | null)
        if (days != null) until = plusDays(s.started_at as string | null, days)
      }
      bump(acc, leadId, until, false)
    }
  } catch { /* tabla ausente / RLS → se ignora */ }

  // 2) Ventas internas con plan (sale_items.cadence).
  try {
    const { data: sales } = await sb
      .from("sales")
      .select("id, lead_id, paid_at, payment_status")
      .in("lead_id", ids)
      .eq("payment_status", "paid")
    const saleRows = (sales ?? []) as Record<string, unknown>[]
    const saleIds = saleRows.map((s) => s.id as string).filter(Boolean)
    // Por venta, quedarse con el ítem de MAYOR cobertura (una venta de consulta
    // one_time + plan mensual debe contar el mensual, no el primero). Fable #8.
    const cadBySale = new Map<string, string>()
    if (saleIds.length > 0) {
      const { data: items } = await sb
        .from("sale_items")
        .select("sale_id, cadence")
        .in("sale_id", saleIds)
      for (const it of (items ?? []) as Record<string, unknown>[]) {
        const sid = it.sale_id as string
        const cad = it.cadence as string | null
        if (!sid || !cad) continue
        const prev = cadBySale.get(sid)
        const prevDays = prev ? cadenceDays(prev) ?? -1 : -1
        const curDays = cadenceDays(cad) ?? -1
        if (curDays > prevDays) cadBySale.set(sid, cad)
      }
    }
    for (const s of saleRows) {
      const leadId = s.lead_id as string | null
      const paidAt = s.paid_at as string | null
      if (!leadId || !paidAt) continue
      bumpByCadence(acc, leadId, paidAt, cadBySale.get(s.id as string) ?? null)
    }
  } catch { /* ignore */ }

  // 3) Planes importados (payment_plans.frequency_days + último abono).
  try {
    const { data: plans } = await sb
      .from("payment_plans")
      .select("id, lead_id, frequency_days")
      .in("lead_id", ids)
    const freqByPlan = new Map<string, number>()
    for (const p of (plans ?? []) as Record<string, unknown>[]) {
      const pid = p.id as string
      const f = p.frequency_days as number | null
      if (pid && typeof f === "number") freqByPlan.set(pid, f)
    }
    if (freqByPlan.size > 0) {
      const { data: abonos } = await sb
        .from("abonos")
        .select("plan_id, lead_id, paid_at")
        .in("lead_id", ids)
      for (const a of (abonos ?? []) as Record<string, unknown>[]) {
        const leadId = a.lead_id as string | null
        const paidAt = a.paid_at as string | null
        const days = freqByPlan.get(a.plan_id as string)
        if (leadId && paidAt && days != null) bump(acc, leadId, plusDays(paidAt, days), false)
      }
    }
  } catch { /* ignore */ }

  // 4) Pagos Stripe/Square (external_payments). Cadencia por precio mapeado
  //    (offer_brand_map.cadence) o, si no, del texto (items/reference).
  try {
    const { data: exts } = await sb
      .from("external_payments")
      .select("lead_id, provider, status, items, reference, paid_at, raw")
      .in("lead_id", ids)
    const allExt = (exts ?? []) as Record<string, unknown>[]
    const extRows = allExt.filter((e) =>
      SETTLED.has(((e.status as string | null) ?? "").toLowerCase()),
    )

    // Reembolsos (Fable #1): fecha del último refund por paciente. Un pago con
    // fecha <= ese refund se considera revocado → NO da cobertura. Conservador
    // (evita 🟢 en alguien reembolsado); cubre Stripe (Square aún no manda refunds).
    const refundedAt = new Map<string, Date>()
    for (const e of allExt) {
      if (((e.status as string | null) ?? "").toLowerCase() !== "refunded") continue
      const leadId = e.lead_id as string | null
      const d = e.paid_at ? parseDbDate(e.paid_at as string) : null
      if (leadId && d) {
        const prev = refundedAt.get(leadId)
        if (!prev || d > prev) refundedAt.set(leadId, d)
      }
    }

    // Batch: junta todas las (provider, offerKey) y trae su cadencia mapeada.
    const rowKeys = new Map<Record<string, unknown>, string[]>()
    const allKeys = new Set<string>()
    for (const e of extRows) {
      const keys = extractOfferKeys((e.provider as string) ?? "", e.raw)
      rowKeys.set(e, keys)
      for (const k of keys) allKeys.add(k)
    }
    const cadByKey = new Map<string, string>() // `${provider}:${key}` → cadence
    if (allKeys.size > 0) {
      const { data: maps } = await sb
        .from("offer_brand_map")
        .select("provider, offer_key, cadence")
        .in("offer_key", Array.from(allKeys))
        .eq("active", true) // solo mapeos activos (Fable #4)
        .not("cadence", "is", null)
      for (const m of (maps ?? []) as Record<string, unknown>[]) {
        const p = m.provider as string
        const k = m.offer_key as string
        const c = m.cadence as string | null
        if (p && k && c) cadByKey.set(`${p}:${k}`, c) // active gana; duplicados no importan
      }
    }

    for (const e of extRows) {
      const leadId = e.lead_id as string | null
      const paidAt = e.paid_at as string | null
      if (!leadId || !paidAt) continue

      // Revocado por reembolso → cuenta como pago (hadPayment) pero sin ventana.
      const refundAt = refundedAt.get(leadId)
      const paidDate = parseDbDate(paidAt)
      if (refundAt && paidDate && paidDate <= refundAt) {
        bump(acc, leadId, null, false)
        continue
      }

      const provider = (e.provider as string) ?? ""
      // Cadencia: 1) precio mapeado (exacto), 2) texto del pago (solo items).
      let cadence: string | null = null
      for (const k of rowKeys.get(e) ?? []) {
        const mapped = cadByKey.get(`${provider}:${k}`)
        if (mapped) { cadence = mapped; break }
      }
      if (!cadence) cadence = parseCadence(e.items as string | null)
      bumpByCadence(acc, leadId, paidAt, cadence)
    }
  } catch { /* ignore */ }

  // Resolver estado por paciente (covered > unknown > none). Estar en `acc`
  // significa que hubo ALGÚN pago/plan → hadPayment = true.
  const todayYmd = ymdFromDateInTz(new Date(), timezone)
  for (const [leadId, a] of acc) {
    let state: CoverageState = "none"
    let coveredUntil: string | null = null
    if (a.bestUntil && ymdFromDateInTz(a.bestUntil, timezone) >= todayYmd) {
      state = "covered"
      coveredUntil = a.bestUntil.toISOString()
    } else if (a.hasUnknown) {
      state = "unknown"
    }
    result.set(leadId, { state, coveredUntil, hadPayment: true })
  }

  return result
}
