import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import {
  verifyStripeSignature,
  stripeAddress,
  stripeInvoiceItems,
  stripeTs,
  type StripeEvent,
  type StripeCheckoutSession,
  type StripeInvoice,
  type StripeCharge,
} from "@/lib/integrations/stripe"
import { routeAndCreateLead } from "@/lib/integrations/offer-brand-map"
import { isStaffEmail } from "@/lib/integrations/staff-email"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DB = SupabaseClient<Database>

// Webhook de Stripe → tabla genérica external_payments (provider='stripe').
// Mismo estándar que Square: firma HMAC + aislamiento de marca (la marca se
// HEREDA del lead; si el email coincide en >1 marca, no se adivina).
// Eventos: checkout.session.completed (pago único), invoice.paid (suscripción
// primer pago + renovaciones), charge.refunded (reembolso).
// Para no contar doble en suscripciones: checkout.session.completed con
// mode='subscription' se IGNORA (invoice.paid lo cubre).

type Cand = { leadId: string; brandId: string }
function resolveUnique(cands: Cand[]): Cand | null {
  if (cands.length === 0) return null
  const brands = new Set(cands.map((c) => c.brandId))
  if (brands.size > 1) return null
  return cands[0]
}

async function resolveLead(sb: DB, email: string | null, phone: string | null): Promise<Cand | null> {
  const slugsRaw = process.env.STRIPE_BRAND_SLUGS
  if (!slugsRaw || (!email && !phone)) return null
  const slugs = slugsRaw.split(",").map((s) => s.trim()).filter(Boolean)
  const { data: brandRows } = await sb.from("brands").select("id").in("slug", slugs)
  const brandIds = ((brandRows ?? []) as { id: string }[]).map((b) => b.id)
  if (brandIds.length === 0) return null

  const cands: Cand[] = []
  // No enlazar por email de staff/rep: se vuelve un imán que absorbe pagos ajenos.
  if (email && !(await isStaffEmail(sb, email))) {
    const emailPattern = email.replace(/([\\%_])/g, "\\$1")
    const { data } = await sb
      .from("leads")
      .select("id, brand_id")
      .in("brand_id", brandIds)
      .ilike("email", emailPattern)
    for (const l of (data ?? []) as { id: string; brand_id: string }[]) {
      cands.push({ leadId: l.id, brandId: l.brand_id })
    }
  }
  if (phone && cands.length === 0) {
    const { data } = await sb
      .from("leads")
      .select("id, brand_id")
      .in("brand_id", brandIds)
      .eq("phone", phone)
    for (const l of (data ?? []) as { id: string; brand_id: string }[]) {
      cands.push({ leadId: l.id, brandId: l.brand_id })
    }
  }
  return resolveUnique(cands)
}

/**
 * Vínculo DETERMINISTA por metadata: cuando el cobro se generó desde el CRM
 * (botón "Cobrar"), la sesión lleva metadata.lead_id / metadata.brand_id. Si el
 * lead existe (y la marca coincide, defensa en profundidad) se enlaza directo,
 * sin adivinar por email/teléfono → nunca cae en "Pagos sin vincular". La
 * metadata la fija NUESTRO servidor y el webhook viene firmado por Stripe, así
 * que es confiable; aun así verificamos que el lead exista.
 */
async function resolveLeadFromMetadata(sb: DB, metadata: unknown): Promise<Cand | null> {
  const m = (metadata ?? {}) as Record<string, unknown>
  const leadId = typeof m.lead_id === "string" ? m.lead_id : null
  if (!leadId) return null
  const { data } = await sb
    .from("leads")
    .select("id, brand_id")
    .eq("id", leadId)
    .maybeSingle()
  const lead = data as { id: string; brand_id: string } | null
  if (!lead) return null
  const mBrand = typeof m.brand_id === "string" ? m.brand_id : null
  if (mBrand && lead.brand_id !== mBrand) return null
  return { leadId: lead.id, brandId: lead.brand_id }
}

/**
 * Metadata de la suscripción en un invoice: Stripe NO la copia a inv.metadata,
 * la expone en subscription_details.metadata (API Basil: bajo `parent`). Sin
 * esto, las suscripciones creadas desde el CRM caían al match por email.
 */
function invoiceSubscriptionMetadata(inv: unknown): unknown {
  const i = inv as {
    parent?: { subscription_details?: { metadata?: unknown } }
    subscription_details?: { metadata?: unknown }
    metadata?: unknown
  }
  return (
    i.parent?.subscription_details?.metadata ??
    i.subscription_details?.metadata ??
    i.metadata
  )
}

/**
 * Reembolso de un cobro generado desde el CRM: hereda el vínculo del pago
 * ORIGINAL vía payment_intent (guardado en raw.payment_intent de la sesión de
 * checkout). Sin esto, el reembolso quedaba sin marca y el KPI "Cobros
 * automáticos" nunca lo restaba → ingreso neto inflado por marca.
 *
 * LIMITACIÓN (follow-up): funciona para pagos ÚNICOS (la sesión guarda
 * payment_intent top-level). Para reembolsos de SUSCRIPCIÓN bajo la API Basil,
 * el invoice ya no trae payment_intent top-level, así que cae al match por email.
 * Fix futuro: guardar payment_intent en una columna real al insertar.
 */
async function linkByPaymentIntent(sb: DB, piId: string | null): Promise<Cand | null> {
  if (!piId) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("external_payments")
    .select("lead_id, brand_id")
    .eq("provider", "stripe")
    .not("lead_id", "is", null)
    .filter("raw->>payment_intent", "eq", piId)
    .limit(1)
    .maybeSingle()
  const r = data as { lead_id: string | null; brand_id: string | null } | null
  if (r?.lead_id && r?.brand_id) return { leadId: r.lead_id, brandId: r.brand_id }
  return null
}

// Inserta/actualiza un pago en external_payments (idempotente por provider+external_id).
async function upsertPayment(
  sb: DB,
  row: Record<string, unknown>,
): Promise<{ error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb as any)
    .from("external_payments")
    .upsert(row, { onConflict: "provider,external_id" })
  return { error: error?.message }
}

/**
 * Vínculo ya establecido en external_payments — para NO pisarlo cuando llega un
 * evento *.updated / renovación (Fable #1). Si ya tiene lead_id, se conserva.
 */
async function existingLink(
  sb: DB,
  externalId: string,
): Promise<{ leadId: string; brandId: string | null } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from("external_payments")
    .select("lead_id, brand_id")
    .eq("provider", "stripe")
    .eq("external_id", externalId)
    .maybeSingle()
  const r = data as { lead_id: string | null; brand_id: string | null } | null
  return r?.lead_id ? { leadId: r.lead_id, brandId: r.brand_id } : null
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET no configurado")
    return NextResponse.json({ error: "not configured" }, { status: 500 })
  }
  const sig = request.headers.get("stripe-signature")
  const nowSec = Math.floor(Date.now() / 1000)
  if (!verifyStripeSignature(rawBody, sig, secret, nowSec)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const type = event.type ?? ""
  const obj = event.data?.object ?? {}
  const sb = createAdminClient() as unknown as DB

  try {
    // ── PAGO ÚNICO (Payment Link no-suscripción) ────────────────────────────
    if (type === "checkout.session.completed") {
      const s = obj as StripeCheckoutSession
      // Las suscripciones las cubre invoice.paid → evitar doble conteo
      if (s.mode === "subscription") {
        return NextResponse.json({ ok: true, ignored: "subscription checkout" })
      }
      if (!s.id) return NextResponse.json({ ok: true, ignored: "no session id" })

      const email = s.customer_details?.email?.trim().toLowerCase() ?? null
      const phone = s.customer_details?.phone ? normalizeToE164(s.customer_details.phone) || null : null
      const prev = await existingLink(sb, s.id)
      // Cobro generado desde el CRM → vínculo determinista por metadata primero.
      let match =
        (await resolveLeadFromMetadata(sb, (s as { metadata?: unknown }).metadata)) ??
        (await resolveLead(sb, email, phone))

      // Ruteo automático: SOLO si no matcheó. Con flags OFF → no-op (null).
      if (!match && !prev) {
        const routed = await routeAndCreateLead(sb, {
          provider: "stripe",
          candidateKeys: [s.payment_link].filter((v): v is string => Boolean(v)),
          origin: "web",
          externalCustomerId: s.customer ?? null,
          contact: {
            email,
            phone,
            name: s.customer_details?.name ?? null,
            address: stripeAddress(s.customer_details?.address),
          },
        })
        if (routed) match = { leadId: routed.leadId, brandId: routed.brandId }
      }

      const row = {
        provider: "stripe",
        brand_id: prev ? prev.brandId : (match?.brandId ?? null),
        lead_id: prev ? prev.leadId : (match?.leadId ?? null),
        external_id: s.id,
        event_id: event.id ?? null,
        amount_cents: typeof s.amount_total === "number" ? s.amount_total : 0,
        currency: s.currency ?? null,
        status: s.payment_status === "paid" ? "completed" : s.payment_status ?? "completed",
        origin: "web",
        customer_name: s.customer_details?.name ?? null,
        customer_email: email,
        customer_phone: phone,
        customer_address: stripeAddress(s.customer_details?.address),
        paid_at: stripeTs(s.created, nowSec),
        raw: s,
        updated_at: new Date().toISOString(),
      }
      const { error } = await upsertPayment(sb, row)
      if (error) {
        console.error("[stripe webhook] checkout upsert:", error)
        return NextResponse.json({ error: "db error" }, { status: 500 })
      }
      return NextResponse.json({ ok: true, kind: "checkout", linked: Boolean(match) })
    }

    // ── SUSCRIPCIÓN: primer pago + renovaciones ─────────────────────────────
    if (type === "invoice.paid") {
      const inv = obj as StripeInvoice
      if (!inv.id) return NextResponse.json({ ok: true, ignored: "no invoice id" })

      const email = inv.customer_email?.trim().toLowerCase() ?? null
      const prev = await existingLink(sb, inv.id)
      let match =
        (await resolveLeadFromMetadata(sb, invoiceSubscriptionMetadata(inv))) ??
        (await resolveLead(sb, email, null))

      // Atribución de PÁGINA: la página de oferta aplica un cupón → el invoice
      // llega CON descuento (total_discount_amounts poblado). Con descuento =
      // "Oferta"; sin descuento = "Original". Se etiqueta en las notas del lead.
      const tda = (inv as { total_discount_amounts?: unknown[] }).total_discount_amounts
      const pagina = Array.isArray(tda) && tda.length > 0 ? "Oferta (cupón)" : "Original"

      // Ruteo automático: SOLO si no matcheó. Con flags OFF → no-op (null).
      if (!match && !prev) {
        const routed = await routeAndCreateLead(sb, {
          provider: "stripe",
          candidateKeys: [
            // API nueva (2025+): pricing.price_details.price; fallback a price.id (vieja).
            inv.lines?.data?.[0]?.pricing?.price_details?.price ??
              inv.lines?.data?.[0]?.price?.id,
          ].filter((v): v is string => Boolean(v)),
          origin: "invoice",
          externalCustomerId: inv.customer ?? null,
          contact: {
            email,
            phone: null,
            name: inv.customer_name ?? null,
            address: null,
          },
          noteSuffix: `Página: ${pagina}`,
        })
        if (routed) match = { leadId: routed.leadId, brandId: routed.brandId }
      }

      const row = {
        provider: "stripe",
        brand_id: prev ? prev.brandId : (match?.brandId ?? null),
        lead_id: prev ? prev.leadId : (match?.leadId ?? null),
        external_id: inv.id,
        event_id: event.id ?? null,
        amount_cents: typeof inv.amount_paid === "number" ? inv.amount_paid : 0,
        currency: inv.currency ?? null,
        status: "completed",
        origin: "invoice",
        items: stripeInvoiceItems(inv),
        customer_name: inv.customer_name ?? null,
        customer_email: email,
        reference: inv.number ?? null, // nº de factura (la columna se llama reference)
        paid_at: stripeTs(inv.status_transitions?.paid_at ?? inv.created, nowSec),
        raw: inv,
        updated_at: new Date().toISOString(),
      }
      const { error } = await upsertPayment(sb, row)
      if (error) {
        console.error("[stripe webhook] invoice upsert:", error)
        return NextResponse.json({ error: "db error" }, { status: 500 })
      }
      return NextResponse.json({ ok: true, kind: "invoice", linked: Boolean(match) })
    }

    // ── REEMBOLSO ───────────────────────────────────────────────────────────
    if (type === "charge.refunded") {
      const ch = obj as StripeCharge
      if (!ch.id) return NextResponse.json({ ok: true, ignored: "no charge id" })

      const email = ch.billing_details?.email?.trim().toLowerCase() ?? null
      const phone = ch.billing_details?.phone ? normalizeToE164(ch.billing_details.phone) || null : null
      // Heredar el vínculo del cobro original (por payment_intent) antes de
      // adivinar por email → el reembolso queda con la misma marca/lead.
      const match =
        (await linkByPaymentIntent(sb, (ch as { payment_intent?: string | null }).payment_intent ?? null)) ??
        (await resolveLead(sb, email, phone))

      const row = {
        provider: "stripe",
        brand_id: match?.brandId ?? null,
        lead_id: match?.leadId ?? null,
        external_id: `${ch.id}_refund`,
        event_id: event.id ?? null,
        amount_cents: typeof ch.amount_refunded === "number" ? ch.amount_refunded : 0,
        currency: ch.currency ?? null,
        status: "refunded",
        origin: "web",
        customer_name: ch.billing_details?.name ?? null,
        customer_email: email,
        customer_phone: phone,
        customer_address: stripeAddress(ch.billing_details?.address),
        paid_at: stripeTs(ch.created, nowSec),
        raw: ch,
        updated_at: new Date().toISOString(),
      }
      const { error } = await upsertPayment(sb, row)
      if (error) {
        console.error("[stripe webhook] refund upsert:", error)
        return NextResponse.json({ error: "db error" }, { status: 500 })
      }
      return NextResponse.json({ ok: true, kind: "refund", linked: Boolean(match) })
    }

    // Otros eventos: 200 para que Stripe no reintente
    return NextResponse.json({ ok: true, ignored: type })
  } catch (e) {
    console.error("[stripe webhook] error:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
