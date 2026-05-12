"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

const CreateAppointmentSchema = z.object({
  brand_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  type: z.enum(["clinic", "home", "telehealth"]),
  scheduled_at: z.string().min(1),
  duration_minutes: z.number().int().min(15).max(480).default(30),
  service: z.string().nullable(),
  notes: z.string().nullable(),
})

export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>

export async function createAppointment(raw: CreateAppointmentInput) {
  const input = CreateAppointmentSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { error } = await supabase.from("appointments").insert({
    brand_id: input.brand_id,
    lead_id: input.lead_id,
    rep_id: user.id,
    type: input.type,
    status: "scheduled",
    scheduled_at: input.scheduled_at,
    duration_minutes: input.duration_minutes,
    service: input.service,
    notes: input.notes,
  })
  if (error) throw new Error(error.message)
  revalidatePath("/appointments")
}

export async function updateAppointmentStatus(
  id: string,
  status: Database["public"]["Enums"]["appointment_status"]
) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"

  const base = supabase.from("appointments").update({ status }).eq("id", id)
  const { error } = role === "rep" ? await base.eq("rep_id", user.id) : await base
  if (error) throw new Error(error.message)
  revalidatePath("/appointments")
}

export async function fetchLeadsForAppt(brandId: string) {
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
