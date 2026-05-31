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
    // Auth: acepta HERMES_SECRET (preferido) o CRON_SECRET (fallback compatible
    // con otros crons del CRM). Así no rompemos los crons existentes si
    // regeneramos CRON_SECRET, y el usuario puede tener un secret dedicado
    // a Hermes que conoce sin tener que revelar el CRON_SECRET de Vercel.
    const hermesSecret = process.env.HERMES_SECRET
    const cronSecret = process.env.CRON_SECRET
    if (!hermesSecret && !cronSecret) {
      return NextResponse.json(
        { error: "HERMES_SECRET o CRON_SECRET not configured" },
        { status: 500 },
      )
    }
    const auth = req.headers.get("authorization") ?? ""
    const validHermes = hermesSecret && auth === `Bearer ${hermesSecret}`
    const validCron = cronSecret && auth === `Bearer ${cronSecret}`
    if (!validHermes && !validCron) {
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
