"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

/**
 * Crea una tarea de follow-up para un lead stale.
 * Asignada al rep del lead (o user actual si no hay), priority 'high',
 * due_at = today + 24h, source='agent' para distinguirla de tareas manuales.
 */
export async function createFollowUpTask(leadId: string, leadName: string) {
  const sb = await typedClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: lead } = await sb
    .from("leads")
    .select("brand_id, assigned_rep_id")
    .eq("id", leadId)
    .single()

  if (!lead) throw new Error("Lead no encontrado")

  const dueAt = new Date(Date.now() + 86_400_000).toISOString()

  const { error } = await sb.from("tasks").insert({
    title: `Follow-up con ${leadName}`,
    description: "Generada desde Daily Insights — lead sin contacto reciente.",
    priority: "high",
    due_at: dueAt,
    related_lead_id: leadId,
    assigned_to: lead.assigned_rep_id ?? user.id,
    brand_id: lead.brand_id,
    status: "open",
    source: "agent",
  })

  if (error) throw new Error(error.message)

  revalidatePath("/dashboard")
  revalidatePath(`/leads/${leadId}`)
}

/**
 * Marca un lead como contactado (last_contacted_at = now). Saca el lead del panel
 * de insights al refrescar (queda fuera del threshold de 5 días).
 */
export async function markAsContacted(leadId: string) {
  const sb = await typedClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { error } = await sb
    .from("leads")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("id", leadId)

  if (error) throw new Error(error.message)

  revalidatePath("/dashboard")
  revalidatePath(`/leads/${leadId}`)
}
