import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getBrandIdBySlug } from "./dashboard"

type SB = SupabaseClient<Database>

/**
 * Sentinel devuelto por `resolveEffectiveBrandId` cuando un usuario NO admin no
 * tiene NINGUNA marca autorizada en `user_brands`. El caller DEBE tratar este
 * valor como "denegar acceso" (403), nunca pasarlo como brandId a una query
 * (no es un UUID válido, así que aunque se filtrara no devolvería filas, pero
 * la intención es denegar explícitamente).
 */
export const NO_BRAND_SENTINEL = "__NONE__"

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
 * @param role Rol ya conocido por el caller. Si se pasa, se OMITE la query
 *   interna a `users.role` (eficiencia). Si se omite, se consulta (backward
 *   compatible con los callers existentes).
 *
 * Usar SIEMPRE el cliente de sesión (RLS): un usuario puede leer su propia fila
 * en `users` y sus propias filas en `user_brands`.
 */
export async function resolveAuthorizedBrandId(
  supabase: SB,
  userId: string,
  brandSlug: string | null,
  role?: string,
): Promise<string | null> {
  if (!brandSlug) return null

  const brandId = await getBrandIdBySlug(brandSlug, supabase)
  if (!brandId) return null

  const effectiveRole = role ?? (await fetchUserRole(supabase, userId))

  if (effectiveRole === "admin") return brandId

  const isMember = await userIsMemberOfBrand(supabase, userId, brandId)
  return isMember ? brandId : null
}

/**
 * Resuelve la marca EFECTIVA para queries en clientes privilegiados
 * (service-role / admin-client que hacen bypass de RLS). A diferencia de
 * `resolveAuthorizedBrandId`, esta NUNCA deja a un usuario NO admin sin scope:
 *
 * - admin → devuelve el brandId del slug si viene presente+válido; si no hay
 *   slug (o es inválido) devuelve null. Para el admin, null = "todas las
 *   marcas", que es acceso global permitido.
 * - NO admin →
 *     * si el slug viene presente + válido + el user es miembro → ese brandId.
 *     * si no (slug ausente, inválido, o de una marca ajena) → fallback a la
 *       PRIMERA marca autorizada del user (order determinista por created_at,
 *       luego brand_id).
 *     * si el user no tiene NINGUNA marca en `user_brands` → devuelve
 *       `NO_BRAND_SENTINEL` ("__NONE__"). El caller DEBE denegar (403).
 *
 * Este fallback es seguro: el BrandProvider del front auto-repara la cookie al
 * cargar, así que un NO admin siempre acaba con una marca autorizada. Garantiza
 * que ningún NO admin lea datos de una marca ajena ni de "todas" (null) en un
 * cliente que hace bypass de RLS, sin provocar lockouts 403 en el uso normal.
 *
 * Usar SIEMPRE el cliente de SESIÓN (RLS) para esta resolución: el user puede
 * leer sus propias filas en `user_brands`. El brandId resultante se usa luego
 * para filtrar en el cliente privilegiado.
 */
export async function resolveEffectiveBrandId(
  supabase: SB,
  userId: string,
  role: string,
  brandSlug: string | null,
): Promise<string | null | typeof NO_BRAND_SENTINEL> {
  // Resolver el slug (si vino) a un brandId válido.
  const slugBrandId = brandSlug
    ? await getBrandIdBySlug(brandSlug, supabase)
    : null

  if (role === "admin") {
    // Admin: slug válido → esa marca; sin slug o inválido → null (= todas).
    return slugBrandId
  }

  // NO admin: solo se honra el slug si es miembro de esa marca.
  if (slugBrandId) {
    const isMember = await userIsMemberOfBrand(supabase, userId, slugBrandId)
    if (isMember) return slugBrandId
  }

  // Fallback: primera marca autorizada del user (determinista).
  const { data: memberships } = await supabase
    .from("user_brands")
    .select("brand_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("brand_id", { ascending: true })
    .limit(1)

  const first = (memberships ?? [])[0] as { brand_id: string } | undefined
  if (first?.brand_id) return first.brand_id

  // El user NO admin no tiene ninguna marca → denegar.
  return NO_BRAND_SENTINEL
}

// ── Helpers internos ──────────────────────────────────────────────────────────

async function fetchUserRole(supabase: SB, userId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .single()
  return (profile?.role ?? "rep") as string
}

async function userIsMemberOfBrand(
  supabase: SB,
  userId: string,
  brandId: string,
): Promise<boolean> {
  const { data: membership } = await supabase
    .from("user_brands")
    .select("user_id")
    .eq("user_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle()
  return !!membership
}
