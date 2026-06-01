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
import { importCallsFromEightHundred } from "@/lib/integrations/800com"
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
    const { apiKey, companyId } = getEnv()
    const brandSlug = input.brandSlug ?? "si-se-pierde"
    const dryRun = input.dryRun ?? false

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return { ok: false, error: "Supabase service env vars missing" }
    }

    // 1) Fetch all numbers de la company desde 800.com API
    const res = await fetch(
      `${API_BASE}/v2/companies/${companyId}/numbers?perPage=200`,
      {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        cache: "no-store",
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return {
        ok: false,
        error: `800.com API error ${res.status}: ${text.slice(0, 300)}`,
      }
    }
    const json = (await res.json()) as { data?: TrackingNumberFromAPI[] }
    const numbersFromAPI = json.data ?? []

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
