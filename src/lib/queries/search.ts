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

/**
 * Filtro de búsqueda de leads UNIFICADO para todos los buscadores (leads, citas,
 * ventas, llamadas, export, vincular externos, bot). Revisado con Fable.
 *
 * Reglas:
 * - Teléfono (>=7 dígitos) → busca en phone / phone_alt (en cualquier posición).
 * - Texto → CADA palabra debe aparecer (AND entre palabras: cada `.or()`
 *   encadenado se AND-ea en PostgREST). Cada palabra hace match por el INICIO de
 *   first_name / last_name (prefijo `tok%`, como autocompletar del teléfono), NO
 *   en medio. Así "Ma" → Maria/Mario/Manuel (no "Irma", "Holman", ni todos los
 *   "gmail"), y "navarrete maria" exige las dos. Máx 5 palabras.
 * - Email solo se busca si la palabra trae "@" (evita que "ma" matchee "gmail").
 * - Una palabra con dígitos (≥4) también busca en phone (parcial).
 *
 * Ojo (mejora futura): `ilike` NO ignora acentos — "maria" no matchea "María".
 * Se resolverá con la extensión `unaccent` + índice. Documentado en el vault.
 *
 * El query debe ser sobre la tabla `leads` (o una vista con esos campos).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyLeadSearch<T extends { or: (filter: string) => T }>(query: T, term: string | null | undefined): T {
  const raw = (term ?? "").trim()
  if (!raw) return query

  const digits = raw.replace(/\D/g, "")
  if (digits.length >= 7) {
    return query.or(`phone.ilike.%${digits}%,phone_alt.ilike.%${digits}%`)
  }

  const tokens = sanitizeOrSearch(raw).split(/\s+/).filter(Boolean).slice(0, 5)
  let q = query
  for (const tok of tokens) {
    // Prefijo: empieza-con, no contiene-en-medio.
    const parts = [`first_name.ilike.${tok}%`, `last_name.ilike.${tok}%`]
    if (tok.includes("@")) parts.push(`email.ilike.%${tok}%`)
    const tokDigits = tok.replace(/\D/g, "")
    if (tokDigits.length >= 4) parts.push(`phone.ilike.%${tokDigits}%`, `phone_alt.ilike.%${tokDigits}%`)
    q = q.or(parts.join(","))
  }
  return q
}
