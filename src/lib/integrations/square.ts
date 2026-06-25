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

export type SquareWebhookEvent = {
  merchant_id?: string
  type?: string
  event_id?: string
  created_at?: string
  data?: { type?: string; id?: string; object?: { payment?: SquarePayment } }
}

// ── Enriquecimiento de cliente (email/teléfono) ──────────────────────────────
// El payment a veces no trae email/teléfono completos; si hay customer_id los
// buscamos con el Access Token. Defensivo: si falla, devolvemos nulls.
export async function retrieveSquareCustomer(
  customerId: string,
): Promise<{ email: string | null; phone: string | null }> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return { email: null, phone: null }
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/customers/${customerId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Square-Version": "2025-01-23",
      },
    })
    if (!res.ok) return { email: null, phone: null }
    const json = (await res.json()) as {
      customer?: { email_address?: string; phone_number?: string }
    }
    return {
      email: json.customer?.email_address ?? null,
      phone: json.customer?.phone_number ?? null,
    }
  } catch {
    return { email: null, phone: null }
  }
}
