import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "./dashboard"

type SB = SupabaseClient<Database>

/**
 * Resuelve el brand id del slug de cookie SOLO si el usuario está autorizado
 * para esa marca. Evita que un rep/manager cambie la cookie `crm_brand_slug`
 * a otra marca y lea sus datos.
 *
 * Reglas:
 * - slug null/vacío → null (no hay marca seleccionada; comportamiento normal).
 * - admin → acceso global: cualquier marca válida. Los admins se asocian a
 *   TODAS las marcas activas vía ensureUserBrandsForRole (settings/actions.ts),
 *   pero una marca creada después podría no re-asociar a cada admin, así que el
 *   admin NO depende de user_brands para no bloquearse de una marca legítima.
 * - manager / rep / provider → solo si existe fila en `user_brands`
 *   (user_id, brand_id).
 * - slug presente pero sin autorización (o slug inválido) → null. El caller
 *   distingue "sin autorización" de "sin selección" comparando con el slug.
 *
 * Tabla user_brands: columnas user_id, brand_id, created_at (PK compuesta
 * user_id + brand_id). El rol se lee de la tabla `users` (no `profiles`),
 * igual que los server actions en settings/actions.ts.
 *
 * Usar SIEMPRE el cliente de sesión (RLS): un usuario puede leer su propia fila
 * en `users` y sus propias filas en `user_brands`.
 */
export async function resolveAuthorizedBrandId(
  supabase: SB,
  userId: string,
  brandSlug: string | null,
): Promise<string | null> {
  if (!brandSlug) return null

  const brandId = await getBrandIdBySlug(brandSlug, supabase)
  if (!brandId) return null

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single()
  const role = (profile?.role ?? "rep") as string

  if (role === "admin") return brandId

  const { data: membership } = await supabase
    .from("user_brands")
    .select("user_id")
    .eq("user_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle()

  return membership ? brandId : null
}
