/**
 * Creación de Square Payment Links para cobrar a un lead DESDE el CRM.
 *
 * Espejo del flujo de Stripe (stripe-checkout.ts): el link lleva el lead en la
 * orden (reference_id + metadata.lead_id/brand_id), así el webhook de Square
 * (payment.created) — que ya recupera la orden — vincula el pago DE FORMA
 * DETERMINISTA a ese paciente, sin adivinar por email/teléfono. El dinero lo
 * escribe el webhook en external_payments; este módulo NO toca `sales`.
 *
 * Sin SDK: fetch crudo, mismo patrón que src/lib/integrations/square.ts.
 */

const SQUARE_API_BASE = process.env.SQUARE_API_BASE_URL ?? "https://connect.squareup.com"
const SQUARE_VERSION = "2025-01-23"

type CreateArgs = {
  /** Square catalog service_variation_id (offer_key de offer_brand_map). */
  variationId: string
  leadId: string
  brandId: string
  /** Base absoluta del sitio para el redirect de retorno. */
  baseUrl: string
}

type CreateResult = { ok: true; url: string } | { ok: false; error: string }

// Cache de la location: Square requiere location_id para crear el link. Se puede
// fijar por env (SQUARE_LOCATION_ID); si no, se descubre vía la Locations API.
let cachedLocationId: string | null = null

async function getSquareLocationId(token: string): Promise<string | null> {
  const envLoc = process.env.SQUARE_LOCATION_ID
  if (envLoc && envLoc.trim()) return envLoc.trim()
  if (cachedLocationId) return cachedLocationId
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/locations`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        Accept: "application/json",
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[square-checkout] locations", res.status, text.slice(0, 160))
      return null
    }
    const json = (await res.json()) as {
      locations?: Array<{ id?: string; status?: string }>
    }
    const locs = json.locations ?? []
    const active = locs.find((l) => l.status === "ACTIVE" && l.id) ?? locs.find((l) => l.id)
    cachedLocationId = active?.id ?? null
    return cachedLocationId
  } catch (e) {
    console.error("[square-checkout] locations threw:", e instanceof Error ? e.message : String(e))
    return null
  }
}

export async function createSquarePaymentLinkForLead(
  args: CreateArgs,
): Promise<CreateResult> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return { ok: false, error: "Square no está configurado (falta SQUARE_ACCESS_TOKEN)." }

  const locationId = await getSquareLocationId(token)
  if (!locationId) return { ok: false, error: "No se encontró una ubicación (location) de Square." }

  try {
    const body = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: locationId,
        // reference_id ≤ 40 chars; un UUID de lead (36) cabe. metadata da el
        // vínculo explícito lead+marca que lee el webhook.
        reference_id: args.leadId,
        line_items: [{ catalog_object_id: args.variationId, quantity: "1" }],
        metadata: { lead_id: args.leadId, brand_id: args.brandId },
      },
      checkout_options: { redirect_url: `${args.baseUrl}/pago/gracias` },
    }

    const res = await fetch(`${SQUARE_API_BASE}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[square-checkout] create", res.status, text.slice(0, 240))
      return { ok: false, error: `Square rechazó el cobro (${res.status}).` }
    }
    const json = (await res.json()) as { payment_link?: { url?: string } }
    const url = json.payment_link?.url
    if (!url) return { ok: false, error: "Square no devolvió el link de pago." }
    return { ok: true, url }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[square-checkout] threw:", msg)
    return { ok: false, error: msg }
  }
}

/**
 * Cobro por un MONTO PERSONALIZADO en Square (producto que no es oferta). Usa un
 * `order` con line item ad-hoc (base_price_money, sin catálogo) para poder llevar
 * reference_id + metadata igual que el path de oferta → consistente y listo para
 * el vínculo determinista futuro. Hoy Square vincula por email/teléfono (el
 * webhook aún no lee la metadata de la orden — ver square/route.ts).
 */
export async function createSquareCustomLink(args: {
  amountCents: number
  description: string
  leadId: string
  brandId: string
  baseUrl: string
}): Promise<CreateResult> {
  const token = process.env.SQUARE_ACCESS_TOKEN
  if (!token) return { ok: false, error: "Square no está configurado (falta SQUARE_ACCESS_TOKEN)." }

  const locationId = await getSquareLocationId(token)
  if (!locationId) return { ok: false, error: "No se encontró una ubicación (location) de Square." }

  try {
    const body = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: locationId,
        reference_id: args.leadId,
        metadata: { lead_id: args.leadId, brand_id: args.brandId },
        line_items: [
          {
            name: args.description,
            quantity: "1",
            base_price_money: { amount: args.amountCents, currency: "USD" },
          },
        ],
      },
      checkout_options: { redirect_url: `${args.baseUrl}/pago/gracias` },
    }
    const res = await fetch(`${SQUARE_API_BASE}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("[square-checkout] custom", res.status, text.slice(0, 240))
      return { ok: false, error: `Square rechazó el cobro (${res.status}).` }
    }
    const json = (await res.json()) as { payment_link?: { url?: string } }
    const url = json.payment_link?.url
    if (!url) return { ok: false, error: "Square no devolvió el link de pago." }
    return { ok: true, url }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[square-checkout] custom threw:", msg)
    return { ok: false, error: msg }
  }
}
