import "server-only"
import { createHmac, timingSafeEqual } from "crypto"

/**
 * Cliente mínimo de WhatsApp Cloud API (Meta) + verificación de la firma del
 * webhook. Sin SDK, fetch crudo — mismo patrón que el resto de integraciones
 * (twilio.ts, meta-lead-ads.ts). server-only: el token jamás cruza al cliente.
 *
 * Conceptos de Meta que el CRM tiene que respetar:
 *  - `phone_number_id`: el ID del número que ENVÍA (no es el teléfono en sí).
 *  - `wamid`: el ID único de cada mensaje → lo usamos como `external_id` para
 *    que el webhook sea idempotente (Meta reintenta).
 *  - Ventana de 24h: fuera de ella SOLO se puede mandar plantilla aprobada. Eso
 *    se valida en el servidor, en la acción de envío (no aquí).
 */

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v25.0"
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

export type WaSendResult = { ok: true; wamid: string } | { ok: false; error: string }

/** Meta quiere el destino en dígitos, sin '+' ni separadores. */
function toDigits(e164: string): string {
  return e164.replace(/[^0-9]/g, "")
}

/** Saca el `error.message` de Meta (legible, sin secretos) o un genérico. */
function metaError(status: number, text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; error_user_msg?: string } }
    const m = j.error?.error_user_msg || j.error?.message
    if (m) return `WhatsApp: ${m.slice(0, 160)}`
  } catch {
    /* cuerpo no-JSON */
  }
  return `WhatsApp rechazó el envío (${status}).`
}

async function postMessage(
  phoneNumberId: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<WaSendResult> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[whatsapp] send", res.status, text.slice(0, 300))
      return { ok: false, error: metaError(res.status, text) }
    }
    const j = (await res.json()) as { messages?: { id?: string }[] }
    return { ok: true, wamid: j.messages?.[0]?.id ?? "" }
  } catch (e) {
    console.error("[whatsapp] send threw:", e instanceof Error ? e.message : String(e))
    return { ok: false, error: "No se pudo enviar el WhatsApp." }
  }
}

/** Texto libre. SOLO válido dentro de la ventana de 24h (Meta lo rechaza fuera). */
export async function sendWhatsAppText(args: {
  phoneNumberId: string
  token: string
  to: string
  body: string
}): Promise<WaSendResult> {
  return postMessage(args.phoneNumberId, args.token, {
    to: toDigits(args.to),
    type: "text",
    text: { preview_url: false, body: args.body },
  })
}

/**
 * Plantilla aprobada. Es la ÚNICA forma de iniciar conversación fuera de la
 * ventana de 24h. `bodyParams` llena los {{1}}, {{2}}… del cuerpo, en orden.
 */
export async function sendWhatsAppTemplate(args: {
  phoneNumberId: string
  token: string
  to: string
  name: string
  language: string
  bodyParams?: string[]
}): Promise<WaSendResult> {
  const components = args.bodyParams?.length
    ? [{ type: "body", parameters: args.bodyParams.map((text) => ({ type: "text", text })) }]
    : undefined
  return postMessage(args.phoneNumberId, args.token, {
    to: toDigits(args.to),
    type: "template",
    template: {
      name: args.name,
      language: { code: args.language },
      ...(components ? { components } : {}),
    },
  })
}

export type WaTemplate = {
  name: string
  language: string
  status: string
  category: string | null
  /** Texto del cuerpo tal como Meta lo aprobó (con {{1}}…). Para previsualizar. */
  bodyText: string | null
  /** Cuántos {{n}} tiene el cuerpo → cuántos campos pedirle al vendedor. */
  paramCount: number
}

type RawTemplate = {
  name?: string
  language?: string
  status?: string
  category?: string
  components?: { type?: string; text?: string }[]
}

/** Cuenta los placeholders distintos {{1}}, {{2}}… de un texto de plantilla. */
function countParams(text: string | null): number {
  if (!text) return 0
  const found = new Set<number>()
  for (const m of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) found.add(Number(m[1]))
  return found.size
}

/**
 * Lista las plantillas de la WABA. Solo devuelve las APROBADAS: ofrecerle al
 * vendedor una plantilla en revisión o rechazada garantiza un error de Meta.
 */
export async function listWhatsAppTemplates(args: {
  wabaId: string
  token: string
  signal?: AbortSignal
}): Promise<{ ok: true; templates: WaTemplate[] } | { ok: false; error: string }> {
  try {
    const url =
      `${GRAPH}/${encodeURIComponent(args.wabaId)}/message_templates` +
      `?fields=name,status,category,language,components&limit=200`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${args.token}` },
      signal: args.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[whatsapp] templates", res.status, text.slice(0, 300))
      return { ok: false, error: metaError(res.status, text) }
    }
    const j = (await res.json()) as { data?: RawTemplate[] }
    const templates: WaTemplate[] = (j.data ?? [])
      .filter((t) => (t.status ?? "").toUpperCase() === "APPROVED" && t.name && t.language)
      .map((t) => {
        const bodyText = t.components?.find((c) => (c.type ?? "").toUpperCase() === "BODY")?.text ?? null
        return {
          name: t.name as string,
          language: t.language as string,
          status: (t.status ?? "").toUpperCase(),
          category: t.category ?? null,
          bodyText,
          paramCount: countParams(bodyText),
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ok: true, templates }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Tiempo de espera agotado al pedir las plantillas." }
    }
    console.error("[whatsapp] templates threw:", e instanceof Error ? e.message : String(e))
    return { ok: false, error: "No se pudieron cargar las plantillas." }
  }
}

/**
 * Verifica la firma `X-Hub-Signature-256` del webhook de Meta: HMAC-SHA256 del
 * cuerpo CRUDO (byte por byte, no reserializado) con el App Secret, en hex, con
 * prefijo "sha256=". Comparación en tiempo constante.
 */
export function verifyMetaSignature(
  rawBody: string,
  appSecret: string,
  header: string | null,
): boolean {
  if (!header || !appSecret) return false
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf-8").digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * ¿Se puede ENVIAR por WhatsApp? (phone_number_id + access token presentes, ya
 * sea guardados y cifrados o por env). Gate barato para la UI — no llama a Meta.
 * Vive aquí y no en health.ts para no arrastrar toda la lógica de estado a una
 * página de detalle.
 */
export async function isWhatsAppConfigured(): Promise<boolean> {
  const { getConnectionSecret } = await import("./connections")
  const [id, token] = await Promise.all([
    getConnectionSecret("whatsapp", "phone_number_id"),
    getConnectionSecret("whatsapp", "access_token"),
  ])
  return !!id && !!token
}
