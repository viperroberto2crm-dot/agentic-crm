/**
 * Debug endpoint TEMPORAL: devuelve el JSON crudo de las últimas 3 calls de
 * 800.com API. Sirve para identificar qué campo contiene el nombre del caller
 * (cliente confirma que en el inbox 800.com hay nombres, pero `extractCallerName`
 * no los encuentra → el campo se llama distinto a lo que probamos).
 *
 * Auth: Bearer HERMES_SECRET o CRON_SECRET.
 * Borrar este archivo cuando termine la investigación.
 */

import { NextRequest, NextResponse } from "next/server"
import { listCallsPage } from "@/lib/integrations/800com"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function GET(req: NextRequest) {
  // Auth
  const cronSecret = process.env.CRON_SECRET
  const hermesSecret = process.env.HERMES_SECRET
  const auth = req.headers.get("authorization") ?? ""
  const ok =
    (!!cronSecret && auth === `Bearer ${cronSecret}`) ||
    (!!hermesSecret && auth === `Bearer ${hermesSecret}`)
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = process.env.EIGHTHUNDRED_COMPANY_ID
  if (!companyId) {
    return NextResponse.json({ error: "EIGHTHUNDRED_COMPANY_ID missing" }, { status: 500 })
  }
  const companyIdNum = parseInt(companyId, 10)
  if (Number.isNaN(companyIdNum)) {
    return NextResponse.json({ error: "EIGHTHUNDRED_COMPANY_ID not numeric" }, { status: 500 })
  }

  // Traer 1ra página de calls (últimos 7 días)
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const endDate = new Date().toISOString()

  try {
    const page = await listCallsPage({
      companyId: companyIdNum,
      startDate: since,
      endDate,
      perPage: 10,
    })

    // Devolver primeras 3 calls completas + lista de TODOS los keys que aparecen
    // en cualquier call (para detectar fields desconocidos)
    const allKeys = new Set<string>()
    for (const call of page.data) {
      for (const k of Object.keys(call)) allKeys.add(k)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callAny = call as any
      if (callAny.contact && typeof callAny.contact === "object") {
        for (const k of Object.keys(callAny.contact)) allKeys.add(`contact.${k}`)
      }
    }

    return NextResponse.json({
      ok: true,
      total_in_page: page.data.length,
      all_keys_seen: Array.from(allKeys).sort(),
      sample_calls: page.data.slice(0, 3),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
