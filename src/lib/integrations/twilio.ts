import "server-only"
import { createHmac, timingSafeEqual } from "crypto"

/**
 * Cliente mínimo de Twilio (SMS) + verificación de firma del webhook. Sin SDK,
 * fetch crudo (mismo patrón que el resto de integraciones). server-only.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01"

export type SendResult = { ok: true; sid: string } | { ok: false; error: string }

/** Envía un SMS. Basic auth = Account SID : Auth Token. */
export async function sendTwilioSms(args: {
  sid: string
  token: string
  from: string
  to: string
  body: string
}): Promise<SendResult> {
  try {
    const auth = Buffer.from(`${args.sid}:${args.token}`).toString("base64")
    const params = new URLSearchParams({ From: args.from, To: args.to, Body: args.body })
    const res = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(args.sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[twilio] send", res.status, text.slice(0, 200))
      // Twilio devuelve un `message` legible; lo pasamos acotado (no hay secreto ahí).
      let detail = `Twilio rechazó el envío (${res.status}).`
      try {
        const j = JSON.parse(text) as { message?: string }
        if (j.message) detail = `Twilio: ${j.message.slice(0, 140)}`
      } catch { /* ignore */ }
      return { ok: false, error: detail }
    }
    const j = (await res.json()) as { sid?: string }
    return { ok: true, sid: j.sid ?? "" }
  } catch (e) {
    console.error("[twilio] send threw:", e instanceof Error ? e.message : String(e))
    return { ok: false, error: "No se pudo enviar el SMS." }
  }
}

/**
 * Verifica la firma X-Twilio-Signature de un webhook entrante.
 * Algoritmo (twilio-node, confirmado): HMAC-SHA1 con el Auth Token sobre
 * (URL exacta del webhook + concatenación de key+value de los params POST
 * ordenados por key), en base64. Comparación en tiempo constante.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  token: string,
  header: string | null,
): boolean {
  if (!header || !token) return false
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  const expected = createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64")
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  return a.length === b.length && timingSafeEqual(a, b)
}
