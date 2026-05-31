/**
 * HERMES — Self-healing tools.
 *
 * Cada tool toma input estructurado y ejecuta una acción concreta.
 * Tools marcados is_safe=true pueden correr sin approval. Los demás
 * devuelven status='requires_approval' y esperan acción humana.
 *
 * Sprint 1: solo auto_link_calls_to_leads (único safe + de valor inmediato).
 * El resto de observations escalan para review humano.
 */

import type { ToolDefinition, ToolContext, ToolResult } from "./types"

// ── Tool 1: auto-linkear calls sin lead a leads existentes por phone ────────
const TOOL_AUTO_LINK_CALLS: ToolDefinition = {
  name: "auto_link_calls_to_leads",
  description:
    "Recorre calls con lead_id=NULL del rango, intenta matchear caller phone con leads existentes del mismo brand. Si matchea, setea lead_id. Safe: solo escribe lead_id en calls, no toca leads.",
  is_safe: true,
  async execute(ctx: ToolContext): Promise<ToolResult> {
    const since = new Date(ctx.now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    // 1) Cargar calls sin lead (con caller_phone si existe en notes o tabla)
    // El schema de calls actual NO tiene phone directo — el phone está en
    // el lead. Para matchear, necesitamos buscar en una tabla intermedia o
    // en algún lugar donde se guardó el caller phone original.
    //
    // En el webhook 800.com receiver vimos: cuando NO matchea lead, se
    // inserta call con lead_id=null. Pero no guarda el caller_phone en
    // ningún campo accesible. Esto es una limitación.
    //
    // Workaround Sprint 1: solo logueamos cuántas calls sin lead hay y
    // pedimos al webhook receiver guardar caller_phone en metadata para
    // futuro auto-link. Reportamos como diagnostic.

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows } = await (ctx.sb as any)
      .from("calls")
      .select("id, brand_id, external_id, called_at, notes")
      .is("lead_id", null)
      .gte("called_at", since)
      .limit(500)

    const calls = (rows ?? []) as Array<{
      id: string
      brand_id: string
      external_id: string | null
      called_at: string
      notes: string | null
    }>

    return {
      status: "requires_approval",
      output: {
        analyzed_count: calls.length,
        linked_count: 0,
        reason:
          "Schema actual de calls no almacena caller_phone (solo external_id). Para auto-link necesitamos primero modificar webhook receiver para guardar caller_e164 en una columna nueva o en metadata JSONB. Reporte: " +
          calls.length +
          " calls sin lead encontradas en últimas 24h.",
      },
      approval_reason:
        "Auto-link requiere agregar columna calls.caller_phone_e164 + migrar webhook receiver. Acción manual: crear migración SQL y actualizar /api/webhooks/800com/voice para guardar el phone del caller.",
    }
  },
}

export const TOOLS: ToolDefinition[] = [TOOL_AUTO_LINK_CALLS]

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name)
}

export async function executeTool(
  toolName: string,
  ctx: ToolContext,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = findTool(toolName)
  if (!tool) {
    return {
      status: "failed",
      output: {},
      error: `Tool desconocido: ${toolName}`,
    }
  }
  try {
    return await tool.execute(ctx, input)
  } catch (err) {
    return {
      status: "failed",
      output: {},
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
