/**
 * Cron: poll 800.com for new calls every ~3 min.
 * Imports calls from the last 24h window with dedup by external_id.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { importCallsFromEightHundred } from "@/lib/integrations/800com"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    // Cron auth (Vercel injects Authorization: Bearer ${CRON_SECRET})
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

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 })
    }

    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    // Pull the last 24h. Dedup via external_id handles overlap with previous runs.
    const result = await importCallsFromEightHundred(sb, {
      startDate: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
      endDate: new Date().toISOString(),
      autoCreateLeads: true,
      maxPages: 10, // ~1000 calls per run cap (enough for any 24h window)
    })

    return NextResponse.json({ ok: result.errors.length === 0, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error("[poll-800com] uncaught:", msg, stack)
    return NextResponse.json(
      { error: msg, stack: stack?.split("\n").slice(0, 5).join("\n") },
      { status: 500 },
    )
  }
}
