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
    // Si el creador es admin/manager puede asignar a otro rep.
    // null o undefined → se asigna al user logueado.
    assigned_to: z.string().uuid().nullable().optional(),
    // Provider que verá al paciente. Independiente de rep_id (dueño venta).
    // Solo admin/manager pueden setearlo.
    provider_id: z.string().uuid().nullable().optional(),
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

  // Idempotencia: si el mismo rep creó una cita para el mismo lead a la misma
  // hora en los últimos 60s, no crear duplicado (probable doble-click o reenvío).
  const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString()
  const { data: recent } = await supabase
    .from("appointments")
    .select("id")
    .eq("lead_id", input.lead_id)
    .eq("rep_id", user.id)
    .eq("scheduled_at", input.scheduled_at)
    .gte("created_at", sixtySecondsAgo)
    .limit(1)
    .maybeSingle()
  if (recent?.id) {
    revalidatePath("/appointments")
    revalidatePath("/dashboard")
    revalidatePath(`/leads/${input.lead_id}`)
    return
  }

  const isHome = input.type === "home"
  const isClinic = input.type === "clinic"
  const isTele = input.type === "telehealth"

  // assigned_to solo lo respetamos si el user es admin/manager (sino auto al user)
  let effectiveRepId = user.id
  if (input.assigned_to && (role === "admin" || role === "manager")) {
    effectiveRepId = input.assigned_to
  }
  // provider_id: solo admin/manager pueden setearlo; rep no
  const effectiveProviderId =
    role === "admin" || role === "manager" ? input.provider_id ?? null : null

  const { error } = await supabase.from("appointments").insert({
    brand_id: input.brand_id,
    lead_id: input.lead_id,
    rep_id: effectiveRepId,
    provider_id: effectiveProviderId,
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

  // Auto-mover el lead status de new/contacted/qualified → appointment_set.
  // NO tocar si está en sold/lost/on_hold/not_interested/appointment_set.
  // Reps frecuentemente olvidan cambiar el status manualmente y el lead se
  // queda en "new" aunque ya tenga cita agendada (visualmente confunde).
  const { data: leadRow } = await supabase
    .from("leads")
    .select("status")
    .eq("id", input.lead_id)
    .maybeSingle()
  if (leadRow?.status && (["new", "contacted", "qualified"] as const).includes(leadRow.status as "new" | "contacted" | "qualified")) {
    await supabase
      .from("leads")
      .update({ status: "appointment_set" })
      .eq("id", input.lead_id)
  }

  revalidatePath("/appointments")
  revalidatePath("/dashboard")
  revalidatePath(`/leads/${input.lead_id}`)
  revalidatePath("/leads")
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

  const { data: appt } = await supabase
    .from("appointments")
    .select("lead_id")
    .eq("id", id)
    .maybeSingle()

  const base = supabase.from("appointments").update({ status }).eq("id", id)
  // Provider está en provider_id (separado de rep_id desde commit 779a819).
  // Filtrar por el campo correcto para no recibir 0 rows silenciosamente.
  const { error } =
    role === "rep"
      ? await base.eq("rep_id", user.id)
      : role === "provider"
        ? await base.eq("provider_id", user.id)
        : await base
  if (error) throw new Error(error.message)
  revalidatePath("/appointments")
  revalidatePath("/dashboard")
  if (appt?.lead_id) revalidatePath(`/leads/${appt.lead_id}`)
}

const UpdateAppointmentSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(["clinic", "home", "telehealth"]),
    status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show", "rescheduled"]),
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
    // Provider que verá al paciente. undefined = no tocar; null = limpiar.
    // Solo admin/manager pueden setearlo.
    provider_id: z.string().uuid().nullable().optional(),
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

  // Provider puede tocar status + notes (sus observaciones clínicas).
  // El resto de campos los ignora.
  const baseUpdates =
    role === "provider"
      ? { status: input.status, notes: input.notes }
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
  // provider_id solo se actualiza si admin/manager lo envió explícitamente
  const updates =
    (role === "admin" || role === "manager") && input.provider_id !== undefined
      ? { ...baseUpdates, provider_id: input.provider_id }
      : baseUpdates

  const { data: appt } = await supabase
    .from("appointments")
    .select("lead_id")
    .eq("id", input.id)
    .maybeSingle()

  const base = supabase.from("appointments").update(updates).eq("id", input.id)
  // Provider está en provider_id (separado de rep_id desde commit 779a819).
  const { error } =
    role === "rep"
      ? await base.eq("rep_id", user.id)
      : role === "provider"
        ? await base.eq("provider_id", user.id)
        : await base
  if (error) throw new Error(error.message)
  revalidatePath("/appointments")
  revalidatePath("/dashboard")
  if (appt?.lead_id) revalidatePath(`/leads/${appt.lead_id}`)
}

/**
 * Borra una cita. Admin/manager pueden borrar cualquiera. Rep solo las suyas.
 * Provider bloqueado.
 */
export async function deleteAppointment(
  appointmentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  assertNotProvider(role)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }

  const { data: appt } = await supabase
    .from("appointments")
    .select("lead_id")
    .eq("id", appointmentId)
    .maybeSingle()

  const base = supabase.from("appointments").delete().eq("id", appointmentId)
  const { error } = role === "rep" ? await base.eq("rep_id", user.id) : await base
  if (error) return { ok: false, error: error.message }

  revalidatePath("/appointments")
  revalidatePath("/dashboard")
  if (appt?.lead_id) revalidatePath(`/leads/${appt.lead_id}`)
  return { ok: true }
}

export async function reassignAppointmentRep(
  appointmentId: string,
  newRepId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  if (role !== "admin" && role !== "manager") {
    return { ok: false, error: "Solo admin/manager pueden reasignar" }
  }
  const { data: appt } = await supabase
    .from("appointments")
    .select("lead_id")
    .eq("id", appointmentId)
    .maybeSingle()

  const { error } = await supabase
    .from("appointments")
    .update({ rep_id: newRepId })
    .eq("id", appointmentId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/appointments")
  revalidatePath("/dashboard")
  if (appt?.lead_id) revalidatePath(`/leads/${appt.lead_id}`)
  return { ok: true }
}

export async function reassignAppointmentProvider(
  appointmentId: string,
  newProviderId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  if (role !== "admin" && role !== "manager") {
    return { ok: false, error: "Solo admin/manager pueden reasignar provider" }
  }
  const { data: appt } = await supabase
    .from("appointments")
    .select("lead_id")
    .eq("id", appointmentId)
    .maybeSingle()

  const { error } = await supabase
    .from("appointments")
    .update({ provider_id: newProviderId })
    .eq("id", appointmentId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/appointments")
  revalidatePath("/dashboard")
  if (appt?.lead_id) revalidatePath(`/leads/${appt.lead_id}`)
  return { ok: true }
}

export async function fetchAppointmentById(id: string) {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  const role = profile?.role ?? "rep"

  let q = supabase
    .from("appointments")
    .select("id, rep_id, provider_id, lead_id, type, scheduled_at, duration_minutes, service, notes, clinic_id, address_line1, address_line2, city, state, zip, telehealth_link, status")
    .eq("id", id)

  // Provider está en provider_id (separado de rep_id desde commit 779a819).
  if (role === "rep") q = q.eq("rep_id", user.id)
  if (role === "provider") q = q.eq("provider_id", user.id)

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

// ─────────────────────────────────────────────────────────────────────
// READY TO SHIP — flujo provider → shipping admin
// Provider aprueba (con notas) → admin ve en /shipping → marca shipped.
// ─────────────────────────────────────────────────────────────────────

const ApproveForShippingSchema = z.object({
  appointment_id: z.string().uuid(),
  provider_notes: z.string().min(1).max(2000),
})

export async function approveForShipping(raw: z.infer<typeof ApproveForShippingSchema>) {
  const input = ApproveForShippingSchema.parse(raw)
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  // Solo provider, admin o manager pueden aprobar.
  if (role !== "provider" && role !== "admin" && role !== "manager") {
    throw new Error("Solo provider/admin pueden aprobar para envío")
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Si es provider, validar que la cita le pertenece (provider_id = user.id)
  if (role === "provider") {
    const { data: appt } = await supabase
      .from("appointments")
      .select("provider_id")
      .eq("id", input.appointment_id)
      .single()
    if (!appt || appt.provider_id !== user.id) {
      throw new Error("Solo el provider asignado puede aprobar esta cita")
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("appointments")
    .update({
      provider_approved: true,
      provider_approved_at: new Date().toISOString(),
      provider_approved_by: user.id,
      provider_notes: input.provider_notes,
    })
    .eq("id", input.appointment_id)

  if (error) throw new Error(error.message)

  revalidatePath("/shipping")
  revalidatePath("/appointments")
}

export async function unapproveForShipping(appointmentId: string) {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  if (role !== "provider" && role !== "admin" && role !== "manager") {
    throw new Error("Solo provider/admin pueden des-aprobar")
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Si ya fue shipped, no permitir des-aprobar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appt } = await (supabase as any)
    .from("appointments")
    .select("shipped_at, provider_id")
    .eq("id", appointmentId)
    .single()
  if (appt?.shipped_at) {
    throw new Error("La cita ya fue marcada como enviada; no se puede des-aprobar")
  }
  if (role === "provider" && appt?.provider_id !== user.id) {
    throw new Error("Solo el provider asignado puede des-aprobar")
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("appointments")
    .update({
      provider_approved: false,
      provider_approved_at: null,
      provider_approved_by: null,
    })
    .eq("id", appointmentId)

  if (error) throw new Error(error.message)

  revalidatePath("/shipping")
  revalidatePath("/appointments")
}

export async function markAsShipped(appointmentId: string) {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  if (role !== "admin" && role !== "manager") {
    throw new Error("Solo admin/manager pueden marcar como enviado")
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")

  // Validar que esté aprobada antes de marcar shipped
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: appt } = await (supabase as any)
    .from("appointments")
    .select("provider_approved, shipped_at")
    .eq("id", appointmentId)
    .single()
  if (!appt?.provider_approved) {
    throw new Error("La cita no está aprobada por el provider")
  }
  if (appt.shipped_at) {
    throw new Error("La cita ya fue marcada como enviada")
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("appointments")
    .update({
      shipped_at: new Date().toISOString(),
      shipped_by: user.id,
    })
    .eq("id", appointmentId)

  if (error) throw new Error(error.message)

  revalidatePath("/shipping")
  revalidatePath("/appointments")
}

/** Cuenta pendientes de envío para el badge del sidebar (admin/manager only) */
export async function getShippingPendingCount(): Promise<number> {
  const supabase = await typedClient()
  const { role } = await getCurrentRole(supabase)
  if (role !== "admin" && role !== "manager") return 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (supabase as any)
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("provider_approved", true)
    .is("shipped_at", null)
  return (count as number | null) ?? 0
}
