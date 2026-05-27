"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { lookupEnhancedCallerId, type EnhancedCallerId } from "@/lib/integrations/800com"

type TypedClient = SupabaseClient<Database>

/**
 * Heurística: un first_name que parece teléfono (ej. "+12138845412") cuenta
 * como vacío para fines de enriquecimiento. Lo mismo para empty strings.
 */
function isPhonelikeOrEmpty(s: string | null | undefined): boolean {
  if (!s) return true
  const trimmed = s.trim()
  if (!trimmed) return true
  return /^\+?\d{7,}$/.test(trimmed.replace(/[\s\-().]/g, ""))
}

function emptyStr(s: string | null | undefined): boolean {
  return !s || s.trim() === ""
}

type CandidateLead = {
  id: string
  phone: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  brand_id: string
}

export type BackfillItem = {
  lead_id: string
  phone: string
  current_name: string
  matchStatus: "found" | "not_found" | "error"
  cacheHit: boolean
  ecid: EnhancedCallerId | null
  // Cambios propuestos (solo campos que cambiarían)
  proposed: Partial<{
    first_name: string
    last_name: string
    email: string
    address_line1: string
    address_line2: string
    city: string
    state: string
    zip: string
  }>
  action: "would_update" | "skip_no_data" | "skip_no_changes" | "updated" | "error"
  error?: string
}

export type BackfillSummary = {
  dryRun: boolean
  total_candidates: number
  processed: number
  found: number
  not_found: number
  updated: number
  skipped_no_changes: number
  errors: number
  cache_hits: number
  live_lookups: number
  items: BackfillItem[]
}

/**
 * Cuenta cuántos leads son candidatos a enriquecimiento.
 * Criterios: tiene phone, address_line1 vacío, last_name vacío.
 */
export async function countCandidates(brandId: string | null): Promise<number> {
  const supabase = (await createClient()) as unknown as TypedClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") throw new Error("Solo admin")

  let q = supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .not("phone", "is", null)
    .neq("phone", "")
    .is("address_line1", null)
  if (brandId) q = q.eq("brand_id", brandId)

  const { count } = await q
  return count ?? 0
}

/**
 * Backfill principal. Acepta dryRun + limit + brandId opcional.
 * - dryRun=true: NO escribe en DB, solo devuelve lo que cambiaría
 * - limit: cuántos leads procesar en esta corrida (default 100)
 *   Cada lookup tiene sleep 1.2s para no superar 60/min de 800.com
 */
export async function runEcidBackfill(opts: {
  dryRun: boolean
  limit?: number
  brandId?: string | null
}): Promise<BackfillSummary> {
  const supabase = (await createClient()) as unknown as TypedClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single()
  if (profile?.role !== "admin") throw new Error("Solo admin")

  const limit = Math.min(opts.limit ?? 100, 200)

  // Candidatos: phone presente, address_line1 vacío.
  // Nota: también incluyo aquí los que tengan last_name presente pero
  // address_line1 null — el merge defensivo evitará pisar el last_name.
  let q = supabase
    .from("leads")
    .select("id, phone, first_name, last_name, email, address_line1, address_line2, city, state, zip, brand_id")
    .not("phone", "is", null)
    .neq("phone", "")
    .is("address_line1", null)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (opts.brandId) q = q.eq("brand_id", opts.brandId)

  const { data: candidates, error } = await q
  if (error) throw new Error(`Error fetching candidates: ${error.message}`)

  const items: BackfillItem[] = []
  let found = 0
  let notFound = 0
  let updated = 0
  let skippedNoChanges = 0
  let errors = 0
  let cacheHits = 0
  let liveLookups = 0

  for (const lead of (candidates ?? []) as CandidateLead[]) {
    const phone = (lead.phone ?? "").trim()
    if (!phone) continue

    const currentName = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || "—"

    let item: BackfillItem = {
      lead_id: lead.id,
      phone,
      current_name: currentName,
      matchStatus: "not_found",
      cacheHit: false,
      ecid: null,
      proposed: {},
      action: "skip_no_data",
    }

    try {
      const res = await lookupEnhancedCallerId(phone, false)
      item.matchStatus = res.matchStatus
      item.cacheHit = res.cacheHit
      item.ecid = res.data
      if (res.cacheHit) cacheHits++
      else liveLookups++

      if (res.matchStatus === "not_found" || !res.data) {
        notFound++
        item.action = "skip_no_data"
      } else {
        found++
        const ecid = res.data
        const proposed: BackfillItem["proposed"] = {}

        // Solo proponer cambios donde el lead esté vacío (o tenga un placeholder phonelike)
        if (isPhonelikeOrEmpty(lead.first_name) && ecid.firstName) {
          proposed.first_name = ecid.firstName
        }
        if (emptyStr(lead.last_name) && ecid.lastName) {
          proposed.last_name = ecid.lastName
        }
        if (emptyStr(lead.email) && ecid.emails && ecid.emails.length > 0) {
          proposed.email = ecid.emails[0]
        }
        if (emptyStr(lead.address_line1) && ecid.streetLine_1) {
          proposed.address_line1 = ecid.streetLine_1
        }
        if (emptyStr(lead.address_line2) && ecid.streetLine_2) {
          proposed.address_line2 = ecid.streetLine_2
        }
        if (emptyStr(lead.city) && ecid.city) {
          proposed.city = ecid.city
        }
        if (emptyStr(lead.state) && ecid.region) {
          proposed.state = ecid.region
        }
        if (emptyStr(lead.zip) && ecid.postalCode) {
          proposed.zip = ecid.postalCode
        }

        item.proposed = proposed

        if (Object.keys(proposed).length === 0) {
          item.action = "skip_no_changes"
          skippedNoChanges++
        } else if (opts.dryRun) {
          item.action = "would_update"
        } else {
          // Aplicar cambios — solo los campos en proposed
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: updErr } = await (supabase as any)
            .from("leads")
            .update(proposed)
            .eq("id", lead.id)
          if (updErr) {
            errors++
            item.action = "error"
            item.error = updErr.message
          } else {
            updated++
            item.action = "updated"
          }
        }
      }
    } catch (e) {
      errors++
      item.action = "error"
      item.error = e instanceof Error ? e.message : String(e)
    }

    items.push(item)
    // Sleep entre lookups para no exceder 60/min (usamos 30/min)
    await new Promise((r) => setTimeout(r, 1200))
  }

  if (!opts.dryRun && updated > 0) {
    revalidatePath("/leads")
    revalidatePath("/dashboard")
  }

  return {
    dryRun: opts.dryRun,
    total_candidates: candidates?.length ?? 0,
    processed: items.length,
    found,
    not_found: notFound,
    updated,
    skipped_no_changes: skippedNoChanges,
    errors,
    cache_hits: cacheHits,
    live_lookups: liveLookups,
    items,
  }
}
