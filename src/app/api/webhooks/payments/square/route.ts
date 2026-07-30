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
  retrieveSquareServiceName,
  retrieveSquareTeamMember,
  toPbAddress,
  buildPaymentPbNote,
  buildBookingPbNote,
  normalizeBookingStatus,
  bookingEndsAt,
  type SquareWebhookEvent,
  type SquarePayment,
  type SquareBooking,
  type SquareAddressParts,
} from "@/lib/integrations/square"
import { routeAndCreateLead } from "@/lib/integrations/offer-brand-map"
import { isStaffEmail } from "@/lib/integrations/staff-email"
import { enrichPbRecord, type PbAddress } from "@/lib/integrations/practice-better"
import { pushPbSession } from "@/lib/integrations/pb-sessions"

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
  // No enlazar por email de staff/rep: se vuelve un imán que absorbe pagos ajenos.
  if (email && !(await isStaffEmail(sb, email))) {
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
  firstName: string | null
  lastName: string | null
  address: string | null
  addressParts: SquareAddressParts | null
  customer: unknown | null
}
async function contactFor(directEmail: string | null, customerId: string | undefined): Promise<Contact> {
  let email = directEmail?.trim().toLowerCase() ?? null
  let phone: string | null = null
  let name: string | null = null
  let firstName: string | null = null
  let lastName: string | null = null
  let address: string | null = null
  let addressParts: SquareAddressParts | null = null
  let customer: unknown | null = null
  if (customerId) {
    const cust = await retrieveSquareCustomer(customerId)
    if (!email && cust.email) email = cust.email.trim().toLowerCase()
    if (cust.phone) phone = normalizeToE164(cust.phone) || null
    name = cust.name
    firstName = cust.firstName
    lastName = cust.lastName
    address = cust.address
    addressParts = cust.addressParts
    customer = cust.customer
  }
  return { email, phone, name, firstName, lastName, address, addressParts, customer }
}

// Enriquece el paciente de PB de un lead YA vinculado (caso Leslie): dirección +
// nota de pago. Gate PB_ENRICH_RECORDS. No bloqueante: un fallo de PB nunca
// hace fallar el webhook. Idempotente (enrichPbRecord no pisa datos ni duplica notas).
async function enrichLinkedLeadPb(
  sb: DB,
  leadId: string | null,
  pbAddress: PbAddress | null,
  pbNote: string | null,
): Promise<void> {
  if (process.env.PB_ENRICH_RECORDS !== "true" || !leadId) return
  if (!pbAddress && !pbNote) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb as any)
      .from("leads")
      .select("pb_record_id")
      .eq("id", leadId)
      .maybeSingle()
    const recId = (data as { pb_record_id: string | null } | null)?.pb_record_id
    if (!recId) return
    await enrichPbRecord(recId, { address: pbAddress, appendNote: pbNote })
  } catch (e) {
    console.warn(
      "[square webhook] enrich PB (no bloqueante):",
      e instanceof Error ? e.message : String(e),
    )
  }
}

/**
 * Vínculo ya establecido en el registro externo — para NO pisarlo cuando llega
 * un payment.updated/booking.updated (Fable #1). Si el registro ya tiene
 * lead_id, se conserva (no se re-rutea ni se borra). null si no existe o está
 * sin vincular.
 */
async function existingLink(
  sb: DB,
  table: "external_payments" | "external_appointments",
  externalId: string,
): Promise<{ leadId: string; brandId: string | null } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any)
    .from(table)
    .select("lead_id, brand_id")
    .eq("provider", "square")
    .eq("external_id", externalId)
    .maybeSingle()
  const r = data as { lead_id: string | null; brand_id: string | null } | null
  return r?.lead_id ? { leadId: r.lead_id, brandId: r.brand_id } : null
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
      // Fable #1: si el pago YA tiene lead (manual/previo), se conserva; un
      // payment.updated NO debe re-rutear ni borrar el vínculo.
      const prev = await existingLink(sb, "external_payments", payment.id)
      const p = payment as SquarePayment

      // Productos comprados (membresía/GLP/etc) viven en el order. Lo traemos
      // ANTES del match porque su metadata da el vínculo determinista del CRM.
      let items: string | null = null
      let orderRaw: unknown = null
      let itemCatalogIds: string[] = []
      if (p.order_id) {
        const ord = await retrieveSquareOrder(p.order_id)
        items = ord.items
        orderRaw = ord.order
        itemCatalogIds = ord.itemCatalogIds
      }

      // NOTA: el vínculo DETERMINISTA por metadata de la orden (cobros generados
      // desde el CRM) está pendiente para Square: sus payment links son
      // reutilizables y sin expiración, así que un link re-pagado por otra persona
      // se atribuiría al paciente original. Requiere manejo de uso-único (borrar el
      // link tras el primer pago) + confirmar con un pago de prueba si Square copia
      // la metadata a la orden de cada checkout. Por ahora Square vincula por
      // email/teléfono como siempre (seguro). Stripe sí es determinista.
      let match = await resolveLead(sb, c.email, c.phone)

      // Datos para enriquecer el perfil de PB: dirección estructurada + nota con
      // el detalle del pago (el "recibo" de facto, ya que PB no deja crear facturas).
      const pbAddress = toPbAddress(c.addressParts)
      const pbNote = buildPaymentPbNote(p, items)

      // Lead vinculado ANTES del ruteo (existente o previo). Los leads que crea
      // routeAndCreateLead ya reciben el enrich en su creación → no re-enriquecer.
      const preLinkedLeadId = prev?.leadId ?? match?.leadId ?? null

      // Ruteo automático: SOLO si no matcheó un lead existente. Con flags OFF,
      // routeAndCreateLead devuelve null → comportamiento idéntico al de hoy.
      if (!match && !prev) {
        const routed = await routeAndCreateLead(sb, {
          provider: "square",
          candidateKeys: itemCatalogIds,
          origin: squareOrigin(p),
          externalCustomerId: payment.customer_id ?? null,
          contact: {
            email: c.email, phone: c.phone, name: c.name,
            firstName: c.firstName, lastName: c.lastName, address: c.address,
          },
          pbAddress,
          pbNote,
          noteSuffix: items ? `Productos: ${items}` : null,
        })
        if (routed) match = { leadId: routed.leadId, brandId: routed.brandId }
      }

      const row = {
        provider: "square",
        brand_id: prev ? prev.brandId : (match?.brandId ?? null),
        lead_id: prev ? prev.leadId : (match?.leadId ?? null),
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
      // Enriquecer el paciente de PB del lead PRE-EXISTENTE (caso Leslie) con
      // dirección + detalle del pago. Gate PB_ENRICH_RECORDS. No bloqueante.
      await enrichLinkedLeadPb(sb, preLinkedLeadId, pbAddress, pbNote)
      return NextResponse.json({ ok: true, kind: "payment", linked: Boolean(match) })
    }

    // ── CITAS ───────────────────────────────────────────────────────────────
    if (type === "booking.created" || type === "booking.updated") {
      const booking = event.data?.object?.booking
      if (!booking?.id) return NextResponse.json({ ok: true, ignored: "no booking" })

      const c = await contactFor(null, booking.customer_id)
      // Fable #1: conservar el vínculo ya establecido; booking.updated no re-rutea.
      const prev = await existingLink(sb, "external_appointments", booking.id)
      let match = await resolveLead(sb, c.email, c.phone)
      const b = booking as SquareBooking
      const seg = b.appointment_segments?.[0]

      // Nombres legibles (Fase 1): resolver service_variation_id → servicio y
      // team_member_id → staff. Gate SQUARE_RESOLVE_NAMES (2 llamadas extra a
      // Square por booking). Defensivo: null si falla → se cae al ID crudo en UI.
      let serviceName: string | null = null
      let staffName: string | null = null
      if (process.env.SQUARE_RESOLVE_NAMES === "true") {
        if (seg?.service_variation_id) {
          serviceName = await retrieveSquareServiceName(seg.service_variation_id)
        }
        if (seg?.team_member_id) {
          staffName = await retrieveSquareTeamMember(seg.team_member_id)
        }
      }

      // Enriquecimiento de PB: dirección + nota con la cita.
      const pbAddress = toPbAddress(c.addressParts)
      const pbNote = buildBookingPbNote(b, serviceName ?? seg?.service_variation_id ?? null)

      // Lead vinculado ANTES del ruteo (los recién creados ya se enriquecen al crearse).
      const preLinkedLeadId = prev?.leadId ?? match?.leadId ?? null

      // Ruteo automático: SOLO si no matcheó. Con flags OFF → no-op (null).
      if (!match && !prev) {
        const routed = await routeAndCreateLead(sb, {
          provider: "square",
          candidateKeys: [seg?.service_variation_id].filter(
            (v): v is string => Boolean(v),
          ),
          externalCustomerId: booking.customer_id ?? null,
          contact: {
            email: c.email, phone: c.phone, name: c.name,
            firstName: c.firstName, lastName: c.lastName, address: c.address,
          },
          pbAddress,
          pbNote,
        })
        if (routed) match = { leadId: routed.leadId, brandId: routed.brandId }
      }

      // Columnas de nombres legibles: SOLO se incluyen si la flag está prendida.
      // Así, con la flag OFF, el insert NO referencia service_name/staff_name y
      // NO depende de que el SQL (ALTER TABLE) se haya corrido → sin regresión.
      const nameCols =
        process.env.SQUARE_RESOLVE_NAMES === "true"
          ? { service_name: serviceName, staff_name: staffName }
          : {}

      const row = {
        provider: "square",
        brand_id: prev ? prev.brandId : (match?.brandId ?? null),
        lead_id: prev ? prev.leadId : (match?.leadId ?? null),
        external_id: booking.id,
        event_id: event.event_id ?? null,
        status: normalizeBookingStatus(b.status),
        service: seg?.service_variation_id ?? null, // ID crudo (fuente de verdad)
        staff: seg?.team_member_id ?? null,
        ...nameCols,
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
      const { data: upserted, error } = await (sb as any)
        .from("external_appointments")
        .upsert(row, { onConflict: "provider,external_id" })
        .select("id")
        .single()
      if (error) {
        console.error("[square webhook] cita upsert:", error.message)
        return NextResponse.json({ error: "db error" }, { status: 500 })
      }
      await enrichLinkedLeadPb(sb, preLinkedLeadId, pbAddress, pbNote)

      // Fase 3.2/3.3: crear/reagendar/cancelar la cita como SESIÓN en PB. Usa el
      // lead vinculado FINAL (incluye los recién creados por el ruteo, que ya
      // tienen pb_record_id). Gate PB_PUSH_SESSIONS. No bloqueante.
      const sessionLeadId = prev?.leadId ?? match?.leadId ?? null
      const rowId = (upserted as { id: string } | null)?.id ?? null
      if (rowId) {
        await pushPbSession(sb, {
          rowId,
          leadId: sessionLeadId,
          serviceVariationId: seg?.service_variation_id ?? null,
          startsAt: b.start_at ?? null,
          endsAt: bookingEndsAt(b),
          status: normalizeBookingStatus(b.status),
          squareCustomerId: booking.customer_id ?? null,
          sessionNote: pbNote,
        })
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
