"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { assertNotProvider, getCurrentRole } from "@/lib/auth/role-guards"
import { lookupEnhancedCallerId } from "@/lib/integrations/800com"

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

// ─────────────────────────────────────────────────────────────────────
// IDENTIFY CALLER — lookup ECID en vivo para una llamada entrante.
// Se llama desde el toast apenas entra la call (Realtime). Devuelve nombre
// + info del caller y crea/linkea el lead. NO toca el webhook receiver:
// el enriquecimiento vive 100% acá, así que si algo falla la captura ni se
// entera. Idempotente con el cron auto-link-calls (match-by-phone + race).
// ─────────────────────────────────────────────────────────────────────
export type IdentifyCallerResult =
  | {
      ok: true
      leadId: string | null
      name: string | null
      phone: string
      city: string | null
      state: string | null
      address: string | null
      carrier: string | null
      lineType: string | null
      created: boolean
    }
  | { ok: false; error: string }

export async function identifyCaller(callId: string): Promise<IdentifyCallerResult> {
  try {
    const supabase = await typedClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "Unauthorized" }

    // NOTE: los tipos generados de Supabase no incluyen caller_e164 todavía
    // (columna existe en la BD; mismo patrón (as any) que usa el resto del code).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: callRaw } = await (supabase as any)
      .from("calls")
      .select("id, brand_id, rep_id, lead_id, caller_e164")
      .eq("id", callId)
      .maybeSingle()
    const call = callRaw as {
      id: string
      brand_id: string
      rep_id: string | null
      lead_id: string | null
      caller_e164: string | null
    } | null
    if (!call) return { ok: false, error: "call no encontrada" }

    const phone = call.caller_e164 ?? ""

    // Ya tiene lead → devolver su nombre, sin lookup (no gasta ECID)
    if (call.lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("first_name, last_name, city, state, address_line1")
        .eq("id", call.lead_id)
        .maybeSingle()
      const name = lead ? `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || null : null
      return {
        ok: true, leadId: call.lead_id, name, phone,
        city: lead?.city ?? null, state: lead?.state ?? null,
        address: lead?.address_line1 ?? null, carrier: null, lineType: null,
        created: false,
      }
    }

    if (!phone) return { ok: false, error: "call sin caller_e164" }

    // Match lead existente por phone (idempotencia con el cron) → linkear sin gastar ECID
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id, first_name, last_name, city, state, address_line1")
      .eq("brand_id", call.brand_id)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle()
    if (existingLead?.id) {
      await supabase.from("calls").update({ lead_id: existingLead.id }).eq("id", call.id)
      revalidatePath("/calls")
      const name = `${existingLead.first_name ?? ""} ${existingLead.last_name ?? ""}`.trim() || null
      return {
        ok: true, leadId: existingLead.id, name, phone,
        city: existingLead.city ?? null, state: existingLead.state ?? null,
        address: existingLead.address_line1 ?? null, carrier: null, lineType: null,
        created: false,
      }
    }

    // Lookup ECID en vivo (cacheado = sin cargo)
    const ecid = await lookupEnhancedCallerId(phone)
    const d = ecid.data

    let firstName = d?.firstName ?? null
    let lastName = d?.lastName ?? null
    if (!firstName && d?.name) {
      const parts = d.name.trim().split(/\s+/).filter(Boolean)
      firstName = parts[0] ?? null
      lastName = parts.slice(1).join(" ") || null
    }
    const displayName = `${firstName ?? ""} ${lastName ?? ""}`.trim() || null

    let leadId: string | null = null
    let created = false

    // Crear lead solo si ECID devolvió nombre. Si no hay nombre, devolvemos la
    // info disponible (ciudad/carrier) sin crear lead vacío — el cron/rep decide.
    if (firstName) {
      const noteParts = [
        d?.carrier ? `Carrier: ${d.carrier}` : null,
        d?.lineType ? `Tipo: ${d.lineType}` : null,
        "Identificado en vivo desde llamada entrante (800.com ECID)",
      ].filter(Boolean)
      const { data: newLead, error } = await supabase
        .from("leads")
        .insert({
          brand_id: call.brand_id,
          first_name: firstName,
          last_name: lastName,
          phone,
          status: "new",
          source: "inbound_call",
          assigned_rep_id: call.rep_id,
          address_line1: d?.streetLine_1 ?? null,
          address_line2: d?.streetLine_2 ?? null,
          city: d?.city ?? null,
          state: d?.region ?? null,
          zip: d?.postalCode ?? null,
          notes: noteParts.join("\n"),
        })
        .select("id")
        .single()
      if (error) {
        // Race: otro cliente/cron creó el lead con el mismo phone
        if (error.code === "23505" || error.message?.includes("duplicate")) {
          const { data: race } = await supabase
            .from("leads").select("id").eq("brand_id", call.brand_id).eq("phone", phone).limit(1).maybeSingle()
          leadId = race?.id ?? null
        } else {
          // No abortar: devolvemos la info igual aunque no se haya podido crear el lead
          console.error("[identifyCaller] insert lead error:", error.message)
        }
      } else {
        leadId = newLead?.id ?? null
        created = true
      }
      if (leadId) {
        await supabase.from("calls").update({ lead_id: leadId }).eq("id", call.id)
        revalidatePath("/calls")
      }
    }

    return {
      ok: true,
      leadId,
      name: displayName,
      phone,
      city: d?.city ?? null,
      state: d?.region ?? null,
      address: d?.streetLine_1 ?? null,
      carrier: d?.carrier ?? null,
      lineType: d?.lineType ?? null,
      created,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
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
