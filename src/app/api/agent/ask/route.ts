"use server"

import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { createClient } from "@/lib/supabase/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import {
  AGENT_TOOLS,
  executeGetLeads,
  executeGetScheduleToday,
  executeGetSalesKpi,
  executeGetCallsSummary,
  executeGetTasksOpen,
} from "@/lib/agent/tools"
import { CRM_SYSTEM_PROMPT } from "@/lib/agent/prompts"

type DB = SupabaseClient<Database>

const MODEL = "claude-sonnet-4-6"
const MAX_TOOL_ROUNDS = 3
const HISTORY_LIMIT = 5

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  // Auth + parse fuera del try principal para poder responder 400/401 sin tocar DB
  const { query } = await req.json().catch(() => ({ query: null }))
  if (!query?.trim()) {
    return NextResponse.json({ error: "Query requerida" }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  // Service client for tool queries (bypasses RLS for agent reads) + persistencia
  const sb = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as DB

  // Brand from cookie
  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const brandId = brandSlug
    ? await getBrandIdBySlug(brandSlug, supabase as unknown as DB)
    : null

  const { data: runRow, error: runInsertErr } = await sb
    .from("agent_runs")
    .insert({
      run_type: "ask",
      triggered_by: user.id,
      related_user_id: user.id,
      input_summary: query,
      brand_id: brandId,
    })
    .select("id")
    .single()

  if (runInsertErr || !runRow) {
    console.error("[agent/ask] no se pudo crear agent_run:", runInsertErr)
    // No bloqueamos al usuario por un fallo de log: seguimos sin persistir.
  }
  const runId = runRow?.id ?? null

  // ---------- 2) Leer historial: últimas HISTORY_LIMIT runs completadas del mismo user ----------
  // "completada" = tiene output_summary y no tiene error.
  const { data: history } = await sb
    .from("agent_runs")
    .select("input_summary, output_summary, created_at")
    .eq("triggered_by", user.id)
    .eq("run_type", "ask")
    .is("error", null)
    .not("output_summary", "is", null)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT)

  // Pasar de DESC (más reciente primero) a orden cronológico ASC para inyectar a Claude
  const orderedHistory = (history ?? [])
    // Excluir la run actual si por algún motivo apareciera (no debería: aún sin output)
    .filter((h) => h.input_summary && h.output_summary)
    .reverse()

  // Construir messages incluyendo historial + query actual
  const messages: Anthropic.MessageParam[] = []
  for (const h of orderedHistory) {
    messages.push({ role: "user", content: h.input_summary as string })
    messages.push({ role: "assistant", content: h.output_summary as string })
  }
  messages.push({ role: "user", content: query })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // System con prompt caching ephemeral (reduce ~90% del costo del system prompt cuando se reusa <5 min)
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: CRM_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ]

  let tokensIn = 0
  let tokensOut = 0
  let finalText = ""
  let failure: Error | null = null

  try {
    // ---------- 3) Primera llamada a Claude ----------
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      tools: AGENT_TOOLS,
      messages,
    })
    tokensIn += response.usage?.input_tokens ?? 0
    tokensOut += response.usage?.output_tokens ?? 0

    // ---------- 4) Tool use loop (max MAX_TOOL_ROUNDS) ----------
    for (let i = 0; i < MAX_TOOL_ROUNDS; i++) {
      if (response.stop_reason !== "tool_use") break

      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== "tool_use") continue
        const input = block.input as Record<string, unknown>
        let result: unknown

        switch (block.name) {
          case "get_leads":
            result = await executeGetLeads(
              sb,
              user.id,
              brandId,
              input as Parameters<typeof executeGetLeads>[3]
            )
            break
          case "get_schedule_today":
            result = await executeGetScheduleToday(
              sb,
              user.id,
              brandId,
              input as Parameters<typeof executeGetScheduleToday>[3]
            )
            break
          case "get_sales_kpi":
            result = await executeGetSalesKpi(
              sb,
              user.id,
              brandId,
              input as Parameters<typeof executeGetSalesKpi>[3]
            )
            break
          case "get_calls_summary":
            result = await executeGetCallsSummary(
              sb,
              user.id,
              brandId,
              input as Parameters<typeof executeGetCallsSummary>[3]
            )
            break
          case "get_tasks_open":
            result = await executeGetTasksOpen(
              sb,
              user.id,
              input as Parameters<typeof executeGetTasksOpen>[2]
            )
            break
          default:
            result = { error: "Tool no encontrado" }
        }

        // Persistir cada tool call en agent_actions (best-effort, no rompe la respuesta)
        if (runId) {
          await sb
            .from("agent_actions")
            .insert({
              run_id: runId,
              action_type: block.name,
              payload: {
                args: input,
                result: result as Database["public"]["Tables"]["agent_actions"]["Insert"]["payload"],
              } as Database["public"]["Tables"]["agent_actions"]["Insert"]["payload"],
              executed: true,
              executed_at: new Date().toISOString(),
            })
            .then(({ error }) => {
              if (error) console.error("[agent/ask] agent_actions insert:", error)
            })
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        })
      }

      messages.push({ role: "assistant", content: response.content })
      messages.push({ role: "user", content: toolResults })

      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemBlocks,
        tools: AGENT_TOOLS,
        messages,
      })
      tokensIn += response.usage?.input_tokens ?? 0
      tokensOut += response.usage?.output_tokens ?? 0
    }

    // ---------- 5) Extraer texto final ----------
    finalText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("")
  } catch (err) {
    failure = err instanceof Error ? err : new Error(String(err))
    console.error("[agent/ask] loop falló:", failure)
  }

  // ---------- 6) UPDATE final de agent_runs ----------
  const durationMs = Date.now() - startedAt
  if (runId) {
    const updatePayload: Database["public"]["Tables"]["agent_runs"]["Update"] = {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      duration_ms: durationMs,
    }
    if (failure) {
      updatePayload.error = failure.message.slice(0, 1000)
      // Guardamos también el mensaje user-friendly en output_summary para no perder contexto
      updatePayload.output_summary = `[error] ${failure.message.slice(0, 500)}`
    } else {
      updatePayload.output_summary = finalText
    }
    await sb
      .from("agent_runs")
      .update(updatePayload)
      .eq("id", runId)
      .then(({ error }) => {
        if (error) console.error("[agent/ask] agent_runs update:", error)
      })
  }

  // ---------- 7) Respuesta al cliente ----------
  if (failure) {
    return NextResponse.json(
      { error: failure.message || "Error interno del agente" },
      { status: 500 }
    )
  }
  return NextResponse.json({ text: finalText })
}
