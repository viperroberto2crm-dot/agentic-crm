import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeToE164 } from "@/lib/integrations/800com"
import {
  verifySquareSignature,
  normalizeSquareStatus,
  squareOrigin,
  retrieveSquareCustomer,
  retrieveSquareOrder,
  normalizeBookingStatus,
  bookingEndsAt,
  type SquareWebhookEvent,
  type SquarePayment,
  type SquareBooking,
} from "@/lib/integrations/square"
import { routeAndCreateLead } from "@/lib/integrations/offer-brand-map"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DB = SupabaseClient<Database>

// Webhook de Square → pagos (external_payments) y citas (external_appointments).
// Patrón: firma HMAC (como 800com) + aislamiento de marca (como Practice
// Better: la marca se HEREDA del lead; si el contacto coincide en >1 marca, NO
// se adivina). Idempotente por (provider, external_id).
// Por ahora SOLO categoriza/registra: vincula a leads existentes; los que no
// matchean quedan sin vincular. (Crear leads se activará al separar cuentas.)

type Cand = { leadId: string; brandId: string }
function resolveUnique(cands: Cand[]): Cand | null {
  if (cands.length === 0) return null
  const brands = new Set(cands.map((c) => c.brandId))
  if (brands.size > 1) return null // ambiguo entre clínicas: no adivinar
  return cands[0]
}

// Resuelve el lead por email (escapado) y luego teléfono, dentro de las marcas
// de Square. Compartido por pagos y citas. Devuelve null si no matchea o ambiguo.
async function resolveLead(
  sb: DB,
  email: string | null,
  phone: string | null,
): Promise<Cand | null> {
  const slugsRaw = process.env.SQUARE_BRAND_SLUGS
  if (!slugsRaw || (!email && !phone)) return null
  const slugs = slugsRaw.split(",").map((s) => s.trim()).filter(Boolean)
  const { data: brandRows } = await sb.from("brands").select("id").in("slug", slugs)
  const brandIds = ((brandRows ?? []) as { id: string }[]).map((b) => b.id)
  if (brandIds.length === 0) return null

  const cands: Cand[] = []
  if (email) {
    // Escapar comodines LIKE (%, _, \): el email viene de Square. ilike preserva
    // el match sin distinción de mayúsculas (emails guardados con cualquier casing).
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

// Obtiene contacto del cliente (email/teléfono/nombre/dirección); enriquece
// con la API de Square si hay customer_id.
type Contact = {
  email: string | null
  phone: string | null
  name: string | null
  address: string | null
  customer: unknown | null
}
async function contactFor(directEmail: string | null, customerId: string | undefined): Promise<Contact> {
  let email = directEmail?.trim().toLowerCase() ?? null
  let phone: string | null = null
  let name: string | null = null
  let address: string | null = null
  let customer: unknown | null = null
  if (customerId) {
    const cust = await retrieveSquareCustomer(customerId)
    if (!email && cust.email) email = cust.email.trim().toLowerCase()
    if (cust.phone) phone = normalizeToE164(cust.phone) || null
    name = cust.name
    address = cust.address
    customer = cust.customer
  }
  return { email, phone, name, address, customer }
}

export async function POST(request: Request) {
  // 1) Cuerpo CRUDO (necesario para verificar la firma)
  const rawBody = await request.text()

  // 2) Verificar firma
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
  const notificationUrl = process.env.SQUARE_WEBHOOK_URL
  if (!signatureKey || !notificationUrl) {
    console.error("[square webhook] SQUARE_WEBHOOK_SIGNATURE_KEY / SQUARE_WEBHOOK_URL no configuradas")
    return NextResponse.json({ error: "not configured" }, { status: 500 })
  }
  const signature = request.headers.get("x-square-hmacsha256-signature")
  if (!verifySquareSignature(rawBody, signature, notificationUrl, signatureKey)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // 3) Parsear evento
  let event: SquareWebhookEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const type = event.type ?? ""
  const sb = createAdminClient() as unknown as DB

  try {
    // ── PAGOS ───────────────────────────────────────────────────────────────
    if (type === "payment.created" || type === "payment.updated") {
      const payment = event.data?.object?.payment
      if (!payment?.id) return NextResponse.json({ ok: true, ignored: "no payment" })

      const c = await contactFor(payment.buyer_email_address ?? null, payment.customer_id)
      let match = await resolveLead(sb, c.email, c.phone)
      const p = payment as SquarePayment

      // Productos comprados (membresía/GLP/etc) viven en el order
      let items: string | null = null
      let orderRaw: unknown = null
      let itemCatalogIds: string[] = []
      if (p.order_id) {
        const ord = await retrieveSquareOrder(p.order_id)
        items = ord.items
        orderRaw = ord.order
        itemCatalogIds = ord.itemCatalogIds
      }

      // Ruteo automático: SOLO si no matcheó un lead existente. Con flags OFF,
      // routeAndCreateLead devuelve null → comportamiento idéntico al de hoy.
      if (!match) {
        const routed = await routeAndCreateLead(sb, {
          provider: "square",
          candidateKeys: itemCatalogIds,
          origin: squareOrigin(p),
          externalCustomerId: payment.customer_id ?? null,
          contact: { email: c.email, phone: c.phone, name: c.name, address: c.address },
          noteSuffix: items ? `Productos: ${items}` : null,
        })
        if (routed) match = { leadId: routed.leadId, brandId: routed.brandId }
      }

      const row = {
        provider: "square",
        brand_id: match?.brandId ?? null,
        lead_id: match?.leadId ?? null,
        external_id: payment.id,
        event_id: event.event_id ?? null,
        amount_cents: typeof p.amount_money?.amount === "number" ? p.amount_money.amount : 0,
        currency: p.amount_money?.currency ?? null,
        status: normalizeSquareStatus(p.status),
        origin: squareOrigin(p),
        items,
        customer_name: c.name,
        customer_email: c.email,
        customer_phone: c.phone,
        customer_address: c.address,
        reference: p.reference_id ?? p.note ?? null,
        paid_at: p.created_at ?? null,
        raw: { payment: p, customer: c.customer, order: orderRaw },
        updated_at: new Date().toISOString(),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any)
        .from("external_payments")
        .upsert(row, { onConflict: "provider,external_id" })
      if (error) {
        console.error("[square webhook] pago upsert:", error.message)
        return NextResponse.json({ error: "db error" }, { status: 500 })
      }
      return NextResponse.json({ ok: true, kind: "payment", linked: Boolean(match) })
    }

    // ── CITAS ───────────────────────────────────────────────────────────────
    if (type === "booking.created" || type === "booking.updated") {
      const booking = event.data?.object?.booking
      if (!booking?.id) return NextResponse.json({ ok: true, ignored: "no booking" })

      const c = await contactFor(null, booking.customer_id)
      let match = await resolveLead(sb, c.email, c.phone)
      const b = booking as SquareBooking
      const seg = b.appointment_segments?.[0]

      // Ruteo automático: SOLO si no matcheó. Con flags OFF → no-op (null).
      if (!match) {
        const routed = await routeAndCreateLead(sb, {
          provider: "square",
          candidateKeys: [seg?.service_variation_id].filter(
            (v): v is string => Boolean(v),
          ),
          externalCustomerId: booking.customer_id ?? null,
          contact: { email: c.email, phone: c.phone, name: c.name, address: c.address },
        })
        if (routed) match = { leadId: routed.leadId, brandId: routed.brandId }
      }

      const row = {
        provider: "square",
        brand_id: match?.brandId ?? null,
        lead_id: match?.leadId ?? null,
        external_id: booking.id,
        event_id: event.event_id ?? null,
        status: normalizeBookingStatus(b.status),
        service: seg?.service_variation_id ?? null, // ID por ahora (v1)
        staff: seg?.team_member_id ?? null,
        starts_at: b.start_at ?? null,
        ends_at: bookingEndsAt(b),
        customer_name: c.name,
        customer_email: c.email,
        customer_phone: c.phone,
        customer_address: c.address,
        note: b.customer_note ?? b.seller_note ?? null,
        raw: { booking: b, customer: c.customer },
        updated_at: new Date().toISOString(),
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any)
        .from("external_appointments")
        .upsert(row, { onConflict: "provider,external_id" })
      if (error) {
        console.error("[square webhook] cita upsert:", error.message)
        return NextResponse.json({ error: "db error" }, { status: 500 })
      }
      return NextResponse.json({ ok: true, kind: "booking", linked: Boolean(match) })
    }

    // Otros eventos: 200 para que Square no reintente
    return NextResponse.json({ ok: true, ignored: type })
  } catch (e) {
    console.error("[square webhook] error:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
