import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

type SB = SupabaseClient<Database>

const REFLECTION_MODEL = "claude-sonnet-4-6"

const REFLECTION_SYSTEM = `Eres un analista que detecta patrones útiles en conversaciones de un agente de CRM.

Analiza la muestra de interacciones agente↔usuario y produce 1 a 5 patrones que el agente pueda aplicar en futuras conversaciones. Cada patrón debe ser:
- Específico (no genérico como "ser amable")
- Accionable (algo que el agente pueda hacer distinto)
- Basado en evidencia visible en la muestra

Tipos válidos (categoría):
- "objection_handling" — cómo responder a una objeción común
- "lead_qualification" — señales que predicen conversión
- "timing" — momentos óptimos para acciones
- "product_pitch" — cómo presentar un producto
- "other" — otro patrón relevante

Salida ESTRICTAMENTE en JSON (sin texto extra antes o después):
[{"type":"objection_handling","content":"texto del patrón en 1-3 oraciones","evidence_count":3,"confidence":0.7}]

Si no detectas patrones útiles, retorna [].`

export type ReflectionPattern = {
  type: "objection_handling" | "lead_qualification" | "timing" | "product_pitch" | "other"
  content: string
  evidence_count: number
  confidence: number
}

export type ReflectionResult = {
  runs_analyzed: number
  patterns_detected: number
  reflection_id: string | null
}

/**
 * Ejecuta una reflexión sobre las runs del bot en un período y persiste los
 * patrones detectados en knowledge_patterns + un registro en self_reflection_runs.
 */
export async function runReflection(
  sb: SB,
  opts: { brandId: string | null; sinceIso: string; untilIso: string },
): Promise<ReflectionResult> {
  const { brandId, sinceIso, untilIso } = opts

  let runsQ = sb
    .from("agent_runs")
    .select("id, run_type, triggered_by, input_summary, output_summary, created_at")
    .gte("created_at", sinceIso)
    .lt("created_at", untilIso)
    .order("created_at", { ascending: true })
    .limit(100)
  if (brandId) runsQ = runsQ.eq("brand_id", brandId)

  const { data: runsData } = await runsQ
  const runs = runsData ?? []

  if (runs.length === 0) {
    return { runs_analyzed: 0, patterns_detected: 0, reflection_id: null }
  }

  const runIds = runs.map((r) => r.id)
  const { data: actionsData } = await sb
    .from("agent_actions")
    .select("run_id, action_type, payload")
    .in("run_id", runIds)
  const actionsByRun = new Map<string, Array<{ action_type: string; payload: unknown }>>()
  for (const a of actionsData ?? []) {
    if (!a.run_id) continue
    const list = actionsByRun.get(a.run_id) ?? []
    list.push({ action_type: a.action_type, payload: a.payload as unknown })
    actionsByRun.set(a.run_id, list)
  }

  const dump = runs
    .map((r, idx) => {
      const acts = actionsByRun.get(r.id) ?? []
      const toolsLine = acts.length
        ? `\n  tools: ${acts.map((a) => a.action_type).join(" | ")}`
        : ""
      const q = (r.input_summary ?? "").slice(0, 200)
      const a = (r.output_summary ?? "").slice(0, 200)
      return `Run #${idx + 1} (${r.created_at}):\n  user: ${q}\n  bot:  ${a}${toolsLine}`
    })
    .join("\n\n")

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  async function callOnce(strictNote: string = ""): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
    const resp = await anthropic.messages.create({
      model: REFLECTION_MODEL,
      max_tokens: 2048,
      system: REFLECTION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${strictNote}Analiza la siguiente muestra de ${runs.length} interacciones del agente CRM:\n\n${dump}`,
        },
      ],
    })
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim()
    return {
      text,
      tokensIn: resp.usage?.input_tokens ?? 0,
      tokensOut: resp.usage?.output_tokens ?? 0,
    }
  }

  let { text, tokensIn, tokensOut } = await callOnce()
  let patterns = tryParsePatterns(text)
  if (!patterns) {
    const retry = await callOnce("IMPORTANTE: tu salida anterior no fue JSON válido. Esta vez devuelve SOLO el array JSON, nada más. ")
    tokensIn += retry.tokensIn
    tokensOut += retry.tokensOut
    patterns = tryParsePatterns(retry.text) ?? []
  }

  // Embedding opcional — si Capa 3 está disponible, embedea cada pattern.content
  let embedText: ((s: string) => Promise<number[]>) | null = null
  try {
    const mod = (await import("./embeddings")) as { embedText?: (s: string) => Promise<number[]> }
    if (typeof mod.embedText === "function") embedText = mod.embedText
  } catch {
    embedText = null
  }

  const insertedPatternIds: string[] = []
  for (const p of patterns) {
    if (!p.content || p.content.length < 10) continue
    let embedding: number[] | null = null
    if (embedText) {
      try {
        embedding = await embedText(p.content)
      } catch {
        embedding = null
      }
    }
    const title = p.content.slice(0, 90)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertRow: Record<string, any> = {
      brand_id: brandId,
      type: p.type,
      category: p.type,
      title,
      content: p.content,
      effectiveness_score: clamp01(p.confidence),
      evidence_count: Math.max(1, p.evidence_count | 0),
      source: "self_reflection",
      active: true,
    }
    if (embedding) insertRow.embedding = JSON.stringify(embedding)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ins } = await (sb as any)
      .from("knowledge_patterns")
      .insert(insertRow)
      .select("id")
      .single()
    if (ins?.id) insertedPatternIds.push(ins.id as string)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reflectionRow } = await (sb as any)
    .from("self_reflection_runs")
    .insert({
      period_start: sinceIso,
      period_end: untilIso,
      patterns_detected: patterns,
      total_calls_analyzed: runs.length,
      total_outcomes_analyzed: 0,
      notes: JSON.stringify({
        brand_id: brandId,
        model: REFLECTION_MODEL,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        inserted_pattern_ids: insertedPatternIds,
        summary: patterns.length
          ? `${patterns.length} patrones detectados de ${runs.length} runs`
          : `Sin patrones útiles en ${runs.length} runs analizadas`,
      }),
      duration_ms: 0,
    })
    .select("id")
    .single()

  return {
    runs_analyzed: runs.length,
    patterns_detected: insertedPatternIds.length,
    reflection_id: (reflectionRow?.id as string) ?? null,
  }
}

function tryParsePatterns(text: string): ReflectionPattern[] | null {
  // Limpia code fences y otros wrappers
  let cleaned = text.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim()
  const firstBracket = cleaned.indexOf("[")
  const lastBracket = cleaned.lastIndexOf("]")
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1)
  }
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((p): p is ReflectionPattern => {
        if (!p || typeof p !== "object") return false
        const r = p as Record<string, unknown>
        return (
          typeof r.type === "string" &&
          typeof r.content === "string" &&
          typeof r.evidence_count === "number" &&
          typeof r.confidence === "number"
        )
      })
      .slice(0, 10)
  } catch {
    return null
  }
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0.5
  return Math.max(0, Math.min(1, n))
}
