import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { verifyTwilioSignature } from "@/lib/integrations/twilio"
import { getConnectionSecret } from "@/lib/integrations/connections"
import { resolveBrandByTwilioNumber } from "@/lib/integrations/brand-numbers"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

const OK_XML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
function xml() {
  return new Response(OK_XML, { headers: { "Content-Type": "text/xml" } })
}

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"])
const START_WORDS = new Set(["START", "YES", "UNSTOP"])

// Busca el lead por teléfono E.164 (phone o phone_alt). Solo enlaza si hay EXACTAMENTE
// un lead (evita atribuir a la persona equivocada si el número está en 2 marcas).
async function matchLead(
  sb: DB,
  e164: string,
): Promise<{ leadId: string; brandId: string | null } | null> {
  if (!e164) return null
  const { data } = await sb
    .from("leads")
    .select("id, brand_id")
    .or(`phone.eq.${e164},phone_alt.eq.${e164}`)
    .limit(2)
  const rows = (data ?? []) as { id: string; brand_id: string | null }[]
  if (rows.length !== 1) return null
  return { leadId: rows[0].id, brandId: rows[0].brand_id }
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  // Reconstruir la URL exacta que Twilio firmó (proto+host+path+query).
  const u = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host
  const proto = request.headers.get("x-forwarded-proto") ?? "https"
  const webhookUrl = `${proto}://${host}${u.pathname}${u.search}`

  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v

  // Verificar firma con el Auth Token (guardado/cifrado o env).
  const token = await getConnectionSecret("twilio", "auth_token")
  if (!token) {
    console.error("[twilio webhook] sin auth token configurado")
    return NextResponse.json({ error: "not configured" }, { status: 503 })
  }
  const sig = request.headers.get("X-Twilio-Signature")
  if (!verifyTwilioSignature(webhookUrl, params, token, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 })
  }

  const from = params.From ?? ""
  const body = (params.Body ?? "").trim()
  const messageSid = params.MessageSid ?? params.SmsSid ?? null
  const e164 = from ? normalizeToE164(from) || null : null

  const sb = createAdminClient() as unknown as SupabaseClient<Database>
  try {
    const match = e164 ? await matchLead(sb, e164) : null

    // Marca del mensaje: la del lead si se pudo vincular; si no, la marca dueña
    // del número NUESTRO que lo recibió (params.To) — así el texto de alguien que
    // aún no es lead cae en la marca/canal correctos (medición de publicidad).
    let brandId = match?.brandId ?? null
    if (!brandId) {
      const toE164 = params.To ? normalizeToE164(params.To) || null : null
      if (toE164) brandId = await resolveBrandByTwilioNumber(toE164)
    }

    // STOP / START: el consentimiento pertenece al NÚMERO, no a un lead. Se
    // aplica a TODOS los leads con ese teléfono (aunque haya duplicados o esté en
    // 2 marcas), independientemente de si la atribución del mensaje fue única.
    const upper = body.toUpperCase()
    if (e164 && (STOP_WORDS.has(upper) || START_WORDS.has(upper))) {
      const optOut = STOP_WORDS.has(upper)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (sb as any).from("leads")
        .update({ sms_opt_out: optOut, sms_opt_out_at: optOut ? new Date().toISOString() : null })
        .or(`phone.eq.${e164},phone_alt.eq.${e164}`)
    }

    // Registrar el mensaje entrante (idempotente por MessageSid).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any).from("messages").upsert(
      {
        provider: "twilio",
        brand_id: brandId,
        lead_id: match?.leadId ?? null,
        direction: "in",
        channel: "sms",
        body,
        from_number: from,
        to_number: params.To ?? null,
        external_id: messageSid,
        status: params.SmsStatus ?? "received",
        raw: params,
      },
      { onConflict: "provider,external_id" },
    )
    if (error) {
      console.error("[twilio webhook] insert:", error.message)
      return NextResponse.json({ error: "db error" }, { status: 500 })
    }
    return xml()
  } catch (e) {
    console.error("[twilio webhook] threw:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
