import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type SB = SupabaseClient<Database>

/**
 * Marcas EXCLUIDAS del intake en clínica.
 * - 'horizon' es la marca paraguas (holding), no una clínica que reciba pacientes.
 * - 'horizon-wound-care' se excluye por decisión de alcance (2026-07-08).
 *
 * Regla de elegibilidad: brand.active = true AND slug NOT IN (estos slugs).
 * En la práctica esto deja: si-se-pierde, sunny-slim, la-esperanza.
 * (george-dr-dang ya está fuera porque active=false.)
 *
 * NO hardcodear la lista de elegibles: se resuelve dinámicamente contra la BD
 * usando este predicado de exclusión.
 */
export const INELIGIBLE_INTAKE_SLUGS = ["horizon", "horizon-wound-care"] as const

export type EligibleBrand = {
  id: string
  slug: string
  name: string
  brand_color: string | null
}

// Filtro PostgREST `not in (...)` — los slugs con guiones son válidos sin comillas.
const NOT_IN_FILTER = `(${INELIGIBLE_INTAKE_SLUGS.join(",")})`

/** ¿El slug es elegible para intake? (regla en memoria, sin tocar BD). */
export function isEligibleIntakeSlug(slug: string): boolean {
  return !INELIGIBLE_INTAKE_SLUGS.includes(slug as (typeof INELIGIBLE_INTAKE_SLUGS)[number])
}

/**
 * Lista TODAS las marcas elegibles para intake (active = true AND slug no excluido),
 * ordenadas por nombre. Usa el cliente que se le pase (sesión o admin).
 */
export async function listEligibleIntakeBrands(sb: SB): Promise<EligibleBrand[]> {
  const { data, error } = await sb
    .from("brands")
    .select("id, slug, name, brand_color")
    .eq("active", true)
    .not("slug", "in", NOT_IN_FILTER)
    .order("name", { ascending: true })

  if (error) {
    console.error("[intake] listEligibleIntakeBrands error:", error.message)
    return []
  }
  return (data ?? []) as EligibleBrand[]
}

/**
 * Resuelve UNA marca por slug SOLO si es elegible para intake
 * (active = true AND slug no excluido). Devuelve null si no existe,
 * está inactiva o está excluida.
 */
export async function getEligibleIntakeBrand(
  sb: SB,
  slug: string,
): Promise<EligibleBrand | null> {
  if (!slug || !isEligibleIntakeSlug(slug)) return null

  const { data, error } = await sb
    .from("brands")
    .select("id, slug, name, brand_color")
    .eq("slug", slug)
    .eq("active", true)
    .not("slug", "in", NOT_IN_FILTER)
    .maybeSingle()

  if (error || !data) return null
  return data as EligibleBrand
}
