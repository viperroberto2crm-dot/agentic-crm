import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { resolveEffectiveBrandId, NO_BRAND_SENTINEL } from "@/lib/queries/brand-access"
import { buildCsv, buildCsvFilename, type CsvCell } from "@/lib/exports/csv"
import type { Database } from "@/types/database"

type TypedClient = SupabaseClient<Database>
type SaleStatus = Database["public"]["Enums"]["payment_status"]

type SaleRow = {
  id: string
  amount_cents: number
  payment_method: Database["public"]["Enums"]["payment_method"]
  payment_status: SaleStatus
  paid_at: string | null
  created_at: string
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
  const statusFilter = url.searchParams.get("status")

  let query = sb
    .from("sales")
    .select(
      `id, amount_cents, payment_method, payment_status, paid_at, created_at, notes,
       lead:leads!sales_lead_id_fkey(id, first_name, last_name),
       rep:users!sales_rep_id_fkey(id, name)`
    )
    .order("created_at", { ascending: false })

  // Role-based filter — reps only see their own sales.
  if (role === "rep") query = query.eq("rep_id", user.id)
  if (brandId) query = query.eq("brand_id", brandId)
  if (statusFilter) {
    query = query.eq("payment_status", statusFilter as SaleStatus)
  }
  if (from) query = query.gte("created_at", from)
  if (to) query = query.lte("created_at", to)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as unknown as SaleRow[]

  const headers = [
    "id",
    "created_at",
    "paid_at",
    "lead_name",
    "amount_usd",
    "payment_method",
    "payment_status",
    "rep_name",
    "notes",
  ]

  const csvRows: CsvCell[][] = rows.map((s) => [
    s.id,
    s.created_at,
    s.paid_at ?? "",
    s.lead
      ? `${s.lead.first_name}${s.lead.last_name ? " " + s.lead.last_name : ""}`
      : "",
    (s.amount_cents / 100).toFixed(2),
    s.payment_method,
    s.payment_status,
    s.rep?.name ?? "",
    s.notes ?? "",
  ])

  const csv = buildCsv(headers, csvRows)
  const filename = buildCsvFilename(
    "sales",
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
