import type { RetellCall } from "./call-report-core"

/**
 * Línea de desvío (la que recibe 800.com) de cada número del brochure.
 * Retell solo ve la llamada cuando 800.com ya conectó hacia esta línea; el "to"
 * que guarda Retell es la línea de desvío, no el número que marcó el cliente.
 * Verificado en 800.com > Number Management (2026-10-16).
 */
export const BROCHURE_RETELL_LINES: Record<string, string> = {
  "+17144672002": "+17148554767", // Botox → Lucía
  "+18888808743": "+17143644244", // IV → María
  "+18882073743": "+17147101622", // GLP → Sofía
}

type RetellApiCall = {
  to_number?: string | null
  start_timestamp?: number | null
  duration_ms?: number | null
}

export type RetellResult =
  | { ok: true; byLine: Map<string, RetellCall[]> }
  | { ok: false; reason: string }

const MAX_PAGES = 5

/**
 * Llamadas de Retell entre `startMs` y `endMs`, agrupadas por línea de desvío.
 * Nunca lanza: si falta la llave o Retell falla, devuelve { ok:false } y el
 * informe oculta esa sección.
 */
export async function fetchRetellCallsByLine(
  lines: string[],
  startMs: number,
  endMs: number,
): Promise<RetellResult> {
  const key = process.env.RETELL_API_KEY
  if (!key) return { ok: false, reason: "Falta RETELL_API_KEY" }

  const wanted = new Set(lines)
  const byLine = new Map<string, RetellCall[]>()
  let paginationKey: string | undefined

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch("https://api.retellai.com/v2/list-calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: 1000,
          sort_order: "descending",
          ...(paginationKey ? { pagination_key: paginationKey } : {}),
        }),
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      })
      if (!res.ok) return { ok: false, reason: `Retell respondió ${res.status}` }
      const batch = (await res.json()) as (RetellApiCall & { call_id?: string })[]
      if (!Array.isArray(batch) || batch.length === 0) break

      let reachedOlder = false
      for (const c of batch) {
        const start = c.start_timestamp ?? 0
        if (start && start < startMs) reachedOlder = true
        if (!start || start < startMs || start > endMs) continue
        if (!c.to_number || !wanted.has(c.to_number)) continue
        const list = byLine.get(c.to_number) ?? []
        list.push({ startMs: start, durationSeconds: Math.round((c.duration_ms ?? 0) / 1000) })
        byLine.set(c.to_number, list)
      }
      if (reachedOlder || batch.length < 1000) break
      paginationKey = (batch[batch.length - 1] as { call_id?: string }).call_id
      if (!paginationKey) break
    }
    return { ok: true, byLine }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Error consultando Retell" }
  }
}
