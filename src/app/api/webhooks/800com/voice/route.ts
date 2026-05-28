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

import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CallObject = {
  id: number | string
  parentId?: number | null
  caller?: string
  dialed?: string
  direction?: "inbound" | "outbound"
  status?: "missed" | "answered" | "voicemail" | "hungup"
  startedAt?: string
  endedAt?: string | null
  answeredAt?: string | null
  ringDuration?: number | null
  duration?: number | null
  recordingUrl?: string | null
  recording?: string | null
  transcription?: unknown
  number?: { id?: string; number?: string; label?: string | null } | null
  forwardNumber?: string
  answeredBy?: string | null
  disconnectCause?: string | null
  disconnectCauseMessage?: string | null
}

type WebhookBody = {
  feature?: "call_started" | "call_completed" | "call_decorated" | "call_updated" | "sms_received"
  data?: CallObject
}

function mapStatusToOutcome(
  status: CallObject["status"],
): Database["public"]["Enums"]["call_outcome"] | null {
  switch (status) {
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
 * El tracking number id viene en data.number.id (string).
 */
async function resolveTracking(
  sb: DB,
  trackingNumberId: string | null,
): Promise<{ brand_id: string; rep_id: string } | null> {
  if (!trackingNumberId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("tracking_numbers")
    .select("brand_id, default_rep_id, provider_metadata")
    .eq("provider", "800com")
    .eq("external_id", trackingNumberId)
    .maybeSingle()
  if (!data?.brand_id) return null

  // Fallback rep si tracking no tiene default_rep_id
  let repId: string | null = data.default_rep_id ?? null
  if (!repId) {
    const { data: anyUser } = await sb
      .from("users")
      .select("id")
      .eq("active", true)
      .in("role", ["admin", "manager", "rep"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    repId = anyUser?.id ?? null
  }
  if (!repId) return null
  return { brand_id: data.brand_id, rep_id: repId }
}

async function handleCallEvent(
  sb: DB,
  feature: NonNullable<WebhookBody["feature"]>,
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
      const outcome = mapStatusToOutcome(call.status)
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
  const trackingId = call.number?.id ?? null
  const tracking = await resolveTracking(sb, trackingId)
  if (!tracking) {
    return {
      ok: true,
      action: "skipped",
      reason: `tracking_number ${trackingId} no encontrado en CRM`,
    }
  }

  const callerE164 = call.caller ?? ""
  const leadId = callerE164 ? await findLeadByPhone(sb, tracking.brand_id, callerE164) : null

  const direction: Database["public"]["Enums"]["call_direction"] =
    call.direction === "outbound" ? "outbound" : "inbound"
  const outcome = mapStatusToOutcome(call.status)
  const recordingUrl = recordingUrlOf(call)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertPayload: any = {
    brand_id: tracking.brand_id,
    lead_id: leadId,
    rep_id: tracking.rep_id,
    direction,
    outcome,
    duration_seconds: typeof call.duration === "number" ? call.duration : null,
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

  if (!body.feature) {
    return NextResponse.json({ error: "missing feature" }, { status: 400 })
  }

  // sms_received se ignora por ahora (no impacta calls table)
  if (body.feature === "sms_received") {
    return NextResponse.json({ ok: true, action: "ignored_sms" })
  }

  if (!body.data) {
    return NextResponse.json({ error: "missing data" }, { status: 400 })
  }

  const sb = createAdminClient() as unknown as DB
  const result = await handleCallEvent(sb, body.feature, body.data)
  return NextResponse.json(result)
}

export async function GET() {
  // Healthcheck — para verificar que el endpoint responde
  return NextResponse.json({ ok: true, endpoint: "800com voice webhook" })
}
