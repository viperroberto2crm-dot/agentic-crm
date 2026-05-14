"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import {
  approvePending,
  rejectPending,
  fetchPendingActions,
  type PendingActionRow,
} from "@/lib/agent/pending-actions"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { cookies } from "next/headers"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"

type SB = SupabaseClient<Database>

async function getSessionUser(): Promise<{
  userId: string
  role: Database["public"]["Enums"]["user_role"]
}> {
  const supabase = (await createClient()) as unknown as SB
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile) throw new Error("Profile no encontrado")
  return { userId: user.id, role: profile.role }
}

function revalidateAffected(action: PendingActionRow | null) {
  revalidatePath("/", "layout")
  revalidatePath("/dashboard")
  if (!action) return
  if (action.related_lead_id) {
    revalidatePath(`/leads/${action.related_lead_id}`)
  }
  if (action.action_type === "create_task") revalidatePath("/tasks")
  if (action.action_type === "log_call_note") revalidatePath("/calls")
  if (action.action_type === "update_lead_status") revalidatePath("/leads")
}

export async function approvePendingAction(id: string): Promise<{
  ok: boolean
  error?: string
}> {
  try {
    const { userId, role } = await getSessionUser()
    if (role !== "admin" && role !== "manager") {
      return { ok: false, error: "No autorizado" }
    }

    // Usamos service client para la ejecución (bypass RLS, mismo patrón que
    // /api/agent/ask para tool executors).
    const admin = createAdminClient() as unknown as SB

    // Cargamos primero para poder revalidar caminos afectados después
    const { data: pending } = await admin
      .from("agent_pending_actions")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    await approvePending(admin, id, userId)
    revalidateAffected((pending ?? null) as PendingActionRow | null)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function rejectPendingAction(
  id: string,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { userId, role } = await getSessionUser()
    if (role !== "admin" && role !== "manager") {
      return { ok: false, error: "No autorizado" }
    }

    const admin = createAdminClient() as unknown as SB
    const { data: pending } = await admin
      .from("agent_pending_actions")
      .select("*")
      .eq("id", id)
      .maybeSingle()

    await rejectPending(admin, id, userId, reason)
    revalidateAffected((pending ?? null) as PendingActionRow | null)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Lista las pending actions visibles para el user actual,
 * filtradas por brand activo (cookie).
 */
export async function listPendingActions(): Promise<PendingActionRow[]> {
  const { userId, role } = await getSessionUser()

  const supabase = (await createClient()) as unknown as SB

  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug
    ? await getBrandIdBySlug(brandSlug, supabase)
    : null

  // service client para evitar RLS al listar (la auth ya quedó verificada arriba)
  const admin = createAdminClient() as unknown as SB
  return fetchPendingActions(admin, { brandId, userId, role })
}
