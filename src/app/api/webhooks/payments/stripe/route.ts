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
  if (email) {
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
      const match = await resolveLead(sb, email, phone)

      const row = {
        provider: "stripe",
        brand_id: match?.brandId ?? null,
        lead_id: match?.leadId ?? null,
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
      const match = await resolveLead(sb, email, null)

      const row = {
        provider: "stripe",
        brand_id: match?.brandId ?? null,
        lead_id: match?.leadId ?? null,
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
      const match = await resolveLead(sb, email, phone)

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
