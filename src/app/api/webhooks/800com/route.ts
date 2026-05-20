/**
 * 800.com webhook receiver — Stub v0
 *
 * PROPÓSITO ACTUAL: loguear todo lo que 800.com manda para descubrir
 * el formato real del payload (los docs públicos no lo especifican).
 *
 * Cuando tengamos 1-2 eventos reales en los logs, este endpoint se reemplaza
 * por el handler completo (insert en calls + matching por teléfono).
 *
 * Persistimos el payload en agent_runs para poder verlo después via Supabase MCP
 * sin tener que pelearse con logs de Vercel.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  // Capturar TODO: headers, raw body, query params
  const headers: Record<string, string> = {}
  req.headers.forEach((v, k) => { headers[k] = v })

  const url = new URL(req.url)
  const queryParams: Record<string, string> = {}
  url.searchParams.forEach((v, k) => { queryParams[k] = v })

  // Leer raw body (puede ser JSON o form-encoded, no asumimos)
  const rawBody = await req.text().catch(() => "")

  // Intentar parsear como JSON, pero guardar el raw text también
  let parsedBody: unknown = null
  try { parsedBody = JSON.parse(rawBody) } catch { parsedBody = null }

  console.log("[webhook/800com] received", {
    method: req.method,
    headers,
    queryParams,
    rawBody: rawBody.slice(0, 2000),
  })

  // Persistir en agent_runs para inspección posterior
  try {
    const sb = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    await sb.from("agent_runs").insert({
      run_type: "webhook_800com_stub",
      input_summary: JSON.stringify({
        headers,
        queryParams,
        body: parsedBody ?? rawBody,
      }).slice(0, 8000),
      output_summary: "stub: payload logged",
      duration_ms: Date.now() - t0,
    })
  } catch (err) {
    console.error("[webhook/800com] persist failed:", err)
  }

  // Siempre devolver 200 para que 800.com no haga retry
  return NextResponse.json({ received: true, stub: true })
}

// 800.com puede hacer GET para validar la URL al configurarla
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "800com-webhook-stub",
    note: "POST events here. Stub logs payloads to agent_runs for inspection.",
  })
}
