"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

/**
 * Borra múltiples leads en una sola operación. Solo admin/manager.
 * Las RLS de Supabase y los CASCADE de FKs (sales, subscriptions, payment_plans,
 * abonos, tasks, appointments, calls, notifications) se encargan del cleanup.
 */
export async function bulkDeleteLeads(
  ids: string[],
): Promise<{ ok: true; deleted: number } | { ok: false; error: string }> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: "Sin leads seleccionados" }
  }
  // Sanidad: máximo 500 por operación (suficiente para casos normales)
  if (ids.length > 500) {
    return { ok: false, error: "Demasiados leads en una sola operación (máx 500)" }
  }

  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"
  if (role !== "admin" && role !== "manager") {
    return { ok: false, error: "Sin permiso para borrar leads en bulk" }
  }

  const { error, count } = await supabase
    .from("leads")
    .delete({ count: "exact" })
    .in("id", ids)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/leads")
  revalidatePath("/dashboard")
  revalidatePath("/sales")
  return { ok: true, deleted: count ?? 0 }
}

export async function logQuickCall(leadId: string, _: FormData) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: lead } = await supabase
    .from("leads")
    .select("brand_id")
    .eq("id", leadId)
    .maybeSingle()

  if (!lead) return

  await supabase.from("calls").insert({
    rep_id: user.id,
    lead_id: leadId,
    brand_id: lead.brand_id,
    direction: "outbound",
    source: "crm_quick",
  })

  await supabase
    .from("leads")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("id", leadId)

  revalidatePath("/leads")
}

export async function createLead(formData: FormData) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const brand_id = formData.get("brand_id") as string
  const first_name = (formData.get("first_name") as string).trim()
  const last_name = (formData.get("last_name") as string | null)?.trim() || null
  const phone = (formData.get("phone") as string).trim()
  const email = (formData.get("email") as string | null)?.trim() || null
  const source = (formData.get("source") as string | null) || null
  const notes = (formData.get("notes") as string | null)?.trim() || null

  if (!brand_id || !first_name || !phone) {
    throw new Error("Campos obligatorios faltantes")
  }

  const { data, error } = await supabase
    .from("leads")
    .insert({
      brand_id,
      first_name,
      last_name,
      phone,
      email,
      source: source as Database["public"]["Enums"]["lead_source"] | null,
      notes,
      assigned_rep_id: user.id,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error) throw new Error(error.message)

  revalidatePath("/leads")
  return data.id
}
