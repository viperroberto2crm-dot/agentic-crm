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

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json()
    if (!query?.trim()) {
      return NextResponse.json({ error: "Query requerida" }, { status: 400 })
    }

    // Auth
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

    // Service client for tool queries (bypasses RLS for agent reads)
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

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // First Claude call
    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: CRM_SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages: [{ role: "user", content: query }],
    })

    // Tool use loop (max 3 rounds)
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: query }]

    for (let i = 0; i < 3; i++) {
      if (response.stop_reason !== "tool_use") break

      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of response.content) {
        if (block.type !== "tool_use") continue
        const input = block.input as Record<string, unknown>
        let result: unknown

        switch (block.name) {
          case "get_leads":
            result = await executeGetLeads(sb, user.id, brandId, input as Parameters<typeof executeGetLeads>[3])
            break
          case "get_schedule_today":
            result = await executeGetScheduleToday(sb, user.id, brandId, input as Parameters<typeof executeGetScheduleToday>[3])
            break
          case "get_sales_kpi":
            result = await executeGetSalesKpi(sb, user.id, brandId, input as Parameters<typeof executeGetSalesKpi>[3])
            break
          case "get_calls_summary":
            result = await executeGetCallsSummary(sb, user.id, brandId, input as Parameters<typeof executeGetCallsSummary>[3])
            break
          case "get_tasks_open":
            result = await executeGetTasksOpen(sb, user.id, input as Parameters<typeof executeGetTasksOpen>[2])
            break
          default:
            result = { error: "Tool no encontrado" }
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
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: CRM_SYSTEM_PROMPT,
        tools: AGENT_TOOLS,
        messages,
      })
    }

    // Extract text response
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("")

    return NextResponse.json({ text })
  } catch (err) {
    console.error("[agent/ask]", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error interno" },
      { status: 500 }
    )
  }
}
