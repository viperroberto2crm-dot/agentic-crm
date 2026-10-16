/**
 * Lógica pura del informe de llamadas por campaña (sin acceso a BD ni a red).
 * Se prueba con `node --test tests/call-report-core.test.mjs`.
 *
 * Definiciones (acordadas con el informe armado a mano de 800.com):
 * - Contestada: outcome ∈ ANSWERED_OUTCOMES. El CRM sobrescribe "connected" con
 *   resultados propios (cita, callback…), que también implican que alguien habló.
 * - Colgó antes: cualquier otra cosa (null, no_answer, voicemail). NO se usa la
 *   duración: en 800.com las "abandonadas" traen 4–22 s de timbre y outcome null.
 * - Persona: teléfono distinto (caller_e164). Los teléfonos del equipo no cuentan.
 */

export type CallRow = {
  called_at: string
  dialed_e164: string
  caller_e164: string | null
  outcome: string | null
  duration_seconds: number | null
  lead_name?: string | null
  lead_status?: string | null
}

const ANSWERED_OUTCOMES = new Set([
  "connected",
  "appointment_set",
  "callback_requested",
  "not_interested",
  "wrong_number",
])

export function classifyCall(c: {
  outcome?: string | null
  duration_seconds?: number | null
}): "answered" | "hung_up" {
  return c.outcome && ANSWERED_OUTCOMES.has(c.outcome) ? "answered" : "hung_up"
}

/** "YYYY-MM" del instante `iso` en la zona horaria dada. */
export function monthKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}`
}

export type SummaryRow = {
  number: string
  month: string
  calls: number
  answered: number
  hungUp: number
  people: number
  internalPhones: number
  avgAnsweredSeconds: number | null
}

type Opts = { timeZone: string; teamPhones: ReadonlySet<string> }

export function summarize(rows: CallRow[], { timeZone, teamPhones }: Opts): SummaryRow[] {
  type Acc = {
    number: string
    month: string
    calls: number
    answered: number
    people: Set<string>
    internal: Set<string>
    secs: number[]
  }
  const groups = new Map<string, Acc>()
  for (const r of rows) {
    const month = monthKey(r.called_at, timeZone)
    const key = `${r.dialed_e164}|${month}`
    let g = groups.get(key)
    if (!g) {
      g = { number: r.dialed_e164, month, calls: 0, answered: 0, people: new Set(), internal: new Set(), secs: [] }
      groups.set(key, g)
    }
    g.calls++
    if (classifyCall(r) === "answered") {
      g.answered++
      if ((r.duration_seconds ?? 0) > 0) g.secs.push(r.duration_seconds as number)
    }
    const phone = r.caller_e164 ?? "(sin número)"
    if (teamPhones.has(phone)) g.internal.add(phone)
    else g.people.add(phone)
  }
  return [...groups.values()]
    .sort((a, b) => (a.number + a.month).localeCompare(b.number + b.month))
    .map((g) => ({
      number: g.number,
      month: g.month,
      calls: g.calls,
      answered: g.answered,
      hungUp: g.calls - g.answered,
      people: g.people.size,
      internalPhones: g.internal.size,
      avgAnsweredSeconds: g.secs.length ? Math.round(g.secs.reduce((a, b) => a + b, 0) / g.secs.length) : null,
    }))
}

export type PersonRow = {
  phone: string
  name: string
  calls: number
  answered: number
  status: string | null
  internal: boolean
}

export function listPeople(rows: CallRow[], { teamPhones }: { teamPhones: ReadonlySet<string> }): PersonRow[] {
  const byPhone = new Map<string, PersonRow>()
  for (const r of rows) {
    const phone = r.caller_e164 ?? "(sin número)"
    let p = byPhone.get(phone)
    if (!p) {
      p = { phone, name: r.lead_name ?? "", calls: 0, answered: 0, status: r.lead_status ?? null, internal: teamPhones.has(phone) }
      byPhone.set(phone, p)
    }
    p.calls++
    if (classifyCall(r) === "answered") p.answered++
    if (!p.name && r.lead_name) p.name = r.lead_name
    if (!p.status && r.lead_status) p.status = r.lead_status
  }
  return [...byPhone.values()]
}

export type RetellCall = { startMs: number; durationSeconds: number }
export type HungUpKind = "never_reached" | "redialed_talked" | "reached_hung_up"

/**
 * ¿Qué pasó con una llamada que colgó antes de contestar?
 * `retellCalls` son las llamadas de Retell a la línea de desvío de ese número.
 * Retell no trae el teléfono del cliente (llega el del tracking), así que el
 * cruce es solo por hora.
 */
export function classifyHungUp(
  hungAtMs: number,
  retellCalls: RetellCall[],
  { windowMs, minTalkSeconds }: { windowMs: number; minTalkSeconds: number },
): HungUpKind {
  const near = retellCalls.filter(
    (r) => r.startMs >= hungAtMs - 60_000 && r.startMs <= hungAtMs + windowMs,
  )
  if (near.some((r) => r.durationSeconds >= minTalkSeconds)) return "redialed_talked"
  if (near.length > 0) return "reached_hung_up"
  return "never_reached"
}

/**
 * Quita de `retellCalls` las llamadas que ya corresponden a una llamada
 * CONTESTADA de 800.com (las contestadas también aparecen en Retell). Cada
 * contestada se lleva la llamada de Retell más cercana dentro de la tolerancia.
 */
export function consumeAnswered(
  answeredAtMs: number[],
  retellCalls: RetellCall[],
  toleranceMs = 120_000,
): RetellCall[] {
  const left = [...retellCalls]
  for (const at of [...answeredAtMs].sort((a, b) => a - b)) {
    let best = -1
    let bestGap = Infinity
    left.forEach((r, i) => {
      const gap = Math.abs(r.startMs - at)
      if (gap <= toleranceMs && gap < bestGap) {
        best = i
        bestGap = gap
      }
    })
    if (best >= 0) left.splice(best, 1)
  }
  return left
}

/**
 * Qué pasó con una llamada que colgó antes de contestar.
 * 1) Si el mismo teléfono volvió a llamar y esa llamada sí se contestó → volvió y habló.
 * 2) Si no, y sobra una llamada de Retell cerca (que no es de una contestada) → llegó al agente y colgó.
 * 3) Si no → nunca llegó al agente.
 */
export function hungUpOutcome(
  hungAtMs: number,
  redialedAndAnswered: boolean,
  retellLeft: RetellCall[],
  win: { windowMs: number; minTalkSeconds: number },
): HungUpKind {
  if (redialedAndAnswered) return "redialed_talked"
  const k = classifyHungUp(hungAtMs, retellLeft, win)
  return k === "redialed_talked" ? "reached_hung_up" : k
}
