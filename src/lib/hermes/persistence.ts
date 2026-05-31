/**
 * HERMES — Helpers para persistir ticks, observations y resolutions.
 *
 * Los tipos en database.ts probablemente no están actualizados con las
 * tablas hermes_* (recién creadas). Usamos casting any donde corresponde,
 * igual que el resto del proyecto.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import type {
  Observation,
  ResolutionStatus,
  Severity,
  ToolResult,
} from "./types"

type SB = SupabaseClient<Database>

export async function startTick(
  sb: SB,
  triggeredBy: "cron" | "manual" = "cron",
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("hermes_ticks")
    .insert({ triggered_by: triggeredBy, status: "running" })
    .select("id")
    .single()
  if (error || !data) throw new Error(error?.message ?? "no se pudo crear tick")
  return data.id as string
}

export async function finishTick(
  sb: SB,
  tickId: string,
  counts: { checks_run: number; observations_count: number; resolutions_count: number },
  status: "completed" | "failed" = "completed",
  errorMessage?: string,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (sb as any)
    .from("hermes_ticks")
    .update({
      finished_at: new Date().toISOString(),
      checks_run: counts.checks_run,
      observations_count: counts.observations_count,
      resolutions_count: counts.resolutions_count,
      status,
      error_message: errorMessage ?? null,
    })
    .eq("id", tickId)
}

export async function persistObservation(
  sb: SB,
  tickId: string,
  obs: Observation,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("hermes_observations")
    .insert({
      tick_id: tickId,
      check_type: obs.check_type,
      severity: obs.severity,
      summary: obs.summary,
      details: obs.details,
      brand_id: obs.brand_id ?? null,
      status: "open",
    })
    .select("id")
    .single()
  if (error || !data)
    throw new Error(error?.message ?? "no se pudo persistir observation")
  return data.id as string
}

export async function persistResolution(
  sb: SB,
  observationId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  result: ToolResult,
  triggeredBy: "auto" | "manual" | "scheduled" = "auto",
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any)
    .from("hermes_resolutions")
    .insert({
      observation_id: observationId,
      tool_name: toolName,
      tool_input: toolInput,
      tool_output: result.output,
      status: result.status,
      approval_reason: result.approval_reason ?? null,
      triggered_by: triggeredBy,
    })
    .select("id")
    .single()
  if (error || !data)
    throw new Error(error?.message ?? "no se pudo persistir resolution")

  // Si fue resuelto exitoso (no requires_approval), marcar la observation como resolved
  if (result.status === "success" || result.status === "approved_by_human") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb as any)
      .from("hermes_observations")
      .update({
        status: "resolved",
        resolution_id: data.id,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", observationId)
  } else if (result.status === "requires_approval") {
    // Marcar como escalated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (sb as any)
      .from("hermes_observations")
      .update({ status: "escalated", resolution_id: data.id })
      .eq("id", observationId)
  }

  return data.id as string
}

/** Cuenta observaciones recientes de un check_type (para evitar spam) */
export async function countRecentObservations(
  sb: SB,
  checkType: string,
  minutesBack: number,
): Promise<number> {
  const since = new Date(Date.now() - minutesBack * 60 * 1000).toISOString()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (sb as any)
    .from("hermes_observations")
    .select("id", { count: "exact", head: true })
    .eq("check_type", checkType)
    .gte("created_at", since)
  return (count as number | null) ?? 0
}

export type { Severity }
