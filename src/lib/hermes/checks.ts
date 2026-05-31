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

export const CHECKS: CheckDefinition[] = [
  CHECK_CALLS_SILENCE,
  CHECK_UNLINKED_CALLS,
  CHECK_DUPLICATE_CALLS,
  CHECK_ORPHAN_SALES,
]
