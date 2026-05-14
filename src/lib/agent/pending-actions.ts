import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, Json } from "@/types/database"
import { executeWriteTool } from "@/lib/agent/write-tools"

type DB = SupabaseClient<Database>

const DEFAULT_EXPIRES_DAYS = 7

export type PendingActionRow =
  Database["public"]["Tables"]["agent_pending_actions"]["Row"]

export type CreatePendingOpts = {
  actionType: string
  payload: Record<string, unknown>
  reasoning?: string | null
  runId?: string | null
  brandId?: string | null
  userId: string
  relatedLeadId?: string | null
  approvalRole?: Database["public"]["Enums"]["user_role"]
}

/**
 * Crea una pending action a la espera de aprobación humana.
 * Devuelve el id de la fila insertada.
 */
export async function createPendingAction(
  sb: DB,
  opts: CreatePendingOpts,
): Promise<string> {
  const expires = new Date()
  expires.setDate(expires.getDate() + DEFAULT_EXPIRES_DAYS)

  const { data, error } = await sb
    .from("agent_pending_actions")
    .insert({
      action_type: opts.actionType,
      payload: opts.payload as Json,
      reasoning: opts.reasoning ?? null,
      agent_run_id: opts.runId ?? null,
      brand_id: opts.brandId ?? null,
      related_user_id: opts.userId,
      related_lead_id: opts.relatedLeadId ?? null,
      status: "pending",
      approval_required_role: opts.approvalRole ?? "admin",
      expires_at: expires.toISOString(),
    })
    .select("id")
    .single()

  if (error || !data) {
    throw new Error(
      `createPendingAction falló: ${error?.message ?? "sin data"}`,
    )
  }
  return data.id
}

export type ApproveResult = {
  result: unknown
}

/**
 * Aprueba una pending action y la ejecuta inmediatamente.
 * - Verifica que el approver sea admin o manager.
 * - Marca status='approved' + approved_by/at.
 * - Ejecuta la write tool con el payload original.
 * - Si éxito: status='executed' + executed_at + execution_result.
 * - Si la ejecución falla: deja status='approved' y guarda el error
 *   en execution_result para auditoría/reintentos.
 */
export async function approvePending(
  sb: DB,
  id: string,
  approvedBy: string,
): Promise<ApproveResult> {
  // 1. Verificar rol del approver
  const { data: approver } = await sb
    .from("users")
    .select("role")
    .eq("id", approvedBy)
    .maybeSingle()
  if (!approver || (approver.role !== "admin" && approver.role !== "manager")) {
    throw new Error("Solo admin/manager pueden aprobar acciones del agente")
  }

  // 2. Cargar la pending
  const { data: pending, error: fetchErr } = await sb
    .from("agent_pending_actions")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (fetchErr || !pending) {
    throw new Error("Pending action no encontrada")
  }
  if (pending.status !== "pending") {
    throw new Error(`La acción ya no está pendiente (status=${pending.status})`)
  }

  // 3. Marcar approved
  const nowIso = new Date().toISOString()
  await sb
    .from("agent_pending_actions")
    .update({
      status: "approved",
      approved_by: approvedBy,
      approved_at: nowIso,
    })
    .eq("id", id)

  // 4. Ejecutar la write tool
  const result = await executeWriteTool(
    pending.action_type,
    sb,
    (pending.payload as Record<string, unknown>) ?? {},
    {
      userId: pending.related_user_id ?? approvedBy,
      brandId: pending.brand_id,
    },
  )

  if (result.ok) {
    await sb
      .from("agent_pending_actions")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        execution_result: (result.result ?? null) as Json,
      })
      .eq("id", id)
    return { result: result.result }
  }

  // 5. Falla de ejecución: guardamos error pero NO revertimos a pending
  await sb
    .from("agent_pending_actions")
    .update({
      execution_result: { error: result.error } as Json,
    })
    .eq("id", id)
  throw new Error(`Ejecución falló tras aprobación: ${result.error}`)
}

/**
 * Rechaza una pending action. Solo admin/manager.
 */
export async function rejectPending(
  sb: DB,
  id: string,
  rejectedBy: string,
  reason?: string,
): Promise<void> {
  const { data: approver } = await sb
    .from("users")
    .select("role")
    .eq("id", rejectedBy)
    .maybeSingle()
  if (!approver || (approver.role !== "admin" && approver.role !== "manager")) {
    throw new Error("Solo admin/manager pueden rechazar acciones del agente")
  }

  const { data: pending } = await sb
    .from("agent_pending_actions")
    .select("status")
    .eq("id", id)
    .maybeSingle()
  if (!pending) throw new Error("Pending action no encontrada")
  if (pending.status !== "pending") {
    throw new Error(`La acción ya no está pendiente (status=${pending.status})`)
  }

  await sb
    .from("agent_pending_actions")
    .update({
      status: "rejected",
      approved_by: rejectedBy,
      approved_at: new Date().toISOString(),
      rejected_reason: reason ?? null,
    })
    .eq("id", id)
}

export type FetchPendingOpts = {
  brandId: string | null
  userId: string
  role: Database["public"]["Enums"]["user_role"]
  limit?: number
}

/**
 * Devuelve las pending actions (status='pending') del brand activo.
 * - admin/manager: todas las pendings del brand.
 * - rep: solo las dirigidas a él (related_user_id = userId).
 */
export async function fetchPendingActions(
  sb: DB,
  opts: FetchPendingOpts,
): Promise<PendingActionRow[]> {
  let query = sb
    .from("agent_pending_actions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 20)

  if (opts.brandId) {
    // Incluimos también pendings sin brand (action global) para no perderlas
    query = query.or(`brand_id.eq.${opts.brandId},brand_id.is.null`)
  }

  if (opts.role === "rep") {
    query = query.eq("related_user_id", opts.userId)
  }

  const { data, error } = await query
  if (error) {
    console.error("[fetchPendingActions]", error)
    return []
  }
  return (data ?? []) as PendingActionRow[]
}

/**
 * Cuenta rápido de pendings para el badge. Mismo filtrado que fetch.
 */
export async function countPendingActions(
  sb: DB,
  opts: FetchPendingOpts,
): Promise<number> {
  let query = sb
    .from("agent_pending_actions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")

  if (opts.brandId) {
    query = query.or(`brand_id.eq.${opts.brandId},brand_id.is.null`)
  }
  if (opts.role === "rep") {
    query = query.eq("related_user_id", opts.userId)
  }

  const { count, error } = await query
  if (error) {
    console.error("[countPendingActions]", error)
    return 0
  }
  return count ?? 0
}
