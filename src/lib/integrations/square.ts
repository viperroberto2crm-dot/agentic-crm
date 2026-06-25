import crypto from "crypto"

// Square integration helpers. Docs: developer.squareup.com
// - Webhook signature: HMAC-SHA256 sobre (notificationUrl + rawBody), base64,
//   header x-square-hmacsha256-signature. Verificación timing-safe.
// - API base producción: https://connect.squareup.com

const SQUARE_API_BASE = process.env.SQUARE_API_BASE_URL ?? "https://connect.squareup.com"

/**
 * Verifica la firma de un webhook de Square.
 * @param rawBody  el cuerpo CRUDO (sin parsear) tal cual llegó
 * @param signature header x-square-hmacsha256-signature
 * @param notificationUrl URL EXACTA configurada en Square (debe coincidir)
 * @param signatureKey Signature Key de la suscripción del webhook
 */
export function verifySquareSignature(
  rawBody: string,
  signature: string | null,
  notificationUrl: string,
  signatureKey: string,
): boolean {
  if (!signature) return false
  const computed = crypto
    .createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody)
    .digest("base64")
  try {
    const a = Buffer.from(computed)
    const b = Buffer.from(signature)
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ── Normalización ────────────────────────────────────────────────────────────

// Square status → estándar interno
export function normalizeSquareStatus(status: string | undefined): string {
  switch ((status ?? "").toUpperCase()) {
    case "COMPLETED":
      return "completed"
    case "APPROVED":
    case "PENDING":
      return "pending"
    case "CANCELED":
    case "FAILED":
      return "failed"
    default:
      return (status ?? "unknown").toLowerCase()
  }
}

// Origen del pago a partir de application_details.square_product
export function squareOrigin(payment: SquarePayment): "web" | "in_person" | "invoice" | "unknown" {
  const product = payment.application_details?.square_product?.toUpperCase() ?? ""
  if (product.includes("INVOICE")) return "invoice"
  if (product.includes("CHECKOUT") || product.includes("ECOMMERCE") || product.includes("ONLINE")) return "web"
  if (product.includes("POS") || product.includes("TERMINAL") || product.includes("REGISTER")) return "in_person"
  // Si hay device físico, asumimos presencial
  if (payment.device_details?.device_id) return "in_person"
  return "unknown"
}

// ── Tipos parciales (solo lo que usamos; tolerante a campos extra) ───────────

export type SquareMoney = { amount?: number; currency?: string }

export type SquarePayment = {
  id?: string
  amount_money?: SquareMoney
  status?: string
  created_at?: string
  source_type?: string
  location_id?: string
  order_id?: string
  customer_id?: string
  buyer_email_address?: string
  reference_id?: string
  note?: string
  application_details?: { square_product?: string; application_id?: string }
  device_details?: { device_id?: string }
  [k: string]: unknown
}

export type SquareAppointmentSegment = {
  duration_minutes?: number
  service_variation_id?: string
  team_member_id?: string
}

export type SquareBooking = {
  id?: string
  status?: string
  start_at?: string
  location_id?: string
  customer_id?: string
  customer_note?: string
  seller_note?: string
  created_at?: string
  updated_at?: string
  appointment_segments?: SquareAppointmentSegment[]
  [k: string]: unknown
}

export type SquareWebhookEvent = {
  merchant_id?: string
  type?: string
  event_id?: string
  created_at?: string
  data?: {
    type?: string
    id?: string
    object?: { payment?: SquarePayment; booking?: SquareBooking }
  }
}

// Trae los productos (line items) de un pedido: membresías, GLP, productos.
// Devuelve un resumen legible + el order crudo. Defensivo: nulls si falla.
export async function retrieveSquareOrder(
  orderId: string,
): Promise<{ items: string | null; itemList: string[]; order: unknown | null }> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return { items: null, itemList: [], order: null }
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Square-Version": "2025-01-23",
      },
    })
    if (!res.ok) return { items: null, itemList: [], order: null }
    const json = (await res.json()) as {
      order?: {
        line_items?: Array<{ name?: string; quantity?: string; variation_name?: string }>
      }
    }
    const lines = json.order?.line_items ?? []
    const itemList = lines
      .map((li) => {
        const qty = li.quantity && li.quantity !== "1" ? `${li.quantity}x ` : ""
        const variation = li.variation_name ? ` (${li.variation_name})` : ""
        return `${qty}${li.name ?? "Producto"}${variation}`.trim()
      })
      .filter(Boolean)
    return {
      items: itemList.length ? itemList.join(", ") : null,
      itemList,
      order: json.order ?? null,
    }
  } catch {
    return { items: null, itemList: [], order: null }
  }
}

// Square booking status → estándar interno
export function normalizeBookingStatus(status: string | undefined): string {
  switch ((status ?? "").toUpperCase()) {
    case "ACCEPTED":
      return "booked"
    case "PENDING":
      return "pending"
    case "CANCELLED_BY_CUSTOMER":
    case "CANCELLED_BY_SELLER":
    case "DECLINED":
      return "cancelled"
    case "NO_SHOW":
      return "no_show"
    default:
      return (status ?? "unknown").toLowerCase()
  }
}

// Calcula fin = start_at + suma(duration_minutes). null si no hay datos.
export function bookingEndsAt(booking: SquareBooking): string | null {
  if (!booking.start_at) return null
  const mins = (booking.appointment_segments ?? []).reduce(
    (s, seg) => s + (typeof seg.duration_minutes === "number" ? seg.duration_minutes : 0),
    0,
  )
  if (mins <= 0) return null
  const start = new Date(booking.start_at)
  if (isNaN(start.getTime())) return null
  return new Date(start.getTime() + mins * 60_000).toISOString()
}

// ── Enriquecimiento de cliente (email/teléfono) ──────────────────────────────
// El payment a veces no trae email/teléfono completos; si hay customer_id los
// buscamos con el Access Token. Defensivo: si falla, devolvemos nulls.
export type SquareCustomerInfo = {
  email: string | null
  phone: string | null
  name: string | null
  address: string | null
  customer: unknown | null // objeto crudo del customer (para guardar en raw)
}

export async function retrieveSquareCustomer(customerId: string): Promise<SquareCustomerInfo> {
  const empty: SquareCustomerInfo = { email: null, phone: null, name: null, address: null, customer: null }
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return empty
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/customers/${customerId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Square-Version": "2025-01-23",
      },
    })
    if (!res.ok) return empty
    const json = (await res.json()) as {
      customer?: {
        given_name?: string
        family_name?: string
        email_address?: string
        phone_number?: string
        address?: {
          address_line_1?: string
          address_line_2?: string
          locality?: string
          administrative_district_level_1?: string
          postal_code?: string
        }
      }
    }
    const c = json.customer
    if (!c) return empty
    const name = [c.given_name, c.family_name].filter(Boolean).join(" ").trim() || null
    const a = c.address
    const address = a
      ? [
          a.address_line_1,
          a.address_line_2,
          [a.locality, a.administrative_district_level_1, a.postal_code].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(" · ") || null
      : null
    return {
      email: c.email_address ?? null,
      phone: c.phone_number ?? null,
      name,
      address,
      customer: c,
    }
  } catch {
    return empty
  }
}
