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
  type SquareWebhookEvent,
  type SquarePayment,
} from "@/lib/integrations/square"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DB = SupabaseClient<Database>

// Webhook de pagos de Square → tabla genérica external_payments.
// Patrón: firma HMAC (como 800com) + aislamiento de marca (como Practice
// Better: la marca se HEREDA del lead; si el email coincide en >1 marca, no
// se adivina). Idempotente por (provider, external_id).

type Cand = { leadId: string; brandId: string }
function resolveUnique(cands: Cand[] | undefined): Cand | null {
  if (!cands || cands.length === 0) return null
  const brands = new Set(cands.map((c) => c.brandId))
  if (brands.size > 1) return null // ambiguo entre clínicas: no adivinar
  return cands[0]
}

export async function POST(request: Request) {
  // 1) Leer cuerpo CRUDO (necesario para verificar la firma)
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
  if (type !== "payment.created" && type !== "payment.updated") {
    // Otros eventos: aceptamos con 200 para que Square no reintente
    return NextResponse.json({ ok: true, ignored: type })
  }

  const payment = event.data?.object?.payment
  const paymentId = payment?.id
  if (!payment || !paymentId) {
    return NextResponse.json({ ok: true, ignored: "no payment" })
  }

  const sb = createAdminClient() as unknown as DB

  try {
    // 4) Obtener email/teléfono del comprador
    let email = payment.buyer_email_address?.trim().toLowerCase() ?? null
    let phone: string | null = null
    if ((!email || !phone) && payment.customer_id) {
      const cust = await retrieveSquareCustomer(payment.customer_id)
      if (!email && cust.email) email = cust.email.trim().toLowerCase()
      if (cust.phone) phone = normalizeToE164(cust.phone) || null
    }

    // 5) Resolver lead dentro de las marcas de Square (marca heredada del lead)
    const slugsRaw = process.env.SQUARE_BRAND_SLUGS
    let match: Cand | null = null
    if (slugsRaw && (email || phone)) {
      const slugs = slugsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      const { data: brandRows } = await sb.from("brands").select("id").in("slug", slugs)
      const brandIds = ((brandRows ?? []) as { id: string }[]).map((b) => b.id)
      if (brandIds.length > 0) {
        const cands: Cand[] = []
        if (email) {
          // Escapar comodines LIKE (%, _, \) — el email viene de Square y un
          // '%' literal convertiría el match en wildcard. ilike preserva el
          // match sin distinción de mayúsculas (los emails guardados pueden
          // tener cualquier casing).
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
        match = resolveUnique(cands)
      }
    }

    // 6) Upsert en external_payments (idempotente por provider+external_id)
    const p = payment as SquarePayment
    const row = {
      provider: "square",
      brand_id: match?.brandId ?? null,
      lead_id: match?.leadId ?? null,
      external_id: paymentId,
      event_id: event.event_id ?? null,
      amount_cents: typeof p.amount_money?.amount === "number" ? p.amount_money.amount : 0,
      currency: p.amount_money?.currency ?? null,
      status: normalizeSquareStatus(p.status),
      origin: squareOrigin(p),
      customer_email: email,
      customer_phone: phone,
      reference: p.reference_id ?? p.note ?? null,
      paid_at: p.created_at ?? null,
      raw: p,
      updated_at: new Date().toISOString(),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any)
      .from("external_payments")
      .upsert(row, { onConflict: "provider,external_id" })
    if (error) {
      console.error("[square webhook] upsert error:", error.message)
      return NextResponse.json({ error: "db error" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, linked: Boolean(match) })
  } catch (e) {
    console.error("[square webhook] error:", e instanceof Error ? e.message : String(e))
    return NextResponse.json({ error: "internal" }, { status: 500 })
  }
}
