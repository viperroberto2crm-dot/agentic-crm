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
  executeListBrands,
} from "@/lib/agent/tools"
import {
  WRITE_TOOLS,
  executeWriteTool,
  isWriteToolName,
} from "@/lib/agent/write-tools"
import {
  RAG_TOOLS,
  RAG_TOOL_NAMES,
  executeRagTool,
} from "@/lib/agent/rag-tools"
import { resolveAutonomy } from "@/lib/agent/policies"
import { createPendingAction } from "@/lib/agent/pending-actions"
import { CRM_SYSTEM_PROMPT } from "@/lib/agent/prompts"
import {
  loadHistoryWithCompaction,
  maybeCompact,
} from "@/lib/agent/compaction"
import {
  selectActiveSkills,
  formatSkillsForPrompt,
} from "@/lib/agent/skills-registry"

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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // ---------- 2a) Compaction best-effort ANTES de leer historial ----------
  // Si el historial sin compactar supera el threshold, generamos un nuevo
  // resumen y lo persistimos en agent_compactions. Errores no rompen la response.
  await maybeCompact(sb, user.id, brandId, anthropic, { limit: HISTORY_LIMIT }).catch((err) => {
    console.error("[agent/ask] maybeCompact lanzó (no debería):", err)
  })

  // ---------- 2b) Leer historial: summary previo (si existe) + runs posteriores ----------
  const { summary: priorSummary, runs: orderedHistory } = await loadHistoryWithCompaction(
    sb,
    user.id,
    { limit: HISTORY_LIMIT }
  )

  // Construir messages incluyendo historial + query actual
  const messages: Anthropic.MessageParam[] = []
  for (const h of orderedHistory) {
    messages.push({ role: "user", content: h.input_summary })
    messages.push({ role: "assistant", content: h.output_summary })
  }
  messages.push({ role: "user", content: query })

  // System con prompt caching ephemeral (reduce ~90% del costo del system prompt cuando se reusa <5 min).
  // Si hay un summary de conversaciones previas compactadas, lo añadimos como SEGUNDO bloque del
  // system (también con cache_control). Ventajas vs. inyectarlo como primer user message:
  //   - No rompe el patrón user/assistant alternado que espera la API con tool_use.
  //   - Se beneficia del prompt caching (el summary cambia poco entre requests cercanos).
  //   - No consume slot de "última instrucción" — el query del user queda al final.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: CRM_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ]
  // ── Capa 5: Skills auto-generadas relevantes al query actual ──
  // Si la marca tiene patrones aprendidos promovidos a skills (status='production'),
  // seleccionamos las 3 más similares semánticamente al query y las inyectamos al
  // system. Best-effort: si OPENAI_API_KEY no está o falla la búsqueda, sigue sin skills.
  const relevantSkills = await selectActiveSkills(sb, query, brandId, 3).catch(() => [])
  const skillsBlock = formatSkillsForPrompt(relevantSkills)
  if (skillsBlock) {
    systemBlocks.push({
      type: "text",
      text: skillsBlock,
      cache_control: { type: "ephemeral" },
    })
  }

  if (priorSummary) {
    systemBlocks.push({
      type: "text",
      text: `Resumen de conversaciones anteriores con este usuario: ${priorSummary}`,
      cache_control: { type: "ephemeral" },
    })
  }

  let tokensIn = 0
  let tokensOut = 0
  let finalText = ""
  let failure: Error | null = null

  try {
    // Combinamos read tools + write tools. Las write tools pasan por el
    // pipeline de aprobación humana (default: approve_required).
    const allTools = [...AGENT_TOOLS, ...WRITE_TOOLS, ...RAG_TOOLS]

    // ---------- 3) Primera llamada a Claude ----------
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      tools: allTools,
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

        // ── RAG TOOLS: lectura semántica de llamadas ──
        if (RAG_TOOL_NAMES.includes(block.name)) {
          result = await executeRagTool(block.name, sb, { brandId }, input)
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
                if (error) console.error("[agent/ask] agent_actions(rag) insert:", error)
              })
          }
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
          continue
        }

        if (isWriteToolName(block.name)) {
          // El bot puede incluir `reasoning` dentro del input (lo pide el
          // system prompt). Lo extraemos sin pasarlo al ejecutor para
          // mantener el payload limpio.
          const reasoning =
            typeof input.reasoning === "string" && input.reasoning.trim()
              ? input.reasoning.trim()
              : null
          const cleanInput = { ...input }
          delete cleanInput.reasoning

          const relatedLeadId =
            typeof cleanInput.lead_id === "string" ? cleanInput.lead_id : null

          const autonomy = await resolveAutonomy(sb, {
            actionType: block.name,
            brandId,
            userId: user.id,
          }).catch((err) => {
            console.error("[agent/ask] resolveAutonomy falló:", err)
            return "approve_required" as const
          })

          if (autonomy === "suggest_only") {
            result = {
              status: "suggested_only",
              message:
                "Esta acción solo está habilitada como sugerencia. Comparte con el rep para que la haga manualmente.",
            }
          } else if (autonomy === "auto_with_audit") {
            const execRes = await executeWriteTool(block.name, sb, cleanInput, {
              userId: user.id,
              brandId,
            })
            // Persistimos también una fila pending status='executed' para audit
            try {
              const expires = new Date()
              expires.setDate(expires.getDate() + 30)
              await sb.from("agent_pending_actions").insert({
                action_type: block.name,
                payload: cleanInput as Database["public"]["Tables"]["agent_pending_actions"]["Insert"]["payload"],
                reasoning,
                agent_run_id: runId,
                brand_id: brandId,
                related_user_id: user.id,
                related_lead_id: relatedLeadId,
                status: "executed",
                approval_required_role: "admin",
                executed_at: new Date().toISOString(),
                execution_result: (execRes.ok
                  ? (execRes.result ?? null)
                  : { error: execRes.error }) as Database["public"]["Tables"]["agent_pending_actions"]["Insert"]["execution_result"],
                expires_at: expires.toISOString(),
              })
            } catch (err) {
              console.error("[agent/ask] audit insert falló:", err)
            }
            result = execRes.ok
              ? { status: "executed", result: execRes.result }
              : { status: "error", error: execRes.error }
          } else {
            // approve_required (default)
            try {
              const pendingId = await createPendingAction(sb, {
                actionType: block.name,
                payload: cleanInput,
                reasoning,
                runId,
                brandId,
                userId: user.id,
                relatedLeadId,
              })
              result = {
                status: "pending_approval",
                pending_id: pendingId,
                message:
                  "Acción enviada para aprobación humana. El admin será notificado.",
              }
            } catch (err) {
              console.error("[agent/ask] createPendingAction falló:", err)
              result = {
                status: "error",
                error: err instanceof Error ? err.message : "Error guardando pending",
              }
            }
          }

          // Persistir en agent_actions para histórico (no ejecutada todavía
          // salvo auto_with_audit, pero queda el rastro de la propuesta)
          if (runId) {
            const r = result as { status?: string }
            await sb
              .from("agent_actions")
              .insert({
                run_id: runId,
                action_type: block.name,
                reasoning,
                payload: {
                  args: cleanInput,
                  autonomy,
                  result: result as Database["public"]["Tables"]["agent_actions"]["Insert"]["payload"],
                } as Database["public"]["Tables"]["agent_actions"]["Insert"]["payload"],
                executed: r.status === "executed",
                executed_at:
                  r.status === "executed" ? new Date().toISOString() : null,
              })
              .then(({ error }) => {
                if (error) console.error("[agent/ask] agent_actions(write) insert:", error)
              })
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          })
          continue
        }

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
          case "list_brands":
            result = await executeListBrands(sb)
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
        tools: allTools,
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

    // Persistir skills aplicadas a este run para análisis de efectividad (Capa 5)
    if (relevantSkills.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sbAny = sb as any
      for (const skill of relevantSkills) {
        await sbAny
          .from("skill_applications")
          .insert({
            skill_id: skill.skill_id,
            agent_run_id: runId,
            brand_id: brandId,
            user_id: user.id,
            similarity: skill.similarity,
          })
          .then(({ error }: { error: unknown }) => {
            if (error) console.error("[agent/ask] skill_applications insert:", error)
          })
      }
    }
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
