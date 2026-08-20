import "server-only"
import { timingSafeEqual } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { createCheckoutSessionForLead } from "@/lib/integrations/stripe-checkout"
import { createSquarePaymentLinkForLead } from "@/lib/integrations/square-checkout"
import { sendTwilioSms } from "@/lib/integrations/twilio"
import { getConnectionSecret } from "@/lib/integrations/connections"
import { resolveBrandTwilioFrom } from "@/lib/integrations/brand-numbers"

/**
 * Herramientas que el bot de voz (Retell) llama a media llamada, service-to-service
 * (admin client, sin sesión). Fase 5a: SOLO Si Se Pierde. Reutiliza los helpers
 * puros del CRM (checkout, SMS, crear lead) y replica el insert de cita con el admin
 * client. NUNCA escribe en `sales`: el link lleva metadata lead/brand y el webhook de
 * Stripe/Square registra el dinero (sin doble conteo).
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentic-crm-sigma.vercel.app"
const BRAND_SLUG = "si-se-pierde"
// Evaluación médica única ($39.99) que se suma SOLO al plan semanal en el 1er pago.
// El mensual/trimestral ya la incluyen. Overridable por env; default = price actual.
const SCREENING_PRICE_ID = process.env.STRIPE_SCREENING_PRICE_ID ?? "price_1TYrDhDH6stKoTqxVZk2f1z2"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** Coerce a string defensivamente (el LLM del bot a veces manda números). */
export function asStr(v: unknown): string | undefined {
  if (v == null) return undefined
  return typeof v === "string" ? v : String(v)
}

/**
 * Fecha de HOY en hora de California. El servidor SIEMPRE sabe el día; el LLM no.
 * Se la devolvemos al bot en la 1a herramienta para que no invente el día y
 * calcule "mañana"/"próximo lunes" bien (en entrantes, salientes y test por igual).
 */
export function pacificToday(): { iso: string; human: string } {
  const now = new Date()
  // en-CA formatea como YYYY-MM-DD, ideal para construir fechas ISO.
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now)
  const human = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Los_Angeles", weekday: "long", year: "numeric", month: "long", day: "numeric",
  }).format(now)
  return { iso, human }
}

/** Verifica el secreto compartido (Bearer o x-voice-secret) en tiempo constante. */
export function verifyVoiceSecret(req: Request): boolean {
  const expected = process.env.RETELL_WEBHOOK_SECRET
  if (!expected) return false
  const auth = req.headers.get("authorization") ?? ""
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : req.headers.get("x-voice-secret") ?? ""
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function admin(): SupabaseClient<Database> {
  return createAdminClient() as unknown as SupabaseClient<Database>
}

// Resuelve el id de la marca por slug. Default = Si Se Pierde (compatibilidad).
// El bot de cada clínica pasa su `brand` (ej. "la-esperanza") para que sus
// leads/citas caigan en la marca correcta (multi-clínica).
async function brandId(sb: Admin, slug?: string): Promise<string | null> {
  const s = (slug && slug.trim()) || BRAND_SLUG
  const { data } = await sb.from("brands").select("id").eq("slug", s).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Un usuario real para rep_id de la cita (NOT NULL): el rep del lead, o un
 *  admin/manager activo de la marca, o cualquier admin activo. */
async function serviceUserId(sb: Admin, bId: string, leadRepId: string | null): Promise<string | null> {
  if (leadRepId) return leadRepId
  const { data: ub } = await sb.from("user_brands").select("user_id").eq("brand_id", bId)
  const userIds = ((ub ?? []) as { user_id: string }[]).map((r) => r.user_id)
  if (userIds.length > 0) {
    const { data } = await sb
      .from("users").select("id").in("id", userIds).eq("active", true)
      .in("role", ["admin", "manager"]).limit(1).maybeSingle()
    if ((data as { id: string } | null)?.id) return (data as { id: string }).id
  }
  const { data: anyAdmin } = await sb
    .from("users").select("id").eq("active", true).eq("role", "admin").limit(1).maybeSingle()
  return (anyAdmin as { id: string } | null)?.id ?? null
}

// ── 1) Buscar o crear paciente por teléfono ──────────────────────────────────
export async function getOrCreatePatient(input: {
  phone: string
  first_name?: string
  last_name?: string
  email?: string
  brand?: string
  /** Segundo número (ej. el de la llamada) si el paciente dio otro como principal. */
  phone_alt?: string
}): Promise<
  | { ok: true; lead_id: string; name: string; is_new: boolean; today: string; today_iso: string }
  | { ok: false; error: string }
> {
  const sb = admin()
  const phone = input.phone ? normalizeToE164(input.phone) || "" : ""
  if (!phone) return { ok: false, error: "Teléfono inválido" }
  const bId = await brandId(sb, input.brand)
  if (!bId) return { ok: false, error: "Marca no encontrada" }

  // Fecha de hoy (California) — se la damos al bot para que agende bien.
  const t = pacificToday()

  const email = input.email?.trim().toLowerCase() || null
  // Buscar por teléfono (y email) en la marca.
  const { data: existing } = await sb
    .from("leads")
    .select("id, first_name, last_name")
    .eq("brand_id", bId)
    .or(`phone.eq.${phone},phone_alt.eq.${phone}`)
    .limit(1)
    .maybeSingle()
  const ex = existing as { id: string; first_name: string; last_name: string | null } | null
  if (ex) {
    return { ok: true, lead_id: ex.id, name: `${ex.first_name} ${ex.last_name ?? ""}`.trim(), is_new: false, today: t.human, today_iso: t.iso }
  }

  const first = input.first_name?.trim() || phone
  const last = input.last_name?.trim() || null
  // Segundo número (el de la llamada) si dieron otro como principal, y es distinto.
  const phoneAlt = input.phone_alt ? normalizeToE164(input.phone_alt) || null : null
  const { data: created, error } = await sb
    .from("leads")
    .insert({
      brand_id: bId,
      first_name: first,
      last_name: last,
      phone,
      phone_alt: phoneAlt && phoneAlt !== phone ? phoneAlt : null,
      email,
      status: "new",
      source: "inbound_call",
      notes: "Creado por el asistente de voz (Retell)",
    })
    .select("id")
    .single()
  if (error || !created) return { ok: false, error: error?.message ?? "No se pudo crear el paciente" }
  return { ok: true, lead_id: (created as { id: string }).id, name: `${first} ${last ?? ""}`.trim(), is_new: true, today: t.human, today_iso: t.iso }
}

// ── 2) Agendar cita ──────────────────────────────────────────────────────────
export async function bookAppointment(input: {
  lead_id: string
  when_iso: string
  service?: string
  notes?: string
  brand?: string
}): Promise<{ ok: true; when: string } | { ok: false; error: string }> {
  const sb = admin()
  const bId = await brandId(sb, input.brand)
  if (!bId) return { ok: false, error: "Marca no encontrada" }
  const when = new Date(input.when_iso)
  if (isNaN(when.getTime())) return { ok: false, error: "Fecha/hora inválida" }
  // No agendar en el pasado (el bot a veces calcula mal la fecha si no sabe el día
  // de hoy). Rechaza y pide reconfirmar en vez de crear una cita vieja.
  if (when.getTime() < Date.now() - 5 * 60 * 1000) {
    const t = pacificToday()
    return { ok: false, error: `Esa fecha ya pasó. HOY es ${t.human} (${t.iso}). Recalcula el día correcto desde HOY (mañana = HOY + 1 día) y reintenta.` }
  }
  // El bot a veces alucina un año/mes lejano. Rechazar citas a más de 120 días.
  if (when.getTime() > Date.now() + 120 * 24 * 60 * 60 * 1000) {
    const t = pacificToday()
    return { ok: false, error: `Esa fecha está demasiado lejos. HOY es ${t.human} (${t.iso}). Confirma el día correcto con el paciente y reintenta.` }
  }

  const { data: lead } = await sb
    .from("leads").select("id, brand_id, status, assigned_rep_id").eq("id", input.lead_id).maybeSingle()
  const l = lead as { id: string; brand_id: string; status: string; assigned_rep_id: string | null } | null
  if (!l || l.brand_id !== bId) return { ok: false, error: "Paciente no válido para esta marca" }

  const repId = await serviceUserId(sb, bId, l.assigned_rep_id)
  if (!repId) return { ok: false, error: "No hay usuario para asignar la cita" }

  const { error } = await sb.from("appointments").insert({
    brand_id: bId,
    lead_id: l.id,
    rep_id: repId,
    type: "telehealth", // Si Se Pierde = telesalud GLP-1
    status: "scheduled",
    scheduled_at: when.toISOString(),
    duration_minutes: 30,
    service: input.service ?? null,
    notes: input.notes ? `[Bot] ${input.notes}` : "[Bot] Cita agendada por el asistente de voz",
  })
  if (error) return { ok: false, error: error.message }

  // Avanzar status del lead como lo hace createAppointment.
  if (["new", "contacted", "qualified"].includes(l.status)) {
    await sb.from("leads").update({ status: "appointment_set" }).eq("id", l.id)
  }
  return { ok: true, when: when.toISOString() }
}

// ── 3) Generar link de pago y mandarlo por SMS ───────────────────────────────
export async function sendPaymentLink(input: {
  lead_id: string
  offer_key?: string
  brand?: string
}): Promise<{ ok: true; sent: boolean } | { ok: false; error: string }> {
  const sb = admin()
  const bId = await brandId(sb, input.brand)
  if (!bId) return { ok: false, error: "Marca no encontrada" }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: leadRaw } = await (sb as any)
    .from("leads").select("id, brand_id, phone, email, sms_opt_out").eq("id", input.lead_id).maybeSingle()
  const lead = leadRaw as { id: string; brand_id: string; phone: string | null; email: string | null; sms_opt_out: boolean | null } | null
  if (!lead || lead.brand_id !== bId) return { ok: false, error: "Paciente no válido para esta marca" }
  if (lead.sms_opt_out) return { ok: false, error: "El paciente pidió no recibir mensajes (STOP)" }
  const to = lead.phone
  if (!to || !to.startsWith("+")) return { ok: false, error: "El paciente no tiene teléfono válido" }

  // Ofertas activas de la marca (offer_brand_map). Si no se especifica, la primera.
  // `cadence` es columna nueva (no en los tipos generados) → query sin tipar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: offers } = await (sb as any)
    .from("offer_brand_map")
    .select("offer_key, offer_label, provider, cadence")
    .in("provider", ["stripe", "square"])
    .eq("brand_id", bId)
    .eq("active", true)
  const offerRows = (offers ?? []) as { offer_key: string; offer_label: string | null; provider: string; cadence: string | null }[]
  if (offerRows.length === 0) return { ok: false, error: "No hay ofertas configuradas para cobrar" }
  // Exigir el plan explícito: NUNCA adivinar (Fable) — mandar el link del plan
  // equivocado sería un cobro erróneo. Si falta, devolver las opciones.
  if (!input.offer_key) {
    const opts = offerRows.map((o) => `${o.offer_label ?? o.offer_key} [${o.offer_key}]`).join(" · ")
    return { ok: false, error: `Falta el plan a cobrar (offer_key). Opciones: ${opts}` }
  }
  const chosen = offerRows.find((o) => o.offer_key === input.offer_key)
  if (!chosen) return { ok: false, error: "Oferta no encontrada para esta marca" }

  // El plan SEMANAL suma la evaluación única de $39.99 (el mensual/trimestral la
  // incluyen). Detecta por cadence='weekly' o por la etiqueta ("semanal"/"weekly").
  const isWeekly =
    chosen.cadence === "weekly" || /semanal|weekly/i.test(chosen.offer_label ?? "")
  const addonPriceId =
    chosen.provider === "stripe" && isWeekly && SCREENING_PRICE_ID
      ? SCREENING_PRICE_ID
      : undefined

  // Link de pago (el builder embebe metadata lead/brand → el webhook concilia).
  const res =
    chosen.provider === "stripe"
      ? await createCheckoutSessionForLead({
          priceId: chosen.offer_key,
          leadId: lead.id,
          brandId: bId,
          email: lead.email ?? undefined,
          baseUrl: SITE_URL,
          addonPriceId,
        })
      : await createSquarePaymentLinkForLead({
          variationId: chosen.offer_key,
          leadId: lead.id,
          brandId: bId,
          baseUrl: SITE_URL,
        })
  if (!res.ok) return { ok: false, error: res.error }

  // Twilio: sid/token/from (número de la marca o global).
  const [sid, token, globalFrom, brandFrom] = await Promise.all([
    getConnectionSecret("twilio", "account_sid"),
    getConnectionSecret("twilio", "auth_token"),
    getConnectionSecret("twilio", "from_number"),
    resolveBrandTwilioFrom(bId, lead.id),
  ])
  const from = brandFrom ?? globalFrom
  if (!sid || !token || !from) return { ok: false, error: "Twilio no está conectado" }

  const body = `Si Se Pierde: aquí está su link de pago seguro 👉 ${res.url} (válido 2 h). Cualquier duda, con gusto le ayudamos.`
  const sent = await sendTwilioSms({ sid, token, from, to, body })
  if (!sent.ok) return { ok: false, error: sent.error }

  // Registrar el SMS saliente en el hilo del paciente.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any).from("messages").insert({
    provider: "twilio",
    brand_id: bId,
    lead_id: lead.id,
    direction: "out",
    channel: "sms",
    body,
    from_number: from,
    to_number: to,
    external_id: sent.sid || null,
    status: "sent",
  })
  return { ok: true, sent: true }
}

// ── 4b) Captura de RESPALDO desde el webhook de Retell (call_ended) ───────────
// Garantiza que TODO el que llame quede en el CRM, aunque cuelgue antes de que
// el bot alcanzara a llamar buscar_o_crear_paciente / registrar_llamada.
// Idempotente: si el bot ya registró la llamada de este lead (últimos 30 min),
// no duplica; solo asegura que el lead exista.
export async function recordCallFromWebhook(call: {
  from_number?: string
  to_number?: string
  direction?: string
  transcript?: string
  disconnection_reason?: string
  recording_url?: string
  metadata?: { lead_id?: string; brand_id?: string } | null
  brand?: string
}): Promise<{ ok: true; created_lead: boolean; logged: boolean } | { ok: false; error: string }> {
  const sb = admin()
  const bId = await brandId(sb, call.brand)
  if (!bId) return { ok: false, error: "Marca no encontrada" }

  const dir: "inbound" | "outbound" = call.direction === "outbound" ? "outbound" : "inbound"
  // El teléfono del PACIENTE es el "from" en entrantes y el "to" en salientes.
  const patientRaw = dir === "outbound" ? call.to_number : call.from_number
  const phone = patientRaw ? normalizeToE164(patientRaw) || null : null
  if (!phone) return { ok: false, error: "Sin número de paciente" }

  // 1) Asegurar el lead (idempotente: busca por teléfono, crea si no existe).
  let leadId = call.metadata?.lead_id ?? null
  let createdLead = false
  if (!leadId) {
    const r = await getOrCreatePatient({ phone, brand: call.brand })
    if (!r.ok) return { ok: false, error: r.error }
    leadId = r.lead_id
    createdLead = r.is_new
  }

  // 2) Dedup: si ya hay una llamada de este lead en los últimos 30 min (el bot
  //    ya la registró con registrar_llamada), no duplicar.
  if (leadId) {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (sb as any)
      .from("calls").select("id").eq("lead_id", leadId).gte("called_at", since).limit(1).maybeSingle()
    if (existing?.id) return { ok: true, created_lead: createdLead, logged: false }
  }

  // 3) Registrar la llamada (respaldo). Motivo de colgado → outcome básico.
  const outcome = call.disconnection_reason === "user_hangup" ? "connected" : undefined
  const res = await logCall({
    phone,
    lead_id: leadId ?? undefined,
    direction: dir,
    outcome,
    transcript: call.transcript,
    recording_url: call.recording_url,
    brand: call.brand,
  })
  if (!res.ok) return { ok: false, error: res.error }
  return { ok: true, created_lead: createdLead, logged: true }
}

// ── 4) Registrar el resultado de la llamada ──────────────────────────────────
const CALL_OUTCOMES = new Set([
  "no_answer", "voicemail", "connected", "appointment_set",
  "not_interested", "callback_requested", "wrong_number",
])
export async function logCall(input: {
  phone?: string
  lead_id?: string
  direction?: "inbound" | "outbound"
  outcome?: string
  summary?: string
  transcript?: string
  recording_url?: string
  brand?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = admin()
  const bId = await brandId(sb, input.brand)
  if (!bId) return { ok: false, error: "Marca no encontrada" }

  let leadId = input.lead_id ?? null
  const callerE164 = input.phone ? normalizeToE164(input.phone) || null : null
  if (!leadId && callerE164) {
    const { data } = await sb
      .from("leads").select("id").eq("brand_id", bId)
      .or(`phone.eq.${callerE164},phone_alt.eq.${callerE164}`).limit(1).maybeSingle()
    leadId = (data as { id: string } | null)?.id ?? null
  }

  const outcome = input.outcome && CALL_OUTCOMES.has(input.outcome) ? input.outcome : null
  // Solo aceptar recording_url https (nada de esquemas raros). Además marcamos
  // transcription_status='done' para que el cron de transcripción NUNCA vaya a
  // buscar esta URL con la API key de 800.com (cierra el SSRF que marcó Fable).
  const rec =
    typeof input.recording_url === "string" && input.recording_url.startsWith("https://")
      ? input.recording_url
      : null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).from("calls").insert({
    brand_id: bId,
    lead_id: leadId,
    direction: input.direction === "outbound" ? "outbound" : "inbound",
    outcome,
    notes: input.summary ?? null,
    transcript_text: input.transcript ?? null,
    recording_url: rec,
    transcription_status: "done",
    source: "retell",
    caller_e164: callerE164,
    called_at: new Date().toISOString(),
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
