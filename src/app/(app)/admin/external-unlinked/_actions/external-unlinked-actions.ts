"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { sanitizeOrSearch } from "@/lib/queries/search"
import { createPbRecord } from "@/lib/integrations/practice-better"
import { retrieveSquareCustomer } from "@/lib/integrations/square"
import { normalizeToE164 } from "@/lib/integrations/800com"

type TypedClient = SupabaseClient<Database>

async function typedClient(): Promise<TypedClient> {
  return (await createClient()) as unknown as TypedClient
}

async function assertAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await typedClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "No autenticado" }
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  if (profile?.role !== "admin") {
    return { ok: false, error: "Solo admins pueden vincular externos" }
  }
  return { ok: true, userId: user.id }
}

/** Slugs con Practice Better habilitado, desde env CSV. Mismo patrón que submit.ts. */
function pbEnabledSlugs(): Set<string> {
  const csv = process.env.PRACTICE_BETTER_BRAND_SLUGS ?? ""
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

// ── Búsqueda de leads existentes (cross-brand, top 10) ───────────────────────

export type LeadSearchResult = {
  id: string
  first_name: string
  last_name: string | null
  phone: string | null
  email: string | null
  brand_id: string
  brand_name: string | null
}

export async function searchLeadsForLink(
  query: string,
): Promise<{ ok: true; leads: LeadSearchResult[] } | { ok: false; error: string }> {
  try {
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const q = sanitizeOrSearch(query ?? "")
    if (q.length < 2) return { ok: true, leads: [] }

    const admin = createAdminClient() as unknown as TypedClient
    const { data, error } = await admin
      .from("leads")
      .select("id, first_name, last_name, phone, email, brand_id, brands(name)")
      .or(
        `first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`,
      )
      .order("created_at", { ascending: false })
      .limit(10)

    if (error) {
      console.error("[searchLeadsForLink]", error.message)
      return { ok: false, error: error.message }
    }

    const leads: LeadSearchResult[] = (data ?? []).map((row) => {
      const r = row as unknown as {
        id: string
        first_name: string
        last_name: string | null
        phone: string | null
        email: string | null
        brand_id: string
        brands: { name: string | null } | null
      }
      return {
        id: r.id,
        first_name: r.first_name,
        last_name: r.last_name,
        phone: r.phone,
        email: r.email,
        brand_id: r.brand_id,
        brand_name: r.brands?.name ?? null,
      }
    })
    return { ok: true, leads }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[searchLeadsForLink] threw:", msg)
    return { ok: false, error: msg }
  }
}

// ── Vincular externo a un lead existente ─────────────────────────────────────

async function fetchLeadBrandId(
  admin: TypedClient,
  leadId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("leads")
    .select("brand_id")
    .eq("id", leadId)
    .single()
  return (data as { brand_id: string } | null)?.brand_id ?? null
}

export async function linkExternalPaymentToLead(
  paymentId: string,
  leadId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!paymentId || !leadId) return { ok: false, error: "Parámetros inválidos" }
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const brandId = await fetchLeadBrandId(admin, leadId)
    if (!brandId) return { ok: false, error: "Lead no encontrado" }

    const { error } = await admin
      .from("external_payments")
      .update({ lead_id: leadId, brand_id: brandId })
      .eq("id", paymentId)

    if (error) {
      console.error("[linkExternalPaymentToLead]", error.message)
      return { ok: false, error: error.message }
    }
    revalidatePath("/admin/external-unlinked")
    revalidatePath(`/leads/${leadId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[linkExternalPaymentToLead] threw:", msg)
    return { ok: false, error: msg }
  }
}

export async function linkExternalAppointmentToLead(
  apptId: string,
  leadId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!apptId || !leadId) return { ok: false, error: "Parámetros inválidos" }
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const brandId = await fetchLeadBrandId(admin, leadId)
    if (!brandId) return { ok: false, error: "Lead no encontrado" }

    const { error } = await admin
      .from("external_appointments")
      .update({ lead_id: leadId, brand_id: brandId })
      .eq("id", apptId)

    if (error) {
      console.error("[linkExternalAppointmentToLead]", error.message)
      return { ok: false, error: error.message }
    }
    revalidatePath("/admin/external-unlinked")
    revalidatePath(`/leads/${leadId}`)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[linkExternalAppointmentToLead] threw:", msg)
    return { ok: false, error: msg }
  }
}

// ── Crear lead nuevo desde un registro externo ───────────────────────────────

const CreateLeadFromExternalSchema = z.object({
  brand_id: z.string().uuid("Marca requerida"),
  first_name: z.string().min(1, "Nombre requerido"),
  last_name: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  phone: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  email: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  address: z
    .string()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
})

export type CreateLeadFromExternalInput = z.input<typeof CreateLeadFromExternalSchema>

type CreatedLead = {
  leadId: string
  brandSlug: string | null
}

/**
 * Inserta un lead nuevo (source='walk_in' — el enum lead_source NO tiene
 * 'square'/'stripe' todavía, NO se modifica) y devuelve id + slug de la marca.
 */
async function insertLeadFromExternal(
  admin: TypedClient,
  input: z.infer<typeof CreateLeadFromExternalSchema>,
): Promise<{ ok: true; lead: CreatedLead } | { ok: false; error: string }> {
  const insertRow: Database["public"]["Tables"]["leads"]["Insert"] = {
    brand_id: input.brand_id,
    first_name: input.first_name.trim(),
    last_name: input.last_name,
    phone: input.phone,
    email: input.email,
    address_line1: input.address,
    status: "new",
    source: "walk_in",
    assigned_rep_id: null,
  }
  const { data, error } = await admin
    .from("leads")
    .insert(insertRow)
    .select("id")
    .single()
  if (error || !data) {
    console.error("[insertLeadFromExternal]", error?.message)
    return { ok: false, error: error?.message ?? "No se pudo crear el lead" }
  }
  const { data: brandRow } = await admin
    .from("brands")
    .select("slug")
    .eq("id", input.brand_id)
    .single()
  return {
    ok: true,
    lead: {
      leadId: (data as { id: string }).id,
      brandSlug: (brandRow as { slug: string } | null)?.slug ?? null,
    },
  }
}

/** Push a Practice Better NO bloqueante. Nunca lanza. */
async function pushLeadToPracticeBetter(
  admin: TypedClient,
  params: {
    leadId: string
    brandSlug: string | null
    firstName: string
    lastName: string | null
    email: string | null
    phone: string | null
  },
): Promise<void> {
  const { leadId, brandSlug, firstName, lastName, email, phone } = params
  if (!brandSlug || !pbEnabledSlugs().has(brandSlug)) return
  try {
    const rec = await createPbRecord({
      firstName,
      lastName: lastName ?? undefined,
      email: email ?? undefined,
      phone: phone ?? undefined,
    })
    const pbId = rec?.id ?? null
    if (pbId) {
      await admin
        .from("leads")
        .update({ pb_record_id: pbId, pb_synced_at: new Date().toISOString() })
        .eq("id", leadId)
    }
  } catch (e) {
    console.warn(
      "[external-unlinked] Practice Better push falló (no bloqueante):",
      e instanceof Error ? e.message : String(e),
    )
  }
}

export async function createLeadFromExternalPayment(
  paymentId: string,
  rawInput: CreateLeadFromExternalInput,
): Promise<{ ok: true; leadId: string } | { ok: false; error: string }> {
  try {
    if (!paymentId) return { ok: false, error: "Parámetros inválidos" }
    const input = CreateLeadFromExternalSchema.parse(rawInput)
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const created = await insertLeadFromExternal(admin, input)
    if (!created.ok) return created

    const { leadId, brandSlug } = created.lead

    const { error: linkErr } = await admin
      .from("external_payments")
      .update({ lead_id: leadId, brand_id: input.brand_id })
      .eq("id", paymentId)
    if (linkErr) {
      console.error("[createLeadFromExternalPayment] link:", linkErr.message)
      return { ok: false, error: linkErr.message }
    }

    await pushLeadToPracticeBetter(admin, {
      leadId,
      brandSlug,
      firstName: input.first_name.trim(),
      lastName: input.last_name,
      email: input.email,
      phone: input.phone,
    })

    revalidatePath("/admin/external-unlinked")
    revalidatePath(`/leads/${leadId}`)
    return { ok: true, leadId }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createLeadFromExternalPayment] threw:", msg)
    return { ok: false, error: msg }
  }
}

// ── Backfill: enriquecer pagos viejos de Square sin datos de cliente ─────────

/**
 * Re-jala datos del cliente (nombre/teléfono/dirección/email) para pagos de
 * Square SIN lead y con datos incompletos. Para cada pago:
 *   - Si raw->payment->customer_id existe → retrieveSquareCustomer y rellena
 *     los campos vacíos (customer_name/email/phone/address).
 *   - Si no hay customer_id pero raw->payment->buyer_email_address existe →
 *     al menos setea customer_email (si estaba vacío).
 * Solo admin. Devuelve cuántos pagos enriqueció.
 */
export async function enrichUnlinkedSquarePayments(): Promise<
  { ok: true; updated: number } | { ok: false; error: string }
> {
  try {
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const { data, error } = await admin
      .from("external_payments")
      .select("id, customer_name, customer_email, customer_phone, customer_address, raw")
      .eq("provider", "square")
      .is("lead_id", null)
      .or("customer_name.is.null,customer_email.is.null")
      .limit(100)
    if (error) {
      console.error("[enrichUnlinkedSquarePayments]", error.message)
      return { ok: false, error: error.message }
    }

    type PayRow = {
      id: string
      customer_name: string | null
      customer_email: string | null
      customer_phone: string | null
      customer_address: string | null
      raw: unknown
    }

    let updated = 0
    for (const row of (data ?? []) as PayRow[]) {
      const raw = (row.raw ?? {}) as {
        payment?: { customer_id?: string; buyer_email_address?: string }
      }
      const payment = raw.payment ?? {}
      const customerId = payment.customer_id ?? null

      const patch: Database["public"]["Tables"]["external_payments"]["Update"] = {}

      if (customerId) {
        const cust = await retrieveSquareCustomer(customerId)
        if (cust.name && !row.customer_name) patch.customer_name = cust.name
        if (cust.email && !row.customer_email) {
          patch.customer_email = cust.email.trim().toLowerCase()
        }
        if (cust.phone && !row.customer_phone) {
          patch.customer_phone = normalizeToE164(cust.phone) || cust.phone
        }
        if (cust.address && !row.customer_address) patch.customer_address = cust.address
      } else if (payment.buyer_email_address && !row.customer_email) {
        patch.customer_email = payment.buyer_email_address.trim().toLowerCase()
      }

      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await admin
          .from("external_payments")
          .update(patch)
          .eq("id", row.id)
        if (updErr) {
          console.warn("[enrichUnlinkedSquarePayments] update:", updErr.message)
        } else {
          updated++
        }
      }
    }

    revalidatePath("/admin/external-unlinked")
    return { ok: true, updated }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[enrichUnlinkedSquarePayments] threw:", msg)
    return { ok: false, error: msg }
  }
}

export async function createLeadFromExternalAppointment(
  apptId: string,
  rawInput: CreateLeadFromExternalInput,
): Promise<{ ok: true; leadId: string } | { ok: false; error: string }> {
  try {
    if (!apptId) return { ok: false, error: "Parámetros inválidos" }
    const input = CreateLeadFromExternalSchema.parse(rawInput)
    const guard = await assertAdmin()
    if (!guard.ok) return guard

    const admin = createAdminClient() as unknown as TypedClient
    const created = await insertLeadFromExternal(admin, input)
    if (!created.ok) return created

    const { leadId, brandSlug } = created.lead

    const { error: linkErr } = await admin
      .from("external_appointments")
      .update({ lead_id: leadId, brand_id: input.brand_id })
      .eq("id", apptId)
    if (linkErr) {
      console.error("[createLeadFromExternalAppointment] link:", linkErr.message)
      return { ok: false, error: linkErr.message }
    }

    await pushLeadToPracticeBetter(admin, {
      leadId,
      brandSlug,
      firstName: input.first_name.trim(),
      lastName: input.last_name,
      email: input.email,
      phone: input.phone,
    })

    revalidatePath("/admin/external-unlinked")
    revalidatePath(`/leads/${leadId}`)
    return { ok: true, leadId }
  } catch (e) {
    if (e instanceof z.ZodError) {
      return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[createLeadFromExternalAppointment] threw:", msg)
    return { ok: false, error: msg }
  }
}
