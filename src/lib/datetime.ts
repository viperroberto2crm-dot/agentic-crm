/**
 * Timezone de la operación (oficina/clínicas). Ambas marcas (Si Se Pierde y
 * Sunny Slim) operan en California → Pacific Time. Server runs en UTC; sin
 * esto las horas se ven 7-8h corridas cuando renderiza el server.
 *
 * Si el negocio se expande a otro timezone hay que volver a esto.
 */
export const BRAND_TIMEZONE = "America/Los_Angeles"

const DEFAULT_LOCALE = "en-US"

/**
 * Parsea una fecha de la BD de forma robusta. `new Date()` de JS NO parsea
 * algunos formatos que devuelve Postgres/Supabase para timestamptz —
 * p.ej. "2026-07-02T18:32:57.284285+00" (microsegundos de 6 dígitos y offset
 * corto "+00") → Invalid Date. Y `Intl.DateTimeFormat().format(InvalidDate)`
 * LANZA "Invalid time value", tumbando la página completa en el server.
 *
 * Estrategia: intenta parsear directo; si falla, normaliza (separador espacio→T,
 * microsegundos→milisegundos, offset "+00"→"+00:00") y reintenta. Si aún falla,
 * devuelve null y el caller muestra un fallback — NUNCA lanza.
 */
function parseDbDate(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined || iso === "") return null
  const direct = new Date(iso)
  if (!Number.isNaN(direct.getTime())) return direct

  let s = String(iso).replace(" ", "T")
  // microsegundos (4+ dígitos de fracción) → milisegundos (3)
  s = s.replace(/(\.\d{3})\d+/, "$1")
  // offset corto "+00"/"-05" (sin minutos) → "+00:00"/"-05:00"
  s = s.replace(/([+-]\d{2})$/, "$1:00")
  const norm = new Date(s)
  return Number.isNaN(norm.getTime()) ? null : norm
}

export function formatApptDateTime(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = parseDbDate(iso)
  if (!d) return "—"
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(d)
}

export function formatTime(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = parseDbDate(iso)
  if (!d) return "—"
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(d)
}

export function formatDate(iso: string, locale: string = DEFAULT_LOCALE): string {
  const d = parseDbDate(iso)
  if (!d) return "—"
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: BRAND_TIMEZONE,
  }).format(d)
}
