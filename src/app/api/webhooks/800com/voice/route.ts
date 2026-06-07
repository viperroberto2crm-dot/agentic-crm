/**
 * 800.com webhook endpoint para eventos de calls en tiempo real.
 *
 * Eventos manejados:
 *   - call_started     → INSERT call con outcome=null (ringing)
 *   - call_completed   → UPDATE call con outcome + duration_seconds + ended
 *   - call_decorated   → UPDATE call con recording_url + transcription
 *   - call_updated     → UPDATE con cualquier cambio post-decoration
 *
 * Dedup: por `external_id` (ID del call en 800.com, único globalmente).
 * Idempotencia: re-procesar el mismo evento NO crea duplicados.
 *
 * Autenticación: shared secret en query param `?secret=XXX`.
 * 800.com docs v2 no documentan firma HMAC en la spec swagger; usamos
 * secret-in-URL como fallback simple. Si más adelante encontramos que sí
 * envían X-Signature header, switcheamos a HMAC-SHA256.
 *
 * Setup:
 *   1. Set EIGHTHUNDRED_WEBHOOK_SECRET en Vercel env (Sensitive)
 *   2. Registrar webhook en 800.com con URL:
 *      https://proyectosagentic-crm.vercel.app/api/webhooks/800com/voice?secret=<SECRET>
 *      events: [call_started, call_completed, call_decorated, call_updated]
 */

import { NextResponse, after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Shape REAL que envía 800.com v2 (descubierto via delivery history):
 *
 *   {
 *     "type": "call_started",
 *     "data": {
 *       "id": 138260337,
 *       "caller": "+17149260731",
 *       "dialed": "+18883073743",
 *       "result": "missed",          ← se usa para outcome (en completed)
 *       "status": "Started",         ← evento, NO outcome
 *       "numberId": 416682,          ← flat, NO data.number.id
 *       "isInbound": true,           ← boolean, NO direction
 *       "startedAt": "...",
 *       "answeredAt": "..." | null,
 *       "endedAt": "..." | null,
 *       "recordingUrl": "..." | null,
 *       ...
 *     }
 *   }
 */
type WebhookFeature = "call_started" | "call_completed" | "call_decorated" | "call_updated" | "sms_received"

type CallObject = {
  id: number | string
  caller?: string
  dialed?: string
  // Direction: 800.com manda isInbound boolean; toleramos también 'direction' por si acaso
  isInbound?: boolean
  direction?: "inbound" | "outbound"
  // Outcome: 800.com manda result en call_completed
  result?: "missed" | "answered" | "voicemail" | "hungup"
  // status es el estado del evento ("Started", "Completed", ...) NO el outcome
  status?: string | null
  startedAt?: string
  endedAt?: string | null
  answeredAt?: string | null
  duration?: number | null
  recordingUrl?: string | null
  voicemailUrl?: string | null
  recording?: string | null
  transcription?: unknown
  // Number tracking id: 800.com manda numberId flat
  numberId?: number
  number?: { id?: string | number; number?: string; label?: string | null } | null
}

type WebhookBody = {
  // 800.com v2 envía 'type'; aceptamos 'feature' como fallback por si cambia
  type?: WebhookFeature
  feature?: WebhookFeature
  data?: CallObject
}

function mapResultToOutcome(
  result: CallObject["result"],
): Database["public"]["Enums"]["call_outcome"] | null {
  switch (result) {
    case "answered":
      return "connected"
    case "voicemail":
      return "voicemail"
    case "missed":
    case "hungup":
      return "no_answer"
    default:
      return null
  }
}

function recordingUrlOf(call: CallObject): string | null {
  return call.recordingUrl ?? call.recording ?? null
}

/**
 * Buscar lead por phone (E.164 contra leads.phone o phone_alt) dentro de
 * la marca dueña del tracking number.
 */
async function findLeadByPhone(
  sb: DB,
  brandId: string,
  callerE164: string,
): Promise<string | null> {
  const { data: byPhone } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", brandId)
    .eq("phone", callerE164)
    .limit(1)
    .maybeSingle()
  if (byPhone?.id) return byPhone.id

  const { data: byAlt } = await sb
    .from("leads")
    .select("id")
    .eq("brand_id", brandId)
    .eq("phone_alt", callerE164)
    .limit(1)
    .maybeSingle()
  return byAlt?.id ?? null
}

/**
 * Resolver tracking number → brand + rep fallback.
 *
 * 800.com payload trae data.number.id (string o number) que matchea con
 * tracking_numbers.provider_metadata.number_id en nuestra DB. NO existe
 * columna `external_id` en tracking_numbers — el matching es por el JSON
 * metadata (mismo patrón que el cron polling de 800com.ts).
 *
 * Si number.id no resuelve, intentamos también match por phone_e164 contra
 * data.dialed (el número marcado por el cliente).
 */
async function resolveTracking(
  sb: DB,
  trackingNumberId: string | number | null,
  dialedE164: string | null,
): Promise<{ brand_id: string; rep_id: string; tracking_number_id: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = (sb as any)
    .from("tracking_numbers")
    .select("id, brand_id, phone_e164, provider_metadata")
    .eq("provider", "800com")
    .eq("active", true)
  // Trae todos los tracking_numbers de 800com (es lista corta, ~pocos)
  const { data: rows } = await query
  if (!rows || rows.length === 0) return null

  type Row = { id: string; brand_id: string; phone_e164: string | null; provider_metadata: { number_id?: number } | null }
  const list = rows as Row[]

  // Match 1: por number_id en provider_metadata
  let matched: Row | null = null
  if (trackingNumberId != null) {
    const nidNum = typeof trackingNumberId === "string" ? parseInt(trackingNumberId, 10) : trackingNumberId
    matched =
      list.find((r) => typeof r.provider_metadata?.number_id === "number" && r.provider_metadata.number_id === nidNum) ??
      null
  }
  // Match 2 (fallback): por phone_e164 contra el número marcado
  if (!matched && dialedE164) {
    const normalized = dialedE164.replace(/[^\d+]/g, "")
    matched =
      list.find((r) => {
        const p = (r.phone_e164 ?? "").replace(/[^\d+]/g, "")
        return p && (p === normalized || p.endsWith(normalized.slice(-10)))
      }) ?? null
  }
  if (!matched) return null

  // Rep de la llamada: un usuario DEL BRAND correcto (no el admin global más
  // viejo). Los leads van al pool, pero la call necesita un rep_id; admin/manager
  // igual ven todas las calls por RLS, así que el toast les llega.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: brandUser } = await (sb as any)
    .from("user_brands")
    .select("user_id, users!inner(id, role, active)")
    .eq("brand_id", matched.brand_id)
    .eq("users.active", true)
    .in("users.role", ["rep", "manager", "admin"])
    .limit(1)
    .maybeSingle()
  let repId: string | null = brandUser?.user_id ?? null
  if (!repId) {
    // Fallback: cualquier admin activo, para NO descartar la llamada.
    const { data: anyAdmin } = await sb
      .from("users")
      .select("id")
      .eq("active", true)
      .eq("role", "admin")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    repId = anyAdmin?.id ?? null
  }
  if (!repId) return null

  return { brand_id: matched.brand_id, rep_id: repId, tracking_number_id: matched.id }
}

async function handleCallEvent(
  sb: DB,
  feature: WebhookFeature,
  call: CallObject,
): Promise<{ ok: true; action: "inserted" | "updated" | "skipped"; reason?: string }> {
  const externalId = String(call.id)
  if (!externalId) return { ok: true, action: "skipped", reason: "no call id" }

  // ¿Existe ya? Dedup por external_id
  const { data: existing } = await sb
    .from("calls")
    .select("id, brand_id, lead_id, rep_id")
    .eq("external_id", externalId)
    .eq("source", "800com")
    .maybeSingle()

  // CASO 1: existe → UPDATE con los nuevos datos
  if (existing?.id) {
    const updates: Record<string, unknown> = {}
    if (feature === "call_completed" || feature === "call_updated") {
      // En call_completed, result contiene el outcome real.
      // En call_started, result="missed" porque aún no se contestó — no usar.
      const outcome = mapResultToOutcome(call.result)
      if (outcome) updates.outcome = outcome
      if (typeof call.duration === "number") updates.duration_seconds = call.duration
    }
    if (feature === "call_decorated" || feature === "call_updated") {
      const url = recordingUrlOf(call)
      if (url) updates.recording_url = url
      if (call.transcription) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(updates as any).transcription = call.transcription
      }
    }
    if (Object.keys(updates).length === 0) {
      return { ok: true, action: "skipped", reason: "no fields to update" }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any).from("calls").update(updates).eq("id", existing.id)
    if (error) {
      console.error("[800com webhook] update error:", error.message)
      return { ok: true, action: "skipped", reason: error.message }
    }
    return { ok: true, action: "updated" }
  }

  // CASO 2: no existe → INSERT (call nueva, probablemente call_started)
  // 800.com manda numberId flat; toleramos también number.id por si cambia
  const trackingId = call.numberId ?? call.number?.id ?? null
  const dialedNumber = call.dialed ?? call.number?.number ?? null
  const tracking = await resolveTracking(sb, trackingId, dialedNumber)
  if (!tracking) {
    return {
      ok: true,
      action: "skipped",
      reason: `tracking_number id=${trackingId} dialed=${dialedNumber} no encontrado en tracking_numbers (provider=800com)`,
    }
  }

  const callerE164 = call.caller ?? ""
  const leadId = callerE164 ? await findLeadByPhone(sb, tracking.brand_id, callerE164) : null

  // Dirección: 800.com manda isInbound boolean. Default a inbound SOLO si no
  // viene ninguna señal; si isInbound===false es saliente (antes se marcaba
  // inbound por error → toast fantasma + ECID gastado).
  const isInbound =
    call.isInbound === true ||
    call.direction === "inbound" ||
    (call.isInbound === undefined && call.direction === undefined)
  const direction: Database["public"]["Enums"]["call_direction"] = isInbound ? "inbound" : "outbound"
  // En call_started, NO mapear result (siempre será "missed" antes de contestar).
  // Solo mapear si el evento es completed/updated.
  const outcome =
    feature === "call_completed" || feature === "call_updated"
      ? mapResultToOutcome(call.result)
      : null
  const recordingUrl = recordingUrlOf(call)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: any = {
    brand_id: tracking.brand_id,
    lead_id: leadId,
    rep_id: tracking.rep_id,
    direction,
    outcome,
    duration_seconds: typeof call.duration === "number" ? call.duration : null,
    caller_e164: callerE164 || null,
    dialed_e164: dialedNumber,
    tracking_number_id: tracking.tracking_number_id,
    notes: null,
    source: "800com",
    external_id: externalId,
    recording_url: recordingUrl,
    called_at: call.startedAt ?? new Date().toISOString(),
    ringing_at: call.startedAt ?? new Date().toISOString(),
  }
  if (call.transcription) insertPayload.transcription = call.transcription

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any).from("calls").insert(insertPayload)
  if (error) {
    // Race: si llegan call_started y call_completed casi simultáneos, podría
    // intentar 2 inserts del mismo external_id. Tratamos como OK (otro
    // request ganó la carrera).
    if (error.message?.includes("duplicate")) {
      return { ok: true, action: "skipped", reason: "race: duplicate" }
    }
    console.error("[800com webhook] insert error:", error.message)
    return { ok: true, action: "skipped", reason: error.message }
  }
  return { ok: true, action: "inserted" }
}

export async function POST(request: Request) {
  // Auth via shared secret en query param
  const url = new URL(request.url)
  const providedSecret = url.searchParams.get("secret")
  const expectedSecret = process.env.EIGHTHUNDRED_WEBHOOK_SECRET
  if (!expectedSecret) {
    console.error("[800com webhook] EIGHTHUNDRED_WEBHOOK_SECRET not configured")
    return NextResponse.json({ error: "not configured" }, { status: 500 })
  }
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: WebhookBody
  try {
    body = (await request.json()) as WebhookBody
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  // Log para entender el shape exacto que manda 800.com (útil al principio
  // para descubrir cualquier campo no documentado)
  console.log("[800com webhook] received:", JSON.stringify(body).slice(0, 500))

  // 800.com manda 'type'; aceptamos 'feature' como fallback
  const feature = body.type ?? body.feature
  if (!feature) {
    return NextResponse.json({ error: "missing type/feature" }, { status: 400 })
  }

  // sms_received se ignora por ahora (no impacta calls table)
  if (feature === "sms_received") {
    return NextResponse.json({ ok: true, action: "ignored_sms" })
  }

  if (!body.data) {
    return NextResponse.json({ error: "missing data" }, { status: 400 })
  }

  // Deferir el trabajo pesado (DB queries + insert) para responder 200
  // inmediatamente. 800.com tiene un timeout corto: en cold start de Vercel
  // las queries tardan ~3-5s y 800.com da timeout (httpResponseCode: 0).
  // Con after() respondemos en <100ms y procesamos en background, sin perder
  // ningún evento. El INSERT llega ~1-2s después → Realtime → toast.
  const data = body.data
  const callId = data.id
  after(async () => {
    try {
      const sb = createAdminClient() as unknown as DB
      const result = await handleCallEvent(sb, feature, data)
      console.log(
        `[800com webhook] feature=${feature} call_id=${callId} action=${result.action}${
          "reason" in result && result.reason ? ` reason=${result.reason}` : ""
        }`,
      )
    } catch (err) {
      console.error(
        `[800com webhook] background error feature=${feature} call_id=${callId}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  })

  return NextResponse.json({ ok: true, accepted: true, feature })
}

export async function GET() {
  // Healthcheck — para verificar que el endpoint responde
  return NextResponse.json({ ok: true, endpoint: "800com voice webhook" })
}
