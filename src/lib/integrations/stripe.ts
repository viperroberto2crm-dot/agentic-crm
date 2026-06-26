import crypto from "crypto"

// Stripe integration helpers. Docs: stripe.com/docs/webhooks
// - Firma: header Stripe-Signature: t=<ts>,v1=<hmac>. Se firma `${t}.${rawBody}`
//   con HMAC-SHA256 (hex) usando el webhook signing secret (whsec_...).
//   Tolerancia de 5 min contra replay.
// - Montos ya vienen en centavos (USD). NO multiplicar.

const STRIPE_TOLERANCE_SEC = 300

/**
 * Verifica la firma de un webhook de Stripe.
 * @param rawBody cuerpo CRUDO sin parsear
 * @param sigHeader header Stripe-Signature
 * @param secret webhook signing secret (whsec_...)
 * @param nowSec epoch en segundos (para la tolerancia; se pasa para testeo)
 */
export function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  nowSec: number,
): boolean {
  if (!sigHeader) return false
  // Parsear t= y v1=
  let t: string | null = null
  const v1s: string[] = []
  for (const part of sigHeader.split(",")) {
    const [k, val] = part.trim().split("=")
    if (k === "t") t = val
    else if (k === "v1" && val) v1s.push(val)
  }
  if (!t || v1s.length === 0) return false

  // Tolerancia de tiempo (anti-replay)
  const ts = parseInt(t, 10)
  if (!isFinite(ts) || Math.abs(nowSec - ts) > STRIPE_TOLERANCE_SEC) return false

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex")
  const expectedBuf = Buffer.from(expected, "hex")

  // Aceptar si CUALQUIER v1 coincide (Stripe puede enviar varias al rotar secret)
  return v1s.some((v1) => {
    try {
      const recvBuf = Buffer.from(v1, "hex")
      if (recvBuf.length !== expectedBuf.length) return false
      return crypto.timingSafeEqual(recvBuf, expectedBuf)
    } catch {
      return false
    }
  })
}

// ── Tipos parciales (solo lo que usamos) ─────────────────────────────────────

type StripeAddress = {
  line1?: string
  line2?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
}

export type StripeCheckoutSession = {
  id?: string
  mode?: string // 'payment' | 'subscription' | 'setup'
  amount_total?: number
  currency?: string
  payment_status?: string
  created?: number // epoch seconds
  customer_details?: { email?: string; phone?: string; name?: string; address?: StripeAddress }
  [k: string]: unknown
}

export type StripeInvoice = {
  id?: string
  amount_paid?: number
  currency?: string
  customer_email?: string
  customer_name?: string
  status?: string
  number?: string
  created?: number
  status_transitions?: { paid_at?: number }
  billing_reason?: string
  subscription?: string
  lines?: { data?: Array<{ description?: string; quantity?: number }> }
  [k: string]: unknown
}

export type StripeCharge = {
  id?: string
  amount?: number
  amount_refunded?: number
  currency?: string
  created?: number
  billing_details?: { email?: string; name?: string; phone?: string; address?: StripeAddress }
  [k: string]: unknown
}

// Convierte epoch-segundos de Stripe a ISO; fallback a `fallbackSec`.
export function stripeTs(sec: number | undefined, fallbackSec: number): string {
  const s = typeof sec === "number" && isFinite(sec) ? sec : fallbackSec
  return new Date(s * 1000).toISOString()
}

export type StripeEvent = {
  id?: string
  type?: string
  data?: { object?: Record<string, unknown> }
}

// Formatea una dirección de Stripe a una línea legible.
export function stripeAddress(a: StripeAddress | undefined): string | null {
  if (!a) return null
  return (
    [a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(", "), a.country]
      .filter(Boolean)
      .join(" · ") || null
  )
}

// Resumen de items de un invoice (descripciones de las líneas).
export function stripeInvoiceItems(inv: StripeInvoice): string | null {
  const lines = inv.lines?.data ?? []
  const names = lines
    .map((l) => {
      const qty = l.quantity && l.quantity > 1 ? `${l.quantity}x ` : ""
      return `${qty}${l.description ?? ""}`.trim()
    })
    .filter(Boolean)
  return names.length ? names.join(", ") : null
}
