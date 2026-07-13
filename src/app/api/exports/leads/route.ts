import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { resolveEffectiveBrandId, NO_BRAND_SENTINEL } from "@/lib/queries/brand-access"
import { applyLeadSearch } from "@/lib/queries/search"
import { buildCsv, buildCsvFilename, type CsvCell } from "@/lib/exports/csv"
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

  let query = sb
    .from("leads")
    .select(
      `id, first_name, last_name, phone, email, status, source,
       ai_score, last_contacted_at, created_at, city, state, notes,
       rep:users!leads_assigned_rep_id_fkey(id, name)`
    )
    .order("created_at", { ascending: false })

  if (role === "rep") query = query.eq("assigned_rep_id", user.id)
  if (brandId) query = query.eq("brand_id", brandId)
  if (status) query = query.eq("status", status as LeadStatus)
  if (source) query = query.eq("source", source as LeadSource)
  if (search) {
    // Mismo buscador que la pantalla (AND entre palabras) → el CSV coincide con
    // lo que ve el usuario. Antes buscaba la frase completa en un solo campo.
    query = applyLeadSearch(query, search)
  }
  if (from) query = query.gte("created_at", from)
  if (to) query = query.lte("created_at", to)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as LeadExportRow[]

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
