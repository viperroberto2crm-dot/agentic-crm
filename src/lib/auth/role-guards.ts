import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export type UserRole = "admin" | "manager" | "rep" | "provider"

export async function getCurrentRole(
  sb: SupabaseClient<Database>,
): Promise<{ userId: string; role: UserRole }> {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  return { userId: user.id, role: (profile?.role ?? "rep") as UserRole }
}

export function assertNotProvider(role: UserRole | string): void {
  if (role === "provider") {
    throw new Error("Sin permiso para realizar esta acción (rol provider)")
  }
}
