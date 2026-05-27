"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { assertNotProvider, getCurrentRole } from "@/lib/auth/role-guards"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const CreateCallSchema = z.object({
  brand_id: z.string().uuid(),
  lead_id: z.string().uuid().nullable(),
  direction: z.enum(["inbound", "outbound"]),
  outcome: z.enum(["no_answer", "voicemail", "connected", "appointment_set", "not_interested", "callback_requested", "wrong_number"]).nullable(),
  duration_seconds: z.number().int().min(0).nullable(),
  notes: z.string().nullable(),
})

export type CreateCallInput = z.infer<typeof CreateCallSchema>

export async function createCall(raw: CreateCallInput) {
  const input = CreateCallSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Idempotencia: si el mismo rep registró una call para el mismo lead en
  // los últimos 30s, NO crear duplicado. Esto cubre double-click y reenvíos.
  // El cliente también tiene un useRef guard, pero esto es defensa en profundidad.
  const thirtySecondsAgo = new Date(Date.now() - 30_000).toISOString()
  let recentQ = supabase
    .from("calls")
    .select("id")
    .eq("rep_id", user.id)
    .eq("source", "manual")
    .gte("created_at", thirtySecondsAgo)
    .order("created_at", { ascending: false })
    .limit(1)
  if (input.lead_id) {
    recentQ = recentQ.eq("lead_id", input.lead_id)
  } else {
    recentQ = recentQ.is("lead_id", null)
  }
  const { data: recent } = await recentQ.maybeSingle()
  if (recent?.id) {
    // Silencioso: ya existe una call del mismo rep para el mismo lead
    revalidatePath("/calls")
    return
  }

  const { error } = await supabase.from("calls").insert({
    brand_id: input.brand_id,
    lead_id: input.lead_id,
    rep_id: user.id,
    direction: input.direction,
    outcome: input.outcome,
    duration_seconds: input.duration_seconds,
    notes: input.notes,
    source: "manual",
  })
  if (error) throw new Error(error.message)

  if (input.lead_id) {
    await supabase
      .from("leads")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", input.lead_id)
  }

  revalidatePath("/calls")
  // También invalidar lead detail y dashboard porque muestran calls
  if (input.lead_id) revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/dashboard")
}

export async function fetchLeadsForCall(brandId: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"

  let query = supabase
    .from("leads")
    .select("id, first_name, last_name, phone")
    .eq("brand_id", brandId)
    .order("first_name")
    .limit(200)

  if (role === "rep") query = query.eq("assigned_rep_id", user.id)

  const { data } = await query
  return (data ?? []) as { id: string; first_name: string; last_name: string | null; phone: string }[]
}
