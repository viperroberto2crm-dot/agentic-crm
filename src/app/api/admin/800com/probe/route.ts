/**
 * Probe endpoint: fetch 1 raw call from 800.com and return as JSON.
 * Sirve para descubrir el field exacto del caller name que estoy buscando.
 *
 * Usage:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" \
 *     "https://proyectosagentic-crm.vercel.app/api/admin/800com/probe"
 */

import { NextRequest, NextResponse } from "next/server"
import { listCallsPage } from "@/lib/integrations/800com"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  try {
    const expected = process.env.CRON_SECRET
    if (!expected) {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
    }
    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const companyId = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID ?? "0", 10)
    if (!companyId) {
      return NextResponse.json({ error: "EIGHTHUNDRED_COMPANY_ID missing" }, { status: 500 })
    }

    // Pull just the last 24h, 5 calls
    const startDate = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const endDate = new Date().toISOString()

    const page = await listCallsPage({
      companyId,
      startDate,
      endDate,
      perPage: 5,
    })

    const sample = page.data[0] ?? null
    const allKeys = sample ? Object.keys(sample as Record<string, unknown>) : []

    return NextResponse.json({
      total_in_page: page.data.length,
      sample_call_keys: allKeys,
      sample_call_full: sample,
      // Devolvemos los 5 para ver variabilidad
      all_samples: page.data,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
