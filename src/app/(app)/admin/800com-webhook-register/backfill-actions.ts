"use server"

/**
 * Server action para disparar el backfill de calls desde 800.com API.
 *
 * Usa session auth (admin only) en lugar de CRON_SECRET, así un admin
 * puede correrlo desde el UI sin pelearse con env vars sensitive.
 *
 * Llama al mismo helper que usa el cron poll-800com y el endpoint
 * /api/admin/800com/backfill, pero sin secret HTTP.
 */

import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { importCallsFromEightHundred } from "@/lib/integrations/800com"
import { revalidatePath } from "next/cache"

type DB = SupabaseClient<Database>

async function assertAdmin() {
  const supabase = (await createClient()) as unknown as DB
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Unauthorized")
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  if (profile?.role !== "admin") throw new Error("Solo admin puede correr backfill")
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
