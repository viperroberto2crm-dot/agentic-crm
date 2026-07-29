"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { assertNotProvider, getCurrentRole } from "@/lib/auth/role-guards"
import { maybeEnrichLead } from "@/lib/integrations/ecid-enrich"
import { normalizeToE164 } from "@/lib/integrations/800com"

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

/**
 * Reasigna múltiples leads a un rep. Solo admin/manager.
 */
export async function bulkAssignLeadsRep(
  ids: string[],
  newRepId: string,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, error: "Sin leads seleccionados" }
  }
  if (ids.length > 500) {
    return { ok: false, error: "Demasiados leads (máx 500)" }
  }

  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"
  if (role !== "admin" && role !== "manager") {
    return { ok: false, error: "Sin permiso para reasignar leads" }
  }

  const { error, count } = await supabase
    .from("leads")
    .update({ assigned_rep_id: newRepId }, { count: "exact" })
    .in("id", ids)

  if (error) return { ok: false, error: error.message }

  revalidatePath("/leads")
  revalidatePath("/dashboard")
  return { ok: true, updated: count ?? 0 }
}

export async function logQuickCall(leadId: string, _: FormData) {
  const supabase = await typedClient()
  const { userId: _uid, role } = await getCurrentRole(supabase)
  assertNotProvider(role)
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
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const brand_id = formData.get("brand_id") as string
  const first_name = (formData.get("first_name") as string).trim()
  const last_name = (formData.get("last_name") as string | null)?.trim() || null
  // Normalizamos a E.164 para que el teléfono se guarde en UN solo formato y el
  // match por teléfono (crons/webhooks) funcione. Sin esto se crean leads
  // duplicados y se mal-vinculan llamadas/pagos (raíz del imán de pagos).
  const phoneRaw = (formData.get("phone") as string).trim()
  const phone = normalizeToE164(phoneRaw) || phoneRaw
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

  // Fire-and-forget: NO await. El lookup tarda ~500ms-2s y bloquearía el
  // form submit del rep. La función ya silent-failea internamente, y si
  // enriquece, el siguiente refresh del lead lo muestra.
  void maybeEnrichLead(supabase, data.id).catch((e) => {
    console.warn("[createLead] enrich error:", e instanceof Error ? e.message : e)
  })

  revalidatePath("/leads")
  return data.id
}
