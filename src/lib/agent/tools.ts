import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { getSalesBreakdown } from "@/lib/queries/sales-kpi"

type DB = SupabaseClient<Database>

// ── Tool input types ──────────────────────────────────────────────────────────

export type Scope = "current" | "all"

export type GetLeadsInput = {
  query?: string
  status?: string
  days_without_contact?: number
  limit?: number
  scope?: Scope
}

export type GetScheduleInput = {
  date?: string
}

export type GetSalesKpiInput = {
  period?: "today" | "week" | "month"
  scope?: Scope
}

export type GetCallsInput = {
  period?: "today" | "week" | "month"
  limit?: number
  scope?: Scope
}

export type GetTasksInput = {
  priority?: string
  limit?: number
}

export type ListBrandsInput = Record<string, never>

// ── Tool definitions (Anthropic format) ──────────────────────────────────────

const SCOPE_DESC =
  "Use 'current' (default) to scope to the active brand only. Use 'all' when the user asks about ALL brands or compares brands."

export const AGENT_TOOLS = [
  {
    name: "list_brands",
    description:
      "List every brand (compañía/marca) in this CRM. Use this when the user asks how many companies/brands exist or to confirm names before reporting metrics.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_leads",
    description: "Get leads from the CRM. Use the 'query' parameter to search by name, phone, or email (case-insensitive, partial match). Can also filter by status or days without contact.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search text. Matches against first_name, last_name, phone, and email (case-insensitive, partial). Use this when the user asks for a specific lead by name or contact info.",
        },
        status: {
          type: "string",
          enum: ["new", "contacted", "qualified", "proposal", "negotiation", "sold", "lost"],
          description: "Filter by lead status",
        },
        days_without_contact: {
          type: "number",
          description: "Only return leads not contacted in this many days",
        },
        limit: { type: "number", description: "Max results, default 10" },
        scope: {
          type: "string",
          enum: ["current", "all"],
          description: SCOPE_DESC,
        },
      },
    },
  },
  {
    name: "get_schedule_today",
    description: "Get today's appointments and open tasks for the current user.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "ISO date (YYYY-MM-DD), defaults to today" },
      },
    },
  },
  {
    name: "get_sales_kpi",
    description:
      "Get sales KPIs (revenue, pending, count, avg ticket). When scope='all', also returns a per-brand breakdown so you can compare brands.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month"],
          description: "Time period, default month",
        },
        scope: {
          type: "string",
          enum: ["current", "all"],
          description: SCOPE_DESC,
        },
      },
    },
  },
  {
    name: "get_calls_summary",
    description: "Get calls summary: count, outcomes, duration.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month"],
          description: "Time period, default week",
        },
        limit: { type: "number", description: "Max results for detail list" },
        scope: {
          type: "string",
          enum: ["current", "all"],
          description: SCOPE_DESC,
        },
      },
    },
  },
  {
    name: "get_tasks_open",
    description: "Get open tasks assigned to the current user.",
    input_schema: {
      type: "object" as const,
      properties: {
        priority: {
          type: "string",
          enum: ["urgent", "high", "normal", "low"],
          description: "Filter by priority",
        },
        limit: { type: "number", description: "Max results, default 10" },
      },
    },
  },
]

// ── Tool executors ────────────────────────────────────────────────────────────

function periodRange(period = "month"): { gte: string } {
  const now = new Date()
  if (period === "today") {
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    return { gte: start.toISOString() }
  }
  if (period === "week") {
    const start = new Date(now); start.setDate(now.getDate() - 7)
    return { gte: start.toISOString() }
  }
  const start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0)
  return { gte: start.toISOString() }
}

export async function executeListBrands(sb: DB) {
  const { data } = await sb
    .from("brands")
    .select("id, name, slug, active")
    .order("name")
  return data ?? []
}

export async function executeGetLeads(
  sb: DB, userId: string, brandId: string | null, input: GetLeadsInput
) {
  const limit = input.limit ?? 10
  let query = sb
    .from("leads")
    .select("id, first_name, last_name, phone, email, status, score, last_contacted_at, source, brand_id")
    .order("score", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (input.scope !== "all" && brandId) query = query.eq("brand_id", brandId)
  if (input.status) query = query.eq("status", input.status as Database["public"]["Enums"]["lead_status"])
  if (input.days_without_contact) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - input.days_without_contact)
    query = query.or(`last_contacted_at.is.null,last_contacted_at.lte.${cutoff.toISOString()}`)
  }

  if (input.query && input.query.trim().length > 0) {
    // Escape commas and parens to keep PostgREST `or` filter safe.
    const safe = input.query.trim().replace(/[(),]/g, " ")
    // Split words and OR each against name/phone/email. Each word ANDed isn't
    // supported in a single .or() chain, so we use a token-aware OR string:
    // any word matching first_name/last_name/phone/email returns the lead.
    const tokens = safe.split(/\s+/).filter(Boolean)
    const parts: string[] = []
    for (const tok of tokens) {
      const t = tok.replace(/%/g, "")
      parts.push(`first_name.ilike.%${t}%`)
      parts.push(`last_name.ilike.%${t}%`)
      parts.push(`phone.ilike.%${t}%`)
      parts.push(`email.ilike.%${t}%`)
    }
    if (parts.length > 0) {
      query = query.or(parts.join(","))
    }
  }

  const { data } = await query
  return data ?? []
}

export async function executeGetScheduleToday(
  sb: DB, userId: string, brandId: string | null, input: GetScheduleInput
) {
  const date = input.date ?? new Date().toISOString().split("T")[0]
  const start = `${date}T00:00:00.000Z`
  const end   = `${date}T23:59:59.999Z`

  const [apptsRes, tasksRes] = await Promise.all([
    sb.from("appointments")
      .select("id, scheduled_at, type, status, service, lead:leads!appointments_lead_id_fkey(first_name, last_name)")
      .eq("rep_id", userId)
      .gte("scheduled_at", start)
      .lte("scheduled_at", end)
      .order("scheduled_at"),
    sb.from("tasks")
      .select("id, title, priority, due_at, status")
      .eq("assigned_to", userId)
      .eq("status", "open")
      .order("priority"),
  ])

  return {
    appointments: apptsRes.data ?? [],
    tasks: tasksRes.data ?? [],
  }
}

export async function executeGetSalesKpi(
  sb: DB, userId: string, brandId: string | null, input: GetSalesKpiInput
) {
  const { gte } = periodRange(input.period ?? "month")
  const paidRange = { startIso: gte, endIso: new Date().toISOString() }

  function toUsd(cents: number) {
    return (cents / 100).toFixed(2)
  }
  function avgTicket(collected: number, count: number) {
    return count > 0 ? (collected / count / 100).toFixed(2) : "0.00"
  }

  if (input.scope === "all") {
    const { data: brandsData } = await sb
      .from("brands")
      .select("id, name")
      .eq("active", true)
      .order("name")
    const allBrands = brandsData ?? []

    const byBrand = await Promise.all(
      allBrands.map(async (b) => {
        const br = await getSalesBreakdown(sb, {
          brandId: b.id,
          repId: null,
          paidRange,
        })
        return {
          brand_id: b.id,
          brand_name: b.name,
          paid_count: br.paidCount,
          pending_count: br.openCount,
          total_paid_usd: toUsd(br.collectedCents),
          total_pending_usd: toUsd(br.outstandingCents),
          avg_ticket_usd: avgTicket(br.collectedCents, br.paidCount),
        }
      }),
    )

    const totalPaid = byBrand.reduce(
      (s, b) => s + Math.round(parseFloat(b.total_paid_usd) * 100),
      0,
    )
    const totalPending = byBrand.reduce(
      (s, b) => s + Math.round(parseFloat(b.total_pending_usd) * 100),
      0,
    )
    const totalPaidCount = byBrand.reduce((s, b) => s + b.paid_count, 0)

    return {
      period: input.period ?? "month",
      scope: "all",
      overall: {
        total_paid_usd: toUsd(totalPaid),
        total_pending_usd: toUsd(totalPending),
        paid_count: totalPaidCount,
        pending_count: byBrand.reduce((s, b) => s + b.pending_count, 0),
        avg_ticket_usd: avgTicket(totalPaid, totalPaidCount),
      },
      by_brand: byBrand,
    }
  }

  // scope === "current"
  const br = await getSalesBreakdown(sb, {
    brandId,
    repId: null,
    paidRange,
  })
  return {
    period: input.period ?? "month",
    scope: "current",
    total_paid_usd: toUsd(br.collectedCents),
    total_pending_usd: toUsd(br.outstandingCents),
    paid_count: br.paidCount,
    pending_count: br.openCount,
    avg_ticket_usd: avgTicket(br.collectedCents, br.paidCount),
  }
}

export async function executeGetCallsSummary(
  sb: DB, userId: string, brandId: string | null, input: GetCallsInput
) {
  const { gte } = periodRange(input.period ?? "week")
  let query = sb
    .from("calls")
    .select("id, outcome, direction, duration_seconds, called_at, brand_id")
    .gte("called_at", gte)
    .order("called_at", { ascending: false })
    .limit(input.limit ?? 50)

  if (input.scope !== "all" && brandId) query = query.eq("brand_id", brandId)

  const { data } = await query
  const rows = data ?? []
  const connected = rows.filter((r) => r.outcome === "connected").length
  const totalDuration = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0)

  return {
    period: input.period ?? "week",
    scope: input.scope ?? "current",
    total_calls: rows.length,
    connected,
    connection_rate: rows.length > 0 ? `${Math.round((connected / rows.length) * 100)}%` : "0%",
    avg_duration_seconds: rows.length > 0 ? Math.round(totalDuration / rows.length) : 0,
  }
}

export async function executeGetTasksOpen(
  sb: DB, userId: string, input: GetTasksInput
) {
  let query = sb
    .from("tasks")
    .select("id, title, priority, due_at, status, description")
    .eq("assigned_to", userId)
    .eq("status", "open")
    .order("priority")
    .limit(input.limit ?? 10)

  if (input.priority) query = query.eq("priority", input.priority as Database["public"]["Enums"]["task_priority"])

  const { data } = await query
  return data ?? []
}
