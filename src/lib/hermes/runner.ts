/**
 * HERMES — Runner del tick.
 *
 * Orquesta:
 *   1. Inicia tick (hermes_ticks row con status=running)
 *   2. Corre todos los CHECKS en paralelo
 *   3. Por cada Observation generada: persiste + dispara tool si auto_resolve+is_safe
 *   4. Persiste tick final con counts y status
 *
 * Manejo de errores: si un check throw, lo registramos como observación
 * crítica de meta-monitoring ("check XXX falló") y seguimos con los demás.
 * Si TODO falla, el tick queda con status=failed.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { CHECKS } from "./checks"
import { executeTool, findTool } from "./tools"
import {
  finishTick,
  persistObservation,
  persistResolution,
  startTick,
} from "./persistence"
import type { Observation } from "./types"

type SB = SupabaseClient<Database>

export type TickResult = {
  tick_id: string
  checks_run: number
  observations: Array<{
    id: string
    check_type: string
    severity: string
    summary: string
    resolution_status?: string
  }>
  resolutions_count: number
  duration_ms: number
}

export async function runTick(
  sb: SB,
  opts: { triggeredBy?: "cron" | "manual" } = {},
): Promise<TickResult> {
  const startTime = Date.now()
  const triggeredBy = opts.triggeredBy ?? "cron"
  const now = new Date()

  const tickId = await startTick(sb, triggeredBy)
  const ctx = { sb, now, tickId }

  let checksRun = 0
  let resolutionsCount = 0
  const persistedObs: TickResult["observations"] = []
  let failedCount = 0

  // 1) Correr checks en paralelo (cada uno aislado)
  const checkResults = await Promise.all(
    CHECKS.map(async (check) => {
      try {
        const obs = await check.run(ctx)
        return { check: check.name, observations: obs, error: null as string | null }
      } catch (err) {
        return {
          check: check.name,
          observations: [] as Observation[],
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  // 2) Procesar resultados de cada check
  for (const result of checkResults) {
    checksRun++

    // Si el check falló, registrar como meta-observation crítica
    if (result.error) {
      failedCount++
      try {
        const obsId = await persistObservation(sb, tickId, {
          check_type: "hermes_meta_check_failed",
          severity: "critical",
          summary: `Check '${result.check}' lanzó error: ${result.error}`,
          details: { failed_check: result.check, error: result.error },
        })
        persistedObs.push({
          id: obsId,
          check_type: "hermes_meta_check_failed",
          severity: "critical",
          summary: `Check '${result.check}' lanzó error`,
        })
      } catch {
        // si no podemos persistir, seguimos
      }
      continue
    }

    // 3) Procesar cada observation que el check generó
    for (const obs of result.observations) {
      let obsId: string
      try {
        obsId = await persistObservation(sb, tickId, obs)
      } catch {
        continue
      }

      const persisted = {
        id: obsId,
        check_type: obs.check_type,
        severity: obs.severity,
        summary: obs.summary,
        resolution_status: undefined as string | undefined,
      }

      // 4) Si hay suggested_tool y auto_resolve, intentar fix automático
      if (obs.suggested_tool && obs.auto_resolve) {
        const tool = findTool(obs.suggested_tool)
        if (tool && tool.is_safe) {
          try {
            const toolResult = await executeTool(
              obs.suggested_tool,
              { ...ctx, observation: { id: obsId, details: obs.details } },
              {},
            )
            await persistResolution(
              sb,
              obsId,
              obs.suggested_tool,
              {},
              toolResult,
              "auto",
            )
            resolutionsCount++
            persisted.resolution_status = toolResult.status
          } catch (err) {
            await persistResolution(
              sb,
              obsId,
              obs.suggested_tool,
              {},
              {
                status: "failed",
                output: {},
                error: err instanceof Error ? err.message : String(err),
              },
              "auto",
            )
            resolutionsCount++
            persisted.resolution_status = "failed"
          }
        }
      }

      persistedObs.push(persisted)
    }
  }

  // 5) Cerrar tick
  const tickStatus = failedCount === checksRun && checksRun > 0 ? "failed" : "completed"
  await finishTick(
    sb,
    tickId,
    {
      checks_run: checksRun,
      observations_count: persistedObs.length,
      resolutions_count: resolutionsCount,
    },
    tickStatus,
    failedCount > 0 ? `${failedCount}/${checksRun} checks fallaron` : undefined,
  )

  return {
    tick_id: tickId,
    checks_run: checksRun,
    observations: persistedObs,
    resolutions_count: resolutionsCount,
    duration_ms: Date.now() - startTime,
  }
}
