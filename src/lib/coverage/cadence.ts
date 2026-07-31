/**
 * Cadencias de plan → días de cobertura. Mismo criterio que `products.cadence`
 * y el CADENCE_DAYS de settings/actions.ts. Se usa para calcular "cubierto
 * hasta" (fecha de pago + días del plan) en la cobertura de prepago.
 */

export type Cadence = "one_time" | "weekly" | "monthly" | "quarterly" | "annual"

export const CADENCE_DAYS: Record<Cadence, number> = {
  one_time: 0,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  annual: 365,
}

/** Normaliza un string de cadencia (es/en) a la llave canónica, o null. */
export function normalizeCadence(value: string | null | undefined): Cadence | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  if (v in CADENCE_DAYS) return v as Cadence
  return null
}

/** Días que cubre una cadencia. null si no aplica (one_time = 0 cubre 0 días). */
export function cadenceDays(cadence: string | null | undefined): number | null {
  const c = normalizeCadence(cadence)
  if (!c) return null
  return CADENCE_DAYS[c]
}

/**
 * Intenta deducir la cadencia de un texto libre (descripción/nota del pago),
 * ej. "Membresía Mensual", "GLP semanal", "Plan trimestral". Fallback cuando el
 * pago no tiene un precio mapeado. Devuelve la llave canónica o null.
 */
export function parseCadence(text: string | null | undefined): Cadence | null {
  if (!text) return null
  const t = text.toLowerCase()
  // Patrones ANCLADOS por límite de palabra (evita "Añorve", "Semana Santa").
  const matched = new Set<Cadence>()
  if (/\b(trimestral|trimestre|quarterly|3\s*meses)\b/.test(t)) matched.add("quarterly")
  if (/\b(anual|annual|yearly|a[nñ]os?)\b/.test(t)) matched.add("annual")
  if (/\b(mensual|monthly|mes(?:es)?)\b/.test(t)) matched.add("monthly")
  if (/\b(semanal|weekly|semanas?)\b/.test(t)) matched.add("weekly")
  if (/\b(pago\s*[úu]nico|one[-\s]?time|single)\b/.test(t)) matched.add("one_time")
  // Ambiguo (ej. "Plan Mensual pago semanal") → null → se marca "por confirmar",
  // NUNCA se adivina el más largo (evita falso verde). Fable #2.
  if (matched.size !== 1) return null
  return [...matched][0]
}
