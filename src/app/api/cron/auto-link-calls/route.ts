/**
 * Cron: auto-link orphan 800.com calls to leads, cada 10 min.
 *
 * Replica la lógica de `backfillLeadsForOrphanCalls` (server action en
 * src/app/(app)/admin/800com-webhook-register/backfill-actions.ts) pero
 * sin session auth (usa CRON_SECRET) y con ventana corta (24h) en lugar
 * de 30d porque corre frecuente.
 *
 * NO modifica el webhook receiver (hot-path intocable). NO modifica el
 * server action existente. Es additivo: si el botón admin sigue funcionando,
 * este cron no rompe nada.
 *
 * Idempotente: la lógica de match-by-phone (existingLead) + race-handler
 * del unique constraint en `leads.phone` evita duplicados aunque corra
 * dos veces seguidas.
 */

import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  listCallsPage,
  extractCallerName,
  type EightHundredCallV2,
} from "@/lib/integrations/800com"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MAX_PAGES = 100
const ORPHANS_LIMIT = 500

export async function GET(req: NextRequest) {
  const t0 = Date.now()
  const startedAt = new Date().toISOString()

  try {
    // 1) Auth: CRON_SECRET o HERMES_SECRET (mismo patrón que otros endpoints internos)
    const cronSecret = process.env.CRON_SECRET
    const hermesSecret = process.env.HERMES_SECRET
    const auth = req.headers.get("authorization") ?? ""
    const tokenOk =
      (!!cronSecret && auth === `Bearer ${cronSecret}`) ||
      (!!hermesSecret && auth === `Bearer ${hermesSecret}`)
    if (!tokenOk) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // 2) Env vars necesarias
    const apiKey = process.env.EIGHTHUNDRED_API_KEY
    const companyId = process.env.EIGHTHUNDRED_COMPANY_ID
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const missing: string[] = []
    if (!apiKey) missing.push("EIGHTHUNDRED_API_KEY")
    if (!companyId) missing.push("EIGHTHUNDRED_COMPANY_ID")
    if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL")
    if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY")
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing env vars: ${missing.join(", ")}` },
        { status: 500 },
      )
    }
    const companyIdNum = parseInt(companyId!, 10)
    if (Number.isNaN(companyIdNum)) {
      return NextResponse.json(
        { error: "EIGHTHUNDRED_COMPANY_ID no es número" },
        { status: 500 },
      )
    }

    // 3) Service client (bypass RLS — igual que el server action admin)
    const sb = createServiceClient<Database>(supabaseUrl!, serviceRoleKey!)

    // 4) Ventana de 24h hacia atrás (corre cada 10min → 24h es buffer amplio)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date().toISOString()

    console.log(
      `[auto-link-calls] start ${startedAt} window=${since}..${endDate}`,
    )

    // 5) Listar orphan calls del CRM (lead_id NULL, source 800com, en rango).
    // Order by called_at ASC para que si hay >ORPHANS_LIMIT, siempre procesemos
    // las más antiguas primero (sino algunas quedarían sin linkear para siempre).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orphanRows, error: orphanErr } = await (sb as any)
      .from("calls")
      .select("id, external_id, brand_id, rep_id, called_at")
      .is("lead_id", null)
      .eq("source", "800com")
      .not("external_id", "is", null)
      .gte("called_at", since)
      .order("called_at", { ascending: true })
      .limit(ORPHANS_LIMIT)

    if (orphanErr) {
      console.error("[auto-link-calls] orphan query failed:", orphanErr.message)
      return NextResponse.json(
        { error: `orphan query: ${orphanErr.message}` },
        { status: 500 },
      )
    }

    const orphans = (orphanRows ?? []) as Array<{
      id: string
      external_id: string
      brand_id: string
      rep_id: string | null
      called_at: string
    }>

    if (orphans.length === 0) {
      const duration = Date.now() - t0
      console.log(
        `[auto-link-calls] done ${new Date().toISOString()} no_orphans duration=${duration}ms`,
      )
      return NextResponse.json({
        ok: true,
        total_orphans: 0,
        leads_created: 0,
        leads_matched_existing: 0,
        calls_updated: 0,
        skipped_no_info: 0,
        duration_ms: duration,
      })
    }

    // 6) Traer calls de 800.com en el rango, indexar por external_id.
    // Si falla la paginación, log + continuar con lo que tengamos (return parcial).
    const callsFromAPI = new Map<string, EightHundredCallV2>()
    let cursor: string | null | undefined = undefined
    let pages = 0
    let paginationError: string | null = null
    while (pages < MAX_PAGES) {
      try {
        const page = await listCallsPage({
          companyId: companyIdNum,
          startDate: since,
          endDate,
          perPage: 100,
          cursor: cursor ?? undefined,
        })
        pages++
        for (const c of page.data) {
          callsFromAPI.set(String(c.id), c)
        }
        if (!page.meta.nextCursor) break
        cursor = page.meta.nextCursor
        // Throttle 1100ms entre páginas para no chocar el rate limit de 60 req/min
        // de 800.com (mismo patrón que iterAllCalls). Sin esto, días de volumen
        // alto podrían tirar 429s.
        await new Promise((r) => setTimeout(r, 1100))
      } catch (e) {
        paginationError = e instanceof Error ? e.message : String(e)
        console.error(
          `[auto-link-calls] pagination failed page=${pages} cursor=${cursor}: ${paginationError}`,
        )
        break
      }
    }

    // 7) Match + create/link
    let leadsCreated = 0
    let leadsMatchedExisting = 0
    let callsUpdated = 0
    let skippedNoInfo = 0

    for (const orphan of orphans) {
      const apiCall = callsFromAPI.get(orphan.external_id)
      if (!apiCall) {
        skippedNoInfo++
        continue
      }

      const { firstName, lastName } = extractCallerName(apiCall)
      const phone = apiCall.caller

      if (!phone) {
        skippedNoInfo++
        continue
      }

      // 7a) Match lead existente por phone (idempotencia: si corrió antes ya está)
      let leadId: string | null = null
      const { data: existingLead } = await sb
        .from("leads")
        .select("id")
        .eq("brand_id", orphan.brand_id)
        .eq("phone", phone)
        .limit(1)
        .maybeSingle()
      if (existingLead?.id) {
        leadId = existingLead.id
        leadsMatchedExisting++
      }

      // 7b) Si no existe y tenemos nombre, crear lead
      if (!leadId) {
        if (!firstName) {
          skippedNoInfo++
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: newLead, error: leadErr } = await (sb as any)
          .from("leads")
          .insert({
            brand_id: orphan.brand_id,
            first_name: firstName,
            last_name: lastName || null,
            phone,
            status: "new",
            source: "inbound_call",
            assigned_rep_id: orphan.rep_id,
            notes: "Auto-creado por cron auto-link-calls (800.com)",
          })
          .select("id")
          .single()
        if (leadErr) {
          // Race: si choca por unique phone, buscar el ganador
          if (leadErr.message?.includes("duplicate") || leadErr.code === "23505") {
            const { data: raceWinner } = await sb
              .from("leads")
              .select("id")
              .eq("brand_id", orphan.brand_id)
              .eq("phone", phone)
              .limit(1)
              .maybeSingle()
            leadId = raceWinner?.id ?? null
            if (leadId) leadsMatchedExisting++
          } else {
            console.error(
              `[auto-link-calls] insert lead failed phone=${phone}: ${leadErr.message}`,
            )
            skippedNoInfo++
            continue
          }
        } else {
          leadId = newLead?.id ?? null
          if (leadId) leadsCreated++
        }
      }

      // 7c) Actualizar la call con lead_id
      if (leadId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updErr } = await (sb as any)
          .from("calls")
          .update({ lead_id: leadId })
          .eq("id", orphan.id)
        if (updErr) {
          console.error(
            `[auto-link-calls] update call failed id=${orphan.id}: ${updErr.message}`,
          )
        } else {
          callsUpdated++
        }
      }
    }

    const duration = Date.now() - t0
    console.log(
      `[auto-link-calls] done ${new Date().toISOString()} ` +
        `orphans=${orphans.length} created=${leadsCreated} ` +
        `matched=${leadsMatchedExisting} updated=${callsUpdated} ` +
        `skipped=${skippedNoInfo} pages=${pages} duration=${duration}ms` +
        (paginationError ? ` pagination_error="${paginationError}"` : ""),
    )

    return NextResponse.json({
      ok: paginationError === null,
      total_orphans: orphans.length,
      leads_created: leadsCreated,
      leads_matched_existing: leadsMatchedExisting,
      calls_updated: callsUpdated,
      skipped_no_info: skippedNoInfo,
      duration_ms: duration,
      ...(paginationError ? { pagination_error: paginationError } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : null
    console.error("[auto-link-calls] uncaught:", msg, stack)
    return NextResponse.json(
      {
        error: msg,
        stack: stack?.split("\n").slice(0, 5).join("\n"),
        duration_ms: Date.now() - t0,
      },
      { status: 500 },
    )
  }
}
