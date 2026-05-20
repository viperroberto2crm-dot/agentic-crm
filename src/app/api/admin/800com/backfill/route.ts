/**
 * Backfill endpoint: sync historical calls from 800.com for SSP numbers.
 *
 * One-time use (or re-runnable safely thanks to dedup by external_id).
 * Triggered manually by admin or via curl with CRON_SECRET.
 *
 * Usage:
 *   curl -X POST -H "Authorization: Bearer <CRON_SECRET>" \
 *     "https://proyectosagentic-crm.vercel.app/api/admin/800com/backfill?from=2024-01-01"
 *
 * Defaults: pulls everything from 2024-09-01 (account creation) to now.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { importCallsFromEightHundred } from "@/lib/integrations/800com"

export const runtime = "nodejs"
export const maxDuration = 300 // 5 min — backfill can take a while

export async function POST(req: NextRequest) {
  try {
    const expected = process.env.CRON_SECRET
    if (!expected) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
    }
    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 })
    }

    const url = new URL(req.url)
    const fromParam = url.searchParams.get("from") // YYYY-MM-DD
    const toParam = url.searchParams.get("to")     // YYYY-MM-DD

    const startDate = fromParam
      ? new Date(fromParam + "T00:00:00Z").toISOString()
      : new Date("2024-09-01T00:00:00Z").toISOString()
    const endDate = toParam
      ? new Date(toParam + "T23:59:59Z").toISOString()
      : new Date().toISOString()

    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const result = await importCallsFromEightHundred(sb, {
      startDate,
      endDate,
      autoCreateLeads: true,
      maxPages: 200, // ~20K calls cap. Bump if you have more.
    })

    return NextResponse.json({
      ok: result.errors.length === 0,
      range: { startDate, endDate },
      ...result,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error("[backfill-800com] uncaught:", msg, stack)
    return NextResponse.json(
      { error: msg, stack: stack?.split("\n").slice(0, 5).join("\n") },
      { status: 500 },
    )
  }
}
