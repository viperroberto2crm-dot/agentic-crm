import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { resolveEffectiveBrandId, NO_BRAND_SENTINEL } from "@/lib/queries/brand-access"
import { buildCsv, buildCsvFilename, type CsvCell } from "@/lib/exports/csv"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>
type CallOutcome = Database["public"]["Enums"]["call_outcome"]
type CallDirection = Database["public"]["Enums"]["call_direction"]

type CallRow = {
  id: string
  direction: CallDirection
  outcome: CallOutcome | null
  duration_seconds: number | null
  called_at: string
  notes: string | null
  lead: { id: string; first_name: string; last_name: string | null } | null
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
  const outcome = url.searchParams.get("outcome")
  const direction = url.searchParams.get("direction")

  let query = sb
    .from("calls")
    .select(
      `id, direction, outcome, duration_seconds, called_at, notes,
       lead:leads!calls_lead_id_fkey(id, first_name, last_name),
       rep:users!calls_rep_id_fkey(id, name)`
    )
    .order("called_at", { ascending: false })

  if (role === "rep") query = query.eq("rep_id", user.id)
  if (brandId) query = query.eq("brand_id", brandId)
  if (outcome) query = query.eq("outcome", outcome as CallOutcome)
  if (direction) query = query.eq("direction", direction as CallDirection)
  if (from) query = query.gte("called_at", from)
  if (to) query = query.lte("called_at", to)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as CallRow[]

  const headers = [
    "id",
    "called_at",
    "direction",
    "outcome",
    "duration_seconds",
    "lead_name",
    "rep_name",
    "notes",
  ]

  const csvRows: CsvCell[][] = rows.map((c) => [
    c.id,
    c.called_at,
    c.direction,
    c.outcome ?? "",
    c.duration_seconds ?? "",
    c.lead
      ? `${c.lead.first_name}${c.lead.last_name ? " " + c.lead.last_name : ""}`
      : "",
    c.rep?.name ?? "",
    c.notes ?? "",
  ])

  const csv = buildCsv(headers, csvRows)
  const filename = buildCsvFilename(
    "calls",
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
