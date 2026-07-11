"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { listPbServices } from "@/lib/integrations/practice-better"
import { pushPbSession } from "@/lib/integrations/pb-sessions"

// Mapeo servicio Square → servicio Practice Better (Fase 3.1). Reusa el patrón de
// offer-brand-map-actions.ts (assertAdmin + Zod + revalidate). La tabla nueva
// square_pb_service_map no está en los tipos generados → cast (sb as any).

type TypedClient = SupabaseClient<Database>

async function typedClient(): Promise<TypedClient> {
  return (await createClient()) as unknown as TypedClient
}

async function assertAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  if (profile?.role !== "admin") {
    return { ok: false, error: "Solo admins pueden gestionar el mapa de servicios de PB" }
  }
  return { ok: true, userId: user.id }
}

// ── Jalar servicios de Practice Better (para el dropdown de mapeo) ───────────

export type PbServiceOption = {
  id: string
  name: string
  duration: number | null
  serviceTypes: string[]
}

export async function pullPbServices(): Promise<
  { ok: true; services: PbServiceOption[] } | { ok: false; error: string }
> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard
  try {
    const raw = await listPbServices()
    const services: PbServiceOption[] = raw
      .map((s) => ({
        id: s.id ?? "",
        name: s.name ?? "(sin nombre)",
        duration: typeof s.duration === "number" ? s.duration : null,
        serviceTypes: Array.isArray(s.serviceTypes) ? s.serviceTypes.filter(Boolean) : [],
      }))
      .filter((s) => s.id)
    return { ok: true, services }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error jalando servicios de PB" }
  }
}

// ── CRUD del mapa ─────────────────────────────────────────────────────────────

const ServiceMapSchema = z.object({
  square_variation_id: z.string().min(1).transform((v) => v.trim()),
  square_label: z.string().nullable().transform((v) => (v && v.trim() ? v.trim() : null)),
  pb_service_id: z.string().min(1).transform((v) => v.trim()),
  pb_service_name: z.string().nullable().transform((v) => (v && v.trim() ? v.trim() : null)),
  pb_service_type: z.enum(["face", "phone", "virtual"]).default("virtual"),
  duration_min: z.number().int().positive().nullable().default(null),
  active: z.boolean().default(true),
})

export type ServiceMapInput = z.input<typeof ServiceMapSchema>

export async function createServiceMap(
  raw: ServiceMapInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const input = ServiceMapSchema.parse(raw)
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // Upsert por square_variation_id (UNIQUE): re-mapear un servicio actualiza.
    const { data, error } = await admin
      .from("square_pb_service_map")
      .upsert(
        {
          square_variation_id: input.square_variation_id,
          square_label: input.square_label,
          pb_service_id: input.pb_service_id,
          pb_service_name: input.pb_service_name,
          pb_service_type: input.pb_service_type,
          duration_min: input.duration_min,
          active: input.active,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "square_variation_id" },
      )
      .select("id")
      .single()
    if (error) return { ok: false, error: error.message }
    revalidatePath("/settings")
    return { ok: true, id: (data as { id: string }).id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error guardando el mapeo" }
  }
}

export async function toggleServiceMapActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin
    .from("square_pb_service_map")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

export async function deleteServiceMap(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { error } = await admin.from("square_pb_service_map").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

export type ServiceMapRow = {
  id: string
  square_variation_id: string
  square_label: string | null
  pb_service_id: string
  pb_service_name: string | null
  pb_service_type: string
  duration_min: number | null
  active: boolean
}

export async function listServiceMaps(): Promise<
  { ok: true; maps: ServiceMapRow[] } | { ok: false; error: string }
> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from("square_pb_service_map")
    .select(
      "id, square_variation_id, square_label, pb_service_id, pb_service_name, pb_service_type, duration_min, active",
    )
    .order("square_label", { ascending: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, maps: (data ?? []) as ServiceMapRow[] }
}

// ── Cola de sesiones: reintentar / empujar pendientes ────────────────────────

/** Reintenta empujar una cita a PB (fila failed/unmapped) tras corregir el mapeo. */
export async function retryPbSession(
  appointmentId: string,
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    const { data: row } = await admin
      .from("external_appointments")
      .select("id, lead_id, service, starts_at, ends_at, status, raw")
      .eq("id", appointmentId)
      .maybeSingle()
    if (!row) return { ok: false, error: "Cita no encontrada" }
    const r = row as {
      id: string
      lead_id: string | null
      service: string | null
      starts_at: string | null
      ends_at: string | null
      status: string | null
      raw: { booking?: { customer_id?: string } } | null
    }
    const res = await pushPbSession(admin, {
      rowId: r.id,
      leadId: r.lead_id,
      serviceVariationId: r.service,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      squareCustomerId: r.raw?.booking?.customer_id ?? null,
      sessionNote: null,
    })
    revalidatePath("/admin/external-unlinked")
    return { ok: true, status: res.status }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error reintentando" }
  }
}
