"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { CAPABILITIES, type Capability } from "@/lib/auth/permissions"

type TypedClient = SupabaseClient<Database>

async function assertAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = (await createClient()) as unknown as TypedClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") return { ok: false, error: "Solo admins pueden cambiar permisos" }
  return { ok: true, userId: user.id }
}

const CAP_SET = new Set<string>(CAPABILITIES)

/**
 * Guarda un toggle de permiso (rol × capacidad). Solo admin. Solo rep/manager
 * son configurables (admin/provider están fijos en código → se rechazan aquí).
 */
export async function saveRolePermission(input: {
  role: string
  capability: string
  allowed: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const role = input.role
    const capability = input.capability as Capability
    if (role !== "rep" && role !== "manager") {
      return { ok: false, error: "Rol no configurable (solo rep/manager)" }
    }
    if (!CAP_SET.has(capability)) {
      return { ok: false, error: "Capacidad inválida" }
    }
    if (typeof input.allowed !== "boolean") {
      return { ok: false, error: "Valor inválido" }
    }

    const admin = createAdminClient() as unknown as TypedClient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("role_permissions")
      .upsert(
        {
          role,
          capability,
          allowed: input.allowed,
          updated_at: new Date().toISOString(),
          updated_by: guard.userId,
        },
        { onConflict: "role,capability" },
      )
    if (error) {
      console.error("[saveRolePermission]", error.message)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    revalidatePath("/leads")
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" }
  }
}
