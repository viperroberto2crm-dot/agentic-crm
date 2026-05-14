import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { embedText } from "./embeddings"

type SB = SupabaseClient<Database>

export type ActiveSkill = {
  skill_id: string
  name: string
  procedure_md: string
  similarity: number
}

/**
 * Selecciona las skills activas (status='production') más relevantes para el
 * query del usuario, scoped a la marca. Retorna [] si no hay OPENAI_API_KEY
 * (no rompe — el bot funciona sin skills inyectadas).
 *
 * @param sb           Service client
 * @param query        Texto del usuario actual
 * @param brandId      Marca activa (si null, sólo skills globales sin brand)
 * @param k            Cuántas skills traer (default 3, max 5)
 */
export async function selectActiveSkills(
  sb: SB,
  query: string,
  brandId: string | null,
  k: number = 3,
): Promise<ActiveSkill[]> {
  if (!process.env.OPENAI_API_KEY) return []
  if (!query?.trim()) return []
  if (!brandId) return [] // requerimos brand para no leakear cross-tenant

  try {
    const queryEmbedding = await embedText(query)
    if (queryEmbedding.length === 0) return []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (sb as any).rpc("match_active_skills", {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: Math.min(5, Math.max(1, k)),
      brand: brandId,
    })

    if (error) {
      console.error("[skills] match_active_skills error:", error.message)
      return []
    }
    // Filtra por similarity threshold mínimo (0.5) para evitar inyectar skills irrelevantes
    return (data ?? [])
      .filter((s: ActiveSkill) => s.similarity >= 0.5)
      .map((s: ActiveSkill) => ({
        skill_id: s.skill_id,
        name: s.name,
        procedure_md: s.procedure_md ?? "",
        similarity: s.similarity,
      })) as ActiveSkill[]
  } catch (err) {
    console.error("[skills] selectActiveSkills falló:", err)
    return []
  }
}

/**
 * Formatea las skills como un bloque markdown para inyectar al system prompt.
 * Si el array está vacío retorna null para que el caller decida no añadir el bloque.
 */
export function formatSkillsForPrompt(skills: ActiveSkill[]): string | null {
  if (skills.length === 0) return null
  const lines = skills.map(
    (s, i) =>
      `${i + 1}. **${s.name}** (similarity ${s.similarity.toFixed(2)}):\n${s.procedure_md.trim()}`,
  )
  return [
    "Skills aprendidas relevantes a la consulta actual (úsalas como guía cuando apliquen):",
    "",
    ...lines,
  ].join("\n")
}
