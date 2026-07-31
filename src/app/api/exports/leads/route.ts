import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { resolveEffectiveBrandId, NO_BRAND_SENTINEL } from "@/lib/queries/brand-access"
import { applyLeadSearch } from "@/lib/queries/search"
import { buildCsv, buildCsvFilename, type CsvCell } from "@/lib/exports/csv"
import { fetchTimezone } from "@/lib/queries/dashboard"
import { activeLeadIdsInRange } from "@/lib/queries/active-leads"
import { owedLeadIdsInScope } from "@/lib/coverage/owed"
import { dateOnlyRangeToUtc, isValidYmd } from "@/lib/dashboard/date-ranges"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>
type LeadStatus = Database["public"]["Enums"]["lead_status"]
type LeadSource = Database["public"]["Enums"]["lead_source"]

type LeadExportRow = {
  id: string
  first_name: string
  last_name: string | null
  phone: string
  email: string | null
  status: LeadStatus
  source: LeadSource | null
  ai_score: number | null
  last_contacted_at: string | null
  created_at: string
  city: string | null
  state: string | null
  notes: string | null
  rep: { id: string; name: string } | null
}

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

  // Brand resolution validado contra user_brands: un NO admin no puede nombrar
  // una marca ajena (queda forzado a su marca autorizada). Admin: null = todas.
  const cookieStore = await cookies()
  const brandSlug = cookieStore.get("crm_brand_slug")?.value ?? null
  const effectiveBrandId = await resolveEffectiveBrandId(sb, user.id, role, brandSlug)
  if (effectiveBrandId === NO_BRAND_SENTINEL) {
    return NextResponse.json({ error: "Sin marca autorizada" }, { status: 403 })
  }
  const brandId: string | null = effectiveBrandId

  const url = new URL(req.url)
  const from = url.searchParams.get("from")
  const to = url.searchParams.get("to")
  const status = url.searchParams.get("status")
  const source = url.searchParams.get("source")
  const search = url.searchParams.get("search")
  const debe = url.searchParams.get("debe") === "1"

  // Provider: SOLO sus pacientes con cita (igual que la pantalla). Sin esto el
  // provider podía exportar toda la lista de la marca = fuga de datos (Fable #3).
  let providerAllow: string[] | null = null
  if (role === "provider") {
    const { data: appts } = await sb
      .from("appointments")
      .select("lead_id")
      .eq("provider_id", user.id)
      .not("lead_id", "is", null)
    providerAllow = Array.from(
      new Set(((appts ?? []) as { lead_id: string | null }[]).map((a) => a.lead_id).filter((x): x is string => Boolean(x))),
    )
  }

  const EXPORT_SELECT = `id, first_name, last_name, phone, email, status, source,
       ai_score, last_contacted_at, created_at, city, state, notes,
       rep:users!leads_assigned_rep_id_fkey(id, name)`

  // Mismos filtros que la pantalla (rol/allow-list provider/marca/status/source/
  // búsqueda). El buscador usa applyLeadSearch (AND entre palabras) → coincide.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (q: any) => {
    if (role === "rep") q = q.eq("assigned_rep_id", user.id)
    if (providerAllow) {
      if (providerAllow.length === 0) q = q.eq("id", "00000000-0000-0000-0000-000000000000")
      else q = q.in("id", providerAllow)
    }
    if (brandId) q = q.eq("brand_id", brandId)
    if (status) q = q.eq("status", status as LeadStatus)
    if (source) q = q.eq("source", source as LeadSource)
    if (search) q = applyLeadSearch(q, search)
    return q
  }

  const PAGE = 1000
  const timezone = await fetchTimezone(sb, user.id)
  const hasRange = Boolean(from && to && isValidYmd(from) && isValidYmd(to) && from <= to)

  // Set de restricción (actividad-en-periodo y/o deuda) — IDÉNTICO a la pantalla,
  // con boundaries correctos en la timezone del usuario (Fable #3/#7).
  let constraintSet: Set<string> | null = null
  if (hasRange) {
    const utc = dateOnlyRangeToUtc(from as string, to as string, timezone)
    constraintSet = new Set(await activeLeadIdsInRange(sb, utc.start, utc.end))
  }
  if (debe) {
    const owedSet = new Set(await owedLeadIdsInScope(sb))
    constraintSet = constraintSet
      ? new Set([...constraintSet].filter((id) => owedSet.has(id)))
      : owedSet
  }

  let rows: LeadExportRow[] = []

  if (constraintSet) {
    // Todos los ids que cumplen filtros (paginado, order+id desempate) ∩ restricción.
    const orderedIds: string[] = []
    for (let f = 0; f < 200_000; f += PAGE) {
      const q = applyFilters(
        sb.from("leads").select("id")
          .order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, f + PAGE - 1),
      )
      const { data, error } = await q
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const rr = (data ?? []) as { id: string }[]
      for (const r of rr) if (constraintSet.has(r.id)) orderedIds.push(r.id)
      if (rr.length < PAGE) break
    }
    // Filas completas por lotes de 200 ids (sin `.in()` gigante).
    for (let i = 0; i < orderedIds.length; i += 200) {
      const chunk = orderedIds.slice(i, i + 200)
      const { data, error } = await sb.from("leads").select(EXPORT_SELECT).in("id", chunk)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const byId = new Map<string, LeadExportRow>()
      for (const r of (data ?? []) as unknown as LeadExportRow[]) byId.set(r.id, r)
      for (const id of chunk) {
        const r = byId.get(id)
        if (r) rows.push(r)
      }
    }
  } else {
    // Sin rango/deuda: todas las filas que cumplen filtros, paginado (sin tope 1000).
    for (let f = 0; f < 200_000; f += PAGE) {
      const q = applyFilters(
        sb.from("leads").select(EXPORT_SELECT)
          .order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, f + PAGE - 1),
      )
      const { data, error } = await q
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      const rr = (data ?? []) as unknown as LeadExportRow[]
      rows.push(...rr)
      if (rr.length < PAGE) break
    }
  }

  const headers = [
    "id",
    "created_at",
    "first_name",
    "last_name",
    "phone",
    "email",
    "status",
    "source",
    "ai_score",
    "last_contacted_at",
    "city",
    "state",
    "rep_name",
    "notes",
  ]

  const csvRows: CsvCell[][] = rows.map((l) => [
    l.id,
    l.created_at,
    l.first_name,
    l.last_name ?? "",
    l.phone,
    l.email ?? "",
    l.status,
    l.source ?? "",
    l.ai_score ?? "",
    l.last_contacted_at ?? "",
    l.city ?? "",
    l.state ?? "",
    l.rep?.name ?? "",
    l.notes ?? "",
  ])

  const csv = buildCsv(headers, csvRows)
  const filename = buildCsvFilename(
    "leads",
    from && to ? { from, to } : null
  )

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
