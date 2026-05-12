import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

// ── Tool input types ──────────────────────────────────────────────────────────

export type GetLeadsInput = {
  status?: string
  days_without_contact?: number
  limit?: number
}

export type GetScheduleInput = {
  date?: string // ISO date, defaults to today
}

export type GetSalesKpiInput = {
  period?: "today" | "week" | "month"
}

export type GetCallsInput = {
  period?: "today" | "week" | "month"
  limit?: number
}

export type GetTasksInput = {
  priority?: string
  limit?: number
}

// ── Tool definitions (Anthropic format) ──────────────────────────────────────

export const AGENT_TOOLS = [
  {
    name: "get_leads",
    description: "Get leads from the CRM. Can filter by status or days without contact.",
    input_schema: {
      type: "object" as const,
      properties: {
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
    description: "Get sales KPIs: total revenue, pending, count, average ticket.",
    input_schema: {
      type: "object" as const,
      properties: {
        period: {
          type: "string",
          enum: ["today", "week", "month"],
          description: "Time period, default month",
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

export async function executeGetLeads(
  sb: DB, userId: string, brandId: string | null, input: GetLeadsInput
) {
  const limit = input.limit ?? 10
  let query = sb
    .from("leads")
    .select("id, first_name, last_name, phone, status, score, last_contacted_at, source")
    .order("score", { ascending: false })
    .limit(limit)

  if (brandId) query = query.eq("brand_id", brandId)
  if (input.status) query = query.eq("status", input.status as Database["public"]["Enums"]["lead_status"])
  if (input.days_without_contact) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - input.days_without_contact)
    query = query.or(`last_contacted_at.is.null,last_contacted_at.lte.${cutoff.toISOString()}`)
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
  let query = sb
    .from("sales")
    .select("amount_cents, payment_status")
    .gte("created_at", gte)

  if (brandId) query = query.eq("brand_id", brandId)

  const { data } = await query
  const rows = data ?? []
  const paid = rows.filter((r) => r.payment_status === "paid")
  const pending = rows.filter((r) => r.payment_status === "pending")
  const totalPaid = paid.reduce((s, r) => s + r.amount_cents, 0)
  const totalPending = pending.reduce((s, r) => s + r.amount_cents, 0)

  return {
    period: input.period ?? "month",
    total_paid_usd: (totalPaid / 100).toFixed(2),
    total_pending_usd: (totalPending / 100).toFixed(2),
    paid_count: paid.length,
    pending_count: pending.length,
    avg_ticket_usd: paid.length > 0 ? (totalPaid / paid.length / 100).toFixed(2) : "0.00",
  }
}

export async function executeGetCallsSummary(
  sb: DB, userId: string, brandId: string | null, input: GetCallsInput
) {
  const { gte } = periodRange(input.period ?? "week")
  let query = sb
    .from("calls")
    .select("id, outcome, direction, duration_seconds, called_at")
    .gte("called_at", gte)
    .order("called_at", { ascending: false })
    .limit(input.limit ?? 50)

  if (brandId) query = query.eq("brand_id", brandId)

  const { data } = await query
  const rows = data ?? []
  const connected = rows.filter((r) => r.outcome === "connected").length
  const totalDuration = rows.reduce((s, r) => s + (r.duration_seconds ?? 0), 0)

  return {
    period: input.period ?? "week",
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
