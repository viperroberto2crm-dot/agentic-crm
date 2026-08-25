import "server-only"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAdapterByWebhookSlug } from "./registry"
import type { ChannelAdapter, InboundMessage } from "./types"

/**
 * Manejador ÚNICO de webhooks entrantes, compartido por todos los canales.
 *
 * Aquí vive lo que es igual para todos: verificar la firma, buscar el lead por
 * teléfono, atribuir la marca, aplicar el consentimiento (STOP/START) y guardar
 * en `messages` de forma idempotente. Lo que cambia por proveedor lo resuelve su
 * adaptador.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any

/**
 * Busca el lead por teléfono E.164 (phone o phone_alt). Solo vincula si hay
 * EXACTAMENTE uno: ante duplicados o un número presente en 2 marcas, preferimos
 * no atribuir el mensaje a la persona equivocada.
 */
async function matchLead(
  sb: AnyClient,
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

/**
 * Aplica STOP/START. El consentimiento pertenece al NÚMERO, no a un lead: se
 * aplica a TODOS los leads con ese teléfono, aunque la atribución del mensaje no
 * haya sido única (duplicados, mismo número en 2 marcas).
 */
async function applyConsent(
  sb: AnyClient,
  adapter: ChannelAdapter,
  e164: string,
  body: string,
): Promise<void> {
  const upper = body.trim().toUpperCase()
  const stop = adapter.stopWords.has(upper)
  const start = adapter.startWords.has(upper)
  if (!stop && !start) return
  await sb
    .from("leads")
    .update({
      [adapter.optOut.column]: stop,
      [adapter.optOut.atColumn]: stop ? new Date().toISOString() : null,
    })
    .or(`phone.eq.${e164},phone_alt.eq.${e164}`)
}

async function storeInbound(
  sb: AnyClient,
  adapter: ChannelAdapter,
  m: InboundMessage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const match = m.fromE164 ? await matchLead(sb, m.fromE164) : null

  // Marca: la del lead si se pudo vincular; si no, la dueña del endpoint NUESTRO
  // que lo recibió. Así el mensaje de alguien que aún no es lead cae en la marca
  // y el canal correctos (y se puede medir la publicidad).
  let brandId = match?.brandId ?? null
  if (!brandId) brandId = await adapter.resolveBrand(m.receiverId)

  if (m.fromE164) await applyConsent(sb, adapter, m.fromE164, m.body)

  // Idempotente por (provider, external_id): el proveedor reintenta el mismo
  // evento y el índice único lo absorbe.
  const { error } = await sb.from("messages").upsert(
    {
      provider: adapter.provider,
      brand_id: brandId,
      lead_id: match?.leadId ?? null,
      direction: "in",
      channel: adapter.key,
      body: m.body,
      from_number: m.from,
      to_number: m.to,
      external_id: m.externalId,
      status: m.status,
      raw: m.raw,
      ...(m.sentAt ? { created_at: m.sentAt } : {}),
    },
    { onConflict: "provider,external_id" },
  )
  if (error) {
    console.error(`[${adapter.key} webhook] insert:`, error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** GET: handshake de verificación (solo los canales que lo usan, como Meta). */
export async function handleChannelGet(request: Request, slug: string): Promise<Response> {
  const adapter = getAdapterByWebhookSlug(slug)
  if (!adapter) return NextResponse.json({ error: "unknown channel" }, { status: 404 })
  if (!adapter.verifyChallenge) {
    return NextResponse.json({ error: "method not allowed" }, { status: 405 })
  }
  const res = await adapter.verifyChallenge(new URL(request.url))
  return res ?? NextResponse.json({ error: "forbidden" }, { status: 403 })
}

/** POST: eventos del proveedor (mensajes entrantes y cambios de estado). */
export async function handleChannelPost(request: Request, slug: string): Promise<Response> {
  const adapter = getAdapterByWebhookSlug(slug)
  if (!adapter) return NextResponse.json({ error: "unknown channel" }, { status: 404 })

  // El cuerpo CRUDO es lo que el proveedor firmó: leerlo como texto y NO
  // reserializarlo, o la firma nunca cuadra.
  const rawBody = await request.text()

  // Reconstruir la URL exacta que se firmó (Twilio firma proto+host+path+query).
  const u = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? u.host
  const proto = request.headers.get("x-forwarded-proto") ?? "https"
  const webhookUrl = `${proto}://${host}${u.pathname}${u.search}`

  const sig = await adapter.verifySignature({ rawBody, headers: request.headers, webhookUrl })
  if (!sig.configured) return NextResponse.json({ error: "not configured" }, { status: 503 })
  if (!sig.ok) return NextResponse.json({ error: "invalid signature" }, { status: 403 })

  const sb = createAdminClient() as AnyClient

  try {
    const { messages, statuses } = adapter.parse(rawBody)

    // Cambios de estado de NUESTROS envíos (sent → delivered → read → failed).
    for (const st of statuses) {
      await sb
        .from("messages")
        .update({ status: st.status })
        .eq("provider", adapter.provider)
        .eq("external_id", st.externalId)
    }

    for (const m of messages) {
      const r = await storeInbound(sb, adapter, m)
      // 500 → el proveedor reintenta; el upsert lo hace seguro.
      if (!r.ok) return NextResponse.json({ error: "db error" }, { status: 500 })
    }

    return adapter.ack()
  } catch (e) {
    console.error(`[${adapter.key} webhook] threw:`, e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
