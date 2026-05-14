import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

// ── Input types ──────────────────────────────────────────────────────────────

export type CreateTaskInput = {
  lead_id?: string
  title: string
  description?: string
  priority?: Database["public"]["Enums"]["task_priority"]
  due_at?: string
  assigned_to?: string
  reasoning?: string
}

export type UpdateLeadStatusInput = {
  lead_id: string
  new_status: Database["public"]["Enums"]["lead_status"]
  reason?: string
  reasoning?: string
}

export type LogCallNoteInput = {
  lead_id: string
  outcome: Database["public"]["Enums"]["call_outcome"]
  notes: string
  direction?: Database["public"]["Enums"]["call_direction"]
  duration_seconds?: number
  reasoning?: string
}

export type WriteToolName = "create_task" | "update_lead_status" | "log_call_note"
export type WriteToolInput =
  | CreateTaskInput
  | UpdateLeadStatusInput
  | LogCallNoteInput

export type WriteToolCtx = {
  userId: string
  brandId: string | null
}

export type WriteToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

// ── Tool definitions (Anthropic format) ──────────────────────────────────────

const REASONING_DESC =
  "Una oración explicando por qué propones esta acción. La verá el admin al aprobar."

export const WRITE_TOOLS = [
  {
    name: "create_task",
    description:
      "Propone crear una tarea de seguimiento para el rep o el user actual. Requiere aprobación humana.",
    input_schema: {
      type: "object" as const,
      properties: {
        lead_id: { type: "string", description: "UUID del lead relacionado (opcional)" },
        title: { type: "string", description: "Título corto de la tarea" },
        description: { type: "string", description: "Descripción / contexto adicional" },
        priority: {
          type: "string",
          enum: ["urgent", "high", "normal", "low"],
          description: "Prioridad, default 'normal'",
        },
        due_at: { type: "string", description: "Fecha límite ISO (YYYY-MM-DDTHH:mm:ssZ)" },
        assigned_to: {
          type: "string",
          description:
            "UUID del user al que asignar. Default: rep asignado al lead, sino el user actual.",
        },
        reasoning: { type: "string", description: REASONING_DESC },
      },
      required: ["title"],
    },
  },
  {
    name: "update_lead_status",
    description:
      "Propone cambiar el estado de un lead. Requiere aprobación humana. Si pasas reason, se anexa a las notas del lead.",
    input_schema: {
      type: "object" as const,
      properties: {
        lead_id: { type: "string", description: "UUID del lead" },
        new_status: {
          type: "string",
          enum: ["new", "contacted", "qualified", "appointment_set", "sold", "lost", "on_hold"],
          description: "Nuevo status",
        },
        reason: {
          type: "string",
          description: "Motivo del cambio. Se anexa a las notas del lead con timestamp.",
        },
        reasoning: { type: "string", description: REASONING_DESC },
      },
      required: ["lead_id", "new_status"],
    },
  },
  {
    name: "log_call_note",
    description:
      "Propone registrar una llamada con su outcome y notas. Requiere aprobación humana. El rep_id se setea al user actual.",
    input_schema: {
      type: "object" as const,
      properties: {
        lead_id: { type: "string", description: "UUID del lead" },
        outcome: {
          type: "string",
          enum: [
            "no_answer",
            "voicemail",
            "connected",
            "appointment_set",
            "not_interested",
            "callback_requested",
            "wrong_number",
          ],
          description: "Resultado de la llamada",
        },
        notes: { type: "string", description: "Resumen / notas de la llamada" },
        direction: {
          type: "string",
          enum: ["inbound", "outbound"],
          description: "Dirección, default 'outbound'",
        },
        duration_seconds: { type: "number", description: "Duración en segundos (opcional)" },
        reasoning: { type: "string", description: REASONING_DESC },
      },
      required: ["lead_id", "outcome", "notes"],
    },
  },
]

export const WRITE_TOOL_NAMES = new Set<string>(WRITE_TOOLS.map((t) => t.name))

export function isWriteToolName(name: string): name is WriteToolName {
  return WRITE_TOOL_NAMES.has(name)
}

// ── Executors ────────────────────────────────────────────────────────────────

export async function executeCreateTask(
  sb: DB,
  input: CreateTaskInput,
  ctx: WriteToolCtx,
): Promise<WriteToolResult> {
  try {
    if (!input.title?.trim()) {
      return { ok: false, error: "title es requerido" }
    }

    // Resolver assigned_to: explícito → rep del lead → user actual
    let assignedTo = input.assigned_to ?? null
    if (!assignedTo && input.lead_id) {
      const { data: lead } = await sb
        .from("leads")
        .select("assigned_rep_id")
        .eq("id", input.lead_id)
        .maybeSingle()
      assignedTo = lead?.assigned_rep_id ?? null
    }
    if (!assignedTo) assignedTo = ctx.userId

    const { data, error } = await sb
      .from("tasks")
      .insert({
        title: input.title.trim(),
        description: input.description ?? null,
        priority: input.priority ?? "normal",
        due_at: input.due_at ?? null,
        related_lead_id: input.lead_id ?? null,
        assigned_to: assignedTo,
        brand_id: ctx.brandId,
        status: "open",
        source: "agent",
      })
      .select("id, title, priority, due_at, assigned_to, related_lead_id, status")
      .single()

    if (error) return { ok: false, error: error.message }
    return { ok: true, result: data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function executeUpdateLeadStatus(
  sb: DB,
  input: UpdateLeadStatusInput,
  _ctx: WriteToolCtx,
): Promise<WriteToolResult> {
  try {
    if (!input.lead_id) return { ok: false, error: "lead_id es requerido" }
    if (!input.new_status) return { ok: false, error: "new_status es requerido" }

    // Append reason a notes si viene
    let notesUpdate: string | undefined
    if (input.reason?.trim()) {
      const { data: existing } = await sb
        .from("leads")
        .select("notes")
        .eq("id", input.lead_id)
        .maybeSingle()
      const prev = existing?.notes ?? ""
      const ts = new Date().toISOString().slice(0, 16).replace("T", " ")
      const stamp = `[Bot - ${ts}]: ${input.reason.trim()}`
      notesUpdate = prev ? `${prev}\n${stamp}` : stamp
    }

    const update: Database["public"]["Tables"]["leads"]["Update"] = {
      status: input.new_status,
    }
    if (notesUpdate !== undefined) update.notes = notesUpdate

    const { data, error } = await sb
      .from("leads")
      .update(update)
      .eq("id", input.lead_id)
      .select("id, status, notes")
      .single()

    if (error) return { ok: false, error: error.message }
    return { ok: true, result: data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function executeLogCallNote(
  sb: DB,
  input: LogCallNoteInput,
  ctx: WriteToolCtx,
): Promise<WriteToolResult> {
  try {
    if (!input.lead_id) return { ok: false, error: "lead_id es requerido" }
    if (!input.outcome) return { ok: false, error: "outcome es requerido" }
    if (!input.notes?.trim()) return { ok: false, error: "notes es requerido" }
    if (!ctx.brandId) return { ok: false, error: "brand activo requerido para registrar llamada" }

    const { data, error } = await sb
      .from("calls")
      .insert({
        lead_id: input.lead_id,
        outcome: input.outcome,
        notes: input.notes.trim(),
        direction: input.direction ?? "outbound",
        duration_seconds: input.duration_seconds ?? null,
        rep_id: ctx.userId,
        brand_id: ctx.brandId,
        called_at: new Date().toISOString(),
        source: "agent",
      })
      .select("id, outcome, direction, duration_seconds, called_at, lead_id")
      .single()

    if (error) return { ok: false, error: error.message }
    return { ok: true, result: data }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executeWriteTool(
  name: string,
  sb: DB,
  input: Record<string, unknown>,
  ctx: WriteToolCtx,
): Promise<WriteToolResult> {
  switch (name) {
    case "create_task":
      return executeCreateTask(sb, input as CreateTaskInput, ctx)
    case "update_lead_status":
      return executeUpdateLeadStatus(sb, input as UpdateLeadStatusInput, ctx)
    case "log_call_note":
      return executeLogCallNote(sb, input as LogCallNoteInput, ctx)
    default:
      return { ok: false, error: `write tool no encontrada: ${name}` }
  }
}
