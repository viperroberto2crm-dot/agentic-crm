import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type DB = SupabaseClient<Database>

// ---------- Constantes configurables ----------
/**
 * Umbral total (tokens_in + tokens_out de las runs no compactadas) a partir
 * del cual se dispara una nueva compaction. Default: 6000.
 * En el futuro puede moverse a env var sin tocar consumidores.
 */
export const COMPACTION_THRESHOLD_TOKENS = 6000

/**
 * Número de runs más recientes que NUNCA se compactan: actúan como
 * ventana de seguridad para preservar el contexto inmediato del usuario.
 */
export const COMPACTION_KEEP_LAST = 2

/**
 * Tamaño de la ventana de historial sin compaction.
 * Mantiene paridad con HISTORY_LIMIT del route handler.
 */
export const HISTORY_LIMIT_DEFAULT = 5

/**
 * Modelo Haiku 4.5 — barato y rápido para generar resúmenes.
 */
const COMPACTION_MODEL = "claude-haiku-4-5-20251001"

/** Tope superior para el resumen generado por Haiku. */
const COMPACTION_MAX_OUTPUT_TOKENS = 400

// ---------- Tipos públicos ----------
export type AgentRun = {
  id: string
  input_summary: string
  output_summary: string
  tokens_in: number | null
  tokens_out: number | null
  created_at: string
}

export type HistoryWithCompaction = {
  summary: string | null
  /** Runs no compactadas, en orden cronológico ASC (más antigua primero). */
  runs: AgentRun[]
}

export type LoadHistoryOptions = {
  /** Cuántas runs cargar si NO hay compaction. Default: 5. */
  limit?: number
}

export type MaybeCompactOptions = {
  /** Override del umbral de tokens. Default: COMPACTION_THRESHOLD_TOKENS. */
  thresholdTokens?: number
  /** Cuántas runs preservar intactas al final. Default: COMPACTION_KEEP_LAST. */
  keepLast?: number
  /** Window de historial cuando NO hay compaction. Default: 5. */
  limit?: number
}

// ---------- Helpers internos ----------

async function loadLatestCompaction(sb: DB, userId: string) {
  const { data } = await sb
    .from("agent_compactions")
    .select("id, summary, up_to_run_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function loadRunsAfter(
  sb: DB,
  userId: string,
  afterRunCreatedAt: string
): Promise<AgentRun[]> {
  const { data } = await sb
    .from("agent_runs")
    .select("id, input_summary, output_summary, tokens_in, tokens_out, created_at")
    .eq("triggered_by", userId)
    .eq("run_type", "ask")
    .is("error", null)
    .not("output_summary", "is", null)
    .gt("created_at", afterRunCreatedAt)
    .order("created_at", { ascending: true })

  return ((data ?? []) as Array<{
    id: string
    input_summary: string | null
    output_summary: string | null
    tokens_in: number | null
    tokens_out: number | null
    created_at: string
  }>)
    .filter((r) => r.input_summary && r.output_summary)
    .map((r) => ({
      id: r.id,
      input_summary: r.input_summary as string,
      output_summary: r.output_summary as string,
      tokens_in: r.tokens_in,
      tokens_out: r.tokens_out,
      created_at: r.created_at,
    }))
}

async function loadLastNRuns(
  sb: DB,
  userId: string,
  limit: number
): Promise<AgentRun[]> {
  const { data } = await sb
    .from("agent_runs")
    .select("id, input_summary, output_summary, tokens_in, tokens_out, created_at")
    .eq("triggered_by", userId)
    .eq("run_type", "ask")
    .is("error", null)
    .not("output_summary", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit)

  return ((data ?? []) as Array<{
    id: string
    input_summary: string | null
    output_summary: string | null
    tokens_in: number | null
    tokens_out: number | null
    created_at: string
  }>)
    .filter((r) => r.input_summary && r.output_summary)
    .reverse() // a ASC para inyectar al modelo
    .map((r) => ({
      id: r.id,
      input_summary: r.input_summary as string,
      output_summary: r.output_summary as string,
      tokens_in: r.tokens_in,
      tokens_out: r.tokens_out,
      created_at: r.created_at,
    }))
}

async function getRunCreatedAt(sb: DB, runId: string): Promise<string | null> {
  const { data } = await sb
    .from("agent_runs")
    .select("created_at")
    .eq("id", runId)
    .maybeSingle()
  return data?.created_at ?? null
}

function dumpRunsForSummary(runs: AgentRun[]): string {
  return runs
    .map((r, i) => {
      return `--- Turno ${i + 1} (${r.created_at}) ---\nUSUARIO: ${r.input_summary}\nAGENTE: ${r.output_summary}`
    })
    .join("\n\n")
}

// ---------- API pública ----------

/**
 * Carga el historial efectivo del user para inyectarlo a Claude.
 * - Si existe una compaction previa: retorna { summary, runs posteriores a esa compaction }.
 * - Si no existe: retorna { summary: null, últimas N runs }.
 */
export async function loadHistoryWithCompaction(
  sb: DB,
  userId: string,
  options: LoadHistoryOptions = {}
): Promise<HistoryWithCompaction> {
  const limit = options.limit ?? HISTORY_LIMIT_DEFAULT
  const compaction = await loadLatestCompaction(sb, userId)

  if (!compaction) {
    const runs = await loadLastNRuns(sb, userId, limit)
    return { summary: null, runs }
  }

  // Anchor: timestamp de la run hasta la que se compactó.
  let afterTs: string | null = null
  if (compaction.up_to_run_id) {
    afterTs = await getRunCreatedAt(sb, compaction.up_to_run_id)
  }
  // Fallback: si la run referenciada ya no existe, usamos created_at del compaction
  // (aproximación segura: cualquier run anterior al insert ya quedó incluida).
  if (!afterTs) afterTs = compaction.created_at

  const runs = await loadRunsAfter(sb, userId, afterTs)
  return { summary: compaction.summary, runs }
}

/**
 * Si las runs no compactadas exceden el threshold de tokens, genera un nuevo
 * resumen con Haiku 4.5 y persiste una nueva fila en `agent_compactions`.
 *
 * Best-effort: NO lanza errores hacia arriba; los loggea y retorna `false`.
 * El caller siempre puede continuar con el flujo normal.
 *
 * Retorna `true` si se ejecutó una compaction nueva, `false` si fue no-op o falló.
 */
export async function maybeCompact(
  sb: DB,
  userId: string,
  brandId: string | null,
  anthropic: Anthropic,
  options: MaybeCompactOptions = {}
): Promise<boolean> {
  const threshold = options.thresholdTokens ?? COMPACTION_THRESHOLD_TOKENS
  const keepLast = options.keepLast ?? COMPACTION_KEEP_LAST
  const limit = options.limit ?? HISTORY_LIMIT_DEFAULT

  try {
    const history = await loadHistoryWithCompaction(sb, userId, { limit })
    const runs = history.runs

    // Total de tokens de las runs no compactadas (excluye el summary previo).
    const totalTokens = runs.reduce(
      (acc, r) => acc + (r.tokens_in ?? 0) + (r.tokens_out ?? 0),
      0
    )

    if (totalTokens < threshold) return false
    // Sólo compactamos si quedan runs viejas más allá de la ventana protegida.
    if (runs.length <= keepLast) return false

    const toCompact = runs.slice(0, runs.length - keepLast)
    if (toCompact.length === 0) return false

    const lastCompactedRun = toCompact[toCompact.length - 1]

    const previousSummaryBlock = history.summary
      ? `\n\nResumen previo (de turnos anteriores): ${history.summary} — incorpora también esta información al nuevo resumen.`
      : ""

    const prompt = `Resume estos turnos del agente CRM en máximo 250 tokens. Mantén:
- Entidades clave (lead_ids, montos, decisiones tomadas)
- Hilos de conversación abiertos
- Preferencias o contexto del usuario
Formato: texto plano, denso, sin saludos.

Conversación a resumir:
${dumpRunsForSummary(toCompact)}${previousSummaryBlock}`

    const resp = await anthropic.messages.create({
      model: COMPACTION_MODEL,
      max_tokens: COMPACTION_MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: prompt }],
    })

    const summary = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("")
      .trim()

    if (!summary) {
      console.warn("[agent/compaction] Haiku devolvió summary vacío, skip insert")
      return false
    }

    const { error } = await sb.from("agent_compactions").insert({
      user_id: userId,
      brand_id: brandId,
      summary,
      up_to_run_id: lastCompactedRun.id,
      tokens_input: resp.usage?.input_tokens ?? null,
      tokens_output: resp.usage?.output_tokens ?? null,
    })

    if (error) {
      console.error("[agent/compaction] insert error:", error)
      return false
    }

    return true
  } catch (err) {
    console.error("[agent/compaction] maybeCompact falló:", err)
    return false
  }
}
