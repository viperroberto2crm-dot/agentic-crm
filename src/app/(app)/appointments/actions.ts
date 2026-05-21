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

const CreateAppointmentSchema = z
  .object({
    brand_id: z.string().uuid(),
    lead_id: z.string().uuid(),
    type: z.enum(["clinic", "home", "telehealth"]),
    scheduled_at: z.string().min(1),
    duration_minutes: z.number().int().min(15).max(480).default(30),
    service: z.string().nullable(),
    notes: z.string().nullable(),
    clinic_id: z.string().uuid().nullable().default(null),
    address_line1: z.string().nullable().default(null),
    address_line2: z.string().nullable().default(null),
    city: z.string().nullable().default(null),
    state: z.string().nullable().default(null),
    zip: z.string().nullable().default(null),
    telehealth_link: z.string().nullable().default(null),
  })
  .refine(
    (v) => v.type !== "clinic" || (typeof v.clinic_id === "string" && v.clinic_id.length > 0),
    { message: "clinic_id is required when type is 'clinic'", path: ["clinic_id"] }
  )
  .refine(
    (v) =>
      v.type !== "home" ||
      (typeof v.address_line1 === "string" &&
        v.address_line1.trim().length > 0 &&
        typeof v.city === "string" &&
        v.city.trim().length > 0),
    {
      message: "address_line1 and city are required when type is 'home'",
      path: ["address_line1"],
    }
  )

export type CreateAppointmentInput = z.input<typeof CreateAppointmentSchema>

export async function createAppointment(raw: CreateAppointmentInput) {
  const input = CreateAppointmentSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const isHome = input.type === "home"
  const isClinic = input.type === "clinic"
  const isTele = input.type === "telehealth"

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
    clinic_id: isClinic ? input.clinic_id : null,
    address_line1: isHome ? input.address_line1 : null,
    address_line2: isHome ? input.address_line2 : null,
    city: isHome ? input.city : null,
    state: isHome ? input.state : null,
    zip: isHome ? input.zip : null,
    telehealth_link: isTele ? input.telehealth_link : null,
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
  const scopeToOwn = role === "rep" || role === "provider"
  const { error } = scopeToOwn ? await base.eq("rep_id", user.id) : await base
  if (error) throw new Error(error.message)
  revalidatePath("/appointments")
}

const UpdateAppointmentSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(["clinic", "home", "telehealth"]),
    status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]),
    scheduled_at: z.string().min(1),
    duration_minutes: z.number().int().min(15).max(480),
    service: z.string().nullable(),
    notes: z.string().nullable(),
    clinic_id: z.string().uuid().nullable().default(null),
    address_line1: z.string().nullable().default(null),
    address_line2: z.string().nullable().default(null),
    city: z.string().nullable().default(null),
    state: z.string().nullable().default(null),
    zip: z.string().nullable().default(null),
    telehealth_link: z.string().nullable().default(null),
  })
  .refine(
    (v) => v.type !== "clinic" || (typeof v.clinic_id === "string" && v.clinic_id.length > 0),
    { message: "clinic_id is required when type is 'clinic'", path: ["clinic_id"] }
  )
  .refine(
    (v) =>
      v.type !== "home" ||
      (typeof v.address_line1 === "string" &&
        v.address_line1.trim().length > 0 &&
        typeof v.city === "string" &&
        v.city.trim().length > 0),
    {
      message: "address_line1 and city are required when type is 'home'",
      path: ["address_line1"],
    }
  )

export type UpdateAppointmentInput = z.input<typeof UpdateAppointmentSchema>

export async function updateAppointment(raw: UpdateAppointmentInput) {
  const input = UpdateAppointmentSchema.parse(raw)
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"

  const isHome = input.type === "home"
  const isClinic = input.type === "clinic"
  const isTele = input.type === "telehealth"

  // Provider solo puede tocar status; el resto de campos se ignoran.
  const updates = role === "provider"
    ? { status: input.status }
    : {
        type: input.type,
        status: input.status,
        scheduled_at: input.scheduled_at,
        duration_minutes: input.duration_minutes,
        service: input.service,
        notes: input.notes,
        clinic_id: isClinic ? input.clinic_id : null,
        address_line1: isHome ? input.address_line1 : null,
        address_line2: isHome ? input.address_line2 : null,
        city: isHome ? input.city : null,
        state: isHome ? input.state : null,
        zip: isHome ? input.zip : null,
        telehealth_link: isTele ? input.telehealth_link : null,
      }

  const base = supabase.from("appointments").update(updates).eq("id", input.id)
  const scopeToOwn = role === "rep" || role === "provider"
  const { error } = scopeToOwn ? await base.eq("rep_id", user.id) : await base
  if (error) throw new Error(error.message)
  revalidatePath("/appointments")
}

export async function fetchAppointmentById(id: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"

  let q = supabase
    .from("appointments")
    .select("id, rep_id, lead_id, type, scheduled_at, duration_minutes, service, notes, clinic_id, address_line1, address_line2, city, state, zip, telehealth_link, status")
    .eq("id", id)

  if (role === "rep" || role === "provider") q = q.eq("rep_id", user.id)

  const { data } = await q.maybeSingle()
  return data
}

export async function fetchLeadsForAppt(brandId: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"

  // Provider no crea appointments; no necesita lista de leads.
  if (role === "provider") return []

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
