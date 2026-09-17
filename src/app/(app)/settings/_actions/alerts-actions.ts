"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { sendAlertEmail } from "@/lib/alerts/emit"

/**
 * Destinatarios de las alertas del equipo. La tabla `alert_recipients` es nueva
 * y no está en los tipos generados, así que las queries usan `as any` puntual;
 * la validación real la hace Zod aquí abajo.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

async function assertAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = (await createClient()) as unknown as SupabaseClient<Database>
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }
  const { data: profile } = await supabase
    .from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin" && profile?.role !== "manager") {
    return { ok: false, error: "Solo admin o manager pueden administrar las alertas" }
  }
  return { ok: true }
}

// Sin `export`: en un archivo "use server" solo se pueden exportar funciones async.
const ALERT_EVENTS = [
  "appointment_set",
  "appointment_cancelled",
  "sale_paid",
  "new_lead",
] as const

const RecipientSchema = z.object({
  label: z.string().trim().min(1, "Ponle un nombre"),
  channel: z.enum(["email", "sms", "whatsapp"]).default("email"),
  email: z.string().trim().email("Correo inválido").nullable().optional(),
  phone: z.string().trim().regex(/^\+[1-9]\d{1,14}$/, "Teléfono en formato +1...").nullable().optional(),
  brand_ids: z.array(z.string().uuid()).default([]),
  events: z.array(z.enum(ALERT_EVENTS)).min(1, "Escoge al menos un evento"),
  active: z.boolean().default(true),
})

export type AlertRecipientInput = z.input<typeof RecipientSchema>

function validateDestino(v: z.output<typeof RecipientSchema>): string | null {
  if (v.channel === "email" && !v.email) return "Un destinatario de correo necesita correo"
  if (v.channel !== "email" && !v.phone) return "Un destinatario de SMS o WhatsApp necesita teléfono"
  return null
}

export async function saveAlertRecipient(
  id: string | null,
  raw: AlertRecipientInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard

  const parsed = RecipientSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" }
  }
  const destinoErr = validateDestino(parsed.data)
  if (destinoErr) return { ok: false, error: destinoErr }

  const row = {
    label: parsed.data.label,
    channel: parsed.data.channel,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    brand_ids: parsed.data.brand_ids,
    events: parsed.data.events,
    active: parsed.data.active,
    updated_at: new Date().toISOString(),
  }

  const sb = createAdminClient() as unknown as Admin
  const { error } = id
    ? await sb.from("alert_recipients").update(row).eq("id", id)
    : await sb.from("alert_recipients").insert(row)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/settings")
  return { ok: true }
}

export async function toggleAlertRecipient(
  id: string,
  active: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard
  const sb = createAdminClient() as unknown as Admin
  const { error } = await sb
    .from("alert_recipients")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

export async function deleteAlertRecipient(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard
  const sb = createAdminClient() as unknown as Admin
  const { error } = await sb.from("alert_recipients").delete().eq("id", id)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/settings")
  return { ok: true }
}

/**
 * Manda un correo de prueba. Es la forma más rápida de saber si el dominio de
 * Resend ya está verificado: si no lo está, aquí sale el error exacto.
 */
export async function sendTestAlert(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await assertAdmin()
  if (!guard.ok) return guard

  const sb = createAdminClient() as unknown as Admin
  const { data } = await sb
    .from("alert_recipients")
    .select("label, channel, email, phone")
    .eq("id", id)
    .maybeSingle()
  const r = data as { label: string; channel: string; email: string | null; phone: string | null } | null
  if (!r) return { ok: false, error: "No encontré ese destinatario" }
  if (r.channel !== "email") {
    return { ok: false, error: `El canal '${r.channel}' todavía no está activo. Hoy solo sale correo.` }
  }
  if (!r.email) return { ok: false, error: "Ese destinatario no tiene correo" }

  const sent = await sendAlertEmail({
    to: r.email,
    subject: "Prueba de alertas del CRM",
    text: [
      `Hola ${r.label},`,
      "",
      "Si estás leyendo esto, las alertas del CRM funcionan.",
      "Vas a recibir un correo así cuando se agende o se cancele una cita, cuando entre un pago y cuando llegue un paciente nuevo.",
    ].join("\n"),
  })
  if (!sent.ok) return { ok: false, error: sent.error }
  return { ok: true }
}
