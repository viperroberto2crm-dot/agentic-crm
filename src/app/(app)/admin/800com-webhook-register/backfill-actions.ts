"use server"

/**
 * Server actions admin-only para mantenimiento de la integración 800.com.
 *
 *   - backfillCallsFromEightHundred: trae calls de 800.com API (recovery de
 *     llamadas perdidas mientras webhook estuvo caído).
 *   - syncTrackingNumbersFromEightHundred: lista TODOS los tracking numbers
 *     de la company 800.com y los inserta en `tracking_numbers` si faltan.
 *     Sin esto, las llamadas a numbers no registrados se descartan en
 *     resolveTracking del webhook receiver.
 *
 * Ambos usan session auth (admin only) — no requieren CRON_SECRET.
 */

import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  importCallsFromEightHundred,
  listCallsPage,
  listConversationsPage,
  extractEnhancedCallerInfo,
  lookupEnhancedCallerId,
  type EightHundredCallV2,
  type EightHundredConversation,
} from "@/lib/integrations/800com"

function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null
  const cleaned = s.replace(/[^\d+]/g, "")
  return cleaned || null
}
import { revalidatePath } from "next/cache"

type DB = SupabaseClient<Database>

const API_BASE = "https://api.800.com"

function getEnv() {
  const apiKey = process.env.EIGHTHUNDRED_API_KEY
  const companyId = process.env.EIGHTHUNDRED_COMPANY_ID
  if (!apiKey) throw new Error("EIGHTHUNDRED_API_KEY no configurado")
  if (!companyId) throw new Error("EIGHTHUNDRED_COMPANY_ID no configurado")
  return { apiKey, companyId }
}

async function assertAdmin() {
  const supabase = (await createClient()) as unknown as DB
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  if (profile?.role !== "admin") throw new Error("Solo admin puede correr esta acción")
}

export type BackfillResult =
  | {
      ok: true
      range: { startDate: string; endDate: string }
      inserted: number
      skipped_existing: number
      leads_matched: number
      errors: { call_id: number; error: string }[]
    }
  | { ok: false; error: string }

export async function backfillCallsFromEightHundred(input: {
  /** YYYY-MM-DD. Si no se pasa, default 7 días atrás. */
  fromDate?: string | null
}): Promise<BackfillResult> {
  try {
    await assertAdmin()

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return { ok: false, error: "Supabase service env vars missing" }
    }

    const startDate = input.fromDate
      ? new Date(input.fromDate + "T00:00:00Z").toISOString()
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date().toISOString()

    // Service client: bypass RLS (admin ya verificado arriba)
    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const result = await importCallsFromEightHundred(sb, {
      startDate,
      endDate,
      autoCreateLeads: true,
      maxPages: 200,
    })

    revalidatePath("/calls")
    revalidatePath("/dashboard")

    return {
      ok: true,
      range: { startDate, endDate },
      inserted: result.inserted ?? 0,
      skipped_existing: result.skipped_existing ?? 0,
      leads_matched: result.leads_matched ?? 0,
      errors: result.errors ?? [],
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// SYNC TRACKING NUMBERS
// Lista todos los tracking numbers de la company A&O via 800.com API y
// los inserta en `tracking_numbers` (brand = Si Se Pierde) si no existen.
// Sin esto, las llamadas a numbers no registrados se descartan.
// ─────────────────────────────────────────────────────────────────────

export type TrackingNumberFromAPI = {
  id: number
  number: string
  label?: string | null
}

export type SyncTrackingResult =
  | {
      ok: true
      total_in_800com: number
      already_in_db: TrackingNumberFromAPI[]
      added: TrackingNumberFromAPI[]
      errors: string[]
    }
  | { ok: false; error: string }

export async function syncTrackingNumbersFromEightHundred(input: {
  /** Brand slug al cual asignar los nuevos numbers. Default 'si-se-pierde'. */
  brandSlug?: string
  /** Si true, solo lista sin insertar (dry run). Default false. */
  dryRun?: boolean
}): Promise<SyncTrackingResult> {
  try {
    await assertAdmin()
    getEnv() // valida que existan EIGHTHUNDRED_API_KEY + COMPANY_ID
    const companyIdNum = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID!, 10)
    const brandSlug = input.brandSlug ?? "si-se-pierde"
    const dryRun = input.dryRun ?? false

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return { ok: false, error: "Supabase service env vars missing" }
    }

    // 1) Listar TODAS las calls de los últimos 30 días con paginación,
    // extraer numberIds únicos (call.number.id, call.number.number, call.number.label).
    // Aprovechamos que listCallsPage YA funciona (es el endpoint que usa el cron).
    // Sin esto teníamos que adivinar el endpoint /numbers (404 not found).
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date().toISOString()
    const numbersMap = new Map<number, TrackingNumberFromAPI>()
    let cursor: string | null | undefined = undefined
    let pages = 0
    const MAX_PAGES = 100 // safety cap

    while (pages < MAX_PAGES) {
      const page = await listCallsPage({
        companyId: companyIdNum,
        startDate,
        endDate,
        perPage: 100,
        cursor: cursor ?? undefined,
      })
      pages++
      for (const call of page.data) {
        const id = call.number?.id
        if (typeof id !== "number") continue
        if (!numbersMap.has(id)) {
          numbersMap.set(id, {
            id,
            number: call.number.number,
            label: call.number.label,
          })
        }
      }
      if (!page.meta.nextCursor) break
      cursor = page.meta.nextCursor
    }
    const numbersFromAPI = Array.from(numbersMap.values())

    // 2) Resolver brand_id por slug
    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
    const { data: brandRow } = await sb
      .from("brands")
      .select("id, name")
      .eq("slug", brandSlug)
      .maybeSingle()
    if (!brandRow?.id) {
      return { ok: false, error: `Brand '${brandSlug}' no encontrado en DB` }
    }

    // 3) Buscar rep fallback (primer admin/manager activo) — para que
    // resolveTracking del webhook tenga rep_id válido.
    const { data: anyRep } = await sb
      .from("users")
      .select("id")
      .eq("active", true)
      .in("role", ["admin", "manager"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!anyRep?.id) {
      return { ok: false, error: "No hay admin/manager activo como rep fallback" }
    }

    // 4) Listar los tracking_numbers ya registrados de 800com
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingRows } = await (sb as any)
      .from("tracking_numbers")
      .select("id, provider_metadata, active")
      .eq("provider", "800com")
    const existingIds = new Set<number>(
      ((existingRows ?? []) as Array<{ provider_metadata: { number_id?: number } | null }>)
        .map((r) => r.provider_metadata?.number_id)
        .filter((x): x is number => typeof x === "number"),
    )

    // 5) Por cada number de la API, ver si falta y si sí, INSERT
    const alreadyInDb: TrackingNumberFromAPI[] = []
    const added: TrackingNumberFromAPI[] = []
    const errors: string[] = []

    for (const n of numbersFromAPI) {
      if (existingIds.has(n.id)) {
        alreadyInDb.push(n)
        continue
      }
      if (dryRun) {
        added.push(n) // simular
        continue
      }
      // INSERT
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (sb as any).from("tracking_numbers").insert({
        provider: "800com",
        brand_id: brandRow.id,
        phone_e164: n.number,
        label: n.label || `800.com #${n.id}`,
        provider_metadata: { number_id: n.id },
        active: true,
      })
      if (error) {
        errors.push(`number ${n.id} (${n.number}): ${error.message}`)
      } else {
        added.push(n)
      }
    }

    revalidatePath("/admin/800com-webhook-register")

    return {
      ok: true,
      total_in_800com: numbersFromAPI.length,
      already_in_db: alreadyInDb,
      added,
      errors,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// BACKFILL LEADS PARA CALLS SIN NOMBRE (lead_id IS NULL)
// Para cada call sin lead, busca info del caller en 800.com API,
// crea lead si tiene nombre, y linkea con la call.
// Safe: solo INSERT leads nuevos y UPDATE de calls que estaban NULL.
// ─────────────────────────────────────────────────────────────────────

export type BackfillLeadsResult =
  | {
      ok: true
      total_orphans: number
      leads_created: number
      leads_matched_existing: number
      calls_updated: number
      skipped_no_info: number
      dry_run: boolean
      sample_created: Array<{ name: string; phone: string }>
    }
  | { ok: false; error: string }

export async function backfillLeadsForOrphanCalls(input: {
  /** YYYY-MM-DD. Si no se pasa, default 30 días atrás. */
  fromDate?: string | null
  /** Si true, solo simula sin escribir nada. Default true (safety). */
  dryRun?: boolean
}): Promise<BackfillLeadsResult> {
  try {
    await assertAdmin()
    getEnv()
    const companyIdNum = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID!, 10)
    const dryRun = input.dryRun ?? true

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return { ok: false, error: "Supabase service env vars missing" }
    }

    const since = input.fromDate
      ? new Date(input.fromDate + "T00:00:00Z").toISOString()
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date().toISOString()

    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // 1) Listar calls del CRM con lead_id NULL y external_id no null (del rango).
    // Incluimos caller_e164 — necesario para matchear contra conversations.recipient.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orphanRows } = await (sb as any)
      .from("calls")
      .select("id, external_id, brand_id, rep_id, called_at, caller_e164")
      .is("lead_id", null)
      .eq("source", "800com")
      .not("external_id", "is", null)
      .gte("called_at", since)
      .limit(500)
    const orphans = (orphanRows ?? []) as Array<{
      id: string
      external_id: string
      brand_id: string
      rep_id: string | null
      called_at: string
      caller_e164: string | null
    }>

    if (orphans.length === 0) {
      return {
        ok: true,
        total_orphans: 0,
        leads_created: 0,
        leads_matched_existing: 0,
        calls_updated: 0,
        skipped_no_info: 0,
        dry_run: dryRun,
        sample_created: [],
      }
    }

    // 2a) Traer calls de /v2/calls indexadas por external_id. Las orphan calls
    // en BD tienen caller_e164 NULL (el webhook receiver no lo guarda) → este
    // lookup nos da el phone real para luego matchear contra conversations.
    const callsFromAPI = new Map<string, EightHundredCallV2>()
    let callCursor: string | null | undefined = undefined
    let callPages = 0
    const MAX_PAGES = 100
    while (callPages < MAX_PAGES) {
      const page = await listCallsPage({
        companyId: companyIdNum,
        startDate: since,
        endDate,
        perPage: 100,
        cursor: callCursor ?? undefined,
      })
      callPages++
      for (const c of page.data) callsFromAPI.set(String(c.id), c)
      if (!page.meta?.nextCursor) break
      callCursor = page.meta.nextCursor
      await new Promise((r) => setTimeout(r, 1100))
    }

    // 2b) Traer conversations de /companies/{id}/conversations indexadas por
    // recipient (phone E.164 normalizado). enhancedCallerId trae el nombre.
    const conversationsByPhone = new Map<string, EightHundredConversation>()
    let cursor: string | null | undefined = undefined
    let pages = 0
    while (pages < MAX_PAGES) {
      const page = await listConversationsPage({
        companyId: companyIdNum,
        perPage: 100,
        cursor: cursor ?? undefined,
      })
      pages++
      for (const conv of page.data) {
        const key = normalizePhone(conv.recipient)
        if (key) conversationsByPhone.set(key, conv)
      }
      if (!page.meta?.nextCursor) break
      cursor = page.meta.nextCursor
      await new Promise((r) => setTimeout(r, 1100))
    }

    // 3) Para cada orphan call, buscar info, crear lead si hay nombre, update call
    let leadsCreated = 0
    let leadsMatchedExisting = 0
    let callsUpdated = 0
    let skippedNoInfo = 0
    const sampleCreated: Array<{ name: string; phone: string }> = []

    for (const orphan of orphans) {
      // Phone: primero intentar caller_e164 de BD, sino lookup via /v2/calls
      let phone = normalizePhone(orphan.caller_e164)
      if (!phone) {
        const apiCall = callsFromAPI.get(orphan.external_id)
        phone = normalizePhone(apiCall?.caller)
      }
      if (!phone) {
        skippedNoInfo++
        continue
      }
      const conv = conversationsByPhone.get(phone)
      if (!conv) {
        skippedNoInfo++
        continue
      }
      const { firstName, lastName } = extractEnhancedCallerInfo(conv)

      // 3a) Intentar matchear lead existente por phone (puede haberse creado entre medio)
      let leadId: string | null = null
      const { data: existingLead } = await sb
        .from("leads")
        .select("id")
        .eq("brand_id", orphan.brand_id)
        .eq("phone", phone)
        .limit(1)
        .maybeSingle()
      if (existingLead?.id) {
        leadId = existingLead.id
        leadsMatchedExisting++
      }

      // 3b) Si no existe y tenemos nombre, crear
      if (!leadId) {
        if (!firstName) {
          // Sin info útil, dejar como está
          skippedNoInfo++
          continue
        }
        if (!dryRun) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: newLead, error: leadErr } = await (sb as any)
            .from("leads")
            .insert({
              brand_id: orphan.brand_id,
              first_name: firstName,
              last_name: lastName || null,
              phone,
              status: "new",
              source: "inbound_call",
              assigned_rep_id: null, // pool: admin/manager asignan manualmente
              notes: "Auto-creado desde llamada entrante (800.com backfill)",
            })
            .select("id")
            .single()
          if (leadErr) {
            // Race condition: si falló por unique phone, buscar el lead que ganó la carrera
            if (leadErr.message?.includes("duplicate") || leadErr.code === "23505") {
              const { data: raceWinner } = await sb
                .from("leads")
                .select("id")
                .eq("brand_id", orphan.brand_id)
                .eq("phone", phone)
                .limit(1)
                .maybeSingle()
              leadId = raceWinner?.id ?? null
              if (leadId) leadsMatchedExisting++
            } else {
              skippedNoInfo++
              continue
            }
          } else {
            leadId = newLead?.id ?? null
            if (leadId) {
              leadsCreated++
              if (sampleCreated.length < 10) {
                sampleCreated.push({
                  name: `${firstName} ${lastName ?? ""}`.trim(),
                  phone,
                })
              }
            }
          }
        } else {
          // dry run: simular creación
          leadsCreated++
          if (sampleCreated.length < 10) {
            sampleCreated.push({
              name: `${firstName} ${lastName ?? ""}`.trim(),
              phone,
            })
          }
        }
      }

      // 3c) Actualizar la call con lead_id (solo si no es dry run)
      if (leadId && !dryRun) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updErr } = await (sb as any)
          .from("calls")
          .update({ lead_id: leadId })
          .eq("id", orphan.id)
        if (!updErr) callsUpdated++
      } else if (leadId && dryRun) {
        callsUpdated++ // simular
      }
    }

    if (!dryRun) {
      revalidatePath("/calls")
      revalidatePath("/leads")
    }

    return {
      ok: true,
      total_orphans: orphans.length,
      leads_created: leadsCreated,
      leads_matched_existing: leadsMatchedExisting,
      calls_updated: callsUpdated,
      skipped_no_info: skippedNoInfo,
      dry_run: dryRun,
      sample_created: sampleCreated,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// SYNC CONTACTS FROM CONVERSATIONS
// Recorre TODAS las conversations de 800.com y crea/rellena leads con la
// info COMPLETA del enhancedCallerId: nombre, teléfono, dirección, email,
// carrier. A diferencia de backfillLeadsForOrphanCalls (que solo toca calls
// huérfanas), este recorre contactos → también rellena leads viejos que ya
// tenían nombre pero les faltaba dirección/email.
//
// Safe: en leads existentes SOLO llena campos vacíos (no pisa data buena).
// Resuelve el brand por conversation.number.id → tracking_numbers.
// ─────────────────────────────────────────────────────────────────────

function looksLikePhone(s: string | null | undefined): boolean {
  if (!s) return true
  return /^\+?\d[\d\s().-]*$/.test(s.trim())
}

export type SyncContactsResult =
  | {
      ok: true
      conversations_seen: number
      leads_created: number
      leads_updated: number
      with_address: number
      with_email: number
      ecid_lookups: number
      ecid_charged: number
      skipped_no_brand: number
      skipped_no_phone: number
      dry_run: boolean
      sample: Array<{ name: string; phone: string; address: string | null; email: string | null }>
    }
  | { ok: false; error: string }

export async function syncContactsFromConversations(input: {
  /** Si true (default), solo simula y reporta cuánto traería. */
  dryRun?: boolean
  /** Si true (default), completa dirección/email faltantes via lookup ECID
   *  (cacheado = gratis; live = cobrado). */
  useEcid?: boolean
  /** Tope de lookups ECID por corrida (protección de costo). Default 2000. */
  maxEcid?: number
  /** Si true (default), recorre también las conversaciones archivadas. */
  includeArchived?: boolean
}): Promise<SyncContactsResult> {
  try {
    await assertAdmin()
    getEnv()
    const companyIdNum = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID!, 10)
    const dryRun = input.dryRun ?? true
    const useEcid = input.useEcid ?? true
    const maxEcid = input.maxEcid ?? 2000
    const includeArchived = input.includeArchived ?? true

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return { ok: false, error: "Supabase service env vars missing" }
    }

    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // 1) Map number_id → brand_id (resolver brand de cada conversation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tnRows } = await (sb as any)
      .from("tracking_numbers")
      .select("brand_id, provider_metadata")
      .eq("provider", "800com")
      .eq("active", true)
    const brandByNumberId = new Map<number, string>()
    for (const r of ((tnRows ?? []) as Array<{ brand_id: string; provider_metadata: { number_id?: number } | null }>)) {
      const nid = r.provider_metadata?.number_id
      if (typeof nid === "number") brandByNumberId.set(nid, r.brand_id)
    }
    if (brandByNumberId.size === 0) {
      return { ok: false, error: "No hay tracking_numbers 800com activos para resolver brand" }
    }

    // 2) Leads entrantes van al POOL (assigned_rep_id = null): admin/manager
    // los reparten. No se elige rep fallback acá.

    // 3) Paginar TODAS las conversations
    let conversationsSeen = 0
    let leadsCreated = 0
    let leadsUpdated = 0
    let withAddress = 0
    let withEmail = 0
    let ecidLookups = 0
    let ecidCharged = 0
    let skippedNoBrand = 0
    let skippedNoPhone = 0
    const sample: Array<{ name: string; phone: string; address: string | null; email: string | null }> = []

    const MAX_PAGES = 200
    const archivedStates = includeArchived ? [false, true] : [false]
    for (const archived of archivedStates) {
    let cursor: string | null | undefined = undefined
    let pages = 0
    while (pages < MAX_PAGES) {
      const page = await listConversationsPage({
        companyId: companyIdNum,
        perPage: 100,
        cursor: cursor ?? undefined,
        isArchived: archived,
      })
      pages++
      for (const conv of page.data) {
        conversationsSeen++
        const phone = normalizePhone(conv.recipient)
        if (!phone) { skippedNoPhone++; continue }
        const numberId = conv.number?.id
        const brandId = typeof numberId === "number" ? brandByNumberId.get(numberId) : undefined
        if (!brandId) { skippedNoBrand++; continue }

        const info = extractEnhancedCallerInfo(conv)

        // Campos finales: arrancan de la conversation (gratis) y se completan
        // con ECID si falta dirección o email.
        let firstName = info.firstName
        let lastName = info.lastName
        let addressLine1 = info.addressLine1
        let addressLine2 = info.addressLine2
        let city = info.city
        let state = info.state
        let zipCode = info.zipCode
        let email = info.email
        let carrier = info.carrier
        let extraEmails: string[] = []

        if (useEcid && (!addressLine1 || !email) && ecidLookups < maxEcid) {
          try {
            const ecid = await lookupEnhancedCallerId(phone)
            ecidLookups++
            if (!ecid.cacheHit) ecidCharged++
            const d = ecid.data
            if (d) {
              if (!firstName) {
                firstName = d.firstName ?? null
                if (!firstName && d.name) {
                  const parts = d.name.trim().split(/\s+/).filter(Boolean)
                  firstName = parts[0] ?? null
                  if (!lastName) lastName = parts.slice(1).join(" ") || null
                }
              }
              if (!lastName) lastName = d.lastName ?? null
              addressLine1 = addressLine1 || d.streetLine_1 || null
              addressLine2 = addressLine2 || d.streetLine_2 || null
              city = city || d.city || null
              state = state || d.region || null
              zipCode = zipCode || d.postalCode || null
              carrier = carrier || d.carrier || null
              if (Array.isArray(d.emails) && d.emails.length > 0) {
                email = email || d.emails[0]
                extraEmails = d.emails
              }
            }
            // Pace ECID (limite 60/min)
            await new Promise((r) => setTimeout(r, 250))
          } catch {
            // Si ECID falla, seguimos con lo que dio la conversation
          }
        }

        if (addressLine1) withAddress++
        if (email) withEmail++

        // ¿Existe lead por (brand, phone)?
        const { data: existing } = await sb
          .from("leads")
          .select("id, first_name, last_name, address_line1, address_line2, city, state, zip, email")
          .eq("brand_id", brandId)
          .eq("phone", phone)
          .limit(1)
          .maybeSingle()

        const noteExtra = [
          carrier ? `Carrier: ${carrier}` : null,
          extraEmails.length > 1 ? `Emails: ${extraEmails.join(", ")}` : null,
        ].filter(Boolean)

        if (existing?.id) {
          // UPDATE: solo llenar campos vacíos (no pisar data buena)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const patch: any = {}
          if (firstName && looksLikePhone(existing.first_name)) patch.first_name = firstName
          if (lastName && !existing.last_name) patch.last_name = lastName
          if (addressLine1 && !existing.address_line1) patch.address_line1 = addressLine1
          if (addressLine2 && !existing.address_line2) patch.address_line2 = addressLine2
          if (city && !existing.city) patch.city = city
          if (state && !existing.state) patch.state = state
          if (zipCode && !existing.zip) patch.zip = zipCode
          if (email && !existing.email) patch.email = email
          if (Object.keys(patch).length > 0) {
            if (!dryRun) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              await (sb as any).from("leads").update(patch).eq("id", existing.id)
            }
            leadsUpdated++
            if (sample.length < 15) {
              sample.push({
                name: `${patch.first_name ?? existing.first_name ?? ""} ${patch.last_name ?? existing.last_name ?? ""}`.trim(),
                phone,
                address: addressLine1 ?? existing.address_line1 ?? null,
                email: email ?? existing.email ?? null,
              })
            }
          }
          continue
        }

        // CREATE: nombre real si hay, sino fallback al teléfono (no perder al cliente)
        const createFirstName = firstName || phone
        const noteParts = [...noteExtra, "Importado de 800.com (contactos / ECID)"]
        if (!dryRun) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (sb as any).from("leads").insert({
            brand_id: brandId,
            first_name: createFirstName,
            last_name: lastName || null,
            phone,
            email: email || null,
            status: "new",
            source: "inbound_call",
            assigned_rep_id: null, // pool: admin/manager asignan manualmente
            address_line1: addressLine1 || null,
            address_line2: addressLine2 || null,
            city: city || null,
            state: state || null,
            zip: zipCode || null,
            notes: noteParts.join("\n"),
          })
          if (error && !(error.code === "23505" || error.message?.includes("duplicate"))) {
            // no abortar todo el sync por un lead — seguir
            continue
          }
        }
        leadsCreated++
        if (sample.length < 15) {
          sample.push({
            name: `${createFirstName} ${lastName ?? ""}`.trim(),
            phone,
            address: addressLine1 ?? null,
            email: email ?? null,
          })
        }
      }
      if (!page.meta?.nextCursor) break
      cursor = page.meta.nextCursor
      await new Promise((r) => setTimeout(r, 1100))
    }
    }

    if (!dryRun) {
      revalidatePath("/leads")
      revalidatePath("/calls")
    }

    return {
      ok: true,
      conversations_seen: conversationsSeen,
      leads_created: leadsCreated,
      leads_updated: leadsUpdated,
      with_address: withAddress,
      with_email: withEmail,
      ecid_lookups: ecidLookups,
      ecid_charged: ecidCharged,
      skipped_no_brand: skippedNoBrand,
      skipped_no_phone: skippedNoPhone,
      dry_run: dryRun,
      sample,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
