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

    // Detección de TOKEN EXPIRADO: el Page Access Token / "Data Access" de Meta
    // muere cada ~75-90d. Cuando pasa, Graph devuelve OAuthException/code 190 y
    // los leads de FB dejan de entrar EN SILENCIO. Forzamos HTTP 500 para que
    // cron-job.org marque el run como fallido y dispare su alerta de email.
    const tokenExpired = result.errors.some((e) =>
      /OAuthException|code.?190|access token|data access|expired|session has been invalidated/i.test(
        e.error,
      ),
    )
    if (tokenExpired) {
      console.error(
        "[poll-meta-leads] TOKEN META EXPIRADO/INVÁLIDO — regenerar Page Access Token. Errores:",
        JSON.stringify(result.errors).slice(0, 600),
      )
      return NextResponse.json(
        {
          ok: false,
          alert: "META_TOKEN_EXPIRED",
          message:
            "Token de Meta expirado o inválido — regenerar Page Access Token (Graph API Explorer). Los leads de Facebook NO están entrando.",
          lookbackDays,
          ...result,
        },
        { status: 500 },
      )
    }

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
