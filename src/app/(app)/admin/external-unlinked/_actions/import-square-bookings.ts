"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  retrieveSquareCustomer,
  normalizeBookingStatus,
  bookingEndsAt,
  type SquareBooking,
} from "@/lib/integrations/square"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { routeAndCreateLead } from "@/lib/integrations/offer-brand-map"

type DB = SupabaseClient<Database>

// ─────────────────────────────────────────────────────────────────────────────
// Mini-importador de citas de Square (recuperación del apagón del webhook).
//
// Durante el apagón (≈7-9 jul 2026, el webhook devolvía 500) se PERDIERON citas
// de Square que nunca se guardaron en external_appointments. El webhook ya está
// arreglado y el ruteo automático PRENDIDO; este importador jala las citas de la
// Bookings API en una ventana de días y las mete/rutea EXACTAMENTE igual que el
// handler de booking.created del webhook.
//
// Endpoint (confirmado): GET {SQUARE_API_BASE}/v2/bookings
//   ?start_at_min=<ISO>&start_at_max=<ISO>&limit=100&cursor=<cursor>
//   headers: Authorization Bearer, Accept application/json, Square-Version 2025-01-23
//   respuesta: { bookings: [...], cursor?: string, errors?: [...] }
//
// La lógica de resolveLead / resolveUnique / contactFor / construcción del row
// se REPLICA aquí a propósito (no se importa del route) para NO tocar el webhook.
// Idempotente: skip si el external_id ya existe; routeAndCreateLead deduplica
// leads por external_id/email/teléfono.
// ─────────────────────────────────────────────────────────────────────────────

// SQUARE_API_BASE es const local (no exportada) en src/lib/integrations/square.ts;
// se replica aquí con el mismo default de producción.
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
    return { ok: false, error: "Solo admins pueden importar citas de Square" }
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
    // Escapar comodines LIKE (%, _, \); ilike preserva el match sin distinción
    // de mayúsculas (mismo patrón exacto que el webhook).
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
  address: string | null
  customer: unknown | null
}
async function contactFor(
  directEmail: string | null,
  customerId: string | undefined,
): Promise<Contact> {
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

// ── Bookings API: página de resultados ───────────────────────────────────────

type ListBookingsResponse = {
  bookings?: SquareBooking[]
  cursor?: string
  errors?: Array<{ category?: string; code?: string; detail?: string }>
}

async function fetchBookingsPage(
  token: string,
  startAtMin: string,
  startAtMax: string,
  cursor: string | null,
): Promise<ListBookingsResponse | null> {
  const params = new URLSearchParams({
    start_at_min: startAtMin,
    start_at_max: startAtMax,
    limit: "100",
  })
  if (cursor) params.set("cursor", cursor)
  try {
    const res = await fetch(`${SQUARE_API_BASE}/v2/bookings?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Square-Version": "2025-01-23",
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[import-square-bookings] ListBookings ${res.status}: ${body.slice(0, 300)}`)
      return null
    }
    return (await res.json()) as ListBookingsResponse
  } catch (e) {
    console.error(
      "[import-square-bookings] ListBookings fetch falló:",
      e instanceof Error ? e.message : String(e),
    )
    return null
  }
}

// ── Acción principal ─────────────────────────────────────────────────────────

export async function importSquareBookings(
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
    const startAtMin = new Date(now - daysBack * 24 * 60 * 60 * 1000).toISOString()
    const startAtMax = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString()

    const sb = createAdminClient() as unknown as DB

    let found = 0
    let imported = 0
    let linkedToLead = 0
    let skippedExisting = 0

    let cursor: string | null = null
    const MAX_PAGES = 20
    for (let page = 0; page < MAX_PAGES; page++) {
      const resp = await fetchBookingsPage(token, startAtMin, startAtMax, cursor)
      if (!resp) {
        // Si aún no importamos nada, es un error duro; si ya llevamos algo,
        // cortamos y devolvemos lo recuperado.
        if (found === 0) return { ok: false, error: "Error al consultar la Bookings API de Square" }
        break
      }
      const bookings = resp.bookings ?? []
      for (const booking of bookings) {
        found++
        const externalId = booking.id
        if (!externalId) continue

        // Idempotencia: si ya existe (provider='square', external_id) → skip.
        const { data: existing } = await sb
          .from("external_appointments")
          .select("id")
          .eq("provider", "square")
          .eq("external_id", externalId)
          .limit(1)
          .maybeSingle()
        if (existing) {
          skippedExisting++
          continue
        }

        const b = booking as SquareBooking
        const seg = b.appointment_segments?.[0]
        const contact = await contactFor(null, b.customer_id)

        // Match por lead existente (réplica exacta de resolveLead del webhook).
        let match = await resolveLead(sb, contact.email, contact.phone)

        // Ruteo automático SOLO si no matcheó (idéntico al webhook booking handler).
        if (!match) {
          const routed = await routeAndCreateLead(sb, {
            provider: "square",
            candidateKeys: [seg?.service_variation_id].filter(
              (v): v is string => Boolean(v),
            ),
            externalCustomerId: b.customer_id ?? null,
            contact: {
              email: contact.email,
              phone: contact.phone,
              name: contact.name,
              address: contact.address,
            },
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
          status: normalizeBookingStatus(b.status),
          service: seg?.service_variation_id ?? null,
          staff: seg?.team_member_id ?? null,
          starts_at: b.start_at ?? null,
          ends_at: bookingEndsAt(b),
          customer_name: contact.name,
          customer_email: contact.email,
          customer_phone: contact.phone,
          customer_address: contact.address,
          note: b.customer_note ?? b.seller_note ?? null,
          raw: { booking: b, customer: contact.customer, importedFrom: "mini-importer" },
          updated_at: new Date().toISOString(),
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (sb as any)
          .from("external_appointments")
          .upsert(row, { onConflict: "provider,external_id" })
        if (error) {
          console.error("[import-square-bookings] cita upsert:", error.message)
          // No abortamos toda la corrida por una fila; seguimos con las demás.
          continue
        }
        imported++
      }

      cursor = resp.cursor ?? null
      if (!cursor) break
    }

    revalidatePath("/admin/external-unlinked")
    return { ok: true, found, imported, linkedToLead, skippedExisting }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[importSquareBookings] threw:", msg)
    return { ok: false, error: msg }
  }
}
