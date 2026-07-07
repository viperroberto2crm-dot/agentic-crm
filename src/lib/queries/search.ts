/**
 * Escapa comodines LIKE/ILIKE (`\`, `%`, `_`) para tratar el valor como literal
 * dentro de `.ilike(col, pattern)`. Mismo patrón que los webhooks de pagos
 * (square/stripe). Preserva el match exacto — NO elimina caracteres — por lo
 * que es seguro para dedup por email/teléfono.
 */
export function escapeIlike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1")
}

/**
 * Sanitiza un término de búsqueda libre que se interpola dentro de un filtro
 * PostgREST `.or(...)`. Elimina paréntesis y comas (rompen la sintaxis del `or`
 * y permitirían inyectar condiciones) y el comodín `%`. Mismo criterio que
 * executeGetLeads en lib/agent/tools.ts.
 */
export function sanitizeOrSearch(value: string): string {
  return value.replace(/[(),]/g, " ").replace(/%/g, "").trim()
}
