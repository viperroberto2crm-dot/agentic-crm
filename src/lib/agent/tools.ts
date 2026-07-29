import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getSalesBreakdown } from "@/lib/queries/sales-kpi"
import { applyLeadSearch } from "@/lib/queries/search"
import { BRAND_TIMEZONE } from "@/lib/datetime"

/**
 * Devuelve null si admin/manager (no filtrar por rep_id, ven todo el brand)
 * o el userId si rep/provider (solo lo suyo).
 */
function scopeRep(userId: string, role: string): string | null {
  return role === "admin" || role === "manager" ? null : userId
}

/**
 * Día YYYY-MM-DD en una timezone específica para "hoy".
 * Resuelve el bug de "hoy" calculado en server UTC cuando son las 9 PM PT
 * (4 AM UTC del día siguiente).
 */
export function todayInTz(tz: string = BRAND_TIMEZONE): string {
  // Formatter para sacar partes en la TZ deseada
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const y = parts.find((p) => p.type === "year")?.value ?? "1970"
  const m = parts.find((p) => p.type === "month")?.value ?? "01"
  const d = parts.find((p) => p.type === "day")?.value ?? "01"
  return `${y}-${m}-${d}`
}

/**
 * Devuelve UTC ISO del inicio de día de una fecha YYYY-MM-DD en TZ dada.
 * Ej: dayStartUtc("2026-05-20", "America/Los_Angeles") → "2026-05-20T07:00:00Z" en PDT.
 */
export function dayStartUtcInTz(ymd: string, tz: string = BRAND_TIMEZONE): string {
  // Construir Date en UTC interpretando ymd como medianoche en tz.
  // Truco: usar Intl para encontrar el offset.
  const [y, m, d] = ymd.split("-").map(Number)
  // Empezamos con esa fecha a medianoche en UTC
  const utcMidnight = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  // Calcular qué hora es en tz cuando es utcMidnight
  const tzParts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(utcMidnight)
  const tzHour = parseInt(tzParts.find((p) => p.type === "hour")?.value ?? "0", 10)
  const tzMin = parseInt(tzParts.find((p) => p.type === "minute")?.value ?? "0", 10)
  // Offset = utc - tz (ej. en PDT tz=17:00 cuando utc=00:00 → offset = +7h)
  // Para llevar utcMidnight a "medianoche en tz" hay que sumarle ese offset.
  const offsetMin = (24 - tzHour) % 24 * 60 - tzMin
  return new Date(utcMidnight.getTime() + offsetMin * 60_000).toISOString()
}

type DB = SupabaseClient<Database>

// ── Tool input types ──────────────────────────────────────────────────────────

export type Scope = "current" | "all"

export type GetLeadsInput = {
  query?: string
  status?: string
  days_without_contact?: number
  limit?: number
  scope?: Scope
}

export type GetScheduleInput = {
  date?: string
  scope?: Scope
}

export type GetSalesKpiInput = {
  period?: "today" | "week" | "month"
  scope?: Scope
  /** Filtra cobros (sales paid + abonos) por método de pago. */
  payment_method?: "cash" | "card" | "stripe" | "zelle"
  /** Si "payment_method", devuelve breakdown agrupado por método. */
  breakdown_by?: "payment_method"
  /**
   * Día específico YYYY-MM-DD interpretado en hora local de la clínica (PT).
   * Si se da, IGNORA `period` y consulta solo ese día (o el rango date..end_date).
   */
  date?: string
  /** Fin de rango YYYY-MM-DD inclusivo (solo con `date`). */
  end_date?: string
}

export type GetCallsInput = {
  period?: "today" | "week" | "month"
  limit?: number
  scope?: Scope
  source?: string
  group_by_source?: boolean
}

export type GetTasksInput = {
  priority?: string
  limit?: number
}

export type ListBrandsInput = Record<string, never>

// ── Tool definitions (Anthropic format) ──────────────────────────────────────

const SCOPE_DESC =
  "Use 'current' (default) to scope to the active brand only. Use 'all' when the user asks about ALL brands or compares brands."

export const AGENT_TOOLS = [
  {
    name: "list_brands",
    description:
      "List every brand (compañía/marca) in this CRM. Use this when the user asks how many companies/brands exist or to confirm names before reporting metrics.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_leads",
    description: "Get leads from the CRM. Use the 'query' parameter to search by name, phone, or email (case-insensitive, partial match). Can also filter by status or days without contact.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search text. Matches against first_name, last_name, phone, and email (case-insensitive, partial). Use this when the user asks for a specific lead by name or contact info.",
        },
        status: {
          type: "string",
          enum: ["new", "contacted", "qualified", "appointment_set", "sold", "lost", "on_hold", "not_interested"],
          description: "Filter by lead status",
        },
        days_without_contact: {
          type: "number",
          description: "Only return leads not contacted in this many days",
        },
        limit: { type: "number", description: "Max results, default 10" },
        scope: {
          type: "string",
          enum: ["current", "all"],
          description: SCOPE_DESC,
        },
      },
    },
  },
  {
    name: "get_schedule_today",
    description: "Get today's appointments and open tasks. Admin/manager ven todas las del brand; rep solo las suyas. Por defecto usa el día de hoy en Pacific Time.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "ISO date (YYYY-MM-DD) en Pacific Time, defaults to today PT" },
        scope: {
          type: "string",
          enum: ["current", "all"],
          description: SCOPE_DESC,
        },
      },
    },
  },
  {
    name: "get_sales_kpi",
    description:
      "Get sales KPIs (revenue, pending, count, avg ticket). When scope='all', also returns a per-brand breakdown so you can compare brands. Use payment_method='cash'|'card'|'stripe'|'zelle' to filter collected amount by method (e.g. '¿cuánto cash hoy?'). Use breakdown_by='payment_method' to get a per-method breakdown (cash vs card vs stripe vs zelle). Always derived from real sales+abonos rows — never invent breakdowns.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month"],
          description: "Time period, default month",
        },
        scope: {
          type: "string",
          enum: ["current", "all"],
          description: SCOPE_DESC,
        },
        payment_method: {
          type: "string",
          enum: ["cash", "card", "stripe", "zelle"],
          description: "Filter collected amount (sales paid + abonos) by payment method. Use only when user explicitly asks about one method.",
        },
        breakdown_by: {
          type: "string",
          enum: ["payment_method"],
          description: "If 'payment_method', returns by_payment_method array with real totals per method.",
        },
        date: {
          type: "string",
          description:
            "Specific day in YYYY-MM-DD, clinic local time (PT). USE THIS WHENEVER the user names a concrete date ('el 16 de julio', 'July 16', 'ayer', 'anteayer', 'el lunes pasado') — resolve it to the exact date using TODAY's date given in the system prompt. Overrides `period`. Do NOT fall back to today/week/month for a specific date; that returns the WRONG day.",
        },
        end_date: {
          type: "string",
          description:
            "Optional inclusive end of a date range, YYYY-MM-DD (PT). Use only together with `date` for ranges like 'del 16 al 18 de julio'.",
        },
      },
    },
  },
  {
    name: "get_calls_summary",
    description:
      "Get calls summary: count, outcomes, duration. Use 'source' to filter by tracking number label (e.g. 'billboard', 'radio', 'buses', 'pulpo') — matches partial/case-insensitive against tracking_numbers.label. Use group_by_source=true to break down by tracking number (useful for 'cuántas llamadas por canal/source/campaña').",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month"],
          description: "Time period, default week",
        },
        limit: { type: "number", description: "Max results for detail list" },
        scope: {
          type: "string",
          enum: ["current", "all"],
          description: SCOPE_DESC,
        },
        source: {
          type: "string",
          description: "Filter calls by tracking number label (partial match, case-insensitive). Examples: 'billboard', 'radio', 'buses'.",
        },
        group_by_source: {
          type: "boolean",
          description: "If true, returns counts grouped by tracking number label.",
        },
      },
    },
  },
  {
    name: "get_tasks_open",
    description: "Get open tasks assigned to the current user.",
    input_schema: {
      type: "object" as const,
      properties: {
        priority: {
          type: "string",
          enum: ["urgent", "high", "normal", "low"],
          description: "Filter by priority",
        },
        limit: { type: "number", description: "Max results, default 10" },
      },
    },
  },
]

// ── Tool executors ────────────────────────────────────────────────────────────

function periodRange(period = "month"): { gte: string } {
  if (period === "today") {
    // Inicio del día PT (no UTC)
    return { gte: dayStartUtcInTz(todayInTz()) }
  }
  if (period === "week") {
    // Hace 7 días desde ahora — para queries de "última semana" rolling
    return { gte: new Date(Date.now() - 7 * 86_400_000).toISOString() }
  }
  // Mes: primer día del mes en PT
  const today = todayInTz()
  const monthStart = `${today.slice(0, 7)}-01`
  return { gte: dayStartUtcInTz(monthStart) }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/
/** true si `s` es un YYYY-MM-DD de calendario real (rechaza 2026-13-45, etc.). */
function isValidYmd(s: string | undefined): s is string {
  if (!s || !YMD_RE.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
/** Devuelve el día siguiente a un YYYY-MM-DD (aritmética en UTC, sin drift de TZ). */
export function nextYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return dt.toISOString().slice(0, 10)
}
/**
 * Rango de cobros para get_sales_kpi. Si viene una fecha específica (PT), la usa
 * (día único o date..end_date inclusivo); si no, cae al period today/week/month.
 * Reusa dayStartUtcInTz para que los límites sean medianoche PT (consistente con
 * el resto de las queries de tiempo del bot) y no UTC.
 *
 * CRÍTICO (abonos): abonos.paid_at es date-only y se filtra con
 * paidRange.{start,end}Iso.slice(0,10). Por eso endIso SIEMPRE debe ser la
 * medianoche PT del día SIGUIENTE al último día del rango — así el slice cae en
 * el día correcto e incluye los abonos de hoy. Antes endIso=now() → al cortar a
 * 10 chars daba la fecha UTC de hoy, que hasta las 5 PM PT es el MISMO día →
 * abonos: [hoy, hoy) = vacío → se perdían los cobros de planes de toda la mañana.
 */
function salesPaidRange(input: GetSalesKpiInput): {
  paidRange: { startIso: string; endIso: string }
  periodLabel: string
} {
  if (isValidYmd(input.date)) {
    const startYmd = input.date
    const endYmd =
      isValidYmd(input.end_date) && input.end_date >= input.date
        ? input.end_date
        : input.date
    return {
      paidRange: {
        startIso: dayStartUtcInTz(startYmd),
        // Exclusivo: medianoche PT del día SIGUIENTE al último día → incluye todo endYmd.
        endIso: dayStartUtcInTz(nextYmd(endYmd)),
      },
      periodLabel: startYmd === endYmd ? startYmd : `${startYmd}..${endYmd}`,
    }
  }
  const { gte } = periodRange(input.period ?? "month")
  return {
    paidRange: {
      startIso: gte,
      // Fin exclusivo = medianoche PT de mañana → incluye TODO el día de hoy
      // (tanto sales por timestamp como abonos por date-only slice).
      endIso: dayStartUtcInTz(nextYmd(todayInTz())),
    },
    periodLabel: input.period ?? "month",
  }
}

export async function executeListBrands(sb: DB) {
  const { data } = await sb
    .from("brands")
    .select("id, name, slug, active")
    .order("name")
  return data ?? []
}

export async function executeGetLeads(
  sb: DB, userId: string, brandId: string | null, input: GetLeadsInput,
  role: string = "rep",
) {
  const limit = input.limit ?? 10
  let query = sb
    .from("leads")
    .select("id, first_name, last_name, phone, email, status, score, last_contacted_at, source, brand_id")
    .order("score", { ascending: false, nullsFirst: false })
    .limit(limit)

  // rep/provider solo ven sus leads asignados; admin/manager ven todo el brand.
  const repFilter = scopeRep(userId, role)
  if (repFilter) query = query.eq("assigned_rep_id", repFilter)

  if (input.scope !== "all" && brandId) query = query.eq("brand_id", brandId)
  if (input.status) query = query.eq("status", input.status as Database["public"]["Enums"]["lead_status"])
  if (input.days_without_contact) {
    // Cutoff = inicio del día PT - N días, para alinear con día de calendario
    const today = todayInTz()
    const [y, m, d] = today.split("-").map(Number)
    const cutoffDate = new Date(Date.UTC(y, m - 1, d - input.days_without_contact))
    const cutoffYmd = cutoffDate.toISOString().slice(0, 10)
    const cutoffIso = dayStartUtcInTz(cutoffYmd)
    query = query.or(`last_contacted_at.is.null,last_contacted_at.lte.${cutoffIso}`)
  }

  if (input.query && input.query.trim().length > 0) {
    // Buscador unificado (applyLeadSearch): CADA palabra debe aparecer (AND entre
    // palabras — múltiples .or() encadenados se AND-ean en PostgREST), OR entre
    // campos. Antes era OR entre todo → "navarrete maria" traía todas las "Maria".
    query = applyLeadSearch(query, input.query)
  }

  const { data } = await query
  return data ?? []
}

export async function executeGetScheduleToday(
  sb: DB,
  userId: string,
  brandId: string | null,
  input: GetScheduleInput,
  role: string = "rep",
) {
  // Día PT (no UTC) — fix bug "no hubo citas hoy" a las 9 PM PT.
  const date = input.date ?? todayInTz()
  const start = dayStartUtcInTz(date)
  const nextDay = new Date(new Date(date + "T12:00:00Z").getTime() + 86_400_000)
  const nextDayYmd = nextDay.toISOString().slice(0, 10)
  const end = dayStartUtcInTz(nextDayYmd)

  const repFilter = scopeRep(userId, role)

  let apptsQ = sb.from("appointments")
    .select("id, scheduled_at, type, status, service, lead:leads!appointments_lead_id_fkey(first_name, last_name)")
    .gte("scheduled_at", start)
    .lt("scheduled_at", end)
    .order("scheduled_at")
  if (repFilter) apptsQ = apptsQ.eq("rep_id", repFilter)
  if (input.scope !== "all" && brandId) apptsQ = apptsQ.eq("brand_id", brandId)

  let tasksQ = sb.from("tasks")
    .select("id, title, priority, due_at, status")
    .eq("status", "open")
    .order("priority")
  if (repFilter) tasksQ = tasksQ.eq("assigned_to", repFilter)

  const [apptsRes, tasksRes] = await Promise.all([apptsQ, tasksQ])

  return {
    appointments: apptsRes.data ?? [],
    tasks: tasksRes.data ?? [],
  }
}

export async function executeGetSalesKpi(
  sb: DB,
  userId: string,
  brandId: string | null,
  input: GetSalesKpiInput,
  role: string = "rep",
) {
  // Validar fechas ANTES de armar el rango: si el modelo manda una fecha
  // malformada ("July 16", "2026-13-45", end_date < date), devolvemos error para
  // que reintente — NO caemos silenciosamente al mes (eso daría el día equivocado).
  if (input.date !== undefined && !isValidYmd(input.date)) {
    return { error: `Fecha inválida: "${input.date}". Usá formato YYYY-MM-DD.` }
  }
  if (input.end_date !== undefined && !isValidYmd(input.end_date)) {
    return { error: `Fecha fin inválida: "${input.end_date}". Usá formato YYYY-MM-DD.` }
  }
  if (input.date && input.end_date && input.end_date < input.date) {
    return { error: `Rango inválido: end_date (${input.end_date}) es anterior a date (${input.date}).` }
  }
  if (input.end_date && !input.date) {
    return { error: `Para un rango, mandá también \`date\` (inicio). \`end_date\` sola se ignora.` }
  }

  const { paidRange, periodLabel } = salesPaidRange(input)

  function toUsd(cents: number) {
    return (cents / 100).toFixed(2)
  }
  function avgTicket(collected: number, count: number) {
    return count > 0 ? (collected / count / 100).toFixed(2) : "0.00"
  }

  // ── Filtro/breakdown por payment_method ──
  // Antes el bot inventaba breakdown "cash" porque no tenía data real. Ahora
  // si user pide cash/card/stripe O pide desglose, vamos directo a sales+abonos
  // agrupando por método. paidStandaloneCents y abonos siguen las mismas reglas
  // de exclusión que getSalesBreakdown (no doble-conteo de sales con plan).
  if (input.payment_method || input.breakdown_by === "payment_method") {
    const scopeRepId = scopeRep(userId, role)
    const effectiveBrandId = input.scope === "all" ? null : brandId

    // Sales standalone PAID en el rango (excluir las que tienen plan → abonos las cubren)
    let salesQ = sb
      .from("sales")
      .select("id, amount_cents, payment_method, paid_at, brand_id")
      .eq("payment_status", "paid")
      .gte("paid_at", paidRange.startIso)
      .lt("paid_at", paidRange.endIso)
    if (effectiveBrandId) salesQ = salesQ.eq("brand_id", effectiveBrandId)
    if (scopeRepId) salesQ = salesQ.eq("rep_id", scopeRepId)
    if (input.payment_method) salesQ = salesQ.eq("payment_method", input.payment_method)
    const { data: salesData } = await salesQ
    const allSales = (salesData ?? []) as Array<{
      id: string; amount_cents: number; payment_method: string; paid_at: string; brand_id: string
    }>

    // Excluir sales con plan (los abonos cubren ese cobro)
    const saleIds = allSales.map((s) => s.id)
    let saleIdsWithPlan = new Set<string>()
    if (saleIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: plansData } = await (sb as any)
        .from("payment_plans")
        .select("sale_id")
        .in("sale_id", saleIds)
      saleIdsWithPlan = new Set(
        ((plansData ?? []) as Array<{ sale_id: string | null }>)
          .map((p) => p.sale_id)
          .filter((x): x is string => !!x),
      )
    }
    const standaloneSales = allSales.filter((s) => !saleIdsWithPlan.has(s.id))

    // Abonos en el rango (paid_at es date-only por convención del schema).
    // CRÍTICO: abonos NO tiene rep_id. Si es un rep, hay que restringir a los
    // planes de SUS sales (vía payment_plans.sale_id → sales.rep_id), sino el
    // rep vería los cobros de TODOS los reps. (admin/manager: scopeRepId null → sin filtro.)
    let repPlanIds: string[] | null = null
    if (scopeRepId) {
      let repSalesQ = sb.from("sales").select("id").eq("rep_id", scopeRepId)
      if (effectiveBrandId) repSalesQ = repSalesQ.eq("brand_id", effectiveBrandId)
      const { data: repSalesData } = await repSalesQ
      const repSaleIds = ((repSalesData ?? []) as Array<{ id: string }>).map((s) => s.id)
      if (repSaleIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: repPlans } = await (sb as any)
          .from("payment_plans")
          .select("id")
          .in("sale_id", repSaleIds)
        repPlanIds = ((repPlans ?? []) as Array<{ id: string }>).map((p) => p.id)
      } else {
        repPlanIds = []
      }
    }

    let allAbonos: Array<{
      amount_cents: number; payment_method: string; paid_at: string; brand_id: string
    }> = []
    // Si el rep no tiene planes, no hay abonos suyos → saltar la query.
    if (!scopeRepId || (repPlanIds && repPlanIds.length > 0)) {
      let abonosQ = sb
        .from("abonos")
        .select("amount_cents, payment_method, paid_at, brand_id, plan_id")
        .gte("paid_at", paidRange.startIso.slice(0, 10))
        .lt("paid_at", paidRange.endIso.slice(0, 10))
      if (effectiveBrandId) abonosQ = abonosQ.eq("brand_id", effectiveBrandId)
      if (input.payment_method) abonosQ = abonosQ.eq("payment_method", input.payment_method)
      if (repPlanIds) abonosQ = abonosQ.in("plan_id", repPlanIds)
      const { data: abonosData } = await abonosQ
      allAbonos = (abonosData ?? []) as Array<{
        amount_cents: number; payment_method: string; paid_at: string; brand_id: string
      }>
    }

    // Agrupar por método
    const byMethod = new Map<string, { count: number; collected_cents: number }>()
    for (const s of standaloneSales) {
      const m = s.payment_method ?? "unknown"
      const cur = byMethod.get(m) ?? { count: 0, collected_cents: 0 }
      cur.count++
      cur.collected_cents += s.amount_cents
      byMethod.set(m, cur)
    }
    for (const a of allAbonos) {
      const m = a.payment_method ?? "unknown"
      const cur = byMethod.get(m) ?? { count: 0, collected_cents: 0 }
      cur.count++
      cur.collected_cents += a.amount_cents
      byMethod.set(m, cur)
    }

    const totalCollected = Array.from(byMethod.values()).reduce(
      (s, v) => s + v.collected_cents, 0,
    )
    const totalCount = Array.from(byMethod.values()).reduce(
      (s, v) => s + v.count, 0,
    )

    return {
      period: periodLabel,
      scope: input.scope ?? "current",
      payment_method_filter: input.payment_method ?? null,
      total_collected_usd: toUsd(totalCollected),
      total_count: totalCount,
      by_payment_method: Array.from(byMethod.entries())
        .map(([method, v]) => ({
          method,
          count: v.count,
          total_collected_usd: toUsd(v.collected_cents),
        }))
        .sort((a, b) => parseFloat(b.total_collected_usd) - parseFloat(a.total_collected_usd)),
    }
  }

  if (input.scope === "all") {
    const { data: brandsData } = await sb
      .from("brands")
      .select("id, name")
      .eq("active", true)
      .order("name")
    const allBrands = brandsData ?? []

    const byBrand = await Promise.all(
      allBrands.map(async (b) => {
        const br = await getSalesBreakdown(sb, {
          brandId: b.id,
          repId: scopeRep(userId, role),
          paidRange,
        })
        return {
          brand_id: b.id,
          brand_name: b.name,
          paid_count: br.paidCount,
          pending_count: br.openCount,
          total_paid_usd: toUsd(br.collectedCents),
          total_pending_usd: toUsd(br.outstandingCents),
          avg_ticket_usd: avgTicket(br.collectedCents, br.paidCount),
        }
      }),
    )

    const totalPaid = byBrand.reduce(
      (s, b) => s + Math.round(parseFloat(b.total_paid_usd) * 100),
      0,
    )
    const totalPending = byBrand.reduce(
      (s, b) => s + Math.round(parseFloat(b.total_pending_usd) * 100),
      0,
    )
    const totalPaidCount = byBrand.reduce((s, b) => s + b.paid_count, 0)

    return {
      period: periodLabel,
      scope: "all",
      overall: {
        total_paid_usd: toUsd(totalPaid),
        total_pending_usd: toUsd(totalPending),
        paid_count: totalPaidCount,
        pending_count: byBrand.reduce((s, b) => s + b.pending_count, 0),
        avg_ticket_usd: avgTicket(totalPaid, totalPaidCount),
      },
      by_brand: byBrand,
    }
  }

  // scope === "current"
  const br = await getSalesBreakdown(sb, {
    brandId,
    repId: scopeRep(userId, role),
    paidRange,
  })
  return {
    period: periodLabel,
    scope: "current",
    total_paid_usd: toUsd(br.collectedCents),
    total_pending_usd: toUsd(br.outstandingCents),
    paid_count: br.paidCount,
    pending_count: br.openCount,
    avg_ticket_usd: avgTicket(br.collectedCents, br.paidCount),
  }
}

export async function executeGetCallsSummary(
  sb: DB,
  userId: string,
  brandId: string | null,
  input: GetCallsInput,
  role: string = "rep",
) {
  const { gte } = periodRange(input.period ?? "week")

  // Si filtran por source o piden group_by, resolvemos tracking_number_ids
  // contra la tabla tracking_numbers antes de query calls.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = sb as any
  let trackingIds: string[] | null = null
  let trackingMap: Map<string, string> = new Map()
  if (input.source || input.group_by_source) {
    let tnQ = sbAny.from("tracking_numbers").select("id, label, brand_id")
    if (input.scope !== "all" && brandId) tnQ = tnQ.eq("brand_id", brandId)
    if (input.source && input.source.trim()) {
      tnQ = tnQ.ilike("label", `%${input.source.trim()}%`)
    }
    const { data: tns } = await tnQ
    trackingMap = new Map(
      ((tns ?? []) as Array<{ id: string; label: string }>).map((t) => [t.id, t.label]),
    )
    if (input.source) {
      trackingIds = Array.from(trackingMap.keys())
      if (trackingIds.length === 0) {
        return {
          period: input.period ?? "week",
          scope: input.scope ?? "current",
          source_filter: input.source,
          total_calls: 0,
          connected: 0,
          connection_rate: "0%",
          avg_duration_seconds: 0,
          note: `No existe un tracking number con label que contenga "${input.source}". Tracking numbers disponibles: ver list_brands o usa group_by_source.`,
        }
      }
    }
  }

  const repFilter = scopeRep(userId, role)
  let query = sbAny
    .from("calls")
    .select("id, outcome, direction, duration_seconds, called_at, brand_id, tracking_number_id")
    .gte("called_at", gte)
    .order("called_at", { ascending: false })
    .limit(input.limit ?? 1000)

  if (input.scope !== "all" && brandId) query = query.eq("brand_id", brandId)
  if (repFilter) query = query.eq("rep_id", repFilter)
  if (trackingIds) query = query.in("tracking_number_id", trackingIds)

  const { data } = await query
  const rows = (data ?? []) as Array<{
    outcome: string | null
    duration_seconds: number | null
    tracking_number_id: string | null
  }>
  // "Conectada" = hubo conversación humana. No solo "connected": appointment_set,
  // callback_requested y not_interested también implican que atendieron.
  const CONNECTED_OUTCOMES = new Set(["connected", "appointment_set", "callback_requested", "not_interested"])
  const connected = rows.filter((r) => r.outcome != null && CONNECTED_OUTCOMES.has(r.outcome)).length
  const totalDuration = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0)

  const base = {
    period: input.period ?? "week",
    scope: input.scope ?? "current",
    total_calls: rows.length,
    connected,
    connection_rate: rows.length > 0 ? `${Math.round((connected / rows.length) * 100)}%` : "0%",
    avg_duration_seconds: rows.length > 0 ? Math.round(totalDuration / rows.length) : 0,
  }

  if (input.source) {
    return { ...base, source_filter: input.source }
  }

  if (input.group_by_source) {
    // Asegurarnos de tener TODOS los tracking_numbers para etiquetar (no solo los del source filter)
    if (trackingMap.size === 0 || input.source) {
      let tnQ2 = sbAny.from("tracking_numbers").select("id, label")
      if (input.scope !== "all" && brandId) tnQ2 = tnQ2.eq("brand_id", brandId)
      const { data: allTns } = await tnQ2
      trackingMap = new Map(
        ((allTns ?? []) as Array<{ id: string; label: string }>).map((t) => [t.id, t.label]),
      )
    }
    const grouped: Record<string, number> = {}
    let untagged = 0
    for (const r of rows) {
      const tnId = r.tracking_number_id
      if (!tnId) { untagged++; continue }
      const label = trackingMap.get(tnId) ?? `(tn:${tnId.slice(0, 8)})`
      grouped[label] = (grouped[label] ?? 0) + 1
    }
    return {
      ...base,
      by_source: grouped,
      untagged_calls: untagged,
    }
  }

  return base
}

export async function executeGetTasksOpen(
  sb: DB,
  userId: string,
  input: GetTasksInput,
  role: string = "rep",
) {
  const repFilter = scopeRep(userId, role)
  let query = sb
    .from("tasks")
    .select("id, title, priority, due_at, status, description")
    .eq("status", "open")
    .order("priority")
    .limit(input.limit ?? 10)

  if (repFilter) query = query.eq("assigned_to", repFilter)
  if (input.priority) query = query.eq("priority", input.priority as Database["public"]["Enums"]["task_priority"])

  const { data } = await query
  return data ?? []
}
