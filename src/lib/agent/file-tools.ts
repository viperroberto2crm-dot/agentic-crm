/**
 * File tools del bot — generan artefactos descargables (xlsx/csv/pdf).
 *
 * Patrón:
 *   - El bot llama la tool con parámetros opcionales en lenguaje natural
 *   - La tool ejecuta queries (respetando rol del user), genera el archivo,
 *     lo sube a Supabase Storage bucket privado 'reports/', y devuelve un
 *     signed URL con expiración corta.
 *
 * Por ahora solo `generate_sales_report` (Sub-proyecto #1 del roadmap
 * "Claude adentro del CRM"). Más tools (PDF de invoices, CSV de leads, etc.)
 * se agregan acá en futuros sprints.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { buildReportData, type ReportFilters } from "@/lib/exports/report-data"
import { buildReportWorkbook, buildReportFilename } from "@/lib/exports/xlsx-builder"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"

type DB = SupabaseClient<Database>

export type FileToolCtx = {
  userId: string
  role: "rep" | "manager" | "admin" | string
  brandId: string | null
}

export type FileToolResult =
  | { ok: true; result: { download_url: string; expires_at: string; filename: string; summary: string } }
  | { ok: false; error: string }

const SIGNED_URL_EXPIRY_SECONDS = 24 * 60 * 60 // 24 horas
const STORAGE_BUCKET = "reports"

// ── Tool definitions (Anthropic format) ──────────────────────────────────────

export const FILE_TOOLS = [
  {
    name: "generate_sales_report",
    description:
      "Genera un reporte Excel (.xlsx) de ventas con 3 hojas: KPIs, Resumen por paciente, y Transacciones detalladas. Devuelve un link de descarga que expira en 24h. " +
      "Usá esta tool cuando el usuario pida 'mandame un Excel', 'generá un reporte', 'cuánto cobramos este mes en formato Excel', 'reporte de ventas de marzo', etc. " +
      "Si el usuario no especifica un rango, default = este mes. Si pide 'todo' o 'histórico', usá historico=true.",
    input_schema: {
      type: "object" as const,
      properties: {
        from: {
          type: "string",
          description:
            "Fecha inicial YYYY-MM-DD. Omitir si historico=true. Si el usuario dice 'marzo' inferir el mes completo del año actual.",
        },
        to: {
          type: "string",
          description:
            "Fecha final YYYY-MM-DD. Omitir si historico=true.",
        },
        brand: {
          type: "string",
          enum: ["all", "sisepierde", "sunnyslim"],
          description:
            "Marca a incluir. 'all' (default) incluye todas las marcas en un solo archivo con columna Marca. Usá la marca específica cuando el usuario la nombre.",
        },
        rep_name: {
          type: "string",
          description:
            "Nombre del rep para filtrar (match contra users.name, case-insensitive, partial). Solo aplicable si el user actual es admin o manager. Omitir para incluir todos los reps.",
        },
        status: {
          type: "string",
          enum: ["all", "paid", "pending"],
          description:
            "Filtrar transacciones por status de cobro. Default 'all'.",
        },
        historico: {
          type: "boolean",
          description:
            "Si true, ignora from/to y genera todo el histórico de ventas. Default false.",
        },
      },
    },
  },
]

export const FILE_TOOL_NAMES = new Set<string>(FILE_TOOLS.map((t) => t.name))

export function isFileToolName(name: string): boolean {
  return FILE_TOOL_NAMES.has(name)
}

// ── Executor ──────────────────────────────────────────────────────────────────

type GenerateSalesReportInput = {
  from?: string
  to?: string
  brand?: "all" | "sisepierde" | "sunnyslim"
  rep_name?: string
  status?: "all" | "paid" | "pending"
  historico?: boolean
}

async function executeGenerateSalesReport(
  sb: DB,
  ctx: FileToolCtx,
  input: GenerateSalesReportInput,
): Promise<FileToolResult> {
  try {
    // Resolver brand slug → brandId
    let brandId: string | null = null
    if (input.brand && input.brand !== "all") {
      brandId = await getBrandIdBySlug(input.brand, sb)
      if (!brandId) {
        return { ok: false, error: "No encontré datos para los filtros indicados." }
      }
    }

    // Resolver rep_name → repId (solo si user es admin/manager)
    let repId: string | null = null
    if (input.rep_name && (ctx.role === "admin" || ctx.role === "manager")) {
      const trimmed = input.rep_name.trim()
      if (trimmed.length > 0) {
        const { data: repRow } = await sb
          .from("users")
          .select("id")
          .ilike("name", `%${trimmed}%`)
          .limit(1)
          .maybeSingle()
        if (!repRow) {
          // Mensaje genérico — evita info-leak (ver spec, decisión de seguridad)
          return { ok: false, error: "No encontré datos para los filtros indicados." }
        }
        repId = (repRow as { id: string }).id
      }
    }
    // Si role=rep, ignoramos rep_name y forzamos el propio user (resolveScope lo hace)

    // Default range: si no es histórico Y no vinieron fechas, usamos mes actual
    let from = input.from ?? null
    let to = input.to ?? null
    const historico = input.historico ?? false
    if (!historico && (!from || !to)) {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      from = start.toISOString()
      to = new Date().toISOString()
    }

    const filters: ReportFilters = {
      from: historico ? null : from,
      to: historico ? null : to,
      historico,
      brandId,
      repId,
      status: input.status ?? "all",
    }

    // 1) Datos
    const dataResult = await buildReportData(sb, ctx, filters)
    if (!dataResult.ok) {
      return { ok: false, error: dataResult.error }
    }

    // 2) Workbook
    const buffer = buildReportWorkbook(dataResult.data)
    const filename = buildReportFilename(dataResult.data)

    // 3) Upload a Storage
    const path = `${ctx.userId}/${Date.now()}_${filename}`
    const { error: uploadErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, buffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      })

    if (uploadErr) {
      const msg = uploadErr.message ?? "Error subiendo el archivo"
      console.error("[file-tools] upload falló:", msg)
      // Si el bucket no existe, mensaje útil
      if (/Bucket not found/i.test(msg)) {
        return {
          ok: false,
          error:
            "Bucket 'reports' no configurado en Supabase Storage. Setup pendiente — avisá al admin.",
        }
      }
      return { ok: false, error: `No se pudo subir el reporte: ${msg}` }
    }

    // 4) Signed URL (24h)
    const { data: urlData, error: urlErr } = await sb.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS)

    if (urlErr || !urlData?.signedUrl) {
      return {
        ok: false,
        error: `Reporte generado pero no se pudo crear link de descarga: ${urlErr?.message ?? "unknown"}`,
      }
    }

    const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString()

    const summary =
      `Reporte generado: ${dataResult.data.meta.row_counts.resumen} pacientes, ` +
      `${dataResult.data.meta.row_counts.transacciones} transacciones. ` +
      `Periodo: ${dataResult.data.kpis.periodo_label}. ` +
      `Marca: ${dataResult.data.kpis.marca_label}. ` +
      `Total cobrado en periodo: $${(dataResult.data.kpis.total_cobrado_cents / 100).toFixed(2)}.`

    return {
      ok: true,
      result: {
        download_url: urlData.signedUrl,
        expires_at: expiresAt,
        filename,
        summary,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[file-tools] generate_sales_report excepción:", msg)
    return { ok: false, error: msg }
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function executeFileTool(
  name: string,
  sb: DB,
  ctx: FileToolCtx,
  input: Record<string, unknown>,
): Promise<FileToolResult> {
  switch (name) {
    case "generate_sales_report":
      return executeGenerateSalesReport(sb, ctx, input as GenerateSalesReportInput)
    default:
      return { ok: false, error: `file tool no encontrada: ${name}` }
  }
}
