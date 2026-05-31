/**
 * HERMES — Endpoint del tick.
 *
 * Llamado por cron-job.org cada 30 min con header:
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * También soporta trigger manual desde el dashboard /admin/hermes
 * (usa auth de Supabase Session + check admin role).
 *
 * Devuelve resumen del tick: cuántos checks corrieron, cuántas observations,
 * cuántas resolutions, y la lista para que el dashboard la muestre.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { runTick } from "@/lib/hermes/runner"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    // Auth: Bearer CRON_SECRET (mismo patrón que poll-800com)
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

    // Service client: bypass RLS (Hermes lee todo el CRM por diseño)
    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )

    const result = await runTick(sb, { triggeredBy: "cron" })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[hermes/tick] fatal:", message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

// POST: trigger manual desde dashboard (próximo sprint)
export async function POST(req: NextRequest) {
  // Por ahora, mismo handler que GET — auth via CRON_SECRET.
  // En Sprint 2 cambiamos a auth de Supabase session + check admin.
  return GET(req)
}
