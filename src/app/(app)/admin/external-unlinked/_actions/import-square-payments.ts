"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  retrieveSquareCustomer,
  retrieveSquareOrder,
  normalizeSquareStatus,
  squareOrigin,
  toPbAddress,
  buildPaymentPbNote,
  type SquarePayment,
  type SquareAddressParts,
} from "@/lib/integrations/square"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { routeAndCreateLead } from "@/lib/integrations/offer-brand-map"
import { enrichPbRecord, type PbAddress } from "@/lib/integrations/practice-better"

type DB = SupabaseClient<Database>

// ─────────────────────────────────────────────────────────────────────────────
// Mini-importador de PAGOS de Square (recuperación del apagón del webhook).
//
// Gemelo de import-square-bookings.ts. Durante el apagón (≈7-9 jul 2026, el
// webhook daba 500) se PERDIERON pagos de Square que nunca entraron a
// external_payments (ej. el pago $25 de Leslie, confirmado en el dashboard de
// Square). El webhook ya está arreglado; este importador jala los pagos de la
// Payments API en una ventana de días y los mete/rutea EXACTAMENTE igual que el
// handler de payment.created del webhook.
//
// Endpoint: GET {SQUARE_API_BASE}/v2/payments
//   ?begin_time=<ISO>&end_time=<ISO>&sort_order=ASC&limit=100&cursor=<cursor>
//   headers: Authorization Bearer, Accept, Square-Version 2025-01-23
//   respuesta: { payments: [...], cursor?: string, errors?: [...] }
//
// La lógica de resolveLead / contactFor / construcción del row se REPLICA aquí a
// propósito (no se importa del route) para NO tocar el webhook. Idempotente: skip
// si el external_id ya existe; routeAndCreateLead deduplica leads.
// ─────────────────────────────────────────────────────────────────────────────

const SQUARE_API_BASE = process.env.SQUARE_API_BASE_URL ?? "https://connect.squareup.com"

async function typedServerClient(): Promise<DB> {
  return (await createClient()) as unknown as DB
}

async function assertAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await typedServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  if (profile?.role !== "admin") {
    return { ok: false, error: "Solo admins pueden importar pagos de Square" }
  }
  return { ok: true, userId: user.id }
}

// ── Réplica de resolveUnique / resolveLead del webhook ───────────────────────

type Cand = { leadId: string; brandId: string }
function resolveUnique(cands: Cand[]): Cand | null {
  if (cands.length === 0) return null
  const brands = new Set(cands.map((c) => c.brandId))
  if (brands.size > 1) return null // ambiguo entre clínicas: no adivinar
  return cands[0]
}

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

// ── Réplica de contactFor del webhook ────────────────────────────────────────

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
async function contactFor(
  directEmail: string | null,
  customerId: string | undefined,
): Promise<Contact> {
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

// Enriquece el paciente de PB de un lead pre-existente (réplica de enrichLinkedLeadPb
// del webhook). Gate PB_ENRICH_RECORDS. No bloqueante.
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
      "[import-square-payments] enrich PB (no bloqueante):",
      e instanceof Error ? e.message : String(e),
    )
  }
}

// ── Payments API: página de resultados ───────────────────────────────────────

type ListPaymentsResponse = {
  payments?: SquarePayment[]
  cursor?: string
  errors?: Array<{ category?: string; code?: string; detail?: string }>
}

async function fetchPaymentsPage(
  token: string,
  beginTime: string,
  endTime: string,
  cursor: string | null,
): Promise<ListPaymentsResponse | null> {
  const params = new URLSearchParams({
    begin_time: beginTime,
    end_time: endTime,
    sort_order: "ASC",
    limit: "100",
  })
  if (cursor) params.set("cursor", cursor)
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/payments?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Square-Version": "2025-01-23",
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[import-square-payments] ListPayments ${res.status}: ${body.slice(0, 300)}`)
      return null
    }
    return (await res.json()) as ListPaymentsResponse
  } catch (e) {
    console.error(
      "[import-square-payments] ListPayments fetch falló:",
      e instanceof Error ? e.message : String(e),
    )
    return null
  }
}

// ── Acción principal ─────────────────────────────────────────────────────────

export async function importSquarePayments(
  daysBack = 12,
): Promise<
  | { ok: true; found: number; imported: number; linkedToLead: number; skippedExisting: number }
  | { ok: false; error: string }
> {
  try {
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const token = process.env.SQUARE_ACCESS_TOKEN
    if (!token) return { ok: false, error: "Falta SQUARE_ACCESS_TOKEN" }

    const now = Date.now()
    const beginTime = new Date(now - daysBack * 24 * 60 * 60 * 1000).toISOString()
    const endTime = new Date(now).toISOString()

    const sb = createAdminClient() as unknown as DB

    let found = 0
    let imported = 0
    let linkedToLead = 0
    let skippedExisting = 0

    let cursor: string | null = null
    const MAX_PAGES = 20
    for (let page = 0; page < MAX_PAGES; page++) {
      const resp = await fetchPaymentsPage(token, beginTime, endTime, cursor)
      if (!resp) {
        if (found === 0) return { ok: false, error: "Error al consultar la Payments API de Square" }
        break
      }
      const payments = resp.payments ?? []
      for (const payment of payments) {
        found++
        const externalId = payment.id
        if (!externalId) continue

        // Idempotencia: si ya existe (provider='square', external_id) → skip.
        const { data: existing } = await sb
          .from("external_payments")
          .select("id")
          .eq("provider", "square")
          .eq("external_id", externalId)
          .limit(1)
          .maybeSingle()
        if (existing) {
          skippedExisting++
          continue
        }

        const p = payment as SquarePayment
        const contact = await contactFor(payment.buyer_email_address ?? null, payment.customer_id)

        // Productos comprados viven en el order (igual que el webhook).
        let items: string | null = null
        let orderRaw: unknown = null
        let itemCatalogIds: string[] = []
        if (p.order_id) {
          const ord = await retrieveSquareOrder(p.order_id)
          items = ord.items
          orderRaw = ord.order
          itemCatalogIds = ord.itemCatalogIds
        }

        const pbAddress = toPbAddress(contact.addressParts)
        const pbNote = buildPaymentPbNote(p, items)

        // Match por lead existente (réplica exacta de resolveLead del webhook).
        let match = await resolveLead(sb, contact.email, contact.phone)
        const preLinkedLeadId = match?.leadId ?? null

        // Ruteo automático SOLO si no matcheó (idéntico al webhook payment handler).
        if (!match) {
          const routed = await routeAndCreateLead(sb, {
            provider: "square",
            candidateKeys: itemCatalogIds,
            origin: squareOrigin(p),
            externalCustomerId: payment.customer_id ?? null,
            contact: {
              email: contact.email,
              phone: contact.phone,
              name: contact.name,
              firstName: contact.firstName,
              lastName: contact.lastName,
              address: contact.address,
            },
            pbAddress,
            pbNote,
            noteSuffix: items ? `Productos: ${items}` : null,
          })
          if (routed) match = { leadId: routed.leadId, brandId: routed.brandId }
        }
        if (match) linkedToLead++

        const row = {
          provider: "square",
          brand_id: match?.brandId ?? null,
          lead_id: match?.leadId ?? null,
          external_id: externalId,
          event_id: null,
          amount_cents: typeof p.amount_money?.amount === "number" ? p.amount_money.amount : 0,
          currency: p.amount_money?.currency ?? null,
          status: normalizeSquareStatus(p.status),
          origin: squareOrigin(p),
          items,
          customer_name: contact.name,
          customer_email: contact.email,
          customer_phone: contact.phone,
          customer_address: contact.address,
          reference: p.reference_id ?? p.note ?? null,
          paid_at: p.created_at ?? null,
          raw: { payment: p, customer: contact.customer, order: orderRaw, importedFrom: "mini-importer" },
          updated_at: new Date().toISOString(),
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (sb as any)
          .from("external_payments")
          .upsert(row, { onConflict: "provider,external_id" })
        if (error) {
          console.error("[import-square-payments] pago upsert:", error.message)
          continue
        }
        imported++

        // Enriquecer PB del lead pre-existente (no de los recién creados por ruteo).
        await enrichLinkedLeadPb(sb, preLinkedLeadId, pbAddress, pbNote)
      }

      cursor = resp.cursor ?? null
      if (!cursor) break
    }

    revalidatePath("/admin/external-unlinked")
    return { ok: true, found, imported, linkedToLead, skippedExisting }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[importSquarePayments] threw:", msg)
    return { ok: false, error: msg }
  }
}
