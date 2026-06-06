/**
 * Endpoint temporal: sincronizar tracking numbers de 800.com sin pasar por el
 * server action (que requiere session admin). Usa HERMES_SECRET.
 *
 * Equivalente al "PASO 1B" del UI admin. Borrar cuando termine.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { listCallsPage } from "@/lib/integrations/800com"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const hermesSecret = process.env.HERMES_SECRET
  const auth = req.headers.get("authorization") ?? ""
  const ok =
    (!!cronSecret && auth === `Bearer ${cronSecret}`) ||
    (!!hermesSecret && auth === `Bearer ${hermesSecret}`)
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") !== "false"
  const brandSlug = url.searchParams.get("brandSlug") ?? "si-se-pierde"

  const companyIdNum = parseInt(process.env.EIGHTHUNDRED_COMPANY_ID!, 10)
  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1) Listar TODOS los numbers que aparecen en calls últimos 30 días
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const endDate = new Date().toISOString()
  const numbersMap = new Map<number, { id: number; number: string; label: string | null }>()
  let cursor: string | undefined = undefined
  let pages = 0
  while (pages < 100) {
    const page = await listCallsPage({
      companyId: companyIdNum,
      startDate,
      endDate,
      perPage: 100,
      cursor,
    })
    pages++
    for (const call of page.data) {
      const id = call.number?.id
      if (typeof id !== "number") continue
      if (!numbersMap.has(id)) {
        numbersMap.set(id, { id, number: call.number.number, label: call.number.label })
      }
    }
    if (!page.meta?.nextCursor) break
    cursor = page.meta.nextCursor
    await new Promise((r) => setTimeout(r, 1100))
  }
  const numbersFromAPI = Array.from(numbersMap.values())

  // 2) Resolver brand_id
  const { data: brandRow } = await sb
    .from("brands")
    .select("id, name")
    .eq("slug", brandSlug)
    .maybeSingle()
  if (!brandRow?.id) {
    return NextResponse.json({ error: `Brand ${brandSlug} no encontrado` }, { status: 404 })
  }

  // 3) Rep fallback
  const { data: anyRep } = await sb
    .from("users")
    .select("id")
    .eq("active", true)
    .in("role", ["admin", "manager"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!anyRep?.id) {
    return NextResponse.json({ error: "No hay admin/manager activo" }, { status: 500 })
  }

  // 4) Existing tracking_numbers de 800com
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingRows } = await (sb as any)
    .from("tracking_numbers")
    .select("provider_metadata")
    .eq("provider", "800com")
  const existingIds = new Set<number>(
    ((existingRows ?? []) as Array<{ provider_metadata: { number_id?: number } | null }>)
      .map((r) => r.provider_metadata?.number_id)
      .filter((x): x is number => typeof x === "number"),
  )

  const alreadyInDb: typeof numbersFromAPI = []
  const added: typeof numbersFromAPI = []
  const errors: string[] = []

  for (const n of numbersFromAPI) {
    if (existingIds.has(n.id)) {
      alreadyInDb.push(n)
      continue
    }
    if (dryRun) {
      added.push(n)
      continue
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (sb as any).from("tracking_numbers").insert({
      provider: "800com",
      brand_id: brandRow.id,
      phone_e164: n.number,
      label: n.label || `800.com #${n.id}`,
      provider_metadata: { number_id: n.id },
      active: true,
    })
    if (error) errors.push(`number ${n.id} (${n.number}): ${error.message}`)
    else added.push(n)
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    brand: brandRow.name,
    total_in_800com: numbersFromAPI.length,
    already_in_db: alreadyInDb.length,
    added: added.length,
    added_detail: added,
    errors,
  })
}
