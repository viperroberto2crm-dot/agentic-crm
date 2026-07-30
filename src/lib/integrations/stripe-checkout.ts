/**
 * Creación de Stripe Checkout Sessions para cobrar a un lead DESDE el CRM.
 *
 * El vendedor genera un link de cobro amarrado a un lead: la sesión lleva
 * `metadata.lead_id` y `metadata.brand_id`, así el webhook (checkout.session.completed)
 * vincula el pago DE FORMA DETERMINISTA a ese paciente — sin caer en "Pagos sin
 * vincular". El dinero lo escribe el webhook en `external_payments`; este módulo
 * NO toca la tabla `sales` (evita doble conteo).
 *
 * Sin SDK: usamos fetch crudo contra la API de Stripe, igual que pullStripePrices
 * (settings/_actions/offer-brand-map-actions.ts). Reutiliza STRIPE_SECRET_KEY que
 * ya está en producción.
 */

const STRIPE_API = "https://api.stripe.com/v1"

type CreateArgs = {
  /** Stripe price id (offer_key de offer_brand_map). */
  priceId: string
  leadId: string
  brandId: string
  /** Email del lead para prellenar el checkout (opcional). */
  email?: string | null
  /** Base absoluta del sitio, ej. https://agentic-crm-sigma.vercel.app */
  baseUrl: string
}

type CreateResult =
  | { ok: true; url: string; sessionId: string }
  | { ok: false; error: string }

/**
 * Determina el modo de checkout según el tipo de precio: recurrente →
 * "subscription", único → "payment". Un precio recurrente en modo "payment"
 * (o viceversa) hace que Stripe rechace la sesión, por eso lo consultamos antes.
 */
async function getPriceMode(
  priceId: string,
  key: string,
): Promise<"payment" | "subscription"> {
  const res = await fetch(
    `${STRIPE_API}/prices/${encodeURIComponent(priceId)}`,
    { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
  )
  if (!res.ok) {
    // No filtrar el cuerpo crudo de Stripe al usuario (va a la UI vía e.message).
    const text = await res.text().catch(() => "")
    console.error("[stripe-checkout] price", res.status, text.slice(0, 200))
    throw new Error("No se pudo validar la oferta con Stripe.")
  }
  const price = (await res.json()) as { recurring?: unknown | null }
  return price.recurring ? "subscription" : "payment"
}

type SessionCore = {
  leadId: string
  brandId: string
  email?: string | null
  baseUrl: string
}

/**
 * Arma y envía el Checkout Session. `setLineItem` fija el line_item (un price de
 * oferta, o price_data con monto personalizado); el resto (metadata, tarjeta,
 * urls, expiración) es común a ambos casos → una sola fuente de verdad.
 */
async function postCheckoutSession(
  key: string,
  mode: "payment" | "subscription",
  setLineItem: (p: URLSearchParams) => void,
  args: SessionCore,
): Promise<CreateResult> {
  try {
    const params = new URLSearchParams()
    params.set("mode", mode)
    setLineItem(params)
    params.set("line_items[0][quantity]", "1")
    // Solo tarjeta: evita métodos diferidos (OXXO, débito bancario) cuyo cobro
    // se confirma en un evento aparte que este webhook no maneja → dinero real
    // que quedaría "unpaid" para siempre. Las wallets (Apple/Google Pay) siguen
    // disponibles porque son respaldadas por tarjeta.
    params.set("payment_method_types[0]", "card")
    params.set("success_url", `${args.baseUrl}/pago/gracias`)
    params.set("cancel_url", `${args.baseUrl}/pago/gracias?cancelado=1`)
    params.set("client_reference_id", args.leadId)
    // Metadata en la sesión → llega en checkout.session.completed (pago único).
    params.set("metadata[lead_id]", args.leadId)
    params.set("metadata[brand_id]", args.brandId)
    // Propagar la metadata también al objeto de pago/suscripción, para que el
    // evento de dinero (payment_intent / subscription) también la lleve.
    if (mode === "payment") {
      params.set("payment_intent_data[metadata][lead_id]", args.leadId)
      params.set("payment_intent_data[metadata][brand_id]", args.brandId)
    } else {
      params.set("subscription_data[metadata][lead_id]", args.leadId)
      params.set("subscription_data[metadata][brand_id]", args.brandId)
    }
    // Expira en 2h (ambos modos: expires_at es a nivel de sesión, 30min–24h):
    // evita que un link viejo (p.ej. tras corregir la oferta) siga cobrable y el
    // paciente pague dos veces o quede doblemente suscrito.
    params.set("expires_at", String(Math.floor(Date.now() / 1000) + 7200))
    const email = args.email?.trim()
    if (email) params.set("customer_email", email)

    const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[stripe-checkout] create", res.status, text.slice(0, 200))
      return { ok: false, error: `Stripe rechazó el cobro (${res.status}).` }
    }
    const session = (await res.json()) as { id?: string; url?: string }
    if (!session.url || !session.id) {
      return { ok: false, error: "Stripe no devolvió el link de pago." }
    }
    return { ok: true, url: session.url, sessionId: session.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[stripe-checkout] threw:", msg)
    return { ok: false, error: msg }
  }
}

/** Cobro por una OFERTA predefinida (Stripe price id). */
export async function createCheckoutSessionForLead(
  args: CreateArgs,
): Promise<CreateResult> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return { ok: false, error: "Stripe no está configurado (falta STRIPE_SECRET_KEY)." }
  try {
    const mode = await getPriceMode(args.priceId, key)
    return await postCheckoutSession(
      key,
      mode,
      (p) => p.set("line_items[0][price]", args.priceId),
      args,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[stripe-checkout] threw:", msg)
    return { ok: false, error: msg }
  }
}

/**
 * Cobro por un MONTO PERSONALIZADO (producto que no es oferta). Usa price_data
 * inline → no requiere crear un price en Stripe. Siempre pago único.
 */
export async function createStripeCustomCheckout(args: {
  amountCents: number
  description: string
  leadId: string
  brandId: string
  email?: string | null
  baseUrl: string
}): Promise<CreateResult> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return { ok: false, error: "Stripe no está configurado (falta STRIPE_SECRET_KEY)." }
  return postCheckoutSession(
    key,
    "payment",
    (p) => {
      p.set("line_items[0][price_data][currency]", "usd")
      p.set("line_items[0][price_data][product_data][name]", args.description)
      p.set("line_items[0][price_data][unit_amount]", String(args.amountCents))
    },
    args,
  )
}
