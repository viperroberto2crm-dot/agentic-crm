import crypto from "crypto"
import type { PbAddress } from "@/lib/integrations/practice-better"

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
): Promise<{ items: string | null; itemList: string[]; itemCatalogIds: string[]; order: unknown | null }> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return { items: null, itemList: [], itemCatalogIds: [], order: null }
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Square-Version": "2025-01-23",
      },
    })
    if (!res.ok) return { items: null, itemList: [], itemCatalogIds: [], order: null }
    const json = (await res.json()) as {
      order?: {
        line_items?: Array<{
          name?: string
          quantity?: string
          variation_name?: string
          catalog_object_id?: string
        }>
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
    // IDs de catálogo (variación del producto) → llaves de ruteo por oferta.
    // Dedup, sin undefined. Match SOLO por ID exacto (nunca por nombre).
    const itemCatalogIds = Array.from(
      new Set(
        lines
          .map((li) => li.catalog_object_id)
          .filter((v): v is string => Boolean(v)),
      ),
    )
    return {
      items: itemList.length ? itemList.join(", ") : null,
      itemList,
      itemCatalogIds,
      order: json.order ?? null,
    }
  } catch {
    return { items: null, itemList: [], itemCatalogIds: [], order: null }
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
// Dirección estructurada del cliente (para empujar a Practice Better, que espera
// campos separados). Independiente del string `address` legible que ya usamos.
export type SquareAddressParts = {
  street: string | null
  unit: string | null
  locality: string | null // ciudad
  region: string | null // estado
  postalCode: string | null
  country: string | null // ISO Alpha-2, ej. "US"
}

export type SquareCustomerInfo = {
  email: string | null
  phone: string | null
  name: string | null
  firstName: string | null // given_name (para partir nombre/apellido en PB)
  lastName: string | null // family_name
  address: string | null // string legible (para customer_address de las tablas)
  addressParts: SquareAddressParts | null // estructurado (para PB)
  customer: unknown | null // objeto crudo del customer (para guardar en raw)
}

export async function retrieveSquareCustomer(customerId: string): Promise<SquareCustomerInfo> {
  const empty: SquareCustomerInfo = {
    email: null, phone: null, name: null, firstName: null, lastName: null,
    address: null, addressParts: null, customer: null,
  }
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
          country?: string
        }
      }
    }
    const c = json.customer
    if (!c) return empty
    const firstName = c.given_name?.trim() || null
    const lastName = c.family_name?.trim() || null
    const name = [firstName, lastName].filter(Boolean).join(" ").trim() || null
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
    const addressParts: SquareAddressParts | null = a
      ? {
          street: a.address_line_1?.trim() || null,
          unit: a.address_line_2?.trim() || null,
          locality: a.locality?.trim() || null,
          region: a.administrative_district_level_1?.trim() || null,
          postalCode: a.postal_code?.trim() || null,
          country: a.country?.trim() || null,
        }
      : null
    return {
      email: c.email_address ?? null,
      phone: c.phone_number ?? null,
      name,
      firstName,
      lastName,
      address,
      addressParts,
      customer: c,
    }
  } catch {
    return empty
  }
}

// ── Resolución de nombres legibles (Catalog + Team) ──────────────────────────
// Un booking de Square guarda service_variation_id y team_member_id en crudo.
// Estas funciones los traducen a nombres para mostrarlos en la UI. Defensivas:
// devuelven null si falla (nunca rompen el webhook). Se resuelven al ingerir el
// booking y se guardan como columnas (service_name/staff_name) — el nombre queda
// "congelado" aunque el catálogo cambie después.

/**
 * service_variation_id (ITEM_VARIATION del catálogo) → "Servicio — Variación".
 * Usa include_related_objects para traer el ITEM padre y armar el nombre.
 */
export async function retrieveSquareServiceName(variationId: string): Promise<string | null> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return null
  try {
    const res = await fetch(
      `${SQUARE_API_BASE}/v2/catalog/object/${variationId}?include_related_objects=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Square-Version": "2025-01-23",
        },
      },
    )
    if (!res.ok) return null
    const json = (await res.json()) as {
      object?: { item_variation_data?: { name?: string; item_id?: string } }
      related_objects?: Array<{ type?: string; id?: string; item_data?: { name?: string } }>
    }
    const variationName = json.object?.item_variation_data?.name?.trim() || null
    const itemId = json.object?.item_variation_data?.item_id
    const item = (json.related_objects ?? []).find(
      (o) => o.type === "ITEM" && o.id === itemId,
    )
    const itemName = item?.item_data?.name?.trim() || null
    if (itemName && variationName && variationName.toLowerCase() !== itemName.toLowerCase()) {
      return `${itemName} — ${variationName}`
    }
    return itemName || variationName || null
  } catch {
    return null
  }
}

/** team_member_id → "Nombre Apellido" del profesional. null si falla. */
export async function retrieveSquareTeamMember(teamMemberId: string): Promise<string | null> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/team-members/${teamMemberId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Square-Version": "2025-01-23",
      },
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      team_member?: { given_name?: string; family_name?: string; display_name?: string }
    }
    const tm = json.team_member
    if (!tm) return null
    const name = [tm.given_name, tm.family_name].filter(Boolean).join(" ").trim()
    return name || tm.display_name?.trim() || null
  } catch {
    return null
  }
}

// ── Mapeo Square → Practice Better (dirección + notas de perfil) ──────────────
// Compartido por el webhook y el mini-importador. PB no permite crear facturas
// por API, así que el detalle del pago/cita se anexa a profile.notes.

/**
 * Dirección estructurada de Square → formato PB. Las clínicas son de EE.UU., así
 * que default country="US" cuando hay dirección sin país. null si no hay datos.
 */
export function toPbAddress(parts: SquareAddressParts | null): PbAddress | null {
  if (!parts) return null
  const hasAny = parts.street || parts.unit || parts.locality || parts.region || parts.postalCode
  if (!hasAny) return null
  return {
    street: parts.street,
    unit: parts.unit,
    locality: parts.locality,
    region: parts.region,
    postalCode: parts.postalCode,
    country: parts.country || "US",
  }
}

// ISO → "YYYY-MM-DD" (sin dependencias de zona horaria en el webhook).
function fmtDateOnly(iso: string | null | undefined): string | null {
  if (!iso) return null
  const s = String(iso)
  return s.length >= 10 ? s.slice(0, 10) : s
}

/** Nota de pago para el perfil de PB. Formato estable (incluye tx id) para dedup. */
export function buildPaymentPbNote(p: SquarePayment, items: string | null): string | null {
  const cents = typeof p.amount_money?.amount === "number" ? p.amount_money.amount : null
  if (cents == null && !items) return null
  const cur = (p.amount_money?.currency ?? "USD").toUpperCase()
  const amount = cents != null ? `$${(cents / 100).toFixed(2)} ${cur}` : "(monto n/d)"
  const date = fmtDateOnly(p.created_at)
  const parts = [`Pago Square${date ? ` ${date}` : ""}: ${amount}`]
  if (items) parts.push(`— ${items}`)
  if (p.id) parts.push(`[tx ${p.id}]`)
  return parts.join(" ")
}

/** Nota de cita para el perfil de PB. Formato estable (incluye booking id) para dedup. */
export function buildBookingPbNote(b: SquareBooking, serviceLabel: string | null): string | null {
  if (!b.id) return null
  const date = fmtDateOnly(b.start_at)
  const svc = serviceLabel ? `: ${serviceLabel}` : ""
  return `Cita Square${date ? ` ${date}` : ""}${svc} [booking ${b.id}]`
}
