/**
 * Cron: poll Meta Lead Ads for new lead submissions.
 *
 * Default: fetches last 90 days (Meta's max retention). Dedup via
 * leads.external_id + external_provider='meta' handles re-runs idempotently.
 *
 * Schedule:
 *   - vercel.json daily backup at 8:30 UTC
 *   - cron-job.org every 15 min for near-realtime (external trigger)
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 *
 * Query params (optional):
 *   - ?days=N  override lookback (1..90, default 90). Useful for backfill testing.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { importMetaLeadsToCrm } from "@/lib/integrations/meta-lead-ads"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const expected = process.env.CRON_SECRET
    if (!expected) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured" },
        { status: 500 },
      )
    }
    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      return NextResponse.json(
        { error: "Supabase env vars missing" },
        { status: 500 },
      )
    }

    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // Lookback window — default 90 days, override via ?days=N.
    const lookbackDaysParam = req.nextUrl.searchParams.get("days")
    const lookbackDays = lookbackDaysParam
      ? Math.max(1, Math.min(90, parseInt(lookbackDaysParam, 10) || 90))
      : 90

    const result = await importMetaLeadsToCrm(sb, {
      sinceTimestamp: Math.floor(
        (Date.now() - lookbackDays * 24 * 3600 * 1000) / 1000,
      ),
      maxLeadsPerForm: 1000,
    })

    return NextResponse.json({
      ok: result.errors.length === 0,
      lookbackDays,
      ...result,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error("[poll-meta-leads] uncaught:", msg, stack)
    return NextResponse.json(
      { error: msg, stack: stack?.split("\n").slice(0, 5).join("\n") },
      { status: 500 },
    )
  }
}
