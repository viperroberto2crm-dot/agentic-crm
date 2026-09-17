import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { admin, pacificToday } from "./core"

/**
 * Llamada SALIENTE del bot de voz (Retell / "Valeria").
 *
 * Vive aquí, importando de `core.ts`, para no duplicar `pacificToday()` — que
 * hoy ya está duplicada a mano dentro de `startBotCall`.
 *
 * Hay DOS entradas y son explícitas a propósito. NO existe un parámetro
 * `requireConsent: boolean`: un booleano así termina en `false` "temporalmente"
 * dentro de seis meses y nadie se entera. Quien llama tiene que elegir, por el
 * nombre de la función, si está disparando una llamada humana o una automática.
 *
 *  - `dispatchOutboundCallByHuman`  → el botón de la ficha. NO exige
 *    consentimiento (no se rompe nada de lo que hoy se usa), pero DEJA CONSTANCIA
 *    de quién la disparó y de si había consentimiento o no.
 *  - `dispatchOutboundCallForBot`   → el puente de WhatsApp. EXIGE una fila de
 *    consentimiento vigente, y la vuelve a verificar contra la base. Sin eso no
 *    marca. Nunca.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

/**
 * Un "sí" viejo no autoriza una llamada de hoy. En Fase 1 el bot llama en
 * cuanto recibe el permiso, así que esto es cinturón y tirantes: protege contra
 * un reintento tardío o un disparo diferido que alguien agregue después.
 */
const CONSENT_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** TCPA: nada de llamar antes de las 8am ni después de las 9pm del receptor. */
const CALL_WINDOW = { startHour: 8, endHour: 21 }

export type DispatchResult =
  | { ok: true; retellCallId: string | null }
  | { ok: false; error: string }

type LeadRow = {
  phone: string | null
  brand_id: string
  first_name: string
  last_name: string | null
}

/** Hora actual (0-23) en California. Retell y las clínicas viven en Pacific. */
function pacificHour(): number {
  const h = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hour12: false,
  }).format(new Date())
  return Number(h)
}

export function isWithinCallingHours(): boolean {
  const h = pacificHour()
  return h >= CALL_WINDOW.startHour && h < CALL_WINDOW.endHour
}

/** Deja constancia del intento. Nunca lanza: una bitácora rota no tumba la llamada. */
async function logAttempt(row: {
  brandId: string
  leadId: string
  phone: string
  source: "human" | "bot"
  actorUserId: string | null
  consentId: string | null
  retellCallId: string | null
  outcome: string
}): Promise<void> {
  try {
    await (admin() as AnyClient).from("outbound_call_attempts").insert({
      brand_id: row.brandId,
      lead_id: row.leadId,
      phone_e164: row.phone,
      source: row.source,
      actor_user_id: row.actorUserId,
      consent_id: row.consentId,
      retell_call_id: row.retellCallId,
      outcome: row.outcome,
    })
  } catch (e) {
    console.error("[outbound] bitácora:", e instanceof Error ? e.message : String(e))
  }
}

/**
 * Núcleo compartido: valida que el lead sea de la marca, que el teléfono sirva,
 * y dispara Retell. `sb` se recibe como parámetro para que el camino humano
 * conserve la RLS de `leads` (cliente de sesión) y el del bot use admin.
 */
async function dispatchCall(args: {
  sb: SupabaseClient<Database>
  leadId: string
  brandId: string
  source: "human" | "bot"
  actorUserId: string | null
  consentId: string | null
  /** Solo el bot: si el consentimiento fijó un número distinto al del lead. */
  overridePhone?: string | null
}): Promise<DispatchResult> {
  const { data: leadRaw } = await (args.sb as AnyClient)
    .from("leads")
    .select("phone, brand_id, first_name, last_name")
    .eq("id", args.leadId)
    .single()
  const lead = leadRaw as LeadRow | null

  if (!lead || lead.brand_id !== args.brandId) {
    return { ok: false, error: "El paciente no es válido para esta marca." }
  }
  const to = args.overridePhone ?? lead.phone
  if (!to || !to.startsWith("+")) {
    return { ok: false, error: "El paciente no tiene un teléfono válido (formato +1…)." }
  }

  const apiKey = process.env.RETELL_API_KEY
  const agentId = process.env.RETELL_AGENT_ID
  const from = process.env.RETELL_FROM_NUMBER
  if (!apiKey || !agentId || !from) {
    return {
      ok: false,
      error:
        "Falta configurar Retell (RETELL_API_KEY, RETELL_AGENT_ID y RETELL_FROM_NUMBER en Vercel).",
    }
  }

  // El webhook de Retell resuelve la marca por SLUG en `call.metadata.brand` y,
  // si no lo encuentra, cae al default "si-se-pierde". Mandar solo `brand_id`
  // hacía que las llamadas de otra clínica se registraran bajo la marca
  // equivocada. Se manda el slug además del id.
  const { data: brandRow } = await (args.sb as AnyClient)
    .from("brands")
    .select("slug")
    .eq("id", args.brandId)
    .maybeSingle()
  const brandSlug = (brandRow as { slug: string } | null)?.slug ?? null

  // El LLM no conoce la fecha de hoy → calcula "mañana"/"próximo lunes" mal y
  // agendar_cita rechaza fechas pasadas.
  const today = pacificToday()

  let retellCallId: string | null = null
  try {
    const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from_number: from,
        to_number: to,
        override_agent_id: agentId,
        retell_llm_dynamic_variables: {
          patient_name: `${lead.first_name} ${lead.last_name ?? ""}`.trim(),
          lead_id: args.leadId,
          patient_phone: to,
          current_date: today.human,
        },
        metadata: {
          lead_id: args.leadId,
          brand_id: args.brandId,
          ...(brandSlug ? { brand: brandSlug } : {}),
          source: args.source,
        },
      }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => "")
      console.error("[outbound] retell:", res.status, txt.slice(0, 200))
      await logAttempt({
        brandId: args.brandId, leadId: args.leadId, phone: to, source: args.source,
        actorUserId: args.actorUserId, consentId: args.consentId, retellCallId: null,
        outcome: `retell_${res.status}`,
      })
      return { ok: false, error: `No se pudo iniciar la llamada (Retell ${res.status}).` }
    }
    const j = (await res.json().catch(() => ({}))) as { call_id?: string }
    retellCallId = j.call_id ?? null
  } catch (e) {
    console.error("[outbound] retell threw:", e instanceof Error ? e.message : String(e))
    await logAttempt({
      brandId: args.brandId, leadId: args.leadId, phone: to, source: args.source,
      actorUserId: args.actorUserId, consentId: args.consentId, retellCallId: null,
      outcome: "error",
    })
    return { ok: false, error: "No se pudo iniciar la llamada." }
  }

  await logAttempt({
    brandId: args.brandId, leadId: args.leadId, phone: to, source: args.source,
    actorUserId: args.actorUserId, consentId: args.consentId, retellCallId,
    outcome: "dispatched",
  })
  return { ok: true, retellCallId }
}

// ── Entrada 1: la dispara una PERSONA desde la ficha ─────────────────────────

/**
 * Conserva la conducta de hoy: NO exige consentimiento, para no romper un botón
 * que ya se usa. Lo que sí hace es dejar constancia de quién llamó y de si
 * había consentimiento guardado — así Horizon decide con datos, no con una
 * suposición. Ver `outbound_call_attempts` y su índice de llamadas sin consent.
 */
export async function dispatchOutboundCallByHuman(args: {
  sb: SupabaseClient<Database>
  leadId: string
  brandId: string
  actorUserId: string
}): Promise<DispatchResult> {
  // Solo para la bitácora: si existe un consentimiento vigente se enlaza; si no,
  // la fila queda con consent_id null y eso ES el dato.
  const { data } = await (admin() as AnyClient)
    .from("call_consents")
    .select("id")
    .eq("lead_id", args.leadId)
    .is("revoked_at", null)
    .order("consented_at", { ascending: false })
    .limit(1)
  const consentId = ((data ?? []) as { id: string }[])[0]?.id ?? null

  return dispatchCall({
    sb: args.sb,
    leadId: args.leadId,
    brandId: args.brandId,
    source: "human",
    actorUserId: args.actorUserId,
    consentId,
  })
}

// ── Entrada 2: la dispara el BOT de WhatsApp ────────────────────────────────

/**
 * Exige consentimiento. El `consentId` no se cree tal cual: se relee de la base
 * y se verifica que siga vigente, que sea de este lead y de esta marca, y que no
 * esté viejo. Fail-closed en cada paso.
 *
 * También aplica los límites que solo tienen sentido en una llamada automática:
 * horario legal, y solo números de EE.UU./Canadá (+1) — el anuncio va a recibir
 * +52 y llamar a México desde un número US no tiene ni sentido ni presupuesto.
 */
export async function dispatchOutboundCallForBot(args: {
  leadId: string
  brandId: string
  consentId: string
}): Promise<DispatchResult> {
  const sb = admin()

  const { data: consentRaw } = await (sb as AnyClient)
    .from("call_consents")
    .select("id, lead_id, brand_id, phone_e164, consented_at, revoked_at")
    .eq("id", args.consentId)
    .maybeSingle()
  const consent = consentRaw as {
    id: string
    lead_id: string | null
    brand_id: string
    phone_e164: string
    consented_at: string
    revoked_at: string | null
  } | null

  if (!consent) return { ok: false, error: "No hay consentimiento guardado: no se llama." }
  if (consent.revoked_at) return { ok: false, error: "El consentimiento fue revocado: no se llama." }
  if (consent.lead_id !== args.leadId || consent.brand_id !== args.brandId) {
    return { ok: false, error: "El consentimiento no corresponde a este paciente o marca." }
  }
  const age = Date.now() - new Date(consent.consented_at).getTime()
  if (!Number.isFinite(age) || age > CONSENT_MAX_AGE_MS) {
    return { ok: false, error: "El consentimiento ya venció: hay que volver a pedirlo." }
  }

  // El paciente pudo pedir que le llamen a OTRO número (fijo, de un familiar).
  // Se llama exactamente al que autorizó, no al de WhatsApp.
  const to = consent.phone_e164
  if (!to.startsWith("+1")) {
    return { ok: false, error: "Por ahora solo se llama a números de EE.UU. y Canadá (+1)." }
  }
  if (!isWithinCallingHours()) {
    return { ok: false, error: "Fuera del horario permitido para llamar (8am–9pm)." }
  }

  return dispatchCall({
    sb,
    leadId: args.leadId,
    brandId: args.brandId,
    source: "bot",
    actorUserId: null,
    consentId: consent.id,
    overridePhone: to,
  })
}
