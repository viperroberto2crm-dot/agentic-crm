"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { z } from "zod"
import { sanitizeOrSearch, escapeIlike } from "@/lib/queries/search"
import { findOrCreatePbRecord } from "@/lib/integrations/pb-dedup"
import { getUnassignedBrandId } from "@/lib/integrations/offer-brand-map"
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
    brandId: string
    brandSlug: string | null
    firstName: string
    lastName: string | null
    email: string | null
    phone: string | null
  },
): Promise<void> {
  const { leadId, brandId, brandSlug, firstName, lastName, email, phone } = params
  if (!brandSlug || !pbEnabledSlugs().has(brandSlug)) return
  try {
    // Busca por email antes de crear (anti-duplicados, bug #2).
    await findOrCreatePbRecord(admin, { leadId, brandId, firstName, lastName, email, phone })
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
      brandId: input.brand_id,
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
      brandId: input.brand_id,
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

// ════════════════════════════════════════════════════════════════════════════
// Bug #3 — Reasignar leads en la marca centinela 'unassigned' a una clínica real
//
// Cuando una oferta Square/Stripe NO está mapeada, el ruteo crea el lead en la
// marca 'unassigned' y setea external_*.lead_id → esos pagos ya NO aparecen en
// la vista de "sin vincular" (que filtra lead_id IS NULL), y quedaban en limbo
// sin forma de moverlos a la clínica correcta. Estas actions cierran ese hueco.
// ════════════════════════════════════════════════════════════════════════════

// Todas las tablas que atan un registro a un lead + una marca. Al reasignar hay
// que mover brand_id en TODAS (si no, reportes/comisiones por marca se corrompen).
const LEAD_ID_BRAND_TABLES = [
  "appointments",
  "calls",
  "sales",
  "subscriptions",
  "payment_plans",
  "abonos",
  "external_payments",
  "external_appointments",
  "pb_appointments",
  "pb_payments",
] as const
// Tablas que referencian el lead por `related_lead_id`.
const RELATED_LEAD_ID_BRAND_TABLES = ["tasks", "agent_pending_actions"] as const

/** Mueve brand_id de todo lo atado a un lead. Best-effort por tabla (loguea). */
async function cascadeBrandId(
  admin: TypedClient,
  leadId: string,
  newBrandId: string,
): Promise<void> {
  for (const table of LEAD_ID_BRAND_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from(table)
      .update({ brand_id: newBrandId })
      .eq("lead_id", leadId)
    if (error) console.warn(`[reassign] cascade ${table}:`, error.message)
  }
  for (const table of RELATED_LEAD_ID_BRAND_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from(table)
      .update({ brand_id: newBrandId })
      .eq("related_lead_id", leadId)
    if (error) console.warn(`[reassign] cascade ${table}:`, error.message)
  }
}

/**
 * Re-vincula todo lo atado a `fromLeadId` hacia `toLeadId` (+ su brand).
 * Devuelve false si CUALQUIER tabla falló: el caller NO debe borrar el stub
 * entonces, porque pb_payments/pb_appointments son ON DELETE CASCADE y borrar
 * el stub con registros aún colgando de él perdería pagos/citas. El merge es
 * idempotente al reintentar (los eq(lead_id, from) ya no encuentran lo movido).
 */
async function relinkLead(
  admin: TypedClient,
  fromLeadId: string,
  toLeadId: string,
  toBrandId: string,
): Promise<boolean> {
  let allOk = true
  for (const table of LEAD_ID_BRAND_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from(table)
      .update({ lead_id: toLeadId, brand_id: toBrandId })
      .eq("lead_id", fromLeadId)
    if (error) {
      console.warn(`[merge] relink ${table}:`, error.message)
      allOk = false
    }
  }
  for (const table of RELATED_LEAD_ID_BRAND_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from(table)
      .update({ related_lead_id: toLeadId, brand_id: toBrandId })
      .eq("related_lead_id", fromLeadId)
    if (error) {
      console.warn(`[merge] relink ${table}:`, error.message)
      allOk = false
    }
  }
  return allOk
}

type LeadForReassign = {
  id: string
  brand_id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  pb_record_id: string | null
  notes: string | null
}

/** ¿El nombre es un placeholder (tel/email/"sin contacto") no apto para PB? */
function looksLikePlaceholderName(name: string, email: string | null, phone: string | null): boolean {
  const n = name.trim()
  if (!n) return true
  if (/sin contacto/i.test(n)) return true
  if (email && n.toLowerCase() === email.trim().toLowerCase()) return true
  if (phone && n === phone.trim()) return true
  if (/^\+?[\d][\d\s()-]{5,}$/.test(n)) return true // parece número de teléfono
  return false
}

/** Busca un lead EXISTENTE (distinto) en la marca destino por email o teléfono. */
async function findExistingLeadInBrand(
  admin: TypedClient,
  brandId: string,
  excludeLeadId: string,
  email: string | null,
  phone: string | null,
): Promise<{ id: string; first_name: string | null; last_name: string | null } | null> {
  if (email) {
    const { data } = await admin
      .from("leads")
      .select("id, first_name, last_name")
      .eq("brand_id", brandId)
      .neq("id", excludeLeadId)
      .ilike("email", escapeIlike(email))
      .limit(1)
      .maybeSingle()
    if (data) return data as { id: string; first_name: string | null; last_name: string | null }
  }
  if (phone) {
    const { data } = await admin
      .from("leads")
      .select("id, first_name, last_name")
      .eq("brand_id", brandId)
      .neq("id", excludeLeadId)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle()
    if (data) return data as { id: string; first_name: string | null; last_name: string | null }
  }
  return null
}

export type UnassignedLead = {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  source: string | null
  notes: string | null
  created_at: string
}

/** Lista los leads que quedaron en la marca centinela 'unassigned'. Solo admin. */
export async function listUnassignedLeads(): Promise<
  { ok: true; leads: UnassignedLead[] } | { ok: false; error: string }
> {
  try {
    const guard = await assertAdmin()
    if (!guard.ok) return guard
    const admin = createAdminClient() as unknown as TypedClient
    const unassignedId = await getUnassignedBrandId(admin)
    if (!unassignedId) return { ok: true, leads: [] } // SQL de ruteo sin correr
    const { data, error } = await admin
      .from("leads")
      .select("id, first_name, last_name, email, phone, source, notes, created_at")
      .eq("brand_id", unassignedId)
      .order("created_at", { ascending: false })
      .limit(200)
    if (error) return { ok: false, error: error.message }
    return { ok: true, leads: (data ?? []) as UnassignedLead[] }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[listUnassignedLeads] threw:", msg)
    return { ok: false, error: msg }
  }
}

const ReassignSchema = z.object({
  leadId: z.string().uuid("Lead inválido"),
  brandId: z.string().uuid("Marca inválida"),
})

/**
 * Reasigna un lead 'unassigned' a una clínica real. Valida server-side que el
 * lead esté HOY en 'unassigned' (no confía en la UI). Si ya existe otro lead de
 * esa persona en la marca destino, NO mueve: devuelve conflicto para que el
 * admin confirme el merge. Si no hay conflicto: cascada de brand_id + push a PB.
 */
export async function reassignLeadToBrand(
  rawLeadId: string,
  rawBrandId: string,
): Promise<
  | { ok: true }
  | { ok: true; conflict: { existingLeadId: string; existingName: string } }
  | { ok: false; error: string }
> {
  try {
    const { leadId, brandId } = ReassignSchema.parse({ leadId: rawLeadId, brandId: rawBrandId })
    const guard = await assertAdmin()
    if (!guard.ok) return guard
    const admin = createAdminClient() as unknown as TypedClient

    // Marca destino debe ser real y activa (no 'unassigned').
    const { data: brandRow } = await admin
      .from("brands")
      .select("id, slug, active")
      .eq("id", brandId)
      .maybeSingle()
    const brand = brandRow as { id: string; slug: string; active: boolean } | null
    if (!brand || !brand.active || brand.slug === "unassigned") {
      return { ok: false, error: "La marca destino no es válida" }
    }

    // El lead debe estar HOY en 'unassigned' (evita mover pacientes entre clínicas reales).
    const unassignedId = await getUnassignedBrandId(admin)
    const { data: leadRow } = await admin
      .from("leads")
      .select("id, brand_id, first_name, last_name, email, phone, pb_record_id, notes")
      .eq("id", leadId)
      .maybeSingle()
    const lead = leadRow as LeadForReassign | null
    if (!lead) return { ok: false, error: "Lead no encontrado" }
    if (!unassignedId || lead.brand_id !== unassignedId) {
      return { ok: false, error: "Este lead ya está asignado a una clínica" }
    }

    // Dedup: ¿ya existe esta persona en la marca destino? → conflicto (no mover).
    const existing = await findExistingLeadInBrand(admin, brandId, leadId, lead.email, lead.phone)
    if (existing) {
      const existingName =
        [existing.first_name, existing.last_name].filter(Boolean).join(" ").trim() || "lead existente"
      return { ok: true, conflict: { existingLeadId: existing.id, existingName } }
    }

    // Mover el lead + cascada de brand_id en todo lo atado.
    const note =
      (lead.notes ? lead.notes + ". " : "") +
      `Reasignado a ${brand.slug} por admin (${new Date().toISOString().slice(0, 10)})`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (admin as any)
      .from("leads")
      .update({ brand_id: brandId, notes: note })
      .eq("id", leadId)
    if (updErr) return { ok: false, error: updErr.message }
    await cascadeBrandId(admin, leadId, brandId)

    // Push a PB si la marca lo tiene habilitado, el lead no está en PB y el
    // nombre no es un placeholder (tel/email). Anti-duplicados por email.
    const firstName = (lead.first_name ?? "").trim()
    if (
      !lead.pb_record_id &&
      pbEnabledSlugs().has(brand.slug) &&
      firstName &&
      !looksLikePlaceholderName(firstName, lead.email, lead.phone)
    ) {
      try {
        await findOrCreatePbRecord(admin, {
          leadId,
          brandId,
          firstName,
          lastName: lead.last_name,
          email: lead.email,
          phone: lead.phone,
        })
      } catch (e) {
        console.warn("[reassign] PB push (no bloqueante):", e instanceof Error ? e.message : String(e))
      }
    }

    revalidatePath("/admin/external-unlinked")
    revalidatePath(`/leads/${leadId}`)
    return { ok: true }
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[reassignLeadToBrand] threw:", msg)
    return { ok: false, error: msg }
  }
}

const MergeSchema = z.object({
  unassignedLeadId: z.string().uuid("Lead inválido"),
  existingLeadId: z.string().uuid("Lead destino inválido"),
})

/**
 * Fusiona un lead 'unassigned' en un lead existente de una clínica real:
 * re-vincula sus pagos/citas/etc. al lead existente (con la marca de éste) y
 * borra el stub 'unassigned'. Usado tras el conflicto de reassignLeadToBrand.
 */
export async function mergeUnassignedLeadInto(
  rawUnassignedLeadId: string,
  rawExistingLeadId: string,
): Promise<{ ok: true; mergedInto: string } | { ok: false; error: string }> {
  try {
    const { unassignedLeadId, existingLeadId } = MergeSchema.parse({
      unassignedLeadId: rawUnassignedLeadId,
      existingLeadId: rawExistingLeadId,
    })
    if (unassignedLeadId === existingLeadId) return { ok: false, error: "Leads iguales" }
    const guard = await assertAdmin()
    if (!guard.ok) return guard
    const admin = createAdminClient() as unknown as TypedClient

    const unassignedId = await getUnassignedBrandId(admin)
    // El origen debe ser un stub 'unassigned'.
    const { data: fromRow } = await admin
      .from("leads")
      .select("id, brand_id")
      .eq("id", unassignedLeadId)
      .maybeSingle()
    const from = fromRow as { id: string; brand_id: string } | null
    if (!from) return { ok: false, error: "Lead origen no encontrado" }
    if (!unassignedId || from.brand_id !== unassignedId) {
      return { ok: false, error: "El lead origen no está sin asignar" }
    }
    // El destino debe ser un lead de una marca real.
    const { data: toRow } = await admin
      .from("leads")
      .select("id, brand_id")
      .eq("id", existingLeadId)
      .maybeSingle()
    const to = toRow as { id: string; brand_id: string } | null
    if (!to) return { ok: false, error: "Lead destino no encontrado" }
    if (to.brand_id === unassignedId) return { ok: false, error: "El destino también está sin asignar" }

    // Re-vincular todo hacia el lead destino. Si algo falló, NO borrar el stub:
    // pb_payments/pb_appointments son ON DELETE CASCADE y borrarlo con registros
    // aún colgando perdería pagos/citas. Reintentar el merge es seguro (idempotente).
    const relinked = await relinkLead(admin, unassignedLeadId, existingLeadId, to.brand_id)
    if (!relinked) {
      revalidatePath("/admin/external-unlinked")
      revalidatePath(`/leads/${existingLeadId}`)
      return {
        ok: false,
        error: "Re-vínculo parcial; no se borró el lead origen para no perder datos. Reintenta.",
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: delErr } = await (admin as any).from("leads").delete().eq("id", unassignedLeadId)
    if (delErr) {
      // Todo re-vinculado ya; el stub quedó vacío. Si el borrado falló, no hay
      // pérdida de datos (no queda nada colgando de él) — solo un stub huérfano.
      console.warn("[merge] no se pudo borrar el stub (sin datos colgando):", delErr.message)
    }

    revalidatePath("/admin/external-unlinked")
    revalidatePath(`/leads/${existingLeadId}`)
    return { ok: true, mergedInto: existingLeadId }
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Datos inválidos" }
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[mergeUnassignedLeadInto] threw:", msg)
    return { ok: false, error: msg }
  }
}
