"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"

// Tracking numbers no estan en los tipos generados todavia; las queries usan
// `as any` puntualmente para evitar errores de type-check, pero la validacion
// real es por Zod abajo.
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
    return { ok: false, error: "Solo admins pueden gestionar tracking numbers" }
  }
  return { ok: true, userId: user.id }
}

// E.164: +<digito 1-9><hasta 14 digitos mas>
const E164_RE = /^\+[1-9]\d{1,14}$/

const TrackingNumberSchema = z.object({
  brand_id: z.string().uuid("Brand requerido"),
  phone_e164: z
    .string()
    .min(1, "Telefono requerido")
    .regex(E164_RE, "Formato E.164 invalido (ej. +18883073743)"),
  label: z.string().min(1, "Label requerido"),
  campaign: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  provider: z.enum(["800com", "twilio"]),
  // jsonb arbitrario; el caller serializa antes de mandar
  provider_metadata: z.record(z.string(), z.unknown()).nullable(),
  active: z.boolean().default(true),
})

export type TrackingNumberInput = z.infer<typeof TrackingNumberSchema>

export async function createTrackingNumber(
  raw: TrackingNumberInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const input = TrackingNumberSchema.parse(raw)
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient()
    // tracking_numbers no esta en Database types — cast puntual
    const { data, error } = await (admin
      .from("tracking_numbers" as never)
      .insert({
        brand_id: input.brand_id,
        phone_e164: input.phone_e164,
        label: input.label,
        campaign: input.campaign,
        provider: input.provider,
        provider_metadata: input.provider_metadata,
        active: input.active,
      } as never)
      .select("id")
      .single() as unknown as Promise<{
        data: { id: string } | null
        error: { message: string; code?: string } | null
      }>)

    if (error || !data) {
      console.error("[createTrackingNumber]", error?.message, error?.code)
      return { ok: false, error: error?.message ?? "No se pudo crear" }
    }

    revalidatePath("/settings")
    return { ok: true, id: data.id }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos invalidos" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createTrackingNumber] threw:", msg)
    return { ok: false, error: msg }
  }
}

const UpdateTrackingNumberSchema = TrackingNumberSchema.extend({
  id: z.string().uuid(),
})
export type UpdateTrackingNumberInput = z.infer<typeof UpdateTrackingNumberSchema>

export async function updateTrackingNumber(
  raw: UpdateTrackingNumberInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { id, ...input } = UpdateTrackingNumberSchema.parse(raw)
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient()
    const { error } = await (admin
      .from("tracking_numbers" as never)
      .update({
        brand_id: input.brand_id,
        phone_e164: input.phone_e164,
        label: input.label,
        campaign: input.campaign,
        provider: input.provider,
        provider_metadata: input.provider_metadata,
        active: input.active,
      } as never)
      .eq("id", id) as unknown as Promise<{
        error: { message: string; code?: string } | null
      }>)

    if (error) {
      console.error("[updateTrackingNumber]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos invalidos" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[updateTrackingNumber] threw:", msg)
    return { ok: false, error: msg }
  }
}

export async function toggleTrackingNumberActive(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!id || typeof active !== "boolean") {
      return { ok: false, error: "Parametros invalidos" }
    }
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient()
    const { error } = await (admin
      .from("tracking_numbers" as never)
      .update({ active } as never)
      .eq("id", id) as unknown as Promise<{
        error: { message: string; code?: string } | null
      }>)

    if (error) {
      console.error("[toggleTrackingNumberActive]", error.message, error.code)
      return { ok: false, error: error.message }
    }
    revalidatePath("/settings")
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[toggleTrackingNumberActive] threw:", msg)
    return { ok: false, error: msg }
  }
}

/**
 * Soft delete: marca active=false. Nunca hard-delete — preservamos referencias
 * desde calls/leads que apunten a este id.
 */
export async function deactivateTrackingNumber(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return toggleTrackingNumberActive(id, false)
}
