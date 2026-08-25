import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  listWhatsAppTemplates,
  verifyMetaSignature,
} from "@/lib/integrations/whatsapp"
import { getConnectionSecret } from "@/lib/integrations/connections"
import { resolveBrandWhatsAppSender, resolveBrandByWhatsAppPhoneId } from "@/lib/integrations/brand-numbers"
import { timingSafeEqual } from "crypto"
import type { ChannelAdapter, ParsedWebhook, InboundMessage, StatusUpdate } from "../types"

/**
 * WhatsApp Cloud API (Meta). Lo propio de este canal:
 *  - handshake GET con hub.challenge,
 *  - firma HMAC-SHA256 del cuerpo CRUDO,
 *  - la VENTANA DE 24H: fuera de ella Meta solo acepta plantilla aprobada.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

const WA_WINDOW_MS = 24 * 60 * 60 * 1000

type WaMessage = {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
}

/**
 * Texto legible del mensaje. WhatsApp manda audio/imagen/documento/ubicación;
 * el hilo del CRM es de texto, así que dejamos una marca clara de qué llegó
 * (el JSON completo queda en `raw` para no perder nada).
 */
function readableBody(m: WaMessage): string {
  const t = (m.type ?? "text").toLowerCase()
  if (t === "text") return m.text?.body ?? ""
  if (t === "button") return m.button?.text ?? "[botón]"
  if (t === "interactive") {
    return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[respuesta]"
  }
  const LABEL: Record<string, string> = {
    image: "[imagen]",
    audio: "[audio]",
    voice: "[nota de voz]",
    video: "[video]",
    document: "[documento]",
    sticker: "[sticker]",
    location: "[ubicación]",
    contacts: "[contacto]",
    reaction: "[reacción]",
  }
  return LABEL[t] ?? `[${t}]`
}

/** Comparación en tiempo constante para el verify_token. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Sustituye {{1}}, {{2}}… del cuerpo de la plantilla para guardarlo en el hilo. */
function fillTemplateBody(bodyText: string, params: string[]): string {
  return bodyText.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`)
}

/** Timestamp del último WhatsApp entrante del paciente, o null si nunca escribió. */
async function lastInboundAt(leadId: string): Promise<number | null> {
  const sb = createAdminClient() as AnyClient
  const { data } = await sb
    .from("messages")
    .select("created_at")
    .eq("lead_id", leadId)
    .eq("channel", "whatsapp")
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
  const row = ((data ?? []) as { created_at: string }[])[0]
  if (!row) return null
  const t = new Date(row.created_at).getTime()
  return Number.isFinite(t) ? t : null
}

export const whatsappCloudAdapter: ChannelAdapter = {
  key: "whatsapp",
  provider: "whatsapp",
  integration: "whatsapp",

  // El consentimiento de WhatsApp es INDEPENDIENTE del de SMS: para Meta son
  // canales distintos, y un STOP en uno no apaga el otro.
  optOut: { column: "wa_opt_out", atColumn: "wa_opt_out_at" },
  stopWords: new Set(["STOP", "BAJA", "CANCELAR", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ALTO"]),
  startWords: new Set(["START", "ALTA", "YES", "UNSTOP"]),

  async verifyChallenge(url) {
    const q = url.searchParams
    const mode = q.get("hub.mode")
    const token = q.get("hub.verify_token")
    const challenge = q.get("hub.challenge")

    const expected = await getConnectionSecret("whatsapp", "verify_token")
    if (!expected) {
      console.error("[whatsapp] sin verify_token configurado")
      return Response.json({ error: "not configured" }, { status: 503 })
    }
    if (mode === "subscribe" && token && safeEqual(token, expected) && challenge) {
      // Meta exige el challenge crudo, en texto plano.
      return new Response(challenge, { headers: { "Content-Type": "text/plain" } })
    }
    return Response.json({ error: "forbidden" }, { status: 403 })
  },

  async verifySignature({ rawBody, headers }) {
    const appSecret = await getConnectionSecret("whatsapp", "app_secret")
    if (!appSecret) {
      console.error("[whatsapp] sin app_secret configurado")
      return { configured: false, ok: false }
    }
    const ok = verifyMetaSignature(rawBody, appSecret, headers.get("x-hub-signature-256"))
    return { configured: true, ok }
  },

  parse(rawBody): ParsedWebhook {
    let payload: {
      entry?: {
        changes?: {
          field?: string
          value?: {
            metadata?: { display_phone_number?: string; phone_number_id?: string }
            messages?: WaMessage[]
            statuses?: {
              id?: string
              status?: string
              errors?: { title?: string; message?: string }[]
            }[]
          }
        }[]
      }[]
    }
    try {
      payload = JSON.parse(rawBody)
    } catch {
      return { messages: [], statuses: [] }
    }

    const messages: InboundMessage[] = []
    const statuses: StatusUpdate[] = []

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if ((change.field ?? "messages") !== "messages") continue
        const value = change.value
        if (!value) continue

        const phoneNumberId = value.metadata?.phone_number_id ?? null
        const ourNumber = value.metadata?.display_phone_number
          ? normalizeToE164(value.metadata.display_phone_number) || null
          : null

        for (const st of value.statuses ?? []) {
          if (!st.id || !st.status) continue
          const failure = st.errors?.[0]
          statuses.push({
            externalId: st.id,
            status: failure
              ? `failed: ${(failure.title ?? failure.message ?? "").slice(0, 120)}`
              : st.status,
          })
        }

        for (const m of value.messages ?? []) {
          if (!m.id) continue
          const e164 = m.from ? normalizeToE164(m.from) || null : null
          messages.push({
            externalId: m.id,
            from: e164 ?? m.from ?? null,
            fromE164: e164,
            to: ourNumber,
            body: readableBody(m),
            // El timestamp de Meta viene en segundos.
            sentAt: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null,
            status: "received",
            raw: { message: m, metadata: value.metadata ?? null },
            receiverId: phoneNumberId,
          })
        }
      }
    }
    return { messages, statuses }
  },

  ack() {
    return Response.json({ ok: true })
  },

  async resolveBrand(receiverId) {
    return receiverId ? resolveBrandByWhatsAppPhoneId(receiverId) : null
  },

  async checkSendPolicy({ leadId, template }) {
    // Con plantilla aprobada siempre se puede: es justo lo que Meta permite para
    // reabrir. El texto libre solo dentro de la ventana.
    if (template) return { ok: true }
    const last = await lastInboundAt(leadId)
    if (last !== null && Date.now() - last < WA_WINDOW_MS) return { ok: true }
    return {
      ok: false,
      error:
        "Pasaron más de 24h desde el último mensaje del paciente. WhatsApp solo permite reabrir la conversación con una plantilla aprobada.",
    }
  },

  async send({ brandId, to, body, template }) {
    const [globalPhoneId, token, brandPhoneId] = await Promise.all([
      getConnectionSecret("whatsapp", "phone_number_id"),
      getConnectionSecret("whatsapp", "access_token"),
      resolveBrandWhatsAppSender(brandId),
    ])
    const phoneNumberId = brandPhoneId ?? globalPhoneId
    if (!phoneNumberId || !token) {
      return { ok: false, error: "WhatsApp no está conectado (falta Phone Number ID o access token)." }
    }

    if (template) {
      const params = template.params ?? []
      const sent = await sendWhatsAppTemplate({
        phoneNumberId,
        token,
        to,
        name: template.name,
        language: template.language,
        bodyParams: params.length ? params : undefined,
      })
      if (!sent.ok) return sent

      // Para el hilo se guarda el texto REAL que le llegó al paciente. Si no se
      // puede leer la plantilla, queda una referencia clara en vez de nada.
      let threadBody = `[plantilla: ${template.name}]${params.length ? ` ${params.join(" · ")}` : ""}`
      const wabaId = await getConnectionSecret("whatsapp", "waba_id")
      if (wabaId) {
        const list = await listWhatsAppTemplates({ wabaId, token })
        if (list.ok) {
          const tpl = list.templates.find(
            (t) => t.name === template.name && t.language === template.language,
          )
          if (tpl?.bodyText) threadBody = fillTemplateBody(tpl.bodyText, params)
        }
      }
      return { ok: true, externalId: sent.wamid, threadBody, from: phoneNumberId }
    }

    if (!body) return { ok: false, error: "El mensaje no puede ir vacío." }
    const sent = await sendWhatsAppText({ phoneNumberId, token, to, body })
    if (!sent.ok) return sent
    return { ok: true, externalId: sent.wamid, threadBody: body, from: phoneNumberId }
  },
}
