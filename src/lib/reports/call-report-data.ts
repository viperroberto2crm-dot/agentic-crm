import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { BRAND_TIMEZONE } from "@/lib/datetime"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { isClinicNumber } from "@/lib/voice/clinic-numbers"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  consumeAnswered,
  hungUpOutcome,
  listPeople,
  monthKey,
  summarize,
  classifyCall,
  type CallRow,
  type HungUpKind,
  type PersonRow,
  type SummaryRow,
} from "./call-report-core"
import { BROCHURE_RETELL_LINES, fetchRetellCallsByLine } from "./retell-calls"

type SB = SupabaseClient<Database>

/**
 * Teléfonos del equipo que aparecen como "cliente" en las llamadas (porque son
 * destinos de desvío o pruebas). Se suman a users.cell_phone y a la lista de la
 * clínica/bots. Verificado en 800.com el 2026-10-16.
 */
const STAFF_PHONES = [
  "+16572320227", // línea La Esperanza
  "+15622983012", // Andreína (call center)
  "+15625100684", // Charles
  "+14243705408", // Kenny (call center)
  "+13236808475", // Honorina
  "+13108776885", // Will Gibbons
  "+17149260731", // Roberto (prueba)
]

export type HungUpDetail = {
  atIso: string
  phone: string
  name: string
  kind: HungUpKind | null
}

export type NumberMonth = {
  month: string
  summary: SummaryRow
  people: PersonRow[]
  hungUp: HungUpDetail[]
}

export type NumberReport = {
  number: string
  label: string
  campaign: string | null
  months: NumberMonth[]
}

export type CallReport = {
  /** Todos los números de la marca (para el filtro), con o sin llamadas. */
  available: { number: string; label: string }[]
  numbers: NumberReport[]
  retell: { ok: true } | { ok: false; reason: string } | { ok: false; reason: "n/a" }
}

type CallQueryRow = {
  called_at: string
  dialed_e164: string | null
  caller_e164: string | null
  outcome: string | null
  duration_seconds: number | null
  lead: { first_name: string | null; last_name: string | null; status: string | null } | null
}

const PAGE = 1000

async function fetchCalls(sb: SB, numbers: string[], startIso: string, endIso: string): Promise<CallRow[]> {
  const out: CallRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("calls")
      .select(
        "called_at, dialed_e164, caller_e164, outcome, duration_seconds, lead:leads!calls_lead_id_fkey(first_name, last_name, status)",
      )
      .in("dialed_e164", numbers)
      .eq("direction", "inbound")
      .gte("called_at", startIso)
      .lt("called_at", endIso)
      .order("called_at", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`No se pudieron leer las llamadas: ${error.message}`)
    const rows = (data ?? []) as unknown as CallQueryRow[]
    for (const r of rows) {
      if (!r.dialed_e164) continue
      const name = [r.lead?.first_name, r.lead?.last_name].filter(Boolean).join(" ").trim()
      out.push({
        called_at: r.called_at,
        dialed_e164: r.dialed_e164,
        caller_e164: r.caller_e164,
        outcome: r.outcome,
        duration_seconds: r.duration_seconds,
        lead_name: name || null,
        lead_status: r.lead?.status ?? null,
      })
    }
    if (rows.length < PAGE) break
  }
  return out
}

async function loadTeamPhones(): Promise<Set<string>> {
  const set = new Set<string>(STAFF_PHONES)
  // Con la sesión (RLS) un manager solo ve su propia fila de users; para tener los
  // celulares de TODO el equipo se lee con el cliente admin (solo teléfonos, no se muestran).
  const { data } = await createAdminClient().from("users").select("cell_phone")
  for (const u of (data ?? []) as { cell_phone: string | null }[]) {
    const e164 = u.cell_phone ? normalizeToE164(u.cell_phone) : ""
    if (e164) set.add(e164)
  }
  return set
}

/**
 * Informe de llamadas entrantes por número de tracking y mes.
 * `sb` debe ser el cliente de sesión (RLS). `brandId` null = todas las marcas
 * (solo admin; el caller ya lo validó con resolveEffectiveBrandId).
 */
export async function loadCallReport(
  sb: SB,
  opts: { brandId: string | null; startIso: string; endIso: string; numbers?: string[] },
): Promise<CallReport> {
  let tq = sb.from("tracking_numbers").select("phone_e164, label, campaign, brand_id, provider")
  if (opts.brandId) tq = tq.eq("brand_id", opts.brandId)
  const { data: tnData, error: tnErr } = await tq
  if (tnErr) throw new Error(`No se pudieron leer los números: ${tnErr.message}`)
  const allTracking = (tnData ?? []) as { phone_e164: string; label: string; campaign: string | null }[]
  const available = allTracking.map((t) => ({ number: t.phone_e164, label: t.label }))
  const tracking = allTracking.filter((t) => !opts.numbers || opts.numbers.length === 0 || opts.numbers.includes(t.phone_e164))
  if (tracking.length === 0) return { available, numbers: [], retell: { ok: false, reason: "n/a" } }

  const calls = await fetchCalls(sb, tracking.map((t) => t.phone_e164), opts.startIso, opts.endIso)

  // Equipo: lista fija + cell_phone de usuarios + números de la clínica/bots.
  const team = await loadTeamPhones()
  for (const c of calls) {
    if (c.caller_e164 && isClinicNumber(c.caller_e164)) team.add(c.caller_e164)
  }

  // Cruce con Retell solo para los números con línea de desvío conocida.
  const mapped = tracking.map((t) => t.phone_e164).filter((n) => BROCHURE_RETELL_LINES[n])
  let retell: CallReport["retell"] = { ok: false, reason: "n/a" }
  let retellByLine = new Map<string, { startMs: number; durationSeconds: number }[]>()
  if (mapped.length > 0) {
    const r = await fetchRetellCallsByLine(
      mapped.map((n) => BROCHURE_RETELL_LINES[n]),
      Date.parse(opts.startIso),
      Date.parse(opts.endIso),
    )
    if (r.ok) {
      retell = { ok: true }
      retellByLine = r.byLine
    } else {
      retell = { ok: false, reason: r.reason }
    }
  }

  const numbers: NumberReport[] = tracking.map((t) => {
    const rows = calls.filter((c) => c.dialed_e164 === t.phone_e164)
    const summaries = summarize(rows, { timeZone: BRAND_TIMEZONE, teamPhones: team })
    const months: NumberMonth[] = summaries.map((summary) => {
      const monthRows = rows.filter((c) => monthKey(c.called_at, BRAND_TIMEZONE) === summary.month)
      const line = BROCHURE_RETELL_LINES[t.phone_e164]
      const lineCalls = line ? retellByLine.get(line) ?? [] : []
      const answeredMs = monthRows.filter((c) => classifyCall(c) === "answered").map((c) => Date.parse(c.called_at))
      const retellLeft = consumeAnswered(answeredMs, lineCalls)
      const hungUp: HungUpDetail[] = monthRows
        .filter((c) => classifyCall(c) === "hung_up")
        .map((c) => {
          const at = Date.parse(c.called_at)
          // ¿El mismo teléfono volvió a llamar a este número y sí contestaron (≤10 min)?
          const redialed = monthRows.some(
            (o) =>
              o !== c &&
              o.caller_e164 === c.caller_e164 &&
              classifyCall(o) === "answered" &&
              Date.parse(o.called_at) > at &&
              Date.parse(o.called_at) - at <= 10 * 60 * 1000,
          )
          return {
            atIso: c.called_at,
            phone: c.caller_e164 ?? "(sin número)",
            name: c.lead_name ?? "",
            kind: line && (retell.ok || redialed)
              ? hungUpOutcome(at, redialed, retell.ok ? retellLeft : [], { windowMs: 6 * 60 * 1000, minTalkSeconds: 10 })
              : null,
          }
        })
      return { month: summary.month, summary, people: listPeople(monthRows, { teamPhones: team }), hungUp }
    })
    return { number: t.phone_e164, label: t.label, campaign: t.campaign, months }
  })

  return { available, numbers: numbers.filter((n) => n.months.length > 0), retell }
}
