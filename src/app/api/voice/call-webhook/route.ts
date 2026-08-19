import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { recordCallFromWebhook } from "@/lib/voice/core"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Webhook de Retell (evento call_ended). Respaldo para que TODO el que llame
 * quede en el CRM aunque cuelgue antes de que el bot lo registre. Se autentica
 * con ?secret=RETELL_WEBHOOK_SECRET (Retell no manda nuestro Bearer; el secreto
 * viaja en la URL del webhook configurada en Retell). Verificación en tiempo
 * constante; fail-closed si falta el secreto.
 */
function verifySecret(req: Request): boolean {
  const expected = process.env.RETELL_WEBHOOK_SECRET
  if (!expected) return false
  const got = new URL(req.url).searchParams.get("secret") ?? ""
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  if (!verifySecret(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* vacío */ }

  // Solo actuar al terminar la llamada. call_started/call_analyzed se ignoran.
  if (body?.event !== "call_ended") {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const call = body?.call ?? {}
  // La marca puede venir en la URL (?brand=la-esperanza) o en la metadata de la
  // llamada. Default = Si Se Pierde (lo resuelve brandId).
  const brand =
    new URL(req.url).searchParams.get("brand") ?? call?.metadata?.brand ?? undefined

  const r = await recordCallFromWebhook({
    from_number: call.from_number,
    to_number: call.to_number,
    direction: call.direction,
    transcript: call.transcript,
    disconnection_reason: call.disconnection_reason,
    recording_url: call.recording_url,
    metadata: call.metadata ?? null,
    brand: typeof brand === "string" ? brand : undefined,
  })
  // Siempre 200 para que Retell no reintente en bucle por un fallo nuestro.
  return NextResponse.json(r)
}
