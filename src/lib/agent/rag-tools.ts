import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { embedText, MissingOpenAIKeyError } from "./embeddings"

type DB = SupabaseClient<Database>

export type SearchCallsSemanticInput = {
  query: string
  match_count?: number
}

export type GetCallEvidenceInput = {
  lead_id: string
  topic: string
  match_count?: number
}

export const RAG_TOOLS = [
  {
    name: "search_calls_semantic",
    description:
      "Busca fragmentos relevantes en transcripciones/notas de llamadas usando similitud semántica. Úsala cuando el usuario pregunte por temas mencionados en llamadas (objeciones, preguntas frecuentes, contexto del pipeline). Filtrado automático por la marca activa.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Consulta en lenguaje natural (ej. 'objeciones de precio', 'dudas sobre dosis')" },
        match_count: { type: "number", description: "Cuántos fragmentos retornar, default 5, max 10" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_call_evidence_for_lead",
    description:
      "Busca evidencia en transcripciones/notas de las llamadas DE UN LEAD ESPECÍFICO sobre un tema. Útil para responder qué dijo un cliente sobre X antes de actuar. NUNCA inventes la cita — solo reporta lo que retorna esta tool.",
    input_schema: {
      type: "object" as const,
      properties: {
        lead_id: { type: "string", description: "UUID del lead" },
        topic: { type: "string", description: "Tema o pregunta a buscar (ej. 'qué objetó', 'qué horario prefiere')" },
        match_count: { type: "number", description: "Cuántos fragmentos retornar, default 3, max 5" },
      },
      required: ["lead_id", "topic"],
    },
  },
]

export const RAG_TOOL_NAMES = RAG_TOOLS.map((t) => t.name)

export type RagCtx = { brandId: string | null }

export async function executeRagTool(
  name: string,
  sb: DB,
  ctx: RagCtx,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    if (name === "search_calls_semantic") {
      return await executeSearchCallsSemantic(sb, ctx, input as unknown as SearchCallsSemanticInput)
    }
    if (name === "get_call_evidence_for_lead") {
      return await executeGetCallEvidenceForLead(sb, ctx, input as unknown as GetCallEvidenceInput)
    }
    return { error: "RAG tool no encontrado" }
  } catch (e) {
    if (e instanceof MissingOpenAIKeyError) {
      return { error: "RAG no disponible (falta OPENAI_API_KEY en el entorno)" }
    }
    return { error: e instanceof Error ? e.message : "Error en RAG" }
  }
}

async function executeSearchCallsSemantic(
  sb: DB,
  ctx: RagCtx,
  input: SearchCallsSemanticInput,
): Promise<unknown> {
  if (!ctx.brandId) {
    return { error: "Esta búsqueda requiere una marca activa" }
  }
  const matchCount = Math.min(10, Math.max(1, input.match_count ?? 5))

  const queryEmbedding = await embedText(input.query)
  if (queryEmbedding.length === 0) {
    return { error: "Query vacío después de normalizar" }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("match_call_embeddings", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount,
    brand: ctx.brandId,
  })

  if (error) return { error: error.message }
  return {
    results: (data ?? []) as Array<{ call_id: string; content: string; similarity: number }>,
  }
}

async function executeGetCallEvidenceForLead(
  sb: DB,
  ctx: RagCtx,
  input: GetCallEvidenceInput,
): Promise<unknown> {
  if (!ctx.brandId) {
    return { error: "Esta búsqueda requiere una marca activa" }
  }
  const matchCount = Math.min(5, Math.max(1, input.match_count ?? 3))

  // 1) Trae todos los call_ids del lead en la brand activa
  const { data: leadCalls } = await sb
    .from("calls")
    .select("id")
    .eq("lead_id", input.lead_id)
    .eq("brand_id", ctx.brandId)
  const callIds = (leadCalls ?? []).map((c) => c.id)
  if (callIds.length === 0) {
    return { results: [], note: "Lead sin llamadas registradas" }
  }

  const queryEmbedding = await embedText(input.topic)
  if (queryEmbedding.length === 0) {
    return { error: "Topic vacío" }
  }

  // 2) Match contra call_embeddings restringidos a esos call_ids
  // Usamos RPC genérica match_call_embeddings filtrando por brand, y luego
  // filtramos en JS por call_ids del lead. Eficiente si el lead tiene pocas calls.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (sb as any).rpc("match_call_embeddings", {
    query_embedding: JSON.stringify(queryEmbedding),
    match_count: matchCount * 3, // sobre-pedimos para filtrar en JS
    brand: ctx.brandId,
  })

  if (error) return { error: error.message }
  const callIdSet = new Set(callIds)
  const filtered = (data ?? [])
    .filter((r: { call_id: string }) => callIdSet.has(r.call_id))
    .slice(0, matchCount)

  return { results: filtered as Array<{ call_id: string; content: string; similarity: number }> }
}
