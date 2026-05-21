/**
 * Timezone de la operación (oficina/clínicas). Ambas marcas (Si Se Pierde y
 * Sunny Slim) operan en California → Pacific Time. Server runs en UTC; sin
 * esto las horas se ven 7-8h corridas cuando renderiza el server.
 *
 * Si el negocio se expande a otro timezone hay que volver a esto.
 */
export const BRAND_TIMEZONE = "America/Los_Angeles"

const DEFAULT_LOCALE = "en-US"

export function formatApptDateTime(iso: string, locale: string = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(new Date(iso))
}

export function formatTime(iso: string, locale: string = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BRAND_TIMEZONE,
  }).format(new Date(iso))
}

export function formatDate(iso: string, locale: string = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: BRAND_TIMEZONE,
  }).format(new Date(iso))
}
