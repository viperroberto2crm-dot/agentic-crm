/**
 * HERMES — Health checks.
 *
 * Cada check es independiente: corre una query, decide si hay anomalía,
 * devuelve 0+ Observation. El runner las persiste y dispara tools.
 *
 * Sprint 1 (4 checks core):
 *   1. check_calls_silence          — webhook 800.com sin actividad en horario laboral
 *   2. check_unlinked_calls         — calls con lead_id NULL pero phone matchea lead existente
 *   3. check_duplicate_calls        — varias rows con el mismo external_id (bug dedup)
 *   4. check_orphan_sales           — sales sin lead_id o sin brand_id (data inconsistency)
 *
 * Sprint 2+ se agregarán: kpi_anomaly, stale_alias, payment_status_mismatch, etc.
 */

import type { CheckContext, CheckDefinition, Observation } from "./types"
import { listCallsPage } from "@/lib/integrations/800com"

// ── Check 1: silencio de webhook 800.com ────────────────────────────────────
const CHECK_CALLS_SILENCE: CheckDefinition = {
  name: "calls_silence",
  description: "Detecta si el webhook 800.com no recibió calls en las últimas 2h en horario laboral (8am-7pm PT).",
  async run(ctx: CheckContext): Promise<Observation[]> {
    const ptHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        hour12: false,
      }).format(ctx.now),
      10,
    )
    // Solo aplicar el check en horario laboral PT (8am-7pm)
    if (ptHour < 8 || ptHour >= 19) return []

    const twoHoursAgo = new Date(ctx.now.getTime() - 2 * 60 * 60 * 1000).toISOString()
    const { count } = await ctx.sb
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("source", "800com")
      .gte("called_at", twoHoursAgo)

    const callCount = count ?? 0
    if (callCount === 0) {
      return [
        {
          check_type: "calls_silence",
          severity: "critical",
          summary: `Sin llamadas 800.com en últimas 2h (horario laboral PT). Webhook puede estar caído.`,
          details: {
            window_hours: 2,
            calls_received: 0,
            pt_hour: ptHour,
            since: twoHoursAgo,
          },
          // No hay auto-fix — requiere ojos humanos sobre Vercel logs + 800.com admin
          suggested_tool: undefined,
          auto_resolve: false,
        },
      ]
    }
    return []
  },
}

// ── Check 2: calls sin lead pero phone matchea lead existente ───────────────
const CHECK_UNLINKED_CALLS: CheckDefinition = {
  name: "unlinked_calls",
  description: "Calls con lead_id NULL cuyo caller phone matchea un lead existente en la misma brand. Auto-fix linkea.",
  async run(ctx: CheckContext): Promise<Observation[]> {
    // Query: calls con lead_id NULL en últimas 24h (no atacar history viejo en cada tick)
    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const { data: unlinkedCalls } = await ctx.sb
      .from("calls")
      .select("id, brand_id, called_at, external_id")
      .is("lead_id", null)
      .gte("called_at", since)
      .limit(200)

    const calls = (unlinkedCalls ?? []) as Array<{
      id: string
      brand_id: string
      called_at: string
      external_id: string | null
    }>
    if (calls.length === 0) return []

    // No hacemos el match aquí — eso es trabajo del tool. El check solo
    // detecta el síntoma y deja que el tool decida cuáles realmente linkean.
    return [
      {
        check_type: "unlinked_calls",
        severity: "warning",
        summary: `${calls.length} calls sin lead_id en últimas 24h. Hermes intentará auto-linkear por phone.`,
        details: {
          calls_without_lead: calls.length,
          window_hours: 24,
          sample_call_ids: calls.slice(0, 5).map((c) => c.id),
        },
        suggested_tool: "auto_link_calls_to_leads",
        auto_resolve: true,
      },
    ]
  },
}

// ── Check 3: calls duplicadas por external_id ───────────────────────────────
const CHECK_DUPLICATE_CALLS: CheckDefinition = {
  name: "duplicate_calls",
  description: "Detecta calls con mismo external_id+source (bug de dedup conocido del webhook 800.com).",
  async run(ctx: CheckContext): Promise<Observation[]> {
    // SQL para encontrar duplicados — usamos RPC genérico o query directo.
    // Como no hay RPC custom, hacemos query con agrupado del lado cliente (limitado).
    const since = new Date(ctx.now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentCalls } = await ctx.sb
      .from("calls")
      .select("id, external_id, source, called_at")
      .not("external_id", "is", null)
      .gte("called_at", since)
      .order("called_at", { ascending: false })
      .limit(5000)

    const calls = (recentCalls ?? []) as Array<{
      id: string
      external_id: string | null
      source: string | null
      called_at: string
    }>

    // Agrupar por (external_id, source) y encontrar grupos con count > 1
    const groups = new Map<string, string[]>()
    for (const c of calls) {
      if (!c.external_id || !c.source) continue
      const key = `${c.source}:${c.external_id}`
      const arr = groups.get(key) ?? []
      arr.push(c.id)
      groups.set(key, arr)
    }

    const dupes: Array<{ key: string; ids: string[] }> = []
    for (const [key, ids] of groups.entries()) {
      if (ids.length > 1) dupes.push({ key, ids })
    }
    if (dupes.length === 0) return []

    return [
      {
        check_type: "duplicate_calls",
        severity: "warning",
        summary: `${dupes.length} grupos de calls duplicadas detectadas en últimos 7 días (total filas extra: ${dupes.reduce((s, d) => s + d.ids.length - 1, 0)}).`,
        details: {
          duplicate_groups: dupes.length,
          extra_rows: dupes.reduce((s, d) => s + d.ids.length - 1, 0),
          sample: dupes.slice(0, 5),
          window_days: 7,
          recommended_action:
            "Agregar UNIQUE INDEX en calls(external_id, source) y borrar filas extras (mantener la más vieja por external_id).",
        },
        // Auto-borrar duplicados es destructivo — siempre escalar
        suggested_tool: undefined,
        auto_resolve: false,
      },
    ]
  },
}

// ── Check 4: sales huérfanas (sin lead o sin brand) ─────────────────────────
const CHECK_ORPHAN_SALES: CheckDefinition = {
  name: "orphan_sales",
  description: "Sales sin lead_id o sin brand_id. Casi siempre es bug de data import o webhook.",
  async run(ctx: CheckContext): Promise<Observation[]> {
    const since = new Date(ctx.now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (ctx.sb as any)
      .from("sales")
      .select("id, lead_id, brand_id, created_at, amount_cents")
      .or("lead_id.is.null,brand_id.is.null")
      .gte("created_at", since)
      .limit(100)
    const orphans = (rows ?? []) as Array<{
      id: string
      lead_id: string | null
      brand_id: string | null
      created_at: string
      amount_cents: number
    }>
    if (orphans.length === 0) return []
    return [
      {
        check_type: "orphan_sales",
        severity: "warning",
        summary: `${orphans.length} sales sin lead_id o brand_id en últimos 30 días.`,
        details: {
          orphans_count: orphans.length,
          total_amount_cents: orphans.reduce((s, o) => s + o.amount_cents, 0),
          missing_lead: orphans.filter((o) => o.lead_id == null).length,
          missing_brand: orphans.filter((o) => o.brand_id == null).length,
          sample_ids: orphans.slice(0, 10).map((o) => o.id),
        },
        suggested_tool: undefined,
        auto_resolve: false,
      },
    ]
  },
}

// ── Check 5: números de 800.com recibiendo llamadas pero SIN registrar ──────
// Raíz del incidente La Esperanza (2026-07-02): un número que NO está en
// tracking_numbers hace que resolveTracking devuelva null → el webhook
// descarta la llamada en silencio (200 OK, sin insertar). Así se perdieron
// llamadas de Mailers/Banners durante semanas sin que nadie se enterara.
// Este check compara los números que RECIBEN llamadas entrantes en 800.com
// contra los registrados y alerta si alguno se está perdiendo, para que el
// admin lo registre antes de perder más leads.
const CHECK_UNREGISTERED_NUMBERS: CheckDefinition = {
  name: "unregistered_numbers",
  description:
    "Detecta números de 800.com que reciben llamadas entrantes pero NO están registrados (activos) en tracking_numbers — sus llamadas se descartan en silencio.",
  async run(ctx: CheckContext): Promise<Observation[]> {
    // Sin credenciales de 800.com no podemos consultar la API — no romper el tick.
    const apiKey = process.env.EIGHTHUNDRED_API_KEY
    const companyIdRaw = process.env.EIGHTHUNDRED_COMPANY_ID
    if (!apiKey || !companyIdRaw) return []
    const companyId = parseInt(companyIdRaw, 10)
    if (Number.isNaN(companyId)) return []

    // 1) number_ids CONOCIDOS: todos los de tracking_numbers, activos o no.
    //    Un número desactivado a propósito (active=false, ej. los "Buses"/"Radio"
    //    marcados como duplicados de Billboard) es una decisión intencional de
    //    NO capturar → no debe disparar alerta si le entra una llamada suelta.
    //    Solo alertamos por números TOTALMENTE ausentes del registro (el caso
    //    real de Mailers/Banners: nunca registrados → llamadas perdidas).
    // tracking_numbers no está en los tipos generados — cast puntual, mismo
    // patrón que 800com.ts y tracking-numbers-actions.ts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tnRows } = await (ctx.sb as any)
      .from("tracking_numbers")
      .select("provider_metadata")
      .eq("provider", "800com")
    const known = new Set<number>()
    for (const r of (tnRows ?? []) as Array<{
      provider_metadata: { number_id?: number } | null
    }>) {
      const nid = r.provider_metadata?.number_id
      if (typeof nid === "number") known.add(nid)
    }

    // 2) Números con llamadas ENTRANTES en las últimas 24h. Cap bajo de páginas
    //    para mantener el tick liviano (máx ~300 calls / 3 páginas).
    const endDate = ctx.now.toISOString()
    const startDate = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const called = new Map<number, { phone: string; label: string | null; count: number }>()
    let cursor: string | undefined
    let pages = 0
    const MAX_PAGES = 3
    try {
      while (pages < MAX_PAGES) {
        const page = await listCallsPage({ companyId, startDate, endDate, perPage: 100, cursor })
        pages++
        for (const call of page.data) {
          if (call.direction === "outbound") continue // solo entrantes
          const nid = call.number?.id
          if (typeof nid !== "number") continue
          const prev = called.get(nid)
          if (prev) prev.count++
          else
            called.set(nid, {
              phone: call.number?.number ?? "",
              label: call.number?.label ?? null,
              count: 1,
            })
        }
        const next = page.meta?.nextCursor
        if (!next) break
        cursor = next
      }
    } catch {
      // Si 800.com falla, no rompemos el tick; simplemente no observamos.
      return []
    }

    // 3) Números con llamadas pero totalmente ausentes del registro → se están
    //    descartando en silencio (webhook resolveTracking devuelve null).
    const missing = [...called.entries()].filter(([nid]) => !known.has(nid))
    if (missing.length === 0) return []

    const totalLost = missing.reduce((s, [, v]) => s + v.count, 0)
    return [
      {
        check_type: "unregistered_numbers",
        severity: "critical",
        summary: `${missing.length} número(s) de 800.com reciben llamadas pero NO están registrados en tracking_numbers — ${totalLost} llamada(s) en 24h se están descartando en silencio. Regístralos por marca.`,
        details: {
          window_hours: 24,
          missing_numbers: missing.map(([nid, v]) => ({
            number_id: nid,
            phone: v.phone,
            label: v.label,
            calls_24h: v.count,
          })),
        },
        // Sin auto-fix: registrar un número requiere decidir a qué MARCA
        // pertenece (decisión humana). Se escala al admin.
        suggested_tool: undefined,
        auto_resolve: false,
      },
    ]
  },
}

export const CHECKS: CheckDefinition[] = [
  CHECK_CALLS_SILENCE,
  CHECK_UNLINKED_CALLS,
  CHECK_DUPLICATE_CALLS,
  CHECK_ORPHAN_SALES,
  CHECK_UNREGISTERED_NUMBERS,
]
