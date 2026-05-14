import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

export type AutonomyLevel = Database["public"]["Enums"]["autonomy_level"]

export type ResolveAutonomyOpts = {
  actionType: string
  brandId: string | null
  userId: string
}

/**
 * Resuelve el nivel de autonomía para una write tool dada.
 *
 * Orden de precedencia (más específica → más general):
 *   1. policy con scope_user_id = userId  AND brand_id = brandId
 *   2. policy con scope_user_id IS NULL   AND brand_id = brandId
 *   3. policy con scope_user_id IS NULL   AND brand_id IS NULL (global)
 *
 * Si no encuentra ninguna policy activa para el action_type, retorna
 * "approve_required" como default seguro.
 */
export async function resolveAutonomy(
  sb: DB,
  opts: ResolveAutonomyOpts,
): Promise<AutonomyLevel> {
  const { actionType, brandId, userId } = opts

  // Buscamos las 3 candidatas en una sola consulta y resolvemos en código.
  // Es más simple y barato que 3 round-trips secuenciales.
  let query = sb
    .from("agent_policies")
    .select("scope_user_id, brand_id, autonomy")
    .eq("active", true)
    .eq("action_type", actionType)

  // Filtramos por la unión de brand y user candidatos.
  // brand_id puede ser brandId o null; scope_user_id puede ser userId o null.
  // Postgrest no acepta OR mixto fácil, así que traemos todo lo que matchee
  // estas dimensiones y resolvemos en memoria.
  if (brandId) {
    query = query.or(`brand_id.eq.${brandId},brand_id.is.null`)
  } else {
    query = query.is("brand_id", null)
  }
  query = query.or(`scope_user_id.eq.${userId},scope_user_id.is.null`)

  const { data, error } = await query
  if (error || !data || data.length === 0) {
    return "approve_required"
  }

  // 1. user+brand específico
  const userBrand = data.find(
    (p) => p.scope_user_id === userId && p.brand_id === brandId,
  )
  if (userBrand) return userBrand.autonomy

  // 2. brand específico, todos los users
  const brandOnly = data.find(
    (p) => p.scope_user_id === null && p.brand_id === brandId,
  )
  if (brandOnly) return brandOnly.autonomy

  // 3. global (sin brand, sin user)
  const global = data.find(
    (p) => p.scope_user_id === null && p.brand_id === null,
  )
  if (global) return global.autonomy

  return "approve_required"
}
