"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentRole, assertNotProvider } from "@/lib/auth/role-guards"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { fetchThreadMessages, type ThreadMessage } from "@/lib/queries/messages"

/**
 * Acciones de la bandeja unificada.
 *
 * Nota de permisos: la tabla `messages` NO tiene policy de UPDATE/INSERT para
 * `authenticated` — solo SELECT acotado por marca. Por eso todo lo que ESCRIBE
 * aquí usa el admin client, y la autorización se hace explícita en código
 * (rol no-provider + membresía de marca), igual que en `sendSms`.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

async function typedClient(): Promise<SupabaseClient<Database>> {
  return (await createClient()) as unknown as SupabaseClient<Database>
}

/** Membresía de marca. Admin pasa siempre; el resto debe estar en user_brands. */
async function assertBrandMember(
  sb: SupabaseClient<Database>,
  userId: string,
  role: string,
  brandId: string,
): Promise<boolean> {
  if (role === "admin") return true
  const { data } = await sb
    .from("user_brands")
    .select("brand_id")
    .eq("user_id", userId)
    .eq("brand_id", brandId)
    .maybeSingle()
  return !!data
}

const ThreadRefSchema = z
  .object({
    channel: z.enum(["sms", "whatsapp"]),
    lead_id: z.string().uuid().nullable().optional(),
    counterpart: z.string().trim().max(32).nullable().optional(),
    brand_id: z.string().uuid().nullable().optional(),
  })
  .refine((d) => !!d.lead_id || !!d.counterpart, {
    message: "Conversación inválida",
  })
export type ThreadRef = z.infer<typeof ThreadRefSchema>

/**
 * Mensajes de una conversación. Lee con el cliente de sesión a propósito: la
 * RLS por marca es la que decide qué puede ver este usuario.
 */
export async function loadThread(
  raw: ThreadRef,
): Promise<{ ok: true; messages: ThreadMessage[] } | { ok: false; error: string }> {
  try {
    const input = ThreadRefSchema.parse(raw)
    const sb = await typedClient()
    const { role } = await getCurrentRole(sb)
    assertNotProvider(role)

    // Sin marca Y sin lead = el bucket huérfano: la RLS lo esconde de TODOS, así
    // que leerlo con el cliente de sesión devolvería vacío. Se lee con admin
    // client, y solo si el usuario es admin. Un hilo con lead siempre trae marca
    // (se la hereda del lead), así que a ese no le aplica.
    const isUnbranded = !input.brand_id && !input.lead_id
    let reader: SupabaseClient<Database> = sb
    if (isUnbranded) {
      if (role !== "admin") {
        return { ok: false, error: "Solo un admin puede ver mensajes sin marca." }
      }
      reader = createAdminClient() as unknown as SupabaseClient<Database>
    }

    const messages = await fetchThreadMessages(reader, {
      channel: input.channel,
      leadId: input.lead_id ?? null,
      counterpart: input.counterpart ?? null,
      brandId: input.brand_id ?? null,
      unbranded: isUnbranded,
    })
    return { ok: true, messages }
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo abrir la conversación." }
  }
}

/**
 * Marca como leídos los entrantes de una conversación. Requiere admin client
 * (no hay policy de UPDATE para `authenticated`), por eso la membresía de marca
 * se valida aquí antes de escribir.
 */
export async function markThreadRead(
  raw: ThreadRef,
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  try {
    const input = ThreadRefSchema.parse(raw)
    const sb = await typedClient()
    const { userId, role } = await getCurrentRole(sb)
    assertNotProvider(role)

    // Sin marca = bucket admin-only. Con marca = hay que ser miembro.
    if (input.brand_id) {
      if (!(await assertBrandMember(sb, userId, role, input.brand_id))) {
        return { ok: false, error: "Sin acceso a esta marca." }
      }
    } else if (role !== "admin") {
      return { ok: false, error: "Solo un admin puede atender mensajes sin marca." }
    }

    const admin = createAdminClient() as AnyClient
    let q = admin
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("channel", input.channel)
      .eq("direction", "in")
      .is("read_at", null)
    if (input.lead_id) q = q.eq("lead_id", input.lead_id)
    else q = q.is("lead_id", null).or(`from_number.eq.${input.counterpart},to_number.eq.${input.counterpart}`)
    // Acotar SIEMPRE a la marca de la conversación: sin esto, un número que
    // aparece en 2 marcas se marcaría leído en las dos.
    q = input.brand_id ? q.eq("brand_id", input.brand_id) : q.is("brand_id", null)

    const { data, error } = await q.select("id")
    if (error) {
      console.error("[markThreadRead]", error.message)
      return { ok: false, error: "No se pudo marcar como leído." }
    }
    revalidatePath("/mensajes")
    return { ok: true, updated: ((data ?? []) as { id: string }[]).length }
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo marcar como leído." }
  }
}

const CreateLeadSchema = z.object({
  counterpart: z.string().trim().min(5, "Número inválido").max(32),
  brand_id: z.string().uuid("Elige una marca"),
  first_name: z.string().trim().min(1, "Escribe un nombre").max(80),
  last_name: z.string().trim().max(80).nullable().optional(),
  channel: z.enum(["sms", "whatsapp"]),
})
export type CreateLeadFromMessageInput = z.infer<typeof CreateLeadSchema>

/**
 * Convierte en paciente a alguien que escribió y todavía no era lead, y
 * ENGANCHA su historial: los mensajes huérfanos de ese número pasan a colgar del
 * lead nuevo, así el hilo no arranca en blanco.
 *
 * A propósito NO empuja a Practice Better: esa integración está pausada y no se
 * cablea a flujos nuevos.
 */
export async function createLeadFromMessage(
  raw: CreateLeadFromMessageInput,
): Promise<{ ok: true; leadId: string; linked: number } | { ok: false; error: string }> {
  try {
    const input = CreateLeadSchema.parse(raw)
    const sb = await typedClient()
    const { userId, role } = await getCurrentRole(sb)
    assertNotProvider(role)
    if (!(await assertBrandMember(sb, userId, role, input.brand_id))) {
      return { ok: false, error: "Sin acceso a esta marca." }
    }

    const phone = normalizeToE164(input.counterpart) || input.counterpart
    const admin = createAdminClient() as unknown as SupabaseClient<Database>

    // Si ese teléfono YA es un lead de esta marca, no duplicar: se reusa.
    const { data: existing } = await admin
      .from("leads")
      .select("id")
      .eq("brand_id", input.brand_id)
      .or(`phone.eq.${phone},phone_alt.eq.${phone}`)
      .limit(1)
    const existingId = ((existing ?? []) as { id: string }[])[0]?.id ?? null

    let leadId = existingId
    if (!leadId) {
      const insertRow: Database["public"]["Tables"]["leads"]["Insert"] = {
        brand_id: input.brand_id,
        first_name: input.first_name.trim(),
        last_name: input.last_name?.trim() || null,
        phone,
        status: "new",
        // El canal por el que llegó es el origen real del lead.
        source: input.channel === "whatsapp" ? "whatsapp" : "other",
        assigned_rep_id: null,
        created_by: userId,
      }
      const { data, error } = await admin.from("leads").insert(insertRow).select("id").single()
      if (error || !data) {
        console.error("[createLeadFromMessage] insert:", error?.message)
        return { ok: false, error: error?.message ?? "No se pudo crear el paciente." }
      }
      leadId = (data as { id: string }).id
    }

    // Enganchar el historial huérfano de ese número.
    //
    // OJO: se hace en DOS pasadas a propósito, no en una sola. Un mismo teléfono
    // puede haberle escrito a DOS marcas distintas; si se jalara "todo huérfano
    // con este número", los mensajes de la otra marca terminarían colgados de
    // este paciente. Solo se adoptan los que ya son de ESTA marca, o los que no
    // tienen marca (nadie los reclama).
    let linked = 0
    let linkFailed = false
    for (const scope of ["brand", "orphan"] as const) {
      let q = (admin as AnyClient)
        .from("messages")
        .update({ lead_id: leadId, brand_id: input.brand_id })
        .is("lead_id", null)
        .or(`from_number.eq.${phone},to_number.eq.${phone}`)
      q = scope === "brand" ? q.eq("brand_id", input.brand_id) : q.is("brand_id", null)
      const { data: rows, error: linkErr } = await q.select("id")
      if (linkErr) {
        // El paciente SÍ se creó; solo no se pudo enganchar el historial.
        console.error("[createLeadFromMessage] link:", linkErr.message)
        linkFailed = true
        continue
      }
      linked += ((rows ?? []) as { id: string }[]).length
    }

    revalidatePath("/mensajes")
    revalidatePath(`/leads/${leadId}`)
    if (linkFailed && linked === 0) return { ok: true, leadId, linked: 0 }
    return { ok: true, leadId, linked }
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createLeadFromMessage] threw:", msg)
    return { ok: false, error: msg }
  }
}
