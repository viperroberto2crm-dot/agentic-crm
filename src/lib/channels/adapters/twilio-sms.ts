import "server-only"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { sendTwilioSms, verifyTwilioSignature } from "@/lib/integrations/twilio"
import { getConnectionSecret } from "@/lib/integrations/connections"
import { resolveBrandTwilioFrom, resolveBrandByTwilioNumber } from "@/lib/integrations/brand-numbers"
import type { ChannelAdapter, ParsedWebhook } from "../types"

/**
 * SMS por Twilio. Mismo comportamiento que tenía la ruta suelta
 * `/api/webhooks/twilio` — aquí solo quedó lo que es propio de Twilio.
 */

const OK_XML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

export const twilioSmsAdapter: ChannelAdapter = {
  key: "sms",
  provider: "twilio",
  integration: "twilio",

  optOut: { column: "sms_opt_out", atColumn: "sms_opt_out_at" },
  stopWords: new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]),
  startWords: new Set(["START", "YES", "UNSTOP"]),

  async verifySignature({ rawBody, headers, webhookUrl }) {
    const token = await getConnectionSecret("twilio", "auth_token")
    if (!token) {
      console.error("[sms] sin auth token configurado")
      return { configured: false, ok: false }
    }
    const params: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v
    const ok = verifyTwilioSignature(webhookUrl, params, token, headers.get("X-Twilio-Signature"))
    return { configured: true, ok }
  },

  parse(rawBody): ParsedWebhook {
    const params: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(rawBody)) params[k] = v

    const externalId = params.MessageSid ?? params.SmsSid ?? ""
    if (!externalId) return { messages: [], statuses: [] }

    const from = params.From ?? ""
    return {
      statuses: [],
      messages: [
        {
          externalId,
          // OJO: se guarda el `From` CRUDO, como siempre lo hizo esta ruta.
          from: from || null,
          fromE164: from ? normalizeToE164(from) || null : null,
          to: params.To ?? null,
          body: (params.Body ?? "").trim(),
          sentAt: null,
          status: params.SmsStatus ?? "received",
          raw: params,
          receiverId: params.To ? normalizeToE164(params.To) || null : null,
        },
      ],
    }
  },

  ack() {
    return new Response(OK_XML, { headers: { "Content-Type": "text/xml" } })
  },

  async resolveBrand(receiverId) {
    return receiverId ? resolveBrandByTwilioNumber(receiverId) : null
  },

  async send({ brandId, leadId, to, body }) {
    if (!body) return { ok: false, error: "El SMS no puede ir vacío." }

    const [sid, token, globalFrom, brandFrom] = await Promise.all([
      getConnectionSecret("twilio", "account_sid"),
      getConnectionSecret("twilio", "auth_token"),
      getConnectionSecret("twilio", "from_number"),
      // Número de ENVÍO de la marca (tracking_numbers, provider Twilio). Si la
      // marca no tiene número propio, cae al from_number global.
      resolveBrandTwilioFrom(brandId, leadId),
    ])

    let from = brandFrom
    if (!from && globalFrom) {
      // Respaldo global — pero NO si ese número está registrado como el de OTRA
      // marca (evitaría que esta marca envíe desde el número ajeno y que las
      // respuestas se atribuyan a la otra marca). Fail-closed.
      const globalOwner = await resolveBrandByTwilioNumber(globalFrom)
      if (globalOwner && globalOwner !== brandId) {
        return {
          ok: false,
          error:
            "Esta marca no tiene número de envío propio. Agrega su número Twilio en Configuración → Números de rastreo.",
        }
      }
      from = globalFrom
    }
    if (!sid || !token || !from) {
      return { ok: false, error: "Twilio no está conectado (falta SID, token o número de envío)." }
    }

    const sent = await sendTwilioSms({ sid, token, from, to, body })
    if (!sent.ok) return sent
    return { ok: true, externalId: sent.sid, threadBody: body, from }
  },
}
