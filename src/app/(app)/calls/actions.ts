"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

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
