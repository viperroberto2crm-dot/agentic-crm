/**
 * HERMES — Bot supervisor agéntico del CRM.
 *
 * Tipos compartidos entre los módulos:
 *   - checks.ts: detectan anomalías y crean Observations
 *   - tools.ts: ejecutan acciones de fix (auto o con approval)
 *   - persistence.ts: helpers para guardar todo en DB
 *   - runner.ts: orquestador del tick
 *   - route.ts: endpoint /api/hermes/tick
 *
 * Filosofía: Hermes observa, diagnostica, resuelve lo que puede solo,
 * escala lo riesgoso. Cada tick deja rastro en `hermes_ticks`,
 * `hermes_observations`, `hermes_resolutions`. Sprint 2+ agregamos
 * `hermes_patterns` (learning) y razonamiento con Claude.
 */

export type Severity = "info" | "warning" | "critical"

export type ObservationStatus = "open" | "resolved" | "escalated" | "ignored"

export type ResolutionStatus =
  | "success"
  | "failed"
  | "requires_approval"
  | "approved_by_human"
  | "rejected"

/**
 * Lo que un check devuelve cuando detecta algo. El runner toma esto y lo
 * persiste como hermes_observations row.
 */
export type Observation = {
  check_type: string
  severity: Severity
  summary: string
  details: Record<string, unknown>
  brand_id?: string | null
  /** Tool sugerido para resolver (si el check sabe cuál usar) */
  suggested_tool?: string
  /** Si el tool sugerido es auto-ejecutable sin approval */
  auto_resolve?: boolean
}

/**
 * Resultado de ejecutar un tool de fix.
 */
export type ToolResult = {
  status: ResolutionStatus
  output: Record<string, unknown>
  /** Si requires_approval, razón legible para el admin */
  approval_reason?: string
  /** Si failed, mensaje de error */
  error?: string
}

/**
 * Definición de un check (observador).
 */
export type CheckDefinition = {
  name: string
  description: string
  /** Función que corre el check y devuelve 0+ observaciones */
  run: (ctx: CheckContext) => Promise<Observation[]>
}

/**
 * Definición de un tool de fix.
 */
export type ToolDefinition = {
  name: string
  description: string
  /** Si true, el tool puede ejecutarse sin approval humano (acciones reversibles/baja-risk) */
  is_safe: boolean
  /** Función que ejecuta el fix */
  execute: (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolResult>
}

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

export type CheckContext = {
  sb: SupabaseClient<Database>
  /** Hora del tick (UTC), para que checks comparen contra "ahora" consistente */
  now: Date
  tickId: string
}

export type ToolContext = CheckContext & {
  /** Observación que disparó este tool (si aplica) */
  observation?: { id: string; details: Record<string, unknown> }
}
