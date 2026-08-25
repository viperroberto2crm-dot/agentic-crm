import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { verifyMetaSignature } from "@/lib/integrations/whatsapp"
import { getConnectionSecret } from "@/lib/integrations/connections"
import { resolveBrandByWhatsAppPhoneId } from "@/lib/integrations/brand-numbers"

/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 *  GET  → handshake de verificación de Meta (hub.challenge).
 *  POST → eventos: mensajes entrantes del paciente y cambios de estado
 *         (sent/delivered/read/failed) de los que nosotros mandamos.
 *
 * Los entrantes caen en la MISMA tabla `messages` que el SMS, con
 * provider='whatsapp' / channel='whatsapp' y external_id = wamid, así el hilo de
 * la ficha del paciente los muestra sin lógica aparte. Idempotente: Meta
 * reintenta el mismo evento y el índice único (provider, external_id) lo absorbe.
 *
 * URL a registrar en Meta → App → WhatsApp → Configuration:
 *   https://<dominio>/api/webhooks/whatsapp
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

const STOP_WORDS = new Set(["STOP", "BAJA", "CANCELAR", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "ALTO"])
const START_WORDS = new Set(["START", "ALTA", "YES", "UNSTOP"])

/** Comparación en tiempo constante para el verify_token (evita fuga por timing). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// ── GET: verificación del webhook ────────────────────────────────────────────

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const mode = q.get("hub.mode")
  const token = q.get("hub.verify_token")
  const challenge = q.get("hub.challenge")

  const expected = await getConnectionSecret("whatsapp", "verify_token")
  if (!expected) {
    console.error("[whatsapp webhook] sin verify_token configurado")
    return NextResponse.json({ error: "not configured" }, { status: 503 })
  }
  if (mode === "subscribe" && token && safeEqual(token, expected) && challenge) {
    // Meta exige el challenge crudo, en texto plano.
    return new Response(challenge, { headers: { "Content-Type": "text/plain" } })
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 })
}

// ── POST: eventos ────────────────────────────────────────────────────────────

/**
 * Busca el lead por teléfono E.164 (phone o phone_alt). Solo vincula si hay
 * EXACTAMENTE uno — mismo criterio que el webhook de Twilio: ante duplicados o
 * un número presente en 2 marcas, preferimos no atribuir a la persona equivocada.
 */
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

type WaMessage = {
  id?: string
  from?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: {
    button_reply?: { title?: string }
    list_reply?: { title?: string }
  }
}

type WaStatus = {
  id?: string
  status?: string
  recipient_id?: string
  errors?: { title?: string; message?: string }[]
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

export async function POST(request: Request) {
  // El cuerpo CRUDO es lo que Meta firmó: hay que leerlo como texto y no
  // reserializarlo, o la firma nunca cuadra.
  const rawBody = await request.text()

  const appSecret = await getConnectionSecret("whatsapp", "app_secret")
  if (!appSecret) {
    console.error("[whatsapp webhook] sin app_secret configurado")
    return NextResponse.json({ error: "not configured" }, { status: 503 })
  }
  const sig = request.headers.get("x-hub-signature-256")
  if (!verifyMetaSignature(rawBody, appSecret, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 })
  }

  let payload: {
    entry?: {
      changes?: {
        field?: string
        value?: {
          metadata?: { display_phone_number?: string; phone_number_id?: string }
          messages?: WaMessage[]
          statuses?: WaStatus[]
        }
      }[]
    }[]
  }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    // Cuerpo ilegible pero firmado: no tiene caso que Meta reintente.
    return NextResponse.json({ ok: true })
  }

  const sb = createAdminClient() as unknown as SupabaseClient<Database>

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if ((change.field ?? "messages") !== "messages") continue
        const value = change.value
        if (!value) continue

        const phoneNumberId = value.metadata?.phone_number_id ?? ""
        const ourNumber = value.metadata?.display_phone_number
          ? normalizeToE164(value.metadata.display_phone_number) || null
          : null

        // 1) Cambios de estado de NUESTROS envíos (sent → delivered → read).
        for (const st of value.statuses ?? []) {
          if (!st.id || !st.status) continue
          const failure = st.errors?.[0]
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (sb as any)
            .from("messages")
            .update({
              status: failure
                ? `failed: ${(failure.title ?? failure.message ?? "").slice(0, 120)}`
                : st.status,
            })
            .eq("provider", "whatsapp")
            .eq("external_id", st.id)
        }

        // 2) Mensajes entrantes del paciente.
        for (const m of value.messages ?? []) {
          if (!m.id) continue
          const e164 = m.from ? normalizeToE164(m.from) || null : null
          const body = readableBody(m)

          const match = e164 ? await matchLead(sb, e164) : null

          // Marca: la del lead si se pudo vincular; si no, la dueña del número
          // NUESTRO que lo recibió. Así el WhatsApp de alguien que todavía no es
          // lead cae en la marca correcta (y se puede medir el canal).
          let brandId = match?.brandId ?? null
          if (!brandId && phoneNumberId) {
            brandId = await resolveBrandByWhatsAppPhoneId(phoneNumberId)
          }

          // Consentimiento: pertenece al NÚMERO, no a un lead. Se aplica a TODOS
          // los leads con ese teléfono, aunque la atribución del mensaje no haya
          // sido única. `wa_opt_out` es propio de WhatsApp: un STOP de SMS no
          // apaga WhatsApp ni al revés (son canales distintos para Meta).
          const upper = body.trim().toUpperCase()
          if (e164 && (STOP_WORDS.has(upper) || START_WORDS.has(upper))) {
            const optOut = STOP_WORDS.has(upper)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (sb as any)
              .from("leads")
              .update({
                wa_opt_out: optOut,
                wa_opt_out_at: optOut ? new Date().toISOString() : null,
              })
              .or(`phone.eq.${e164},phone_alt.eq.${e164}`)
          }

          // Registrar el entrante. Idempotente por wamid: Meta reintenta el
          // mismo evento y el índice único (provider, external_id) lo absorbe.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (sb as any).from("messages").upsert(
            {
              provider: "whatsapp",
              brand_id: brandId,
              lead_id: match?.leadId ?? null,
              direction: "in",
              channel: "whatsapp",
              body,
              from_number: e164 ?? m.from ?? null,
              to_number: ourNumber,
              external_id: m.id,
              status: "received",
              raw: { message: m, metadata: value.metadata ?? null },
              // El timestamp de Meta viene en segundos; si falta, default de la tabla.
              ...(m.timestamp
                ? { created_at: new Date(Number(m.timestamp) * 1000).toISOString() }
                : {}),
            },
            { onConflict: "provider,external_id" },
          )
          if (error) {
            console.error("[whatsapp webhook] insert:", error.message)
            // 500 → Meta reintenta; el upsert lo hace seguro.
            return NextResponse.json({ error: "db error" }, { status: 500 })
          }
        }
      }
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[whatsapp webhook] threw:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
