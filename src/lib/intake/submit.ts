import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, Json } from "@/types/database"
import { normalizeToE164 } from "@/lib/integrations/800com"
import { escapeIlike } from "@/lib/queries/search"
import { createPbRecord } from "@/lib/integrations/practice-better"

type SB = SupabaseClient<Database>

// ── Tipos de los valores de intake (SOLO demográficos, sin PHI) ──────────────

export type IntakeGender = "F" | "M" | "other"
export type IntakeMaritalStatus =
  | "casado"
  | "soltero"
  | "divorciado"
  | "viudo"
  | "otro"
export type IntakePreferredLanguage = "en" | "es"

/** Todos opcionales excepto first_name + phone. */
export type IntakeValues = {
  // Columnas estándar de leads
  first_name: string
  last_name?: string | null
  phone: string
  email?: string | null
  address_line1?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  // Extras → leads.custom_fields (jsonb)
  dob?: string | null // ISO date (YYYY-MM-DD)
  gender?: IntakeGender | null
  identifies_as?: string | null
  occupation?: string | null
  marital_status?: IntakeMaritalStatus | null
  preferred_language?: IntakePreferredLanguage | null
  intake_date?: string | null // ISO date; default = hoy si no viene
}

export type SubmitIntakeResult = { leadId: string; created: boolean }

// ── Helpers ──────────────────────────────────────────────────────────────────

function clean(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** Slugs con Practice Better habilitado, desde env CSV. */
function pbEnabledSlugs(): Set<string> {
  const csv = process.env.PRACTICE_BETTER_BRAND_SLUGS ?? ""
  return new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

/**
 * Construye el objeto custom_fields SOLO con los extras de intake presentes.
 * Nunca incluye datos médicos/PHI.
 */
function buildIntakeCustomFields(values: IntakeValues): Record<string, string> {
  const cf: Record<string, string> = {}
  const dob = clean(values.dob)
  const gender = values.gender ?? null
  const identifiesAs = clean(values.identifies_as)
  const occupation = clean(values.occupation)
  const maritalStatus = values.marital_status ?? null
  const preferredLanguage = values.preferred_language ?? null
  const intakeDate = clean(values.intake_date) ?? new Date().toISOString().slice(0, 10)

  if (dob) cf.dob = dob
  if (gender) cf.gender = gender
  if (identifiesAs) cf.identifies_as = identifiesAs
  if (occupation) cf.occupation = occupation
  if (maritalStatus) cf.marital_status = maritalStatus
  if (preferredLanguage) cf.preferred_language = preferredLanguage
  cf.intake_date = intakeDate
  return cf
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Crea o actualiza un lead a partir de una admisión en clínica.
 *
 * Dedup: busca un lead existente en la MISMA marca por teléfono (E.164) o email.
 *   - Si existe → actualiza SOLO las columnas estándar vacías y MERGEA
 *     custom_fields (sin sobreescribir valores ya presentes).
 *   - Si no → inserta un lead nuevo con source="walk_in", status="new".
 *
 * Practice Better (no bloqueante): si el slug de la marca está en
 * PRACTICE_BETTER_BRAND_SLUGS y el lead aún no tiene pb_record_id, crea el
 * cliente en PB y guarda pb_record_id + pb_synced_at. Cualquier fallo de PB se
 * captura y NO hace fallar el intake.
 *
 * Usada tanto por el server action público (tablet, admin-client) como por el
 * interno (sesión). El caller decide qué cliente Supabase pasar.
 */
export async function submitIntake(params: {
  sb: SB
  brandId: string
  brandSlug: string
  values: IntakeValues
}): Promise<SubmitIntakeResult> {
  const { sb, brandId, brandSlug, values } = params

  const firstName = clean(values.first_name)
  if (!firstName) throw new Error("first_name requerido")

  const phoneRaw = clean(values.phone)
  if (!phoneRaw) throw new Error("phone requerido")
  const phone = normalizeToE164(phoneRaw) || phoneRaw

  const lastName = clean(values.last_name)
  const email = clean(values.email)
  const addressLine1 = clean(values.address_line1)
  const city = clean(values.city)
  const state = clean(values.state)
  const zip = clean(values.zip)

  const intakeCustomFields = buildIntakeCustomFields(values)

  // ── Dedup dentro de la marca: por teléfono primero, luego por email ──────────
  type ExistingLead = {
    id: string
    first_name: string | null
    last_name: string | null
    phone: string | null
    email: string | null
    address_line1: string | null
    city: string | null
    state: string | null
    zip: string | null
    custom_fields: Json
    pb_record_id: string | null
  }
  let existing: ExistingLead | null = null

  const existingSelect =
    "id, first_name, last_name, phone, email, address_line1, city, state, zip, custom_fields, pb_record_id"

  {
    const { data } = await sb
      .from("leads")
      .select(existingSelect)
      .eq("brand_id", brandId)
      .eq("phone", phone)
      .maybeSingle()
    if (data) existing = data as unknown as ExistingLead
  }

  if (!existing && email) {
    const { data } = await sb
      .from("leads")
      .select(existingSelect)
      .eq("brand_id", brandId)
      .ilike("email", escapeIlike(email))
      .maybeSingle()
    if (data) existing = data as unknown as ExistingLead
  }

  let leadId: string
  let created: boolean
  let leadHasPbRecord: boolean

  if (existing) {
    // ── UPDATE: solo rellenar columnas estándar vacías + merge custom_fields ──
    const patch: Database["public"]["Tables"]["leads"]["Update"] = {}
    if (!clean(existing.first_name) && firstName) patch.first_name = firstName
    if (!clean(existing.last_name) && lastName) patch.last_name = lastName
    if (!clean(existing.phone) && phone) patch.phone = phone
    if (!clean(existing.email) && email) patch.email = email
    if (!clean(existing.address_line1) && addressLine1) patch.address_line1 = addressLine1
    if (!clean(existing.city) && city) patch.city = city
    if (!clean(existing.state) && state) patch.state = state
    if (!clean(existing.zip) && zip) patch.zip = zip

    // Merge custom_fields: NO sobreescribir claves ya presentes.
    const existingCf =
      existing.custom_fields && typeof existing.custom_fields === "object" && !Array.isArray(existing.custom_fields)
        ? (existing.custom_fields as Record<string, unknown>)
        : {}
    const mergedCf: Record<string, unknown> = { ...existingCf }
    let cfChanged = false
    for (const [k, v] of Object.entries(intakeCustomFields)) {
      if (existingCf[k] === undefined || existingCf[k] === null || existingCf[k] === "") {
        mergedCf[k] = v
        cfChanged = true
      }
    }
    if (cfChanged) patch.custom_fields = mergedCf as Json

    if (Object.keys(patch).length > 0) {
      const { error } = await sb.from("leads").update(patch).eq("id", existing.id)
      if (error) throw new Error(`intake update falló: ${error.message}`)
    }

    leadId = existing.id
    created = false
    leadHasPbRecord = Boolean(clean(existing.pb_record_id))
  } else {
    // ── INSERT nuevo lead ──────────────────────────────────────────────────────
    const insertRow: Database["public"]["Tables"]["leads"]["Insert"] = {
      brand_id: brandId,
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      address_line1: addressLine1,
      city,
      state,
      zip,
      status: "new",
      source: "walk_in",
      assigned_rep_id: null,
      custom_fields: intakeCustomFields as Json,
    }
    const { data, error } = await sb.from("leads").insert(insertRow).select("id").single()
    if (error || !data) throw new Error(`intake insert falló: ${error?.message ?? "sin id"}`)

    leadId = (data as { id: string }).id
    created = true
    leadHasPbRecord = false
  }

  // ── Practice Better push (no bloqueante, solo slugs habilitados) ─────────────
  if (pbEnabledSlugs().has(brandSlug) && !leadHasPbRecord) {
    try {
      const rec = await createPbRecord({
        firstName,
        lastName: lastName ?? undefined,
        email: email ?? undefined,
        phone: phone ?? undefined,
      })
      const pbId = rec?.id ?? null
      if (pbId) {
        await sb
          .from("leads")
          .update({ pb_record_id: pbId, pb_synced_at: new Date().toISOString() })
          .eq("id", leadId)
      }
    } catch (e) {
      // Un fallo de PB NUNCA hace fallar el intake.
      console.warn(
        "[intake] Practice Better push falló (no bloqueante):",
        e instanceof Error ? e.message : String(e),
      )
    }
  }

  return { leadId, created }
}
