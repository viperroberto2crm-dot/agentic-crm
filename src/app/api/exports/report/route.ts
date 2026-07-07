import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import { getLocale } from "next-intl/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getBrandIdBySlug } from "@/lib/queries/dashboard"
import { resolveEffectiveBrandId, NO_BRAND_SENTINEL } from "@/lib/queries/brand-access"
import type { Database } from "@/types/database"
import { buildReportData, type ReportFilters } from "@/lib/exports/report-data"
import { buildReportWorkbook, buildReportFilename } from "@/lib/exports/xlsx-builder"
import { isReportLang, type ReportLang } from "@/lib/exports/translations"

export const runtime = "nodejs"
export const maxDuration = 60

type TypedClient = SupabaseClient<Database>

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sb = supabase as unknown as TypedClient
  const { data: profile } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single()
  const role = (profile?.role ?? "rep") as string

  const url = new URL(req.url)
  const fromParam = url.searchParams.get("from")
  const toParam = url.searchParams.get("to")
  const brandSlugParam = url.searchParams.get("brand")
  const historicoParam = url.searchParams.get("historico") === "true"
  const statusParam = url.searchParams.get("status") as
    | "all"
    | "paid"
    | "pending"
    | null

  // Resolver brand (SEGURIDAD): solo un admin puede nombrar la marca vía el
  // parámetro ?brand= (prioridad sobre cookie). Un NO admin no puede pedir el
  // reporte de una marca ajena → se ignora ?brand= y se fuerza su marca
  // autorizada (o 403 si no tiene ninguna).
  let brandId: string | null = null
  if (role === "admin") {
    if (brandSlugParam) {
      brandId = await getBrandIdBySlug(brandSlugParam, sb)
      if (!brandId) {
        return NextResponse.json(
          { error: `Marca no encontrada: ${brandSlugParam}` },
          { status: 400 },
        )
      }
    }
    // Sin ?brand= → brandId null (todas las marcas), acceso global admin.
  } else {
    // NO admin: ?brand= se descarta. Se resuelve su marca autorizada partiendo
    // de la cookie del switcher (si apunta a una ajena, cae a la primera suya).
    const cookieStore = await cookies()
    const cookieSlug = cookieStore.get("crm_brand_slug")?.value ?? null
    const effectiveBrandId = await resolveEffectiveBrandId(sb, user.id, role, cookieSlug)
    if (effectiveBrandId === NO_BRAND_SENTINEL) {
      return NextResponse.json({ error: "Sin marca autorizada" }, { status: 403 })
    }
    brandId = effectiveBrandId
  }

  // Validar rango si no es histórico
  if (!historicoParam) {
    if (!fromParam || !toParam) {
      return NextResponse.json(
        { error: "from/to son requeridos cuando historico=false" },
        { status: 400 },
      )
    }
  }

  const filters: ReportFilters = {
    from: historicoParam ? null : fromParam,
    to: historicoParam ? null : toParam,
    historico: historicoParam,
    brandId,
    repId: null,
    status: statusParam ?? "all",
  }

  // Idioma: query param `?lang=en|es` tiene prioridad (para que el bot pueda
  // pedir explícito). Si no, usa el locale activo del usuario en next-intl
  // (cookie NEXT_LOCALE seteada por LocaleSwitcher).
  const langParam = url.searchParams.get("lang")
  let lang: ReportLang
  if (isReportLang(langParam)) {
    lang = langParam
  } else {
    const locale = await getLocale()
    lang = isReportLang(locale) ? locale : "es"
  }

  const result = await buildReportData(
    sb,
    { userId: user.id, role, lang },
    filters,
  )

  if (!result.ok) {
    const status =
      result.code === "too_large" ? 413 :
      result.code === "invalid_range" ? 400 :
      result.code === "no_brand_access" ? 403 :
      500
    return NextResponse.json({ error: result.error, code: result.code }, { status })
  }

  let buffer: Buffer
  try {
    buffer = buildReportWorkbook(result.data, lang)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[exports/report] buildReportWorkbook falló:", message)
    return NextResponse.json(
      { error: "No se pudo generar el archivo Excel" },
      { status: 500 },
    )
  }

  const filename = buildReportFilename(result.data, lang)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  })
}
